import { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';

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

// NSFW Settings - Configure based on your needs
const NSFW_CONFIG = {
  // Allow NSFW in DMs? (true/false)
  allowInDM: true,
  
  // Allow NSFW only in NSFW-marked channels? (true/false)
  requireNSFWChannel: true,
  
  // Role ID that can use NSFW anywhere (optional, leave empty if not needed)
  bypassRoleId: process.env.NSFW_BYPASS_ROLE_ID || '',
  
  // NSFW intensity levels
  levels: {
    soft: {
      name: 'Soft NSFW',
      flag: '--nsfw-soft',
      emoji: '🔞',
      description: 'Light suggestive content',
      suffix: ', artistic, tasteful, suggestive but not explicit'
    },
    medium: {
      name: 'Medium NSFW',
      flag: '--nsfw',
      emoji: '🔥',
      description: 'Moderate adult content',
      suffix: ', sensual, artistic nude, mature content'
    },
    hard: {
      name: 'Hard NSFW',
      flag: '--nsfw-hard',
      emoji: '💀',
      description: 'Explicit adult content',
      suffix: ', explicit, uncensored, highly detailed NSFW'
    }
  }
};

// Check if user can use NSFW
function canUseNSFW(message) {
  const isDM = message.channel.type === 1;
  
  // In DMs
  if (isDM) {
    return {
      allowed: NSFW_CONFIG.allowInDM,
      reason: NSFW_CONFIG.allowInDM ? null : 'NSFW is disabled in DMs'
    };
  }
  
  // In server - check bypass role
  if (NSFW_CONFIG.bypassRoleId && message.member?.roles.cache.has(NSFW_CONFIG.bypassRoleId)) {
    return { allowed: true, reason: null };
  }
  
  // In server - check NSFW channel
  if (NSFW_CONFIG.requireNSFWChannel) {
    const isNSFWChannel = message.channel.nsfw;
    return {
      allowed: isNSFWChannel,
      reason: isNSFWChannel ? null : 'NSFW commands only work in NSFW-marked channels'
    };
  }
  
  return { allowed: true, reason: null };
}

const textModel = genAI.getGenerativeModel({ 
  model: 'gemini-1.5-flash',
  systemInstruction: `You are a friendly AI assistant named Hyggshi OS AI. Respond naturally and helpfully. You can see and analyze images when users send them.

IMPORTANT - Image creation commands:
- Users can create images with: "/create <description>" or "/imagine <description>"
- They can add model flags: --flux, --turbo, --klein, --gptimage
- They can add orientation flags: --portrait, --landscape, --square
- They can add NSFW flags: --nsfw-soft, --nsfw, --nsfw-hard (only in appropriate channels)
- Example: "/create a cat wearing glasses --flux --portrait"
- You DON'T need to process these commands, just respond normally to other topics.`,
  generationConfig: {
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
  }
});

const visionModel = genAI.getGenerativeModel({ 
  model: 'gemini-1.5-flash',
  systemInstruction: 'You are an AI assistant with the ability to see and analyze images. Describe in detail what you see, including: main subjects, colors, context, emotions, and any interesting details.',
  generationConfig: {
    temperature: 1.0,
    topP: 0.95,
    maxOutputTokens: 8192,
  }
});

const conversationHistory = new Map();
const VIDEO_LIMIT = 5;
const videoUsage = new Map();

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

function saveVideoUsage() {
  try {
    const data = Object.fromEntries(videoUsage);
    fs.writeFileSync('video_usage.json', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving video usage:', error);
  }
}

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

const IMAGE_MODELS = {
  flux: { 
    name: 'Flux', 
    param: 'flux',
    emoji: '⚡', 
    description: 'High quality, detailed images (default)',
    quality: 'Premium'
  },
  turbo: { 
    name: 'Turbo', 
    param: 'turbo',
    emoji: '🚀', 
    description: 'Fast generation, good quality',
    quality: 'Fast'
  },
  klein: { 
    name: 'Klein', 
    param: 'klein',
    emoji: '🎨', 
    description: 'Artistic and creative style',
    quality: 'Artistic'
  },
  gptimage: { 
    name: 'GPT Image', 
    param: 'gptimage',
    emoji: '🤖', 
    description: 'AI-optimized generation',
    quality: 'Balanced'
  }
};

const ORIENTATIONS = {
  portrait: { width: 768, height: 1344, emoji: '📱' },
  landscape: { width: 1344, height: 768, emoji: '🖼️' },
  square: { width: 1024, height: 1024, emoji: '⬛' },
};

// Parse model, orientation, and NSFW flags from prompt
function parseImageFlags(prompt) {
  let model = 'flux';
  let orientation = 'square';
  let nsfwLevel = null;
  let cleanPrompt = prompt;

  // Check for NSFW flags
  for (const [level, config] of Object.entries(NSFW_CONFIG.levels)) {
    if (cleanPrompt.toLowerCase().includes(config.flag)) {
      nsfwLevel = level;
      cleanPrompt = cleanPrompt.replace(new RegExp(config.flag, 'gi'), '').trim();
      break;
    }
  }

  // Check for model flags
  for (const [key, value] of Object.entries(IMAGE_MODELS)) {
    const flag = `--${key}`;
    if (cleanPrompt.toLowerCase().includes(flag)) {
      model = key;
      cleanPrompt = cleanPrompt.replace(new RegExp(flag, 'gi'), '').trim();
      break;
    }
  }

  // Check for orientation flags
  const orientationFlags = ['--portrait', '--landscape', '--square'];
  for (const flag of orientationFlags) {
    if (cleanPrompt.toLowerCase().includes(flag)) {
      orientation = flag.replace('--', '');
      cleanPrompt = cleanPrompt.replace(new RegExp(flag, 'gi'), '').trim();
      break;
    }
  }

  return { model, orientation, nsfwLevel, cleanPrompt };
}

async function generateImage(prompt, model = 'flux', orientation = 'square', nsfwLevel = null) {
  let finalPrompt = prompt;
  
  // Add NSFW suffix if level is specified
  if (nsfwLevel && NSFW_CONFIG.levels[nsfwLevel]) {
    finalPrompt += NSFW_CONFIG.levels[nsfwLevel].suffix;
  }
  
  const encodedPrompt = encodeURIComponent(finalPrompt);
  const { width, height } = ORIENTATIONS[orientation];
  const modelParam = IMAGE_MODELS[model].param;
  
  // Add nologo and private flags for NSFW content
  const nsfwParams = nsfwLevel ? '&private=true' : '';
  
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${modelParam}&nologo=true&enhance=true&seed=${Date.now()}${nsfwParams}`;
  return imageUrl;
}

async function enhancePrompt(userPrompt, isVideo = false, nsfwLevel = null) {
  try {
    const mediaType = isVideo ? 'video' : 'image';
    const nsfwNote = nsfwLevel ? `\nIMPORTANT: This is ${NSFW_CONFIG.levels[nsfwLevel].name} content. Add appropriate mature/adult themes while keeping artistic quality.` : '';
    
    const result = await textModel.generateContent(
      `You are an expert at writing prompts for AI ${mediaType} generation. Improve the following prompt into professional, detailed English, including: subject, ${isVideo ? 'motion, camera movement, scene transitions,' : 'art style,'} colors, lighting, and quality.${nsfwNote} Return ONLY the enhanced English prompt, NO explanations.

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
  console.log(`🤖 Model: gemini-1.5-flash`);
  console.log(`👁️ Vision: Enabled`);
  console.log(`🎨 Image Generation: Enabled`);
  console.log(`🔞 NSFW: ${NSFW_CONFIG.requireNSFWChannel ? 'NSFW channels only' : 'Enabled'}`);
  console.log(`\n📋 Image commands:`);
  console.log(`   /create <description> [flags]`);
  console.log(`\n🔞 NSFW Flags (use in NSFW channels only):`);
  Object.entries(NSFW_CONFIG.levels).forEach(([level, config]) => {
    console.log(`   ${config.emoji} ${config.flag}: ${config.description}`);
  });
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
        const modelsList = Object.entries(IMAGE_MODELS)
          .map(([key, model]) => `${model.emoji} \`--${key}\`: ${model.description}`)
          .join('\n');
        
        const nsfwList = Object.entries(NSFW_CONFIG.levels)
          .map(([level, config]) => `${config.emoji} \`${config.flag}\`: ${config.description}`)
          .join('\n');
        
        await message.reply(`❌ Please provide a description!\n\n**Usage:**\n\`/create <description> [flags]\`\n\n**Examples:**\n\`/create a cat --flux --portrait\`\n\`/create sunset --nsfw-soft --landscape\` ${!isDM ? '(NSFW channels only)' : ''}\n\n**🎨 Models:**\n${modelsList}\n\n**🔞 NSFW Levels:**\n${nsfwList}\n\n**Note:** NSFW only works in ${NSFW_CONFIG.requireNSFWChannel ? 'NSFW-marked channels' : 'designated areas'}`);
        return;
      }

      // Parse flags
      const { model, orientation, nsfwLevel, cleanPrompt } = parseImageFlags(promptWithFlags);
      
      // Check NSFW permissions if NSFW flag is used
      if (nsfwLevel) {
        const nsfwCheck = canUseNSFW(message);
        if (!nsfwCheck.allowed) {
          const nsfwConfig = NSFW_CONFIG.levels[nsfwLevel];
          await message.reply(`🔞 **NSFW Content Blocked**\n\n${nsfwConfig.emoji} **${nsfwConfig.name}** can only be used in:\n${NSFW_CONFIG.requireNSFWChannel ? '• NSFW-marked channels (enable in channel settings)' : ''}\n${NSFW_CONFIG.allowInDM ? '• Direct Messages' : ''}\n\n**Current location:** ${isDM ? 'DM' : message.channel.nsfw ? 'NSFW Channel ✅' : 'Regular Channel ❌'}\n\n💡 Remove the NSFW flag or use in an appropriate channel.`);
          return;
        }
      }

      const { width, height, emoji } = ORIENTATIONS[orientation];
      const modelInfo = IMAGE_MODELS[model];
      const nsfwInfo = nsfwLevel ? NSFW_CONFIG.levels[nsfwLevel] : null;
      const nsfwWarning = nsfwInfo ? `${nsfwInfo.emoji} **${nsfwInfo.name}** ` : '';

      console.log(`🎨 Generating ${nsfwWarning}${orientation} image (${width}x${height}) using ${modelInfo.name} from: "${cleanPrompt}"`);
      
      const processingMsg = await message.reply(`🎨 Creating ${nsfwWarning}${emoji} **${orientation}** image with ${modelInfo.emoji} **${modelInfo.name}**... Please wait!`);

      try {
        const enhancedPrompt = await enhancePrompt(cleanPrompt, false, nsfwLevel);
        const imageUrl = await generateImage(enhancedPrompt, model, orientation, nsfwLevel);

        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const attachment = new AttachmentBuilder(Buffer.from(imageBuffer), { 
          name: 'generated-image.png',
          description: nsfwInfo ? `NSFW: ${nsfwInfo.name}` : 'AI Generated Image'
        });

        const nsfwEmbed = nsfwInfo ? `**NSFW Level:** ${nsfwInfo.emoji} ${nsfwInfo.name}\n` : '';
        
        const embed = new EmbedBuilder()
          .setTitle(`🎨 AI Generated Image ${emoji} ${nsfwInfo ? nsfwInfo.emoji : ''}`)
          .setDescription(`**Original:** ${cleanPrompt}\n**AI Prompt:** ${enhancedPrompt.substring(0, 150)}...\n${nsfwEmbed}**Model:** ${modelInfo.emoji} ${modelInfo.name}\n**Size:** ${emoji} ${orientation.toUpperCase()} (${width}x${height})`)
          .setImage('attachment://generated-image.png')
          .setColor(nsfwInfo ? 0xFF6B6B : 0x00D9FF)
          .setFooter({ text: `Created by ${message.author.username} • Powered by Pollinations.ai` })
          .setTimestamp();

        await processingMsg.delete();
        
        // Spoiler tag for NSFW content
        const replyContent = nsfwInfo ? `🔞 **${nsfwInfo.name}** content - Click to reveal` : null;
        
        await message.reply({ 
          content: replyContent,
          embeds: [embed], 
          files: [attachment]
        });

        console.log(`✅ ${nsfwWarning}Image created for: ${message.author.tag}`);
        return;

      } catch (error) {
        console.error('❌ Error creating image:', error);
        await processingMsg.edit('⚠️ An error occurred. Please try again!');
        return;
      }
    }

    // CHECK NSFW INFO COMMAND
    if (userMessage.toLowerCase() === '/nsfw' || userMessage.toLowerCase() === '/nsfw-info') {
      const nsfwStatus = canUseNSFW(message);
      const levelsList = Object.entries(NSFW_CONFIG.levels)
        .map(([level, config]) => `${config.emoji} **${config.name}** (\`${config.flag}\`)\n└ ${config.description}`)
        .join('\n\n');
      
      const embed = new EmbedBuilder()
        .setTitle('🔞 NSFW Information')
        .setDescription(`**Current Status:** ${nsfwStatus.allowed ? '✅ Allowed' : '❌ Not Allowed'}\n${nsfwStatus.reason ? `**Reason:** ${nsfwStatus.reason}` : ''}\n\n**Available Levels:**\n${levelsList}\n\n**Usage:**\n\`/create your prompt ${NSFW_CONFIG.levels.soft.flag}\`\n\n**Requirements:**\n${NSFW_CONFIG.requireNSFWChannel ? '• Must be in NSFW-marked channel' : '• Available in all channels'}\n${NSFW_CONFIG.allowInDM ? '• Allowed in DMs' : '• Not allowed in DMs'}`)
        .setColor(nsfwStatus.allowed ? 0x00FF00 : 0xFF0000)
        .setFooter({ text: 'Use responsibly and follow Discord ToS' })
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
      await message.reply(`What would you like to talk about? 🤔\n\n💡 **Commands:**\n🎨 \`/create <description>\` - Generate images\n🔞 \`/nsfw\` - NSFW information\n📊 \`/quota\` - Check usage`);
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
