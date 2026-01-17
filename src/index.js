import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

/* =======================
   DISCORD CLIENT
======================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

/* =======================
   GEMINI AI
======================= */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction: `
Bạn là trợ lý AI trên Discord.
Luôn trả lời bằng tiếng Việt.
Ngắn gọn, rõ ràng, đúng trọng tâm.
Không bịa đặt.
Nếu không đủ thông tin, nói rõ là không đủ.
`,
  generationConfig: {
    temperature: 0.5,
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 2048,
  },
});

/* =======================
   LƯU LỊCH SỬ CHAT
======================= */
const conversationHistory = new Map();

/* =======================
   READY
======================= */
client.once('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

/* =======================
   MESSAGE HANDLER
======================= */
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = message.channel.type === 1; // DM
  const isMentioned = message.mentions.has(client.user);
  const isReply = message.reference?.messageId;

  // Server: chỉ trả lời khi mention hoặc reply
  if (!isDM && !isMentioned && !isReply) return;

  /* ====== CHẶN FORWARD ====== */
  if (
    message.content.trim() === '' &&
    message.embeds.length > 0
  ) {
    await message.reply(
      '⚠️ **Discord không cho bot đọc nội dung chuyển tiếp.**\n' +
      '👉 Hãy **Reply trực tiếp tin gốc** hoặc **copy nội dung** rồi gửi lại.'
    );
    return;
  }

  await message.channel.sendTyping();

  try {
    const historyKey = isDM ? message.author.id : message.channelId;
    if (!conversationHistory.has(historyKey)) {
      conversationHistory.set(historyKey, []);
    }
    const history = conversationHistory.get(historyKey);

    // Lấy nội dung người dùng
    let userMessage = message.content
      .replace(/<@!?\d+>/g, '')
      .trim();

    if (!userMessage) {
      await message.reply('🤔 Bạn muốn hỏi gì?');
      return;
    }

    /* ====== CONTEXT REPLY ====== */
    if (isReply) {
      try {
        const repliedMsg = await message.channel.messages.fetch(
          message.reference.messageId
        );
        userMessage =
          `Tin nhắn gốc:\n"${repliedMsg.content}"\n\n` +
          `Người dùng hỏi: ${userMessage}`;
      } catch {
        console.log('⚠️ Không fetch được tin reply');
      }
    }

    // Thêm vào lịch sử
    history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    if (history.length > 30) {
      history.splice(0, history.length - 30);
    }

    const chat = model.startChat({
      history: history.slice(0, -1),
    });

    const result = await chat.sendMessage(userMessage);
    const replyText = result.response.text();

    history.push({
      role: 'model',
      parts: [{ text: replyText }],
    });

    /* ====== GỬI PHẢN HỒI ====== */
    if (replyText.length > 2000) {
      const chunks = replyText.match(/[\s\S]{1,2000}/g);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(replyText);
    }

  } catch (err) {
    console.error('❌ Lỗi:', err);

    let msg = '⚠️ Có lỗi xảy ra.';
    if (err.message?.includes('API key')) msg = '🔑 Lỗi API Key Gemini';
    if (err.message?.includes('quota')) msg = '⏰ Gemini hết quota';
    if (err.message?.includes('model')) msg = '🤖 Model Gemini lỗi';

    await message.reply(msg);
  }
});

/* =======================
   ERROR HANDLER
======================= */
process.on('unhandledRejection', console.error);
client.on('error', console.error);

/* =======================
   LOGIN
======================= */
client.login(process.env.DISCORD_TOKEN);
