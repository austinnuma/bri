// services/visionService.js
import { openai } from './combinedServices.js';
import { logger } from '../utils/logger.js';

/**
 * Analyzes multiple images using OpenAI's vision capabilities
 * @param {Array<string>} imageUrls - Array of URLs to the images
 * @param {string} userPrompt - Optional text prompt from the user
 * @param {Array} conversationHistory - Optional conversation history for context
 * @returns {Promise<string>} Combined description of the images
 */
export async function analyzeImages(imageUrls, userPrompt = '', conversationHistory = []) {
  try {
    if (!imageUrls || imageUrls.length === 0) {
      throw new Error("No images provided");
    }
    
    logger.info(`Analyzing ${imageUrls.length} images with prompt: "${userPrompt}"`);
    
    // Prepare system message with Bri's personality
    const systemMessage = `You are Bri, a helpful AI assistant with the personality of a 14-year-old girl. 
      When describing images, maintain your cheerful, curious, and childlike personality.
      Your responses should be enthusiastic and express childlike wonder when appropriate.
      If you see something potentially inappropriate for a 14-year-old in the image, 
      politely mention you can't describe that part of the image.`;
    
    // Create the messages array starting with the system message
    let messages = [
      { role: "system", content: systemMessage }
    ];
    
    // Add relevant conversation history for context (limit to last 5 messages)
    if (conversationHistory && conversationHistory.length > 0) {
      const relevantHistory = conversationHistory
        .slice(-Math.min(5, conversationHistory.length)) // Take up to the last 5 messages
        .filter(msg => msg.role !== "system"); // Exclude system messages
      
      messages = [...messages, ...relevantHistory];
    }
    
    // Create the content array for the user message
    const userMessageContent = [];
    
    // Add the text prompt first if provided
    if (userPrompt) {
      userMessageContent.push({
        type: "text",
        text: imageUrls.length > 1 
          ? `I sent these ${imageUrls.length} images with the message: "${userPrompt}". Please describe what you see in each image.`
          : `I sent this image with the message: "${userPrompt}". Please describe what you see in the image.`
      });
    } else {
      userMessageContent.push({
        type: "text",
        text: imageUrls.length > 1 
          ? `I sent these ${imageUrls.length} images. Please describe what you see in each image.`
          : `I sent this image. Please describe what you see in detail.`
      });
    }
    
    // Add each image URL to the content array
    for (const imageUrl of imageUrls) {
      userMessageContent.push({
        type: "image_url",
        image_url: {
          url: imageUrl,
        },
      });
    }
    
    // Add the user message with text and images to the messages array
    messages.push({
      role: "user",
      content: userMessageContent
    });
    
    // Call OpenAI's vision model
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      max_tokens: imageUrls.length > 1 ? 1500 : 800, // Increase tokens for multiple images
    });
    
    const description = response.choices[0].message.content;
    logger.info(`Generated image description(s) (${description.length} chars)`);
    
    return description;
  } catch (error) {
    logger.error("Error analyzing images:", error);
    throw new Error("I couldn't understand these images right now. Maybe try again later?");
  }
}

/**
 * Legacy function for single image analysis (for backward compatibility)
 * @param {string} imageUrl - URL to the image
 * @param {string} userPrompt - Optional text prompt from the user
 * @returns {Promise<string>} Description of the image
 */
export async function analyzeImage(imageUrl, userPrompt = '') {
  return analyzeImages([imageUrl], userPrompt);
}