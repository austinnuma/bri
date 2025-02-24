import { retrieveRelevantMemories } from '../utils/memoryManager.js';
import { ApplicationCommandOptionType } from 'discord.js';

export const recallCommand = {
  name: 'recall',
  description: 'Retrieve memories by query.',
  options: [
    {
      name: 'query',
      type: ApplicationCommandOptionType.String,
      description: 'Query to search memories',
      required: true,
    }
  ],
  async execute(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('query');
    try {
      const memories = await retrieveRelevantMemories(interaction.user.id, query, 3);
      if (memories && memories.trim() !== "") {
        await interaction.editReply("Here are the memories I found:\n" + memories);
      } else {
        await interaction.editReply("No memories found for that query.");
      }
    } catch (error) {
      console.error("Error in /recall:", error);
      await interaction.editReply("Sorry, an error occurred retrieving your memory.");
    }
  },
};
