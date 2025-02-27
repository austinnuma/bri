// Update your clearmemories.js file to use the new memory system
import { SlashCommandBuilder } from '@discordjs/builders';
import { clearAllMemories } from '../utils/unifiedMemoryManager.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('clearmemories')
  .setDescription('Clears all of your memories from my database.');

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    
    const userId = interaction.user.id;
    const success = await clearAllMemories(userId);
    
    if (success) {
      await interaction.editReply("I've cleared all of your memories from my database. It's like we're meeting for the first time! 😊");
      logger.info(`Cleared all memories for user ${userId}`);
    } else {
      await interaction.editReply("Hmm, I had trouble clearing your memories. Can you try again?");
      logger.error(`Failed to clear memories for user ${userId}`);
    }
  } catch (error) {
    logger.error('Error executing clearmemories command:', error);
    await interaction.editReply('Sorry, there was an error clearing your memories.');
  }
}