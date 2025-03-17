import { SlashCommandBuilder } from '@discordjs/builders';
import { AttachmentBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

// Import the image generation function
import { generateImageFromPrompt } from '../services/combinedServices.js';

export const data = new SlashCommandBuilder()
  .setName('draw')
  .setDescription('Generate an image using Google\'s Imagen AI')
  .addStringOption(option =>
    option.setName('prompt')
      .setDescription('Describe the image you want to generate')
      .setRequired(true))
  .addIntegerOption(option =>
    option.setName('count')
      .setDescription('Number of images to generate (1-4)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(4))
  .addStringOption(option =>
    option.setName('safety')
      .setDescription('Content filtering level')
      .setRequired(false)
      .addChoices(
        { name: 'Standard', value: 'block_medium_and_above' },
        { name: 'Strict', value: 'block_low_and_above' },
        { name: 'Relaxed', value: 'block_only_high' }
      ))
  .addBooleanOption(option =>
    option.setName('ephemeral')
      .setDescription('Make the response visible only to you')
      .setRequired(false));

export async function execute(interaction) {
  let imageBuffer = null;
  
  try {
    // Defer reply with ephemeral flag if requested
    const isEphemeral = interaction.options.getBoolean('ephemeral') ?? false;
    await interaction.deferReply({ ephemeral: isEphemeral });
    
    // Get all parameters
    const prompt = interaction.options.getString('prompt');
    const count = interaction.options.getInteger('count') ?? 1;
    const safety = interaction.options.getString('safety') ?? 'block_medium_and_above';
    
    // Check if prompt exists and is not empty
    if (!prompt) {
      await interaction.editReply("I need a description to generate an image! Please provide a prompt.");
      return;
    }
    
    logger.info(`User ${interaction.user.id} requested image generation: "${prompt}", count: ${count}, safety: ${safety}`);
    
    // Call the image generation service
    try {
      const imageBuffers = await generateImageFromPrompt(prompt, count, safety);
      
      if (!imageBuffers || imageBuffers.length === 0) {
        await interaction.editReply("Sorry, I couldn't generate any images right now. Try again later!");
        return;
      }
      
      // Create attachments from all image buffers
      const attachments = imageBuffers.map((buffer, index) => 
        new AttachmentBuilder(buffer, { name: `generated-image-${index + 1}.png` })
      );
      
      // Create a more descriptive message based on how many images were generated
      const imageCount = imageBuffers.length > 1 ? 
        `Here are ${imageBuffers.length} images:` : 
        `Here's your image:`;
      
      // Respond with all generated images and the prompt
      await interaction.editReply({
        //content: `${imageCount} based on: "${prompt}"`,
        files: attachments
      });
      
      logger.info(`Successfully generated image for ${interaction.user.id}`);
    } catch (genError) {
      logger.error(`Image generation error: ${genError.message}`);
      await interaction.editReply(`Sorry, there was an error generating your image: ${genError.message}`);
      return;
    }
  } catch (error) {
    logger.error(`Error executing draw command: ${error.message}`, { error });
    
    // Handle interaction errors properly
    if (interaction.deferred) {
      await interaction.editReply('Sorry, there was an error generating your image. Please try again later.');
    } else if (!interaction.replied) {
      // If the interaction hasn't been replied to or deferred yet
      try {
        await interaction.reply({
          content: 'Sorry, there was an error processing your request.',
          ephemeral: true
        });
      } catch (replyError) {
        logger.error(`Failed to send error response: ${replyError.message}`);
      }
    }
  }
}