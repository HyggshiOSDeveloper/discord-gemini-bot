import 'dotenv/config'
import { Client, GatewayIntentBits } from 'discord.js'
import { GoogleGenerativeAI } from '@google/generative-ai'

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
})

// Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`)
})

client.on('messageCreate', async (message) => {
  if (message.author.bot) return

  // 🔁 CHUYỂN TIẾP: chỉ trả lời khi bot được ping
  if (!message.mentions.has(client.user)) return

  try {
    const userMessage = message.content
      .replace(`<@${client.user.id}>`, '')
      .trim()

    if (!userMessage) return

    await message.channel.sendTyping()

    const result = await model.generateContent(userMessage)
    const reply = result.response.text()

    // giới hạn Discord 2000 ký tự
    await message.reply(reply.slice(0, 1900))
  } catch (err) {
    console.error(err)
    message.reply("❌ Lỗi Gemini AI")
  }
})

client.login(process.env.DISCORD_TOKEN)
