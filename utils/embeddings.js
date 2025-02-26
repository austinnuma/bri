// /src/utils/embeddings.js
import OpenAI from 'openai';
import { normalizeText } from './normalize.js';

// Create an instance of the OpenAI API client using your API key.
import { openai } from '../services/openaiService.js';
// Create an in-memory cache to store embeddings.
export const embeddingCache = new Map();

/**
 * Retrieves the embedding for a given text.
 * It normalizes the text and checks if an embedding is already cached.
 * If not, it calls the OpenAI embeddings API and caches the result.
 *
 * @param {string} text - The input text for which to get the embedding.
 * @returns {Promise<any>} - The embedding vector.
 */
export async function getEmbedding(text) {
  const normalized = normalizeText(text);
  if (embeddingCache.has(normalized)) {
    return embeddingCache.get(normalized);
  }
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: normalized,
    });
    const embedding = response.data[0].embedding;
    embeddingCache.set(normalized, embedding);
    return embedding;
  } catch (error) {
    console.error("Error fetching embedding for text:", error);
    throw error;
  }
}

/**
 * Clears the embeddings cache.
 */
export function clearEmbeddingCache() {
  embeddingCache.clear();
}

/**
 * Returns the current embedding cache (for debugging or inspection).
 */
export const cache = embeddingCache;
