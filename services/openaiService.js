// services/openaiService.js
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';

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
 * Create a chat completion with error handling
 * @param {Object} params - Parameters for the completion
 * @returns {Promise<Object>} - The completion response
 */
export async function createChatCompletion(params) {
  try {
    return await openai.chat.completions.create(params);
  } catch (error) {
    logger.error('Error creating chat completion', { error, params });
    throw error;
  }
}

/**
 * Create an embedding with error handling
 * @param {Object} params - Parameters for the embedding
 * @returns {Promise<Object>} - The embedding response
 */
export async function createEmbedding(params) {
  try {
    return await openai.embeddings.create({
      model: _embeddingModel,
      ...params
    });
  } catch (error) {
    logger.error('Error creating embedding', { error, params });
    throw error;
  }
}