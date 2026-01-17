import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

/* =========================
   DISCORD CLIENT
========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

/* =========================
   GEMINI SETUP
========================= */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash',
  systemInstruction: `
Bạn là trợ lý AI trò chuyện trên Discord.

Quy tắc:
- Luôn trả lời bằng tiếng Việt
- Ngắn gọn, rõ ràng, đúng trọng tâm
- Không tự giới thiệu bạn là AI hay mô hình ngôn ngữ
- Không roleplay, không lan man
- Nếu người dùng gửi tin dài / tin chuyển tiếp → hãy tóm tắt và giải thích
- Chỉ dùng Markdown khi thật sự cần
`,
  generationConfig: {
    temperature: 0.5,
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 2048,
  },
});

/* =========================
   MEMORY (DM = user, SERVER = channel)
========================= */
const conversationHistory = new Map();

/* =========================
   READY
========================= */
client.once('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log(`🤖 Model: gemini-2.0-flash`);
});

/* =========================
   MESSAGE HANDLER
========================= */
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    const isDM = message.channel.type === 1;
    const isMentioned = message.mentions.has(client.user);
    const isReply = Boolean(message.reference?.messageId);

    // Server: chỉ trả lời khi mention hoặc reply
    if (!isDM && !isMentioned && !isReply) return;

    await message.channel.sendTyping();

    /* ========= MEMORY KEY ========= */
    const historyKey = isDM ? message.author.id : message.channelId;
    if (!conversationHistory.has(historyKey)) {
      conversationHistory.set(historyKey, []);
    }
    const history = conversationHistory.get(historyKey);

    /* ========= CLEAN USER MESSAGE ========= */
    let userMessage = message.content
      .replace(/<@!?\d+>/g, '')
      .trim();

    // Nếu nội dung rỗng nhưng message dài (forward, embed, mention role)
    if (!userMessage && message.content.length > 50) {
      userMessage = 'Hãy giải thích nội dung trên một cách dễ hiểu.';
    }

    if (!userMessage) {
      await message.reply('Bạn muốn hỏi gì? 🤔');
      return;
    }

    /* ========= HANDLE REPLY ========= */
    if (isReply) {
      try {
        const replied = await message.channel.messages.fetch(
          message.reference.messageId
        );

        userMessage = `
Context (tin nhắn trước của ${replied.author.username}):
"${replied.content || '[Không có nội dung]'}"

User hỏi:
${userMessage}
        `.trim();
      } catch {
        // bỏ qua nếu fetch fail
      }
    }

    /* ========= LONG / FORWARDED MESSAGE INTENT ========= */
    if (userMessage.length > 400) {
      userMessage = `
Người dùng gửi một nội dung dài và hỏi: "là sao?"

Hãy:
- Tóm tắt nội dung
- Giải thích ngắn gọn, dễ hiểu
- Không nói về bản thân bạn

Nội dung:
${userMessage}
      `.trim();
    }

    /* ========= PUSH TO HISTORY ========= */
    history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    /* ========= GEMINI CHAT ========= */
    const chat = model.startChat({
      history: history.length > 1 ? history.slice(0, -1) : [],
    });

    const result = await chat.sendMessage(userMessage);
    const botReply = result.response.text();

    history.push({
      role: 'model',
      parts: [{ text: botReply }],
    });

    /* ========= SEND RESPONSE ========= */
    if (botReply.length > 2000) {
      const chunks = botReply.match(/[\s\S]{1,2000}/g) || [];
      await message.reply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send(chunks[i]);
      }
    } else {
      await message.reply(botReply);
    }

  } catch (err) {
    console.error('❌ Error:', err);
    try {
      await message.reply('⚠️ Có lỗi xảy ra, thử lại sau nhé.');
    } catch {}
  }
});

/* =========================
   ERROR HANDLING
========================= */
process.on('unhandledRejection', console.error);
client.on('error', console.error);

/* =========================
   LOGIN
========================= */
client.login(process.env.DISCORD_TOKEN);
