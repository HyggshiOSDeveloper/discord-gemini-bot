import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Trò chuyện với Gemini 1.5 Flash AI')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Tin nhắn của bạn')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('private')
        .setDescription('Chỉ bạn nhìn thấy phản hồi (ephemeral)')
        .setRequired(false)
    )
    .setIntegrationTypes([0, 1]) // 0 = Guild, 1 = User
    .setContexts([0, 1, 2]), // 0 = Guild, 1 = DM, 2 = Group DM

  async execute(interaction, model, conversationHistory) {
    const message = interaction.options.getString('message');
    const isPrivate = interaction.options.getBoolean('private') ?? false;

    await interaction.deferReply({ ephemeral: isPrivate });

    try {
      // Tạo key cho user (mỗi user có lịch sử riêng)
      const userId = interaction.user.id;
      
      if (!conversationHistory.has(userId)) {
        conversationHistory.set(userId, []);
      }
      const history = conversationHistory.get(userId);

      // Thêm tin nhắn vào lịch sử
      history.push({
        role: 'user',
        parts: [{ text: message }],
      });

      // Giới hạn lịch sử 30 tin nhắn (Flash có context window lớn hơn)
      if (history.length > 30) {
        history.splice(0, history.length - 30);
      }

      // Tạo chat với context - Flash không cần config lại vì đã set global
      const chat = model.startChat({
        history: history.slice(0, -1),
      });

      const result = await chat.sendMessage(message);
      const response = await result.response;
      let botReply = response.text();

      // Thêm phản hồi vào lịch sử
      history.push({
        role: 'model',
        parts: [{ text: botReply }],
      });

      // Chia nhỏ nếu quá dài
      if (botReply.length > 2000) {
        const chunks = botReply.match(/[\s\S]{1,2000}/g) || [];
        await interaction.editReply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp({ content: chunks[i], ephemeral: isPrivate });
        }
      } else {
        await interaction.editReply(botReply);
      }

    } catch (error) {
      console.error('Error:', error);
      await interaction.editReply('⚠️ Đã có lỗi xảy ra khi xử lý yêu cầu của bạn.');
    }
  },
};
