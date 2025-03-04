import { SlashCommandBuilder } from '@discordjs/builders';
import { logger } from '../utils/logger.js';
import { setPersonalityPreference, getPersonality } from '../utils/unifiedMemoryManager.js';

export const data = new SlashCommandBuilder()
  .setName('personality')
  .setDescription('Customize how Bri responds to you')
  .addIntegerOption(option =>
    option.setName('verbosity')
      .setDescription('How detailed should responses be?')
      .setRequired(false)
      .addChoices(
        { name: 'Brief', value: 1 },
        { name: 'Normal', value: 2 },
        { name: 'Detailed', value: 3 }
      ))
  .addIntegerOption(option =>
    option.setName('humor')
      .setDescription('How much humor should Bri use?')
      .setRequired(false)
      .addChoices(
        { name: 'Minimal', value: 1 },
        { name: 'Normal', value: 2 },
        { name: 'Extra Silly', value: 3 }
      ))
  .addIntegerOption(option =>
    option.setName('tone')
      .setDescription('What tone should Bri use?')
      .setRequired(false)
      .addChoices(
        { name: 'Casual', value: 1 },
        { name: 'Balanced', value: 2 },
        { name: 'Formal', value: 3 }
      ));

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    
    const userId = interaction.user.id;
    
    // Get current settings
    const currentSettings = getPersonality(userId);
    
    // Get new settings from options
    const verbosity = interaction.options.getInteger('verbosity');
    const humor = interaction.options.getInteger('humor');
    const tone = interaction.options.getInteger('tone');
    
    // If no settings provided, show current settings
    if (!verbosity && !humor && !tone) {
      const reply = formatCurrentSettings(currentSettings);
      await interaction.editReply(reply);
      return;
    }
    
    // Update settings
    const updatedSettings = {
      ...currentSettings,
      verbosity: verbosity || currentSettings.verbosity,
      humor: humor || currentSettings.humor,
      tone: tone || currentSettings.tone
    };
    
    // Save settings
    setPersonalityPreference(userId, updatedSettings);
    
    // Confirm changes
    const reply = `I've updated how I'll respond to you!\n\n${formatCurrentSettings(updatedSettings)}`;
    
    await interaction.editReply(reply);
    logger.info(`Updated personality settings for user ${userId}`);
  } catch (error) {
    logger.error('Error executing personality command:', error);
    await interaction.editReply('Sorry, there was an error updating your personality settings.');
  }
}

/**
 * Formats the current settings into a readable string
 */
function formatCurrentSettings(settings) {
  const verbosityNames = ['Brief', 'Normal', 'Detailed'];
  const humorNames = ['Minimal', 'Normal', 'Extra Silly'];
  const toneNames = ['Casual', 'Balanced', 'Formal'];
  
  return `**Current Personality Settings:**\n` +
    `• **Verbosity**: ${verbosityNames[settings.verbosity - 1] || 'Normal'}\n` +
    `• **Humor**: ${humorNames[settings.humor - 1] || 'Normal'}\n` +
    `• **Tone**: ${toneNames[settings.tone - 1] || 'Balanced'}`;
}