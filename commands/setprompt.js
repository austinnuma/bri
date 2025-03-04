import { SlashCommandBuilder } from '@discordjs/builders';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/combinedServices.js';
import { memoryManagerState, STATIC_CORE_PROMPT } from '../utils/unifiedMemoryManager.js';

export const data = new SlashCommandBuilder()
  .setName('setprompt')
  .setDescription('Set a custom prompt for Bri to use when talking to you')
  .addStringOption(option =>
    option.setName('prompt')
      .setDescription('Your custom prompt (or leave empty to reset)')
      .setRequired(false));

export async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });
    
    const userId = interaction.user.id;
    const promptText = interaction.options.getString('prompt');
    
    const { userDynamicPrompts } = memoryManagerState;
    
    // If no prompt text is provided, reset to default
    if (!promptText) {
      userDynamicPrompts.delete(userId);
      
      // Update database
      const { error } = await supabase.from('user_conversations').upsert({
        user_id: userId,
        system_prompt: STATIC_CORE_PROMPT,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });
      
      if (error) {
        logger.error(`Error resetting prompt for user ${userId}:`, error);
        await interaction.editReply('There was an error resetting your prompt. Please try again.');
        return;
      }
      
      await interaction.editReply('Your prompt has been reset to the default!');
      logger.info(`Reset prompt for user ${userId}`);
      return;
    }
    
    // Validate prompt length
    if (promptText.length > 500) {
      await interaction.editReply('Your prompt is too long! Please keep it under 500 characters.');
      return;
    }
    
    // Update in memory
    userDynamicPrompts.set(userId, promptText);
    
    // Update in database
    const { error } = await supabase.from('user_conversations').upsert({
      user_id: userId,
      system_prompt: STATIC_CORE_PROMPT + "\n" + promptText,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });
    
    if (error) {
      logger.error(`Error updating prompt for user ${userId}:`, error);
      await interaction.editReply('There was an error saving your prompt. Please try again.');
      return;
    }
    
    await interaction.editReply('Your custom prompt has been set! I will use this when chatting with you.');
    logger.info(`Set custom prompt for user ${userId}`);
  } catch (error) {
    logger.error('Error executing setprompt command:', error);
    await interaction.editReply('Sorry, there was an error updating your prompt.');
  }
}