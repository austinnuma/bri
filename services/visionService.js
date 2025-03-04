// services/visionService.js
import { openai } from './combinedServices.js';
import { logger } from '../utils/logger.js';

/**
 * Analyzes an image using OpenAI's vision capabilities
 * @param {string} imageUrl - URL to the image
 * @param {string} userPrompt - Optional text prompt from the user
 * @returns {Promise<string>} Description of the image
 */
export async function analyzeImage(imageUrl, userPrompt = '') {
  try {
    logger.info(`Analyzing image: ${imageUrl}`);
    
    // Prepare the custom prompt with Bri's personality
    const prompt = userPrompt ? 
      `The user sent this image with the message: "${userPrompt}". Describe what you see in the image.` :
      `The user sent this image. Describe what you see in detail.`;
      
    const systemMessage = `You are Bri, a helpful AI assistant with the personality of a 10-year-old girl. 
      When describing images, maintain your cheerful, curious, and childlike personality.
      Your responses should be enthusiastic and express childlike wonder when appropriate.
      If you see something potentially inappropriate for a 10-year-old in the image, 
      politely mention you can't describe that part of the image.`;
    
    // Call OpenAI's vision model
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: systemMessage
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 800,
    });
    
    const description = response.choices[0].message.content;
    logger.info(`Generated image description (${description.length} chars)`);
    
    return description;
  } catch (error) {
    logger.error("Error analyzing image:", error);
    throw new Error("I couldn't understand this image right now. Maybe try again later?");
  }
}