import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Model cho text
const textModel = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash',
  systemInstruction: 'You are a friendly AI assistant named Hyggshi OS AI. You respond naturally and clearly. You can see and analyze images when users send them.',
  generationConfig: {
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
  }
});

// Model cho vision (text + ảnh)
const visionModel = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash',
  systemInstruction: 'You are an AI assistant capable of seeing and analyzing images. Describe in detail what you see in the image, including: the main subject, colors, background, emotions, and any interesting details.',
  generationConfig: {
    temperature: 1.0,
    topP: 0.95,
    maxOutputTokens: 8192,
  }
});

const conversationHistory = new Map();

// Hàm chuyển đổi ảnh URL thành format Gemini
async function urlToGenerativePart(url, mimeType) {
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    return {
      inlineData: {
        data: Buffer.from(buffer).toString('base64'),
        mimeType
      }
    };
  } catch (error) {
    console.error('Lỗi khi tải ảnh:', error);
    return null;
  }
}

client.on('ready', () => {
  console.log(`✅ Bot đã online: ${client.user.tag}`);
  console.log(`🤖 Model: gemini-1.5-flash`);
  console.log(`👁️ Vision: Enabled`);
  console.log(`📱 User Install: Enabled`);
  console.log(`💬 DM Support: Enabled`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = message.channel.type === 1;
  const isMentioned = message.mentions.has(client.user);
  const isReply = message.reference?.messageId;
  
  if (!isDM && !isMentioned && !isReply) return;

  try {
    await message.channel.sendTyping();

    const historyKey = isDM ? message.author.id : message.channelId;
    
    if (!conversationHistory.has(historyKey)) {
      conversationHistory.set(historyKey, []);
    }
    const history = conversationHistory.get(historyKey);

    let userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

    // Kiểm tra có ảnh không
    const hasImage = message.attachments.size > 0;
    const images = [];
    
    if (hasImage) {
      for (const attachment of message.attachments.values()) {
        // Kiểm tra file type
        if (attachment.contentType?.startsWith('image/')) {
          console.log(`🖼️ Đang xử lý ảnh: ${attachment.name} (${attachment.contentType})`);
          const imagePart = await urlToGenerativePart(attachment.url, attachment.contentType);
          if (imagePart) {
            images.push(imagePart);
          }
        }
      }
    }

    // Nếu không có text và không có ảnh
    if (!userMessage && images.length === 0) {
      await message.reply('Bạn muốn nói gì với mình? 🤔');
      return;
    }

    // Nếu có ảnh nhưng không có text, thêm prompt mặc định
    if (images.length > 0 && !userMessage) {
      userMessage = 'Hãy phân tích và mô tả chi tiết hình ảnh này';
    }

    // Xử lý reply
    if (isReply) {
      try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        const repliedContent = repliedMessage.content || '[Tin nhắn không có nội dung]';
        const repliedAuthor = repliedMessage.author.username;
        userMessage = `Người dùng đang trả lời tin nhắn của ${repliedAuthor}: "${repliedContent}"\n\nVà họ nói: ${userMessage}`;
      } catch (err) {
        console.log('Không thể fetch tin nhắn được reply');
      }
    }

    const context = isDM ? 'DM' : 'Server';
    const imageInfo = images.length > 0 ? ` + ${images.length} ảnh` : '';
    console.log(`📨 [${context}] ${message.author.tag}: "${userMessage.substring(0, 50)}..."${imageInfo}`);

    let botReply;

    // Nếu có ảnh, dùng vision model (không lưu lịch sử ảnh)
    if (images.length > 0) {
      const parts = [{ text: userMessage }, ...images];
      const result = await visionModel.generateContent(parts);
      const response = await result.response;
      botReply = response.text();
      
      console.log(`✅ [VISION] Phản hồi: "${botReply.substring(0, 50)}..."`);
    } else {
      // Không có ảnh, dùng text model với lịch sử
      history.push({
        role: 'user',
        parts: [{ text: userMessage }],
      });

      if (history.length > 30) {
        history.splice(0, history.length - 30);
      }

      const chat = textModel.startChat({
        history: history.slice(0, -1),
      });

      const result = await chat.sendMessage(userMessage);
      const response = await result.response;
      botReply = response.text();

      history.push({
        role: 'model',
        parts: [{ text: botReply }],
      });

      console.log(`✅ [TEXT] Phản hồi: "${botReply.substring(0, 50)}..."`);
    }

    // Gửi phản hồi
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
    } else if (error.message?.includes('quota')) {
      errorMessage = '⏰ API đã hết quota. Vui lòng thử lại sau!';
    } else if (error.message?.includes('INVALID_ARGUMENT')) {
      errorMessage = '🖼️ Lỗi xử lý hình ảnh. Vui lòng thử ảnh khác!';
    }
    
    try {
      await message.reply(errorMessage);
    } catch (replyError) {
      console.error('Không thể gửi tin nhắn lỗi:', replyError);
    }
  }
});

client.on('error', error => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log('🔐 Đang đăng nhập...'))
  .catch(err => {
    console.error('❌ Không thể login Discord:', err);
    process.exit(1);
  });
