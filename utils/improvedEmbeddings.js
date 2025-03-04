// improvedEmbeddings.js - Simplified embedding optimization
import { openai } from '../services/combinedServices.js';
import { normalizeText } from './textUtils.js';
import { logger } from './logger.js';

// Simple cache with size limit
class SimpleCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.accessOrder = [];
  }
  
  has(key) {
    return this.cache.has(key);
  }
  
  get(key) {
    if (this.cache.has(key)) {
      // Move to end of access order (most recently used)
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.accessOrder.push(key);
      return this.cache.get(key);
    }
    return undefined;
  }
  
  set(key, value) {
    // If cache is full, remove least recently used item
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      const oldest = this.accessOrder.shift();
      this.cache.delete(oldest);
    }
    
    // Store the new value
    this.cache.set(key, value);
    
    // Add/move to end of access order
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
  }
  
  clear() {
    this.cache.clear();
    this.accessOrder = [];
  }
  
  get size() {
    return this.cache.size;
  }
}

// Create embedding cache
export const embeddingCache = new SimpleCache(1000);

// Queue for batching embedding requests
let embeddingQueue = [];
let isProcessingQueue = false;
let processingTimer = null;

/**
 * Get embedding for a single text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
export async function getEmbedding(text) {
  // Normalize text for consistency
  const normalized = normalizeText(text);
  
  // Return from cache if available
  if (embeddingCache.has(normalized)) {
    return embeddingCache.get(normalized);
  }
  
  // If the queue is empty and not processing, generate immediately
  if (embeddingQueue.length === 0 && !isProcessingQueue) {
    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: normalized,
      });
      const embedding = response.data[0].embedding;
      embeddingCache.set(normalized, embedding);
      return embedding;
    } catch (error) {
      logger.error("Error generating embedding:", error);
      throw error;
    }
  }
  
  // Otherwise, add to queue and wait for batch processing
  return new Promise((resolve, reject) => {
    embeddingQueue.push({
      text: normalized,
      resolve,
      reject
    });
    
    // Schedule queue processing
    if (!processingTimer) {
      processingTimer = setTimeout(processEmbeddingQueue, 100); // 100ms delay for batching
    }
  });
}

/**
 * Process the queued embedding requests in a batch
 */
async function processEmbeddingQueue() {
  // Reset timer
  processingTimer = null;
  
  // If already processing or queue is empty, exit
  if (isProcessingQueue || embeddingQueue.length === 0) {
    return;
  }
  
  // Mark as processing
  isProcessingQueue = true;
  
  try {
    // Take all current items from the queue
    const batch = [...embeddingQueue];
    embeddingQueue = [];
    
    // Get unique texts (some might be duplicates)
    const uniqueTexts = [...new Set(batch.map(item => item.text))];
    
    // Generate embeddings for unique texts
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: uniqueTexts,
    });
    
    // Map response data to a dictionary for easier lookup
    const embeddings = {};
    response.data.forEach((item, index) => {
      embeddings[uniqueTexts[index]] = item.embedding;
      
      // Cache the result
      embeddingCache.set(uniqueTexts[index], item.embedding);
    });
    
    // Resolve all promises in the batch
    for (const item of batch) {
      item.resolve(embeddings[item.text]);
    }
    
    logger.info(`Processed batch of ${batch.length} embeddings (${uniqueTexts.length} unique)`);
  } catch (error) {
    logger.error("Error processing embedding batch:", error);
    
    // Reject all promises in the batch
    for (const item of embeddingQueue) {
      item.reject(error);
    }
    embeddingQueue = [];
  } finally {
    // Mark as no longer processing
    isProcessingQueue = false;
    
    // If more items were added during processing, schedule another run
    if (embeddingQueue.length > 0) {
      processingTimer = setTimeout(processEmbeddingQueue, 100);
    }
  }
}

/**
 * Get embeddings for multiple texts in one batch request
 * @param {string[]} texts - Array of texts
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
export async function getBatchEmbeddings(texts) {
  if (!texts || texts.length === 0) return [];
  
  // Normalize all texts
  const normalizedTexts = texts.map(text => normalizeText(text));
  
  // Check which texts are already cached
  const uncachedTexts = [];
  const textToIndexMap = {};
  
  for (let i = 0; i < normalizedTexts.length; i++) {
    if (!embeddingCache.has(normalizedTexts[i])) {
      uncachedTexts.push(normalizedTexts[i]);
      textToIndexMap[normalizedTexts[i]] = i;
    }
  }
  
  // If all texts are cached, return immediately
  if (uncachedTexts.length === 0) {
    return normalizedTexts.map(text => embeddingCache.get(text));
  }
  
  // Otherwise, generate embeddings for uncached texts
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: uncachedTexts,
  });
  
  // Cache the results
  for (let i = 0; i < uncachedTexts.length; i++) {
    embeddingCache.set(uncachedTexts[i], response.data[i].embedding);
  }
  
  // Return all embeddings in the original order
  return normalizedTexts.map(text => embeddingCache.get(text));
}

/**
 * Clear the embedding cache
 */
export function clearEmbeddingCache() {
  embeddingCache.clear();
}

/**
 * Get statistics about the embedding cache
 */
export function getEmbeddingCacheStats() {
  return {
    size: embeddingCache.size,
    maxSize: embeddingCache.maxSize,
    queueSize: embeddingQueue.length,
    isProcessing: isProcessingQueue
  };
}