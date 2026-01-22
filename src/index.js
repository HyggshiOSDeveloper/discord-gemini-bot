import { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } from 'discord.js';
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

const textModel = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash',
  systemInstruction: `You are a friendly AI assistant named Hyggshi OS AI. Respond naturally and helpfully. You can see and analyze images when users send them.

IMPORTANT - Image creation commands:
- When users want to create images, they use: "/create <description>" or "/imagine <description>"
- They can add orientation flags: --portrait, --landscape, --square
- Example: "/create a cat wearing glasses --portrait" or "/imagine sunset on beach --landscape"
- You DON'T need to process these commands, just respond normally to other topics.`,
  generationConfig: {
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
  }
});

const visionModel = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash',
  systemInstruction: 'You are an AI assistant with the ability to see and analyze images. Describe in detail what you see, including: main subjects, colors, context, emotions, and any interesting details.',
  generationConfig: {
    temperature: 1.0,
    topP: 0.95,
    maxOutputTokens: 8192,
  }
});

const conversationHistory = new Map();

// Image orientation presets
const ORIENTATIONS = {
  portrait: { width: 768, height: 1344, emoji: '📱' },
  landscape: { width: 1344, height: 768, emoji: '🖼️' },
  square: { width: 1024, height: 1024, emoji: '⬛' },
};

// Parse orientation from prompt
function parseOrientation(prompt) {
  const orientationFlags = ['--portrait', '--landscape', '--square'];
  let orientation = 'square'; // default
  let cleanPrompt = prompt;

  for (const flag of orientationFlags) {
    if (prompt.toLowerCase().includes(flag)) {
      orientation = flag.replace('--', '');
      cleanPrompt = prompt.replace(new RegExp(flag, 'gi'), '').trim();
      break;
    }
  }

  return { orientation, cleanPrompt };
}

