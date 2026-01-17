import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Xóa lịch sử hội thoại với AI')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),

  async execute(interaction, model, conversationHistory) {
    const userId = interaction.user.id;
    
    if (conversationHistory.has(userId)) {
      conversationHistory.delete(userId);
      await interaction.reply({ 
        content: '✅ Đã xóa lịch sử hội thoại. Bạn có thể bắt đầu cuộc trò chuyện mới!',
        ephemeral: true 
      });
    } else {
      await interaction.reply({ 
        content: 'ℹ️ Chưa có lịch sử hội thoại nào.',
        ephemeral: true 
      });
    }
  },
};
