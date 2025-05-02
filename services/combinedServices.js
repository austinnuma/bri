// Global Imports
import { logger } from '../utils/logger.js';
import { generateImageFromPrompt } from './imagenService.js';

/**
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 *                    Gemini Service Section
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

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
      "You are Bri, a helpful AI assistant with the personality of a 14-year-old girl. " +
      "While you have access to the latest information through Google Search, " +
      "maintain your cheerful, energetic personality. Your answers should be " +
      "helpful, accurate, and reflect your childlike enthusiasm. " +
      "If you use information from the internet, mention your sources in a way a 14-year-old would.";
    
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


export { generateImageFromPrompt };



/**
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 *                   OpenAI Service Section
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 */


// services/openaiService.js
import OpenAI from 'openai';
import { createChatCompletion, createEmbedding } from '../utils/batchedOpenAI.js';

// Initialize the OpenAI client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Default models
let _defaultAskModel = process.env.DEFAULT_MODEL || 'gpt-4o';
const _summarizationModel = process.env.SUMMARIZATION_MODEL || 'gpt-4o-mini';
const _embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';
const _webSearchModel = process.env.WEB_SEARCH_MODEL || 'gpt-4o-search-preview';

/**
 * Get the default model for ask queries
 * @returns {string} - The default model name
 */
export const defaultAskModel = _defaultAskModel;

/**
 * Set the default model for ask queries
 * @param {string} modelName - The model name to set as default
 * @returns {string} - The new default model name
 */
export function setDefaultAskModel(modelName) {
  // Validate the model name
  const validModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'];
  if (!validModels.includes(modelName)) {
    logger.warn(`Invalid model name: ${modelName}, defaulting to gpt-4o-mini`);
    _defaultAskModel = 'gpt-4o-mini';
    return _defaultAskModel;
  }

  logger.info(`Changing default model from ${_defaultAskModel} to ${modelName}`);
  _defaultAskModel = modelName;
  return _defaultAskModel;
}

/**
 * Get the current default model
 * @returns {string} - The current default model
 */
export function getCurrentModel() {
  return _defaultAskModel;
}

/**
 * Gets the model used for summarization
 * @returns {string} - The summarization model
 */
export function getSummarizationModel() {
  return _summarizationModel;
}

/**
 * Gets the model used for embeddings
 * @returns {string} - The embedding model
 */
export function getEmbeddingModel() {
  return _embeddingModel;
}

/**
 * Gets the model used for web search
 * @returns {string} - The web search model
 */
export function getWebSearchModel() {
  return _webSearchModel;
}

/**
 * Sends a query to OpenAI with web search capabilities
 * @param {string} prompt - The user's question
 * @param {string} [contextSize='medium'] - Search context size ('low', 'medium', 'high')
 * @returns {Promise<Object>} - Response with text and source information
 */
export async function fetchOpenAISearchResponse(prompt, contextSize = 'medium') {
  if (!prompt) {
    logger.error("Prompt cannot be null or undefined");
    throw new Error("Prompt cannot be null or undefined");
  }
  
  try {
    logger.info(`Sending web search query to OpenAI: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
    
    // System instruction to maintain Bri's personality
    const systemInstructions = 
      "You are Bri, a helpful AI assistant with the personality of a 14-year-old girl. " +
      "While you have access to the latest information through web search, " +
      "maintain your cheerful, energetic personality. Your answers should be " +
      "helpful, accurate, and reflect your childlike enthusiasm. " +
      "If you use information from the internet, cite your sources inline using [1], [2], etc. " +
      "and try to use current and reliable sources.";
    
    // Create the messages array
    const messages = [
      { role: "system", content: systemInstructions },
      { role: "user", content: prompt }
    ];
    
    try {
      // Make the API call with web search
      const response = await openai.chat.completions.create({
        model: _webSearchModel,
        messages: messages,
        max_tokens: 1500,
        web_search_options: {
          search_context_size: contextSize,
        },
      });
      
      // Extract the response content
      const responseText = response.choices[0].message.content;
      
      // Extract annotations (source citations)
      let sources = [];
      if (response.choices[0].message.annotations) {
        const annotations = response.choices[0].message.annotations;
        
        // Process URL citation annotations
        for (const annotation of annotations) {
          if (annotation.type === 'url_citation' && annotation.url_citation) {
            sources.push({
              title: annotation.url_citation.title || "Untitled Source",
              url: annotation.url_citation.url || "#",
              start_index: annotation.url_citation.start_index,
              end_index: annotation.url_citation.end_index
            });
          }
        }
      }
      
      logger.info(`Received OpenAI search response (${responseText.length} chars, ${sources.length} sources)`);
      
      return {
        text: responseText,
        sources: sources,
        usedSearch: true
      };
    } catch (error) {
      logger.error("Error using OpenAI web search:", error);
      
      // Fallback to regular model without web search
      const fallbackResult = await getChatCompletion({
        model: _defaultAskModel,
        messages: messages
      });
      
      logger.info(`Received fallback OpenAI response (${fallbackResult.choices[0].message.content.length} chars)`);
      
      return {
        text: fallbackResult.choices[0].message.content,
        sources: [],
        usedSearch: false,
        fallback: true
      };
    }
  } catch (error) {
    logger.error("Error querying OpenAI:", error);
    throw error;
  }
}

/**
 * Creates a chat completion using OpenAI's Chat Completion API with batching.
 *
 * @param {Object} options - Options for the chat completion.
 * @param {string} [options.model=defaultAskModel] - The model to use.
 * @param {Array<Object>} options.messages - Array of message objects { role, content }.
 * @param {number} [options.max_tokens=1500] - Maximum tokens to generate.
 * @returns {Promise<Object>} - The API response.
 */
export async function getChatCompletion({ model = defaultAskModel, messages, max_tokens = 1500, ...otherOptions }) {
  try {
    // Use the batched version for supported scenarios
    return await createChatCompletion({
      model,
      messages,
      max_tokens,
      ...otherOptions
    });
  } catch (error) {
    logger.error("Error creating chat completion:", error);
    throw error;
  }
}

/**
 * Retrieves an embedding vector for the given text with batching support.
 *
 * @param {Object} options - Options for the embedding request.
 * @param {string|string[]} options.text - The text(s) to embed.
 * @param {string} [options.model="text-embedding-ada-002"] - The embedding model to use.
 * @returns {Promise<any>} - The embedding vector(s).
 */
export async function getEmbedding({ text, model = "text-embedding-ada-002" }) {
  try {
    const response = await createEmbedding({
      model,
      input: text
    });
    
    // Format response to match original function
    if (Array.isArray(text)) {
      return response.data.map(item => item.embedding);
    } else {
      return response.data[0].embedding;
    }
  } catch (error) {
    logger.error("Error creating embedding:", error);
    throw error;
  }
}


/**
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 *                 SupaBase Service Section
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Create and export the Supabase client instance.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Upserts data into a specified table.
 * @param {string} table - The name of the table.
 * @param {Object|Array} data - The data to upsert.
 * @returns {Promise<Object>} - The result data from the upsert.
 */
export async function upsert(table, data) {
  const { data: result, error } = await supabase
    .from(table)
    .upsert(data);
  if (error) {
    console.error(`Error upserting into ${table}:`, error);
    throw error;
  }
  return result;
}

/**
 * Selects data from a specified table using a query condition.
 * @param {string} table - The name of the table.
 * @param {Object} query - An object containing the query key/value pair.
 * @returns {Promise<Object>} - The selected data.
 */
export async function select(table, query) {
  const key = Object.keys(query)[0];
  const value = query[key];
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(key, value);
  if (error) {
    console.error(`Error selecting from ${table}:`, error);
    throw error;
  }
  return data;
}

/**
 * Calls an RPC (stored procedure) on Supabase.
 * @param {string} rpcName - The name of the RPC function.
 * @param {Object} params - Parameters for the RPC.
 * @returns {Promise<Object>} - The result data from the RPC.
 */
export async function callRpc(rpcName, params) {
  const { data, error } = await supabase.rpc(rpcName, params);
  if (error) {
    console.error(`Error calling RPC ${rpcName}:`, error);
    throw error;
  }
  return data;
}