// Image generation using Pollinations.ai (Free, no API key needed)
async function generateImage(prompt, orientation = 'square') {
  const encodedPrompt = encodeURIComponent(prompt);
  const { width, height } = ORIENTATIONS[orientation];
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&enhance=true`;
  return imageUrl;
}

// Enhance prompt using Gemini
async function enhancePrompt(userPrompt) {
  try {
    const result = await textModel.generateContent(
      `You are an expert at writing prompts for AI image generation. Improve the following prompt into professional, detailed English, including: subject, art style, colors, lighting, and quality. Return ONLY the enhanced English prompt, NO explanations.

Original prompt: "${userPrompt}"

Enhanced prompt:`
    );
    const enhanced = result.response.text().trim();
    console.log(`📝 Original prompt: "${userPrompt}"`);
    console.log(`✨ Enhanced prompt: "${enhanced}"`);
    return enhanced;
  } catch (error) {
    console.error('Error enhancing prompt, using original');
    return userPrompt;
  }
}

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
    console.error('Error loading image:', error);
    return null;
  }
}

client.on('ready', () => {
  console.log(`✅ Bot is online: ${client.user.tag}`);
  console.log(`🤖 Model: gemini-2.5-flash`);
  console.log(`👁️ Vision: Enabled`);
  console.log(`🎨 Image Generation: Enabled (Pollinations.ai)`);
  console.log(`📱 User Install: Enabled`);
  console.log(`💬 DM Support: Enabled`);
  console.log(`\n📋 Image commands:`);
  console.log(`   /create <description> [--portrait|--landscape|--square]`);
  console.log(`   /imagine <description> [--portrait|--landscape|--square]`);
  console.log(`\n📐 Orientations:`);
  console.log(`   --portrait  (768x1344)`);
  console.log(`   --landscape (1344x768)`);
  console.log(`   --square    (1024x1024) [default]`);
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

    // CHECK IMAGE GENERATION COMMANDS
    const imageCommands = ['/create', '/imagine', '/draw', '/gen'];
    const isImageCommand = imageCommands.some(cmd => userMessage.toLowerCase().startsWith(cmd));

    if (isImageCommand) {
      const promptWithFlags = userMessage.split(' ').slice(1).join(' ').trim();
      
      if (!promptWithFlags) {
        await message.reply('❌ Please provide a description for the image!\n\n**Usage:**\n`/create <description> [--portrait|--landscape|--square]`\n\n**Examples:**\n`/create a cat wearing sunglasses on the moon --portrait`\n`/imagine cyberpunk city at night --landscape`\n`/create beautiful sunset --square`\n\n**Orientations:**\n📱 `--portrait` (768x1344)\n🖼️ `--landscape` (1344x768)\n⬛ `--square` (1024x1024) [default]');
        return;
      }

      // Parse orientation and clean prompt
      const { orientation, cleanPrompt } = parseOrientation(promptWithFlags);
      const { width, height, emoji } = ORIENTATIONS[orientation];

      console.log(`🎨 Generating ${orientation} image (${width}x${height}) from prompt: "${cleanPrompt}"`);
      
      const processingMsg = await message.reply(`🎨 Creating ${emoji} **${orientation}** image (${width}x${height})... Please wait!`);

      try {
        // Enhance prompt with Gemini
        const enhancedPrompt = await enhancePrompt(cleanPrompt);
        
        // Generate image with orientation
        const imageUrl = await generateImage(enhancedPrompt, orientation);

        // Download image to send as attachment
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const attachment = new AttachmentBuilder(Buffer.from(imageBuffer), { 
          name: 'generated-image.png' 
        });

        // Create beautiful embed
        const embed = new EmbedBuilder()
          .setTitle(`🎨 AI Generated Image ${emoji}`)
          .setDescription(`**Original:** ${cleanPrompt}\n**AI Prompt:** ${enhancedPrompt.substring(0, 200)}${enhancedPrompt.length > 200 ? '...' : ''}\n**Orientation:** ${emoji} ${orientation.toUpperCase()} (${width}x${height})`)
          .setImage('attachment://generated-image.png')
          .setColor(0x00D9FF)
          .setFooter({ text: `Created by ${message.author.username} • Powered by Pollinations.ai` })
          .setTimestamp();

        await processingMsg.delete();
        await message.reply({ 
          embeds: [embed], 
          files: [attachment]
        });

        console.log(`✅ ${orientation.toUpperCase()} image created successfully for: ${message.author.tag}`);
        return;

      } catch (error) {
        console.error('❌ Error creating image:', error);
        await processingMsg.edit('⚠️ An error occurred while creating the image. Please try again!');
        return;
      }
    }

    // HANDLE IMAGE ATTACHMENTS (Vision)
    const hasImage = message.attachments.size > 0;
    const images = [];
    
    if (hasImage) {
      for (const attachment of message.attachments.values()) {
        if (attachment.contentType?.startsWith('image/')) {
          console.log(`🖼️ Processing image: ${attachment.name}`);
          const imagePart = await urlToGenerativePart(attachment.url, attachment.contentType);
          if (imagePart) {
            images.push(imagePart);
          }
        }
      }
    }

    if (!userMessage && images.length === 0) {
      await message.reply('What would you like to talk about? 🤔\n\n💡 **Tip:** Use `/create <description> [--portrait|--landscape|--square]` to generate AI images!\n\n**Examples:**\n`/create a cat in space --portrait`\n`/imagine sunset beach --landscape`');
      return;
    }

    if (images.length > 0 && !userMessage) {
      userMessage = 'Please analyze and describe this image in detail';
    }

    // Handle replies
    if (isReply) {
      try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        const repliedContent = repliedMessage.content || '[Message has no content]';
        const repliedAuthor = repliedMessage.author.username;
        userMessage = `User is replying to ${repliedAuthor}'s message: "${repliedContent}"\n\nAnd they say: ${userMessage}`;
      } catch (err) {
        console.log('Cannot fetch replied message');
      }
    }

    const context = isDM ? 'DM' : 'Server';
    const imageInfo = images.length > 0 ? ` + ${images.length} image(s)` : '';
    console.log(`📨 [${context}] ${message.author.tag}: "${userMessage.substring(0, 50)}..."${imageInfo}`);

    let botReply;

    // HANDLE VISION
    if (images.length > 0) {
      const parts = [{ text: userMessage }, ...images];
      const result = await visionModel.generateContent(parts);
      const response = await result.response;
      botReply = response.text();
      
      console.log(`✅ [VISION] Response: "${botReply.substring(0, 50)}..."`);
    } else {
      // HANDLE TEXT CONVERSATION
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

      console.log(`✅ [TEXT] Response: "${botReply.substring(0, 50)}..."`);
    }

    // Send response
    if (botReply.length > 2000) {
      const chunks = botReply.match(/[\s\S]{1,2000}/g) || [];
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(botReply);
    }

  } catch (error) {
    console.error('❌ Detailed error:', error);
    
    let errorMessage = '⚠️ Sorry, an error occurred while processing your message.';
    
    if (error.message?.includes('API key')) {
      errorMessage = '🔑 API Key error. Please check configuration!';
    } else if (error.message?.includes('quota')) {
      errorMessage = '⏰ API quota exceeded. Please try again later!';
    } else if (error.message?.includes('INVALID_ARGUMENT')) {
      errorMessage = '🖼️ Error processing image. Please try a different image!';
    }
    
    try {
      await message.reply(errorMessage);
    } catch (replyError) {
      console.error('Cannot send error message:', replyError);
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
  .then(() => console.log('🔐 Logging in...'))
  .catch(err => {
    console.error('❌ Cannot login to Discord:', err);
    process.exit(1);
  });
