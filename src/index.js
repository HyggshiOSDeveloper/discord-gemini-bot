import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages, // Quan trọng cho DM
  ],
  partials: [
    Partials.Channel, // Quan trọng để nhận tin nhắn DM
    Partials.Message,
  ],
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash',
  systemInstruction: 'Bạn là một trợ lý AI thân thiện, trả lời tự nhiên và dễ hiểu. Luôn trả lời bằng tiếng Việt và EN có dấu. dùng định dạng markdown (nêu muốn) hay code block khi không cần thiết. Hãy trò chuyện như một người bạn.',
  generationConfig: {
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
  }
});

// Lưu lịch sử chat theo userId (cho DM) hoặc channelId (cho server)
const conversationHistory = new Map();

client.on('ready', () => {
  console.log(`✅ Bot đã online: ${client.user.tag}`);
  console.log(`🤖 Model: gemini-1.5-flash`);
  console.log(`📱 User Install: Enabled`);
  console.log(`💬 DM Support: Enabled`);
});

client.on('messageCreate', async (message) => {
  // Bỏ qua tin nhắn từ bot
  if (message.author.bot) return;

  // Kiểm tra xem có phải DM không
  const isDM = message.channel.type === 1; // 1 = DM
  
  // Nếu là DM, tự động trả lời
  // Nếu là server, chỉ trả lời khi được mention hoặc reply
  const isMentioned = message.mentions.has(client.user);
  const isReply = message.reference?.messageId;
  
  if (!isDM && !isMentioned && !isReply) return;

  try {
    // Hiển thị typing indicator
    await message.channel.sendTyping();

    // Tạo key để lưu lịch sử
    // DM: dùng userId, Server: dùng channelId
    const historyKey = isDM ? message.author.id : message.channelId;
    
    if (!conversationHistory.has(historyKey)) {
      conversationHistory.set(historyKey, []);
    }
    const history = conversationHistory.get(historyKey);

    // Lấy nội dung tin nhắn (loại bỏ mention nếu có)
    let userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

    if (!userMessage) {
      await message.reply('Bạn muốn nói gì với mình? 🤔');
      return;
    }

    // Nếu là reply, lấy context từ tin nhắn được reply
    if (isReply) {
      try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        const repliedContent = repliedMessage.content || '[Tin nhắn không có nội dung]';
        const repliedAuthor = repliedMessage.author.username;
        
        // Thêm context tự nhiên hơn cho AI
        userMessage = `Người dùng đang trả lời tin nhắn của ${repliedAuthor}: "${repliedContent}"\n\nVà họ nói: ${userMessage}`;
      } catch (err) {
        console.log('Không thể fetch tin nhắn được reply');
      }
    }

    // Thêm tin nhắn vào lịch sử
    history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    // Giới hạn lịch sử (giữ 30 tin nhắn)
    if (history.length > 30) {
      history.splice(0, history.length - 30);
    }

    // Log để debug
    const context = isDM ? 'DM' : 'Server';
    console.log(`📨 [${context}] ${message.author.tag}: "${userMessage.substring(0, 50)}..."`);

    // Tạo chat với lịch sử
    const chat = model.startChat({
      history: history.slice(0, -1),
    });

    // Gửi tin nhắn và nhận phản hồi
    const result = await chat.sendMessage(userMessage);
    const response = await result.response;
    let botReply = response.text();

    console.log(`✅ Phản hồi: "${botReply.substring(0, 50)}..."`);

    // Thêm phản hồi vào lịch sử
    history.push({
      role: 'model',
      parts: [{ text: botReply }],
    });

    // Chia nhỏ nếu quá dài
    if (botReply.length > 2000) {
      const chunks = botReply.match(/[\s\S]{1,2000}/g) || [];
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(botReply);
    }

  } catch (error) {
    console.error('❌ Lỗi chi tiết:', error);
    
    let errorMessage = '⚠️ Xin lỗi, đã có lỗi xảy ra khi xử lý tin nhắn của bạn.';
    
    if (error.message?.includes('API key')) {
      errorMessage = '🔑 Lỗi API Key. Admin vui lòng kiểm tra lại!';
      console.error('🔑 API Key không hợp lệ!');
    } else if (error.message?.includes('quota')) {
      errorMessage = '⏰ API đã hết quota. Vui lòng thử lại sau!';
      console.error('⏰ Gemini API hết quota!');
    } else if (error.message?.includes('model')) {
      errorMessage = '🤖 Lỗi model AI. Vui lòng liên hệ admin!';
      console.error('🤖 Model không tồn tại hoặc không khả dụng!');
    }
    
    try {
      await message.reply(errorMessage);
    } catch (replyError) {
      console.error('Không thể gửi tin nhắn lỗi:', replyError);
    }
  }
});

// Xử lý lỗi không mong muốn
client.on('error', error => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log('🔐 Đang đăng nhập...'))
  .catch(err => {
    console.error('❌ Không thể login Discord:', err);
    process.exit(1);
  });
