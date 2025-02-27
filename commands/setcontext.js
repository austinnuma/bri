import { SlashCommandBuilder } from '@discordjs/builders';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/supabaseService.js';
import { memoryManagerState } from '../utils/unifiedMemoryManager.js';

export const data = new SlashCommandBuilder()
  .setName('setcontext')
  .setDescription('Set how many messages Bri remembers in your conversation')
  .addIntegerOption(option =>
    option.setName('length')
      .setDescription('Number of messages to remember (5-50)')
      .setRequired(true)
      .setMinValue(5)
      .setMaxValue(50));

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    
    const userId = interaction.user.id;
    const contextLength = interaction.options.getInteger('length');
    
    // Validate context length
    if (contextLength < 5 || contextLength > 50) {
      await interaction.editReply('Context length must be between 5 and 50 messages.');
      return;
    }
    
    // Update in memory
    const { userContextLengths } = memoryManagerState;
    userContextLengths.set(userId, contextLength);
    
    // Update in database
    const { error } = await supabase.from('user_conversations').upsert({
      user_id: userId,
      context_length: contextLength,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });
    
    if (error) {
      logger.error(`Error updating context length for user ${userId}:`, error);
      await interaction.editReply('There was an error saving your context length. Please try again.');
      return;
    }
    
    await interaction.editReply(`Your conversation context length has been set to ${contextLength} messages! This means I'll remember up to ${contextLength} messages of our conversation.`);
    logger.info(`Set context length to ${contextLength} for user ${userId}`);
  } catch (error) {
    logger.error('Error executing setcontext command:', error);
    await interaction.editReply('Sorry, there was an error updating your context length.');
  }
}