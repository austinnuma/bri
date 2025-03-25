// cacheManager.js - Unified Write-Through Caching Solution

import LRU from 'lru-cache';
import { logger } from './logger.js';
import { supabase } from '../services/combinedServices.js';

// Configure primary caches
const userDataCache = new LRU({
  max: 500,            // Store up to 500 users
  ttl: 30 * 60 * 1000, // 30 minute TTL
  updateAgeOnGet: true // Reset TTL when accessed
});

const memoryCache = new LRU({
  max: 1000,           // Store up to 1000 memory sets
  ttl: 10 * 60 * 1000, // 10 minute TTL 
  updateAgeOnGet: true
});

const vectorSearchCache = new LRU({
  max: 200,            // Fewer vector searches cached (they're large)
  ttl: 5 * 60 * 1000,  // 5 minute TTL
  updateAgeOnGet: true
});

/**
 * Get user conversation with write-through caching
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<Array>} - Conversation array
 */
export async function getUserConversation(userId, guildId) {
  const cacheKey = `conversation:${userId}:${guildId}`;
  
  // Check cache first
  if (userDataCache.has(cacheKey)) {
    logger.debug(`Cache hit for user conversation: ${userId} in guild ${guildId}`);
    return userDataCache.get(cacheKey);
  }
  
  // Not in cache, fetch from database
  try {
    logger.debug(`Cache miss for user conversation: ${userId} in guild ${guildId}`);
    const { data, error } = await supabase
      .from('user_conversations')
      .select('conversation')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      logger.error(`Error fetching user conversation: ${error.message}`);
      return null;
    }
    
    // Cache the conversation array
    const conversation = data?.conversation || [];
    userDataCache.set(cacheKey, conversation);
    
    return conversation;
  } catch (error) {
    logger.error(`Error in getUserConversation: ${error.message}`);
    return null;
  }
}

/**
 * Set user conversation with write-through caching
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Array} conversation - Conversation array
 * @returns {Promise<boolean>} - Success indicator
 */
export async function setUserConversation(userId, guildId, conversation) {
  const cacheKey = `conversation:${userId}:${guildId}`;
  
  try {
    // Update database first (write-through approach)
    const { error } = await supabase
      .from('user_conversations')
      .upsert({
        user_id: userId,
        guild_id: guildId,
        conversation: conversation,
        last_updated: new Date().toISOString()
      });
      
    if (error) {
      logger.error(`Error updating user conversation: ${error.message}`);
      // If database update fails, invalidate cache to prevent stale data
      userDataCache.delete(cacheKey);
      return false;
    }
    
    // Update cache with the new data (not invalidating, updating!)
    userDataCache.set(cacheKey, conversation);
    logger.debug(`Updated conversation cache for user ${userId} in guild ${guildId}`);
    
    return true;
  } catch (error) {
    logger.error(`Error in setUserConversation: ${error.message}`);
    userDataCache.delete(cacheKey);
    return false;
  }
}

/**
 * Get user context length with caching
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<number|null>} - Context length
 */
export async function getUserContextLength(userId, guildId) {
  const cacheKey = `contextLength:${userId}:${guildId}`;
  
  // Check cache first
  if (userDataCache.has(cacheKey)) {
    return userDataCache.get(cacheKey);
  }
  
  // Not in cache, fetch from database
  try {
    const { data, error } = await supabase
      .from('user_conversations')
      .select('context_length')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      logger.error(`Error fetching context length: ${error.message}`);
      return null;
    }
    
    const contextLength = data?.context_length || null;
    userDataCache.set(cacheKey, contextLength);
    
    return contextLength;
  } catch (error) {
    logger.error(`Error in getUserContextLength: ${error.message}`);
    return null;
  }
}

/**
 * Get user dynamic prompt with caching
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<string|null>} - Dynamic prompt
 */
export async function getUserDynamicPrompt(userId, guildId) {
  const cacheKey = `dynamicPrompt:${userId}:${guildId}`;
  
  // Check cache first
  if (userDataCache.has(cacheKey)) {
    return userDataCache.get(cacheKey);
  }
  
  // Not in cache, fetch from database
  try {
    const { data, error } = await supabase
      .from('user_conversations')
      .select('dynamic_prompt')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      logger.error(`Error fetching dynamic prompt: ${error.message}`);
      return null;
    }
    
    const dynamicPrompt = data?.dynamic_prompt || null;
    userDataCache.set(cacheKey, dynamicPrompt);
    
    return dynamicPrompt;
  } catch (error) {
    logger.error(`Error in getUserDynamicPrompt: ${error.message}`);
    return null;
  }
}

/**
 * Efficient memory retrieval with vectorization
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID 
 * @param {Array} embedding - Query embedding
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Relevant memories
 */
