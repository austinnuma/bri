// commands/gif.js
import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import fetch from 'node-fetch';
import { openai, defaultAskModel } from '../services/combinedServices.js';
import { analyzeImage } from '../services/visionService.js';

// Create the slash command
export const data = new SlashCommandBuilder()
    .setName('gif')
    .setDescription('Posts a random GIF')
    .addStringOption(option =>
        option.setName('tag')
            .setDescription('Optional tag to filter GIFs (e.g., "cat", "happy", "dance")')
            .setRequired(false));

/**
 * Fetches a random GIF from Tenor
 * @param {string} tag - Optional tag to filter GIFs
 * @returns {Promise<string>} - GIF URL
 */
async function getRandomGif(tag = '') {
    try {
        // Get the API key from environment variables
        const apiKey = process.env.TENOR_API_KEY;
        
        if (!apiKey) {
            throw new Error('TENOR_API_KEY not found in environment variables');
        }
        
        // Determine which endpoint to use based on whether a tag was provided
        let endpoint;
        
        if (tag) {
            // Use search endpoint with the random parameter when a tag is provided
            // The random parameter helps ensure different results each time
            endpoint = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(tag)}&key=${apiKey}&random=true&limit=1`;
        } else {
            // Use featured endpoint with random parameter when no tag is provided
            endpoint = `https://tenor.googleapis.com/v2/featured?key=${apiKey}&random=true&limit=1`;
        }
            
        // Fetch from Tenor API
        const response = await fetch(endpoint);
        
        if (!response.ok) {
            throw new Error(`Tenor API responded with status ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if we got a valid response with at least one result
        if (!data.results || data.results.length === 0) {
            if (tag) {
                // If we used a tag but got no results, try again without the tag
                logger.info(`No GIF found for tag "${tag}", trying random GIF instead`);
                return getRandomGif('');
            }
            throw new Error('No GIF found in Tenor response');
        }
        
        // Tenor provides different media formats, use the highest quality
        const gifResult = data.results[0];
        
        // Get the URL of the GIF (prefer gif format)
        let gifUrl;
        
        if (gifResult.media_formats?.gif?.url) {
            // Use GIF format if available
            gifUrl = gifResult.media_formats.gif.url;
        } else if (gifResult.media_formats?.mediumgif?.url) {
            // Fall back to medium gif if available
            gifUrl = gifResult.media_formats.mediumgif.url;
        } else if (gifResult.media_formats?.tinygif?.url) {
            // Fall back to tiny gif if available
            gifUrl = gifResult.media_formats.tinygif.url;
        } else if (gifResult.url) {
            // Last resort, use the main URL if available
            gifUrl = gifResult.url;
        } else {
            throw new Error('Could not find a valid GIF URL in the Tenor response');
        }
        
        return gifUrl;
    } catch (error) {
        logger.error('Error fetching GIF from Tenor:', error);
        throw error;
    }
}

/**
 * Generates a personalized comment about the GIF
 * @param {string} gifUrl - URL of the GIF
 * @param {string} tag - Optional tag that was used in search
 * @returns {Promise<string>} - Bri's personalized comment
 */
async function generateGifComment(gifUrl, tag = '') {
    try {
        // First try to analyze the GIF using the vision service
        let imageDescription = '';
        try {
            // The vision service will analyze the first frame of the GIF
            imageDescription = await analyzeImage(gifUrl);
        } catch (visionError) {
            logger.warn('Error analyzing GIF with vision service, falling back to simpler method:', visionError);
            // If vision analysis fails, we'll continue without it
        }
        
        // If we couldn't get a description, generate a comment based just on the tag
        if (!imageDescription) {
            const prompt = `
You're Bri, a 14-year-old girl AI. Write a short, fun, ONE SENTENCE comment about a GIF.
${tag ? `The GIF is related to "${tag}".` : 'The GIF is completely random.'}
Make your comment excited and enthusiastic as if you're showing a friend a cool GIF you found!
Don't use phrases like "here's a GIF" - just comment on what might be IN the GIF in a fun way.
Example: "Wow, that kitty is doing the funniest dance I've ever seen!" or "That's exactly how I feel on Mondays too!"
`;

            const completion = await openai.chat.completions.create({
                model: defaultAskModel,
                messages: [{ role: "user", content: prompt }],
                max_tokens: 100,
                temperature: 0.8,
            });
            
            return completion.choices[0].message.content.trim();
        }
        
        // If we have a description, use it to generate a more personalized comment
        const prompt = `
You're Bri, a 14-year-old girl AI. Write a short, fun, ONE SENTENCE comment about a GIF I'm sending.
The GIF contains: ${imageDescription}
${tag ? `This GIF was found using the tag "${tag}".` : ''}
Make your comment excited and enthusiastic as if you're showing a friend a cool GIF you found!
Don't use phrases like "here's a GIF" - just comment on what's IN the GIF in a fun way.
Example: "Wow, that kitty is doing the funniest dance I've ever seen!" or "That's exactly how I feel on Mondays too!"
`;

        const completion = await openai.chat.completions.create({
            model: defaultAskModel,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
            temperature: 0.8,
        });
        
        return completion.choices[0].message.content.trim();
    } catch (error) {
        logger.error('Error generating GIF comment:', error);
        // Return a fallback message in case of error
        return tag 
            ? `Here's a ${tag} GIF for you!` 
            : `Check out this cool GIF!`;
    }
}

export async function execute(interaction) {
    await interaction.deferReply();
    
    try {
        // Get the optional tag parameter
        const tag = interaction.options.getString('tag');
        
        logger.info(`User ${interaction.user.id} requested a${tag ? ` "${tag}"` : ''} GIF`);
        
        // Get a random GIF
        const gifUrl = await getRandomGif(tag);
        
        // Generate a personalized comment about the GIF
        const comment = await generateGifComment(gifUrl, tag);
        
        // Reply with the GIF and personalized comment
        await interaction.editReply({
            content: comment,
            files: [{ attachment: gifUrl, name: 'gif.gif' }]
        });
        
    } catch (error) {
        logger.error('Error executing gif command:', error);
        await interaction.editReply('Oops! I had trouble finding a GIF. Can you try again?');
    }
}