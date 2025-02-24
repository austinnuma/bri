// Change the current model used for chat responses (owner only)
let currentModel = 'gpt-4o-mini';
import { ApplicationCommandOptionType } from 'discord.js';

export const modelCommand = {
  name: 'model',
  description: 'Change the model (owner only).',
  options: [
    {
      name: 'choice',
      type: ApplicationCommandOptionType.String,
      description: 'Model to use: gpt-3.5-turbo, gpt-3.5-turbo-16k, gpt-4o-mini, gpt-o3-mini-high',
      required: true,
      choices: [
        { name: 'gpt-3.5-turbo', value: 'gpt-3.5-turbo' },
        { name: 'gpt-3.5-turbo-16k', value: 'gpt-3.5-turbo-16k' },
        { name: 'gpt-4o-mini', value: 'gpt-4o-mini' },
        { name: 'gpt-o3-mini-high', value: 'gpt-o3-mini-high' },
      ],
    }
  ],
  async execute(interaction) {
    if (interaction.guild && interaction.user.id !== interaction.guild.ownerId) {
      await interaction.reply({ content: 'Only the owner can change the model.', ephemeral: true });
      return;
    }
    const chosenModel = interaction.options.getString('choice');
    // Set the global currentModel variable.
    currentModel = chosenModel;
    await interaction.reply({ content: `Model updated to ${chosenModel}.`, ephemeral: true });
  },
  getCurrentModel: () => currentModel,
};
