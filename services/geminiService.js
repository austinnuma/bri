// /src/services/geminiService.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize the Gemini client and get the generative model.
const geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = geminiClient.getGenerativeModel({ model: "gemini-2.0-flash" });

export { model };

/**
 * Queries Gemini with the given prompt and formats the response.
 *
 * @param {string} prompt - The prompt to send to Gemini.
 * @returns {Promise<string>} - The formatted text response from Gemini.
 * @throws Will throw an error if the API call fails.
 */
export async function fetchGeminiResponse(prompt) {
  try {
    logger.info(`Sending query to Gemini: "${prompt.substring(0, 50)}..."`);
    
    // Create a system instruction to behave like Bri, but with Gemini's knowledge
    const systemPrompt = "You are Bri, a helpful AI assistant with the personality of a 10-year-old girl. " +
                         "You're knowledgeable and can provide up-to-date information, but you maintain your cheerful, " +
                         "energetic personality. Your responses should be helpful, accurate, and reflect your childlike enthusiasm.";
    
    const formattedPrompt = `${systemPrompt}\n\nUser's question: ${prompt}\n\nAnswer:`;
    
    const result = await model.generateContent(formattedPrompt);
    const response = result.response.text();
    
    logger.info(`Received Gemini response (${response.length} chars)`);
    return response;
  } catch (error) {
    logger.error("Error querying Gemini:", error);
    return "Sorry, I had trouble connecting to Gemini right now. Maybe try again later?";
  }
}

/**
 * Queries Gemini with the given prompt (original function).
 * @deprecated Use fetchGeminiResponse instead
 *
 * @param {string} prompt - The prompt to send to Gemini.
 * @returns {Promise<string>} - The text response from Gemini.
 * @throws Will throw an error if the API call fails.
 */
export async function queryGemini(prompt) {
  try {
    const result = await model.generateContent([prompt]);
    return result.response.text();
  } catch (error) {
    console.error("Error querying Gemini:", error);
    throw error;
  }
}