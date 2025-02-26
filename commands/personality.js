import { setPersonalityPreference } from '../utils/personality.js';
import { ApplicationCommandOptionType } from 'discord.js';

export const personalityCommand = {
  name: 'personality',
  description: 'Update your personality preferences for Bri.',
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'responselength',
      description: 'Set your preferred response length.',
      options: [
        {
          name: 'value',
          type: ApplicationCommandOptionType.String,
          description: 'Response length (e.g., short, normal, long)',
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'humor',
      description: 'Set your preferred humor level.',
      options: [
        {
          name: 'value',
          type: ApplicationCommandOptionType.String,
          description: 'Humor preference (e.g., none, light, more humorous)',
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'tone',
      description: 'Set your preferred tone.',
      options: [
        {
          name: 'value',
          type: ApplicationCommandOptionType.String,
          description: 'Tone (e.g., friendly, formal, casual)',
          required: true,
        },
      ],
    },
  ],
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand(); // will be one of 'responselength', 'humor', or 'tone'
    const value = interaction.options.getString('value');

    try {
      await setPersonalityPreference(interaction.user.id, subcommand, value);
      await interaction.reply({
        content: `Your personality preference for "${subcommand}" has been updated to: ${value}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Error updating personality preference:", error);
      await interaction.reply({
        content: 'There was an error updating your personality preference.',
        ephemeral: true,
      });
    }
  },
};
