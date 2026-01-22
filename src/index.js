import { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

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
- They can specify models: --flux, --nanobanana, --seedream, --gptimage, or default (pollinations)
- Example: "/create a cat wearing glasses --portrait --flux" or "/imagine sunset on beach --landscape --nanobanana"
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

// Video generation tracking (5 free per user)
const VIDEO_LIMIT = 5;
const videoUsage = new Map(); // userId -> count

// Load video usage from file
function loadVideoUsage() {
  try {
    if (fs.existsSync('video_usage.json')) {
      const data = JSON.parse(fs.readFileSync('video_usage.json', 'utf8'));
      Object.entries(data).forEach(([userId, count]) => {
        videoUsage.set(userId, count);
      });
      console.log('📊 Loaded video usage data');
    }
  } catch (error) {
    console.error('Error loading video usage:', error);
  }
}

// Save video usage to file
function saveVideoUsage() {
  try {
    const data = Object.fromEntries(videoUsage);
    fs.writeFileSync('video_usage.json', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving video usage:', error);
  }
}

// Check and update video quota
function checkVideoQuota(userId) {
  const currentUsage = videoUsage.get(userId) || 0;
  const remaining = VIDEO_LIMIT - currentUsage;
  return {
    canGenerate: remaining > 0,
    used: currentUsage,
    remaining: remaining,
    total: VIDEO_LIMIT
  };
}

function incrementVideoUsage(userId) {
  const current = videoUsage.get(userId) || 0;
  videoUsage.set(userId, current + 1);
  saveVideoUsage();
}

// Image orientation presets
const ORIENTATIONS = {
  portrait: { width: 768, height: 1344, emoji: '📱' },
  landscape: { width: 1344, height: 768, emoji: '🖼️' },
  square: { width: 1024, height: 1024, emoji: '⬛' },
};

// Image generation models/providers
const IMAGE_MODELS = {
  pollinations: {
    name: 'Pollinations AI',
    emoji: '🌸',
    color: 0x00D9FF,
    description: 'Balanced quality and speed'
  },
  flux: {
    name: 'Flux',
    emoji: '⚡',
    color: 0xFF6B35,
    description: 'High quality, photorealistic'
  },
  nanobanana: {
    name: 'Nanobanana',
    emoji: '🍌',
    color: 0xFFE135,
    description: 'Creative and artistic style'
  },
  seedream: {
    name: 'Seedream',
    emoji: '🌙',
    color: 0x9B59B6,
    description: 'Dreamlike, surreal imagery'
  },
  gptimage: {
    name: 'GPT Image',
    emoji: '🤖',
    color: 0x10A37F,
    description: 'AI-enhanced generation'
  }
};

// Parse orientation and model from prompt
function parseFlags(prompt) {
  const orientationFlags = ['--portrait', '--landscape', '--square'];
  const modelFlags = ['--flux', '--nanobanana', '--seedream', '--gptimage', '--pollinations'];
  
  let orientation = 'square'; // default
  let model = 'pollinations'; // default
  let cleanPrompt = prompt;

  // Parse orientation
  for (const flag of orientationFlags) {
    if (prompt.toLowerCase().includes(flag)) {
      orientation = flag.replace('--', '');
      cleanPrompt = cleanPrompt.replace(new RegExp(flag, 'gi'), '').trim();
      break;
    }
  }

  // Parse model
  for (const flag of modelFlags) {
    if (prompt.toLowerCase().includes(flag)) {
      model = flag.replace('--', '');
      cleanPrompt = cleanPrompt.replace(new RegExp(flag, 'gi'), '').trim();
      break;
    }
  }

  return { orientation, model, cleanPrompt };
}

// Image generation with multiple providers
async function generateImage(prompt, orientation = 'square', model = 'pollinations') {
  const encodedPrompt = encodeURIComponent(prompt);
  const { width, height } = ORIENTATIONS[orientation];
  
  let imageUrl;
  
  switch (model) {
    case 'flux':
      // Flux model via Pollinations
      imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=flux&nologo=true&enhance=true`;
      break;
      
    case 'nanobanana':
      // Nanobanana model via Pollinations
      imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=nanobanana&nologo=true&enhance=true`;
      break;
      
    case 'seedream':
      // Seedream model via Pollinations
      imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=seedream&nologo=true&enhance=true`;
      break;
      
    case 'gptimage':
      // GPT Image model via Pollinations
      imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=gptimage&nologo=true&enhance=true`;
      break;
      
    case 'pollinations':
    default:
      // Default Pollinations model
      imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&enhance=true`;
      break;
  }
  
  return imageUrl;
}

// Video generation using free services
async function generateVideo(prompt) {
  const encodedPrompt = encodeURIComponent(prompt);
  const videoUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&nologo=true&enhance=true&seed=${Date.now()}`;
  return videoUrl;
}

// Enhance prompt using Gemini
async function enhancePrompt(userPrompt, isVideo = false) {
  try {
    const mediaType = isVideo ? 'video' : 'image';
    const result = await textModel.generateContent(
      `You are an expert at writing prompts for AI ${mediaType} generation. Improve the following prompt into professional, detailed English, including: subject, ${isVideo ? 'motion, camera movement, scene transitions,' : 'art style,'} colors, lighting, and quality. Return ONLY the enhanced English prompt, NO explanations.

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
  loadVideoUsage();
  
  console.log(`✅ Bot is online: ${client.user.tag}`);
  console.log(`🤖 Model: gemini-2.5-flash`);
  console.log(`👁️ Vision: Enabled`);
  console.log(`🎨 Image Generation: Enabled (Multiple providers)`);
  console.log(`🎬 Video Generation: Enabled (5 free per user)`);
  console.log(`📱 User Install: Enabled`);
  console.log(`💬 DM Support: Enabled`);
  console.log(`\n📋 Image commands:`);
  console.log(`   /create <description> [--model] [--orientation]`);
  console.log(`   /imagine <description> [--model] [--orientation]`);
  console.log(`\n🎨 Available models:`);
  console.log(`   --flux (⚡ Photorealistic)`);
  console.log(`   --nanobanana (🍌 Artistic)`);
  console.log(`   --seedream (🌙 Surreal)`);
  console.log(`   --gptimage (🤖 AI-enhanced)`);
  console.log(`   --pollinations (🌸 Default)`);
  console.log(`\n🎬 Video commands:`);
  console.log(`   /video <description>`);
  console.log(`   /animate <description>`);
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

    // CHECK /MODELS COMMAND
    if (userMessage.toLowerCase() === '/models' || userMessage.toLowerCase() === '/styles') {
      const embed = new EmbedBuilder()
        .setTitle('🎨 Available Image Generation Models')
        .setDescription('Choose different AI models for various artistic styles!')
        .addFields(
          { 
            name: `${IMAGE_MODELS.flux.emoji} Flux (--flux)`, 
            value: IMAGE_MODELS.flux.description,
            inline: false
          },
          { 
            name: `${IMAGE_MODELS.nanobanana.emoji} Nanobanana (--nanobanana)`, 
            value: IMAGE_MODELS.nanobanana.description,
            inline: false
          },
          { 
            name: `${IMAGE_MODELS.seedream.emoji} Seedream (--seedream)`, 
            value: IMAGE_MODELS.seedream.description,
            inline: false
          },
          { 
            name: `${IMAGE_MODELS.gptimage.emoji} GPT Image (--gptimage)`, 
            value: IMAGE_MODELS.gptimage.description,
            inline: false
          },
          { 
            name: `${IMAGE_MODELS.pollinations.emoji} Pollinations (--pollinations)`, 
            value: IMAGE_MODELS.pollinations.description + ' [DEFAULT]',
            inline: false
          }
        )
        .setColor(0x00D9FF)
        .setFooter({ text: 'Use: /create <description> --flux --landscape' })
        .setTimestamp();
      
      await message.reply({ embeds: [embed] });
      return;
    }

    // CHECK VIDEO GENERATION COMMANDS
    const videoCommands = ['/video', '/animate', '/vid'];
    const isVideoCommand = videoCommands.some(cmd => userMessage.toLowerCase().startsWith(cmd));

    if (isVideoCommand) {
      const prompt = userMessage.split(' ').slice(1).join(' ').trim();
      
      if (!prompt) {
        const quota = checkVideoQuota(message.author.id);
        await message.reply(`❌ Please provide a description for the video!\n\n**Usage:**\n\`/video <description>\`\n\n**Examples:**\n\`/video a cat walking in a futuristic city\`\n\`/animate ocean waves at sunset\`\n\n**Your Quota:** ${quota.used}/${quota.total} videos used | ${quota.remaining} remaining`);
        return;
      }

      const quota = checkVideoQuota(message.author.id);
      if (!quota.canGenerate) {
        await message.reply(`❌ **Video Limit Reached!**\n\nYou've used all ${VIDEO_LIMIT} free videos.\n\n**Your Usage:** ${quota.used}/${quota.total}\n\n💡 **Tip:** You can still generate unlimited images with \`/create\`!`);
        return;
      }

      console.log(`🎬 Generating video from prompt: "${prompt}" (User: ${message.author.tag}, ${quota.remaining} remaining)`);
      
      const processingMsg = await message.reply(`🎬 Creating video... Please wait! This may take 30-60 seconds.\n\n**Your Quota:** ${quota.used}/${quota.total} used | ${quota.remaining} videos remaining`);

      try {
        const enhancedPrompt = await enhancePrompt(prompt, true);
        console.log('⚠️ Generating static image instead of video (free API limitation)');
        const imageUrl = await generateImage(enhancedPrompt, 'landscape');

        console.log('📥 Downloading image...');
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const attachment = new AttachmentBuilder(Buffer.from(imageBuffer), { 
          name: 'generated-video-frame.png' 
        });

        incrementVideoUsage(message.author.id);
        const newQuota = checkVideoQuota(message.author.id);

        const embed = new EmbedBuilder()
          .setTitle('🎨 AI Generated Image (Video Mode)')
          .setDescription(`**Original:** ${prompt}\n**AI Prompt:** ${enhancedPrompt.substring(0, 150)}${enhancedPrompt.length > 150 ? '...' : ''}\n\n⚠️ **Note:** Free video APIs are limited. This is a high-quality image representation.\n\n**Suggested Paid APIs for Real Videos:**\n• Runway ML\n• Luma AI Dream Machine\n• Stability AI Video\n\n**Quota Used:** ${newQuota.used}/${newQuota.total} | **Remaining:** ${newQuota.remaining}`)
          .setImage('attachment://generated-video-frame.png')
          .setColor(0xFF6B6B)
          .setFooter({ text: `Created by ${message.author.username} • Powered by Pollinations.ai` })
          .setTimestamp();

        await processingMsg.delete();
        await message.reply({ 
          content: '⚠️ **Video generation requires paid API.** Here\'s a high-quality image instead!',
          embeds: [embed], 
          files: [attachment]
        });

        console.log(`✅ Image (video mode) created for: ${message.author.tag} (${newQuota.remaining} remaining)`);
        
        if (newQuota.remaining === 0) {
          await message.channel.send(`⚠️ **${message.author.username}**, you've used all your video attempts! You can still generate unlimited images with \`/create\`.`);
        } else if (newQuota.remaining === 1) {
          await message.channel.send(`⚠️ **${message.author.username}**, you have **1 video attempt** remaining!`);
        }
        
        return;

      } catch (error) {
        console.error('❌ Error creating video:', error);
        await processingMsg.edit('⚠️ An error occurred while creating the video. Please try again! Your quota was not used.');
        return;
      }
    }

    // CHECK IMAGE GENERATION COMMANDS
    const imageCommands = ['/create', '/imagine', '/draw', '/gen'];
    const isImageCommand = imageCommands.some(cmd => userMessage.toLowerCase().startsWith(cmd));

    if (isImageCommand) {
      const promptWithFlags = userMessage.split(' ').slice(1).join(' ').trim();
      
      if (!promptWithFlags) {
        await message.reply('❌ Please provide a description for the image!\n\n**Usage:**\n`/create <description> [--model] [--orientation]`\n\n**Examples:**\n`/create a cat wearing sunglasses --flux --portrait`\n`/imagine cyberpunk city at night --seedream --landscape`\n`/create beautiful sunset --nanobanana --square`\n\n**Models:**\n⚡ `--flux` (Photorealistic)\n🍌 `--nanobanana` (Artistic)\n🌙 `--seedream` (Surreal)\n🤖 `--gptimage` (AI-enhanced)\n🌸 `--pollinations` (Default)\n\n**Orientations:**\n📱 `--portrait` (768x1344)\n🖼️ `--landscape` (1344x768)\n⬛ `--square` (1024x1024) [default]\n\n💡 Use `/models` to see all available models!');
        return;
      }

      // Parse model, orientation and clean prompt
      const { orientation, model, cleanPrompt } = parseFlags(promptWithFlags);
      const { width, height, emoji } = ORIENTATIONS[orientation];
      const modelInfo = IMAGE_MODELS[model];

      console.log(`🎨 Generating ${orientation} image (${width}x${height}) with ${modelInfo.name} from prompt: "${cleanPrompt}"`);
      
      const processingMsg = await message.reply(`${modelInfo.emoji} Creating **${modelInfo.name}** image ${emoji} (${width}x${height})... Please wait!`);

      try {
        const enhancedPrompt = await enhancePrompt(cleanPrompt, false);
        const imageUrl = await generateImage(enhancedPrompt, orientation, model);

        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const attachment = new AttachmentBuilder(Buffer.from(imageBuffer), { 
          name: 'generated-image.png' 
        });

        const embed = new EmbedBuilder()
          .setTitle(`${modelInfo.emoji} ${modelInfo.name} - ${emoji} ${orientation.toUpperCase()}`)
          .setDescription(`**Original:** ${cleanPrompt}\n**AI Prompt:** ${enhancedPrompt.substring(0, 180)}${enhancedPrompt.length > 180 ? '...' : ''}\n**Model:** ${modelInfo.name} (${modelInfo.description})\n**Size:** ${width}x${height}`)
          .setImage('attachment://generated-image.png')
          .setColor(modelInfo.color)
          .setFooter({ text: `Created by ${message.author.username} • Powered by Pollinations.ai` })
          .setTimestamp();

        await processingMsg.delete();
        await message.reply({ 
          embeds: [embed], 
          files: [attachment]
        });

        console.log(`✅ ${orientation.toUpperCase()} image created with ${modelInfo.name} for: ${message.author.tag}`);
        return;

      } catch (error) {
        console.error('❌ Error creating image:', error);
        await processingMsg.edit('⚠️ An error occurred while creating the image. Please try again!');
        return;
      }
    }

    // CHECK QUOTA COMMAND
    if (userMessage.toLowerCase() === '/quota' || userMessage.toLowerCase() === '/usage') {
      const quota = checkVideoQuota(message.author.id);
      const embed = new EmbedBuilder()
        .setTitle('📊 Your Usage Statistics')
        .setDescription(`**Video Generation:**\n🎬 Used: ${quota.used}/${quota.total}\n✅ Remaining: ${quota.remaining}\n\n**Image Generation:**\n🎨 Unlimited! (5 models available)\n\n💡 Use \`/models\` to see all AI models\n💡 Use \`/video <description>\` to create videos\n💡 Use \`/create <description> --flux\` to create images`)
        .setColor(0x00D9FF)
        .setFooter({ text: `User: ${message.author.username}` })
        .setTimestamp();
      
      await message.reply({ embeds: [embed] });
      return;
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
      const quota = checkVideoQuota(message.author.id);
      await message.reply(`What would you like to talk about? 🤔\n\n💡 **Commands:**\n🎨 \`/create <description>\` - Generate images (unlimited, 5 models)\n🖼️ \`/models\` - See all AI models\n🎬 \`/video <description>\` - Generate videos (${quota.remaining}/${quota.total} remaining)\n📊 \`/quota\` - Check your usage`);
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
