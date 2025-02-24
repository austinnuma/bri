// /src/services/geminiService.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config({ path: './config.env' });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize the Gemini client and get the generative model.
// Adjust the model name and options as needed.
const geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = geminiClient.getGenerativeModel({ model: "gemini-2.0-flash" });

export { model };

/**
 * Queries Gemini with the given prompt.
 *
 * @param {string} prompt - The prompt to send to Gemini.
 * @returns {Promise<string>} - The text response from Gemini.
 * @throws Will throw an error if the API call fails.
 */
export async function queryGemini(prompt) {
  try {
    const result = await model.generateContent([prompt]);
    // Adjust extraction based on Gemini's response structure.
    return result.response.text();
  } catch (error) {
    console.error("Error querying Gemini:", error);
    throw error;
  }
}
