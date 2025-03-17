import { SlashCommandBuilder } from '@discordjs/builders';
import { EmbedBuilder } from 'discord.js';
import { fetchGeminiResponse } from '../services/combinedServices.js';
import { logger } from '../utils/logger.js';
import { splitMessage } from '../utils/textUtils.js';

// Import credit management functions
import { hasEnoughCredits, useCredits, CREDIT_COSTS, getServerCredits } from '../utils/creditManager.js';
import { getServerConfig } from '../utils/serverConfigManager.js';

export const data = new SlashCommandBuilder()
  .setName('gemini')
  .setDescription('Ask Google Gemini AI a question with internet search')
  .addStringOption(option =>
    option.setName('prompt')
      .setDescription('What would you like to ask?')
      .setRequired(true))
  .addBooleanOption(option =>
    option.setName('showsources')
      .setDescription('Show where information came from (if available)')
      .setRequired(false));

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    
    // Get the prompt parameter
    const prompt = interaction.options.getString('prompt');
    const showSources = interaction.options.getBoolean('showsources') ?? true;
    
    // Check if prompt exists and is not empty
    if (!prompt) {
      await interaction.editReply("I need a question to answer! Please provide a prompt.");
      return;
    }
    
    // Get guild ID for credit checks
    const guildId = interaction.guildId;
    
    // Check if this server has credits enabled
    const serverConfig = await getServerConfig(guildId);
    const creditsEnabled = serverConfig?.credits_enabled === true;
    
    // If credits are enabled, check if there are enough credits
    if (creditsEnabled) {
      const operationType = 'GEMINI_QUERY';
      
      // Check if server has enough credits
      const hasCredits = await hasEnoughCredits(guildId, operationType);
      
      if (!hasCredits) {
        // Get current credit information for a more helpful message
        const credits = await getServerCredits(guildId);
        
        const creditsEmbed = new EmbedBuilder()
          .setTitle('Insufficient Credits')
          .setDescription(`This server doesn't have enough credits to use the Gemini AI.`)
          .setColor(0xFF0000)
          .addFields(
            {
              name: '💰 Available Credits',
              value: `${credits?.remaining_credits || 0} credits`,
              inline: true
            },
            {
              name: '💸 Required Credits',
              value: `${CREDIT_COSTS[operationType]} credits`,
              inline: true
            },
            {
              name: '📊 Credit Cost',
              value: `Using Gemini AI costs ${CREDIT_COSTS[operationType]} credits per query.`,
              inline: true
            }
          )
          .setFooter({ 
            text: 'Purchase more credits on the Bri website or wait for your monthly refresh.'
          });
          
        await interaction.editReply({ embeds: [creditsEmbed] });
        return;
      }
    }
    
    logger.info(`User ${interaction.user.id} asked Gemini: ${prompt}`);
    
    // Send typing indicator while processing
    await interaction.channel.sendTyping();
    
    // Query Gemini with internet search capabilities
    const response = await fetchGeminiResponse(prompt);
    
    if (!response || !response.text) {
      await interaction.editReply("Sorry, I couldn't get a response from Gemini right now. Try again later!");
      return;
    }
    
    // If credits are enabled, use credits AFTER successful response
    if (creditsEnabled) {
      await useCredits(guildId, 'GEMINI_QUERY');
      logger.info(`Used ${CREDIT_COSTS['GEMINI_QUERY']} credits for Gemini query in server ${guildId}`);
    }
    
    // Format response text
    const responseText = response.text;
    
    // Handle response based on length
    if (responseText.length <= 2000) {
      // Simple case: direct response fits in a single message
      await interaction.editReply(responseText);
      
      // If sources are available and user wants to see them, send as a follow-up
      if (response.sources && response.sources.length > 0 && showSources) {
        await sendSourcesEmbed(interaction, response.sources);
      }
    } else {
      // Complex case: response needs to be split into multiple messages
      const chunks = splitMessage(responseText, 2000);
      
      // Send the first chunk as the initial reply
      await interaction.editReply(chunks[0]);
      
      // Send additional chunks as follow-up messages
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
      
      // Send sources as the final follow-up if available
      if (response.sources && response.sources.length > 0 && showSources) {
        await sendSourcesEmbed(interaction, response.sources);
      }
    }
    
    logger.info(`Successfully responded to Gemini query from ${interaction.user.id}`);
  } catch (error) {
    logger.error('Error executing gemini command:', error);
    await interaction.editReply('Sorry, there was an error processing your request to Gemini.');
  }
}

/**
 * Sends an embed with source information
 * @param {Interaction} interaction - The Discord interaction
 * @param {Array} sources - Array of source objects
 */
async function sendSourcesEmbed(interaction, sources) {
  if (!sources || sources.length === 0) return;
  
  try {
    // Create a simple embed for sources
    const embed = new EmbedBuilder()
      .setTitle('Where I Found This Information')
      .setDescription('I looked at these websites to help answer your question:')
      .setColor(0x4285F4) // Google blue color
      .setFooter({ text: 'Information from Google Search' });
    
    // Add up to 5 sources as fields (Discord limits fields to 25)
    const maxSources = Math.min(sources.length, 5);
    for (let i = 0; i < maxSources; i++) {
      const source = sources[i];
      embed.addFields({ 
        name: source.title || `Source ${i+1}`,
        value: source.url ? `[Click here to visit](${source.url})` : 'No link available'
      });
    }
    
    // If there are more sources than we can show
    if (sources.length > maxSources) {
      embed.addFields({ 
        name: 'More Sources',
        value: `I also looked at ${sources.length - maxSources} other websites!`
      });
    }
    
    // Send the embed as a follow-up
    await interaction.followUp({ embeds: [embed] });
  } catch (error) {
    logger.error('Error sending sources embed:', error);
    // Don't fail the whole command if just the sources embed fails
  }
}