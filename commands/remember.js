import { processMemoryCommand } from '../utils/memoryManager.js';
import { ApplicationCommandOptionType } from 'discord.js';

export const rememberCommand = {
  name: 'remember',
  description: 'Store a memory (merge similar ones).',
  options: [
    {
      name: 'text',
      type: ApplicationCommandOptionType.String,
      description: 'Memory to store',
      required: true,
    }
  ],
  async execute(interaction) {
    const text = interaction.options.getString('text');
    const result = await processMemoryCommand(interaction.user.id, text);
    if (result.success) {
      await interaction.reply({ content: result.message, ephemeral: true });
    } else {
      await interaction.reply({ content: result.error, ephemeral: true });
    }
  },
};
