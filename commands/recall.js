// Update your recall.js file to use the new memory system
import { SlashCommandBuilder } from '@discordjs/builders';
import { retrieveRelevantMemories, MemoryTypes, MemoryCategories } from '../utils/unifiedMemoryManager.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('recall')
  .setDescription('Searches through what I remember about you')
  .addStringOption(option => 
    option.setName('query')
      .setDescription('What would you like me to recall?')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('category')
      .setDescription('Filter by category (optional)')
      .setRequired(false)
      .addChoices(
        { name: 'Personal', value: MemoryCategories.PERSONAL },
        { name: 'Professional', value: MemoryCategories.PROFESSIONAL },
        { name: 'Preferences', value: MemoryCategories.PREFERENCES },
        { name: 'Hobbies', value: MemoryCategories.HOBBIES },
        { name: 'Contact', value: MemoryCategories.CONTACT },
        { name: 'Other', value: MemoryCategories.OTHER }
      ));

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    
    const userId = interaction.user.id;
    const query = interaction.options.getString('query');
    const category = interaction.options.getString('category'); // May be null
    
    const memories = await retrieveRelevantMemories(
      userId, 
      query, 
      5,  // Limit to 5 memories
      null, // Don't filter by type
      category // May be null (no filter) or a specific category
    );
    
    if (!memories || memories.trim() === '') {
      await interaction.editReply("I don't remember anything about that. Maybe you haven't told me, or I forgot! 😅");
      return;
    }
    
    // Format the response nicely
    const response = `Here's what I remember about "${query}":\n\n${memories}`;
    
    await interaction.editReply(response);
    logger.info(`Recalled memories for user ${userId} with query "${query}"`);
  } catch (error) {
    logger.error('Error executing recall command:', error);
    await interaction.editReply('Sorry, there was an error recalling your memories.');
  }
}