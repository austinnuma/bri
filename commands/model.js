import { SlashCommandBuilder } from '@discordjs/builders';
import { openai, setDefaultAskModel } from '../services/openaiService.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('model')
  .setDescription('Change the AI model being used (owner only)')
  .addStringOption(option =>
    option.setName('model')
      .setDescription('OpenAI model to use')
      .setRequired(true)
      .addChoices(
        { name: 'GPT-4o', value: 'gpt-4o' },
        { name: 'GPT-4o-mini', value: 'gpt-4o-mini' },
        { name: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' }
      ));

export async function execute(interaction) {
  try {
    // Check if user is the bot owner
    if (interaction.user.id !== process.env.OWNER_ID) {
      await interaction.reply({ content: "Sorry, only the bot owner can change the model.", ephemeral: true });
      return;
    }
    
    await interaction.deferReply();
    
    const modelName = interaction.options.getString('model');
    setDefaultAskModel(modelName);
    
    await interaction.editReply(`✅ Model changed to ${modelName}`);
    logger.info(`Model changed to ${modelName} by ${interaction.user.id}`);
  } catch (error) {
    logger.error('Error executing model command:', error);
    await interaction.editReply('Sorry, there was an error changing the model.');
  }
}