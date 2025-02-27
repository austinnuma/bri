// services/geminiService.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger.js';

// Get API key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Check if API key is available
if (!GEMINI_API_KEY) {
  logger.error("Gemini API key is missing! Set GEMINI_API_KEY in your environment variables.");
}

// Initialize the Gemini client
const geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);

// Create a search-enabled model (using the beta API version)
const searchEnabledModel = geminiClient.getGenerativeModel(
  {
    model: "gemini-1.5-flash",
    tools: [
      {
        googleSearchRetrieval: {} // Use default search configuration
      },
    ],
  },
  { apiVersion: "v1beta" }
);

// Regular model as fallback
const regularModel = geminiClient.getGenerativeModel({ 
  model: "gemini-1.5-flash" 
});

/**
 * Sends a query to Gemini with Google Search enabled
 * @param {string} prompt - The user's question
 * @returns {Promise<Object>} - Response with text and source information
 */
export async function fetchGeminiResponse(prompt) {
  if (!prompt) {
    logger.error("Prompt cannot be null or undefined");
    throw new Error("Prompt cannot be null or undefined");
  }
  
  try {
    logger.info(`Sending search-enabled query to Gemini: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
    
    // System instruction to maintain Bri's personality
    const systemInstructions = 
      "You are Bri, a helpful AI assistant with the personality of a 10-year-old girl. " +
      "While you have access to the latest information through Google Search, " +
      "maintain your cheerful, energetic personality. Your answers should be " +
      "helpful, accurate, and reflect your childlike enthusiasm. " +
      "If you use information from the internet, mention your sources in a way a 10-year-old would.";
    
    // Format the prompt with system instructions
    const formattedPrompt = `${systemInstructions}\n\nUser asked: ${prompt}`;
    
    try {
      // First try with search enabled
      const result = await searchEnabledModel.generateContent(formattedPrompt);
      const responseText = result.response.text();
      
      // Check for sources in the response
      let sources = [];
      try {
        if (result.response.candidates && 
            result.response.candidates[0] && 
            result.response.candidates[0].groundingMetadata) {
          
          const groundingMetadata = result.response.candidates[0].groundingMetadata;
          
          if (groundingMetadata.searchResponseSources && 
              Array.isArray(groundingMetadata.searchResponseSources)) {
            
            sources = groundingMetadata.searchResponseSources.map(source => ({
              title: source.title || "Untitled Source",
              url: source.uri || "#",
              snippet: source.snippet || ""
            }));
          }
        }
      } catch (metadataError) {
        logger.warn("Error extracting search metadata (continuing with response):", metadataError);
        // Don't fail the whole response if we just can't extract sources
      }
      
      logger.info(`Received Gemini response with search (${responseText.length} chars, ${sources.length} sources)`);
      
      return {
        text: responseText,
        sources: sources,
        usedSearch: true
      };
    } catch (searchError) {
      // If search-enabled request fails, fall back to regular model
      logger.warn("Search-enabled request failed, falling back to regular model:", searchError);
      
      const fallbackResult = await regularModel.generateContent(formattedPrompt);
      const fallbackText = fallbackResult.response.text();
      
      logger.info(`Received fallback Gemini response (${fallbackText.length} chars)`);
      
      return {
        text: fallbackText,
        sources: [],
        usedSearch: false,
        fallback: true
      };
    }
  } catch (error) {
    logger.error("Error querying Gemini:", error);
    throw error;
  }
}

/**
 * Legacy function for backward compatibility
 */
export async function queryGemini(prompt) {
  if (!prompt) {
    throw new Error("Prompt cannot be null or undefined");
  }
  
  try {
    const result = await regularModel.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    logger.error("Error in legacy queryGemini:", error);
    throw error;
  }
}

// Export models for direct access if needed
export { searchEnabledModel, regularModel };