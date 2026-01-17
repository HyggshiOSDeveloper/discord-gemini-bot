import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
  }
});

// Lưu lịch sử chat cho mỗi channel
const conversationHistory = new Map();

client.on('ready', () => {
  console.log(`✅ Bot đã online: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // Bỏ qua tin nhắn từ bot
  if (message.author.bot) return;

  // Chỉ trả lời khi được mention hoặc reply
  const isMentioned = message.mentions.has(client.user);
  const isReply = message.reference?.messageId;

  if (!isMentioned && !isReply) return;

  try {
    // Hiển thị typing indicator
    await message.channel.sendTyping();

    // Lấy hoặc tạo lịch sử chat cho channel
    if (!conversationHistory.has(message.channelId)) {
      conversationHistory.set(message.channelId, []);
    }
    const history = conversationHistory.get(message.channelId);

    // Lấy nội dung tin nhắn (loại bỏ mention)
    let userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

    // Nếu là reply, lấy context từ tin nhắn được reply
    if (isReply) {
      const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
      userMessage = `[Đang trả lời tin nhắn: "${repliedMessage.content}"]\n${userMessage}`;
    }

    // Thêm tin nhắn người dùng vào lịch sử
    history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    // Giới hạn lịch sử (giữ 20 tin nhắn gần nhất)
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Tạo chat với lịch sử
    const chat = model.startChat({
      history: history.slice(0, -1), // Không bao gồm tin nhắn hiện tại
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.9,
      },
    });

    // Gửi tin nhắn và nhận phản hồi
    const result = await chat.sendMessage(userMessage);
    const response = await result.response;
    let botReply = response.text();

    // Thêm phản hồi của bot vào lịch sử
    history.push({
      role: 'model',
      parts: [{ text: botReply }],
    });

    // Chia nhỏ tin nhắn nếu quá dài (Discord giới hạn 2000 ký tự)
    if (botReply.length > 2000) {
      const chunks = botReply.match(/[\s\S]{1,2000}/g) || [];
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(botReply);
    }

  } catch (error) {
    console.error('❌ Lỗi:', error);
    await message.reply('⚠️ Xin lỗi, đã có lỗi xảy ra khi xử lý tin nhắn của bạn.');
  }
});

client.login(process.env.DISCORD_TOKEN);