export async function getRelevantMemories(userId, guildId, embedding, options = {}) {
  const { threshold = 0.6, limit = 5 } = options;
  
  // Create a hash from the embedding for cache key
  // Note: Don't use full embedding in key as it's too large
  const embeddingHash = hashEmbedding(embedding);
  const cacheKey = `vector:${userId}:${guildId}:${threshold}:${limit}:${embeddingHash}`;
  
  // Check cache first
  if (vectorSearchCache.has(cacheKey)) {
    logger.debug(`Vector search cache hit for user ${userId}`);
    return vectorSearchCache.get(cacheKey);
  }
  
  try {
    logger.debug(`Vector search cache miss for user ${userId}`);
    // Execute RPC for vector search
    const { data, error } = await supabase.rpc('match_unified_memories_multi_server', {
      p_user_id: userId,
      p_guild_id: guildId,
      p_query_embedding: embedding,
      p_match_threshold: threshold,
      p_match_count: limit
    });
    
    if (error) {
      logger.error(`Vector search error: ${error.message}`);
      return [];
    }
    
    // Cache the results
    vectorSearchCache.set(cacheKey, data || []);
    
    return data || [];
  } catch (error) {
    logger.error(`Error in getRelevantMemories: ${error.message}`);
    return [];
  }
}

/**
 * Create a simple hash of an embedding array for cache keys
 * @param {Array} embedding - Embedding array
 * @returns {string} - Hash string
 */
function hashEmbedding(embedding) {
  // Sample a few values from the embedding for the hash
  const samples = [0, 10, 100, 500, 999].map(i => 
    embedding[i] !== undefined ? embedding[i].toFixed(2) : '0'
  );
  return samples.join(':');
}

/**
 * Batch fetch user data to reduce database round-trips
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - User data bundle
 */
export async function batchGetUserData(userId, guildId) {
  const cacheKey = `userData:${userId}:${guildId}`;
  
  // Check cache first
  if (userDataCache.has(cacheKey)) {
    return userDataCache.get(cacheKey);
  }
  
  try {
    // Use an RPC to get all user data in one call
    const { data, error } = await supabase.rpc('get_user_data_bundle', {
      p_user_id: userId,
      p_guild_id: guildId
    });
    
    if (error) {
      logger.error(`Error in batch user data fetch: ${error.message}`);
      return {
        conversation: [],
        contextLength: 10,
        dynamicPrompt: null,
        characterPreferences: {}
      };
    }
    
    // Cache the results
    userDataCache.set(cacheKey, data);
    
    // Also cache individual components for direct access
    if (data.conversation) userDataCache.set(`conversation:${userId}:${guildId}`, data.conversation);
    if (data.contextLength) userDataCache.set(`contextLength:${userId}:${guildId}`, data.contextLength);
    if (data.dynamicPrompt) userDataCache.set(`dynamicPrompt:${userId}:${guildId}`, data.dynamicPrompt);
    
    return data;
  } catch (error) {
    logger.error(`Error in batchGetUserData: ${error.message}`);
    return {
      conversation: [],
      contextLength: 10, 
      dynamicPrompt: null,
      characterPreferences: {}
    };
  }
}

/**
 * Warm up user cache without unnecessary invalidation
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 */
export async function warmupUserCache(userId, guildId) {
  try {
    // Check if we already have this user's data cached
    const conversationCached = userDataCache.has(`conversation:${userId}:${guildId}`);
    const contextLengthCached = userDataCache.has(`contextLength:${userId}:${guildId}`);
    const dynamicPromptCached = userDataCache.has(`dynamicPrompt:${userId}:${guildId}`);
    
    // If any key pieces aren't cached, do a batch fetch
    if (!conversationCached || !contextLengthCached || !dynamicPromptCached) {
      logger.debug(`Warming up cache for user ${userId} in guild ${guildId}`);
      await batchGetUserData(userId, guildId);
    } else {
      logger.debug(`Cache already warm for user ${userId} in guild ${guildId}`);
    }
  } catch (error) {
    logger.error(`Error warming up cache: ${error.message}`);
  }
}

/**
 * Clear cache stats for monitoring purposes
 */
export function getCacheStats() {
  return {
    userDataCache: {
      size: userDataCache.size,
      maxSize: userDataCache.max,
      keys: Array.from(userDataCache.keys()).slice(0, 5) // Sample of keys
    },
    memoryCache: {
      size: memoryCache.size,
      maxSize: memoryCache.max
    },
    vectorSearchCache: {
      size: vectorSearchCache.size,
      maxSize: vectorSearchCache.max
    }
  };
}

// Create database functions as needed below
// ...