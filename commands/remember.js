import { SlashCommandBuilder } from '@discordjs/builders';
import { processMemoryCommand } from '../utils/unifiedMemoryManager.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('remember')
  .setDescription('Tell bri to remember something important')
  .addStringOption(option =>
    option.setName('memory')
      .setDescription('What would you like me to remember?')
      .setRequired(true));

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    
    const userId = interaction.user.id;
    const memoryText = interaction.options.getString('memory');
    
    const result = await processMemoryCommand(userId, memoryText);
    
    if (result.success) {
      await interaction.editReply(result.message);
      logger.info(`Stored memory for user ${userId}: ${memoryText}`);
    } else {
      await interaction.editReply(result.error || "Sorry, I couldn't save that memory.");
      logger.error(`Failed to store memory for user ${userId}`, { error: result.error });
    }
  } catch (error) {
    logger.error('Error executing remember command:', error);
    await interaction.editReply('Sorry, there was an error processing your memory command.');
  }
}