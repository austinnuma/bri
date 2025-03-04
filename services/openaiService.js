// services/openaiService.js
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { createChatCompletion, createEmbedding } from '../utils/batchedOpenAI.js';

// Initialize the OpenAI client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Default models
let _defaultAskModel = process.env.DEFAULT_MODEL || 'gpt-4o-mini';
const _summarizationModel = process.env.SUMMARIZATION_MODEL || 'gpt-3.5-turbo';
const _embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';

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