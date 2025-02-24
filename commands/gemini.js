// /src/commands/gemini.js
import { logger } from '../utils/logger.js';
import { splitMessage } from '../utils/textUtils.js';
import { model as geminiModel } from '../services/geminiService.js';
import { ApplicationCommandOptionType } from 'discord.js';

const GEMINI_BASE_INSTRUCTION = "You are an AI model with the ability to search the internet for up-to-date information. Please use this internet search feature and answer the following query:";

export const geminiCommand = {
  name: 'gemini',
  description: 'Interact with the Gemini model for up-to-date information.',
  options: [
    {
      name: 'prompt',
      type: ApplicationCommandOptionType.String,
      description: 'Your prompt for Gemini',
      required: true,
    }
  ],
  async execute(interaction) {
    const userQuery = interaction.options.getString('prompt');
    // Prepend the base instruction
    const geminiPrompt = GEMINI_BASE_INSTRUCTION + "\n" + userQuery;
    await interaction.deferReply();
    try {
      logger.info('Gemini request', { prompt: geminiPrompt, timestamp: new Date() });
      const result = await geminiModel.generateContent([geminiPrompt]);
      // Adjust response extraction as needed based on Gemini's API.
      const geminiOutput = result.response.text();
      logger.info('Gemini response', { response: result, timestamp: new Date() });
      
      if (geminiOutput.length > 2000) {
        const chunks = splitMessage(geminiOutput, 2000);
        for (const chunk of chunks) {
          await interaction.followUp(chunk);
        }
      } else {
        await interaction.editReply(geminiOutput);
      }
    } catch (error) {
      logger.error('Gemini error', { error: error, timestamp: new Date() });
      console.error("Error interacting with Gemini:", error);
      await interaction.editReply("Sorry, an error occurred while interacting with Gemini.");
    }
  },
};
