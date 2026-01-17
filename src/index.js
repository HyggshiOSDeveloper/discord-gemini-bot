import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

// Khởi tạo Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

// Lưu lịch sử chat theo userId
const conversationHistory = new Map();

// Load commands
client.commands = new Collection();
const commandsPath = join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  client.commands.set(command.default.data.name, command.default);
}

client.on('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log(`📱 User Install: Enabled`);
  console.log(`💬 Slash Commands: ${client.commands.size}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, model, conversationHistory);
  } catch (error) {
    console.error('❌ Error executing command:', error);
    const reply = { content: '⚠️ Đã có lỗi xảy ra!', ephemeral: true };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
```

### .gitignore
```
node_modules/
.env
.DS_Store
