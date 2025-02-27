import { SlashCommandBuilder } from '@discordjs/builders';
import { logger } from '../utils/logger.js';
import { fetchGeminiResponse } from '../services/geminiService.js';

export const data = new SlashCommandBuilder()
  .setName('gemini')
  .setDescription('Ask Google Gemini AI for up-to-date information')
  .addStringOption(option =>
    option.setName('query')
      .setDescription('What would you like to ask Gemini?')
      .setRequired(true));

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    
    const query = interaction.options.getString('query');
    logger.info(`User ${interaction.user.id} asked Gemini: ${query}`);
    
    // Get response from Gemini
    const response = await fetchGeminiResponse(query);
    
    if (!response) {
      await interaction.editReply("Sorry, I couldn't get a response from Gemini right now. Try again later!");
      return;
    }
    
    // Handle long responses by chunking if needed
    if (response.length > 2000) {
      // Split response into chunks of 2000 characters
      for (let i = 0; i < response.length; i += 2000) {
        const chunk = response.substring(i, i + 2000);
        if (i === 0) {
          await interaction.editReply(chunk);
        } else {
          await interaction.followUp(chunk);
        }
      }
    } else {
      await interaction.editReply(response);
    }
  } catch (error) {
    logger.error('Error executing gemini command:', error);
    await interaction.editReply('Sorry, there was an error processing your request to Gemini.');
  }
}