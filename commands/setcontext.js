import { memoryManagerState } from '../utils/memoryManager.js';
import { ApplicationCommandOptionType } from 'discord.js';

export const setcontextCommand = {
  name: 'setcontext',
  description: 'Set your context length.',
  options: [
    {
      name: 'length',
      type: ApplicationCommandOptionType.Integer,
      description: 'Number of messages to keep (2-20)',
      required: true,
    }
  ],
  async execute(interaction) {
    const length = interaction.options.getInteger('length');
    if (length < 2 || length > 20) {
      await interaction.reply({ content: 'Context length must be between 2 and 20.', ephemeral: true });
      return;
    }
    memoryManagerState.userContextLengths.set(interaction.user.id, length);
    await interaction.reply({ content: `Context length set to ${length}.`, ephemeral: true });
  },
};
