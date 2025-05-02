// cacheManager.js - Complete replacement for databaseCache.js
// Unified Write-Through Caching Solution

import { LRUCache } from 'lru-cache';
import { logger } from './logger.js';
import { supabase } from '../services/combinedServices.js';

const QUERY_TIMEOUT = 5000; // 5 second timeout for database queries

// Configure primary caches
const userDataCache = new LRUCache({
  max: 500,            // Store up to 500 users
  ttl: 30 * 60 * 1000, // 30 minute TTL
  updateAgeOnGet: true // Reset TTL when accessed
});

const memoryCache = new LRUCache({
  max: 1000,           // Store up to 1000 memory sets
  ttl: 10 * 60 * 1000, // 10 minute TTL 
  updateAgeOnGet: true
});

const vectorSearchCache = new LRUCache({
  max: 200,            // Fewer vector searches cached (they're large)
  ttl: 5 * 60 * 1000,  // 5 minute TTL
  updateAgeOnGet: true
});

const queryCache = new LRUCache({
  max: 1000,           // Store up to 1000 query results
  ttl: 2 * 60 * 1000,  // 2 minute TTL
  updateAgeOnGet: true
});

// Configure image cache for recent user images
const imageCache = new LRUCache({
  max: 500,            // Store up to 500 image references
  ttl: 60 * 60 * 1000, // 60 minute TTL - keep images in cache longer
  updateAgeOnGet: true // Reset TTL when accessed
});

/**
 * Generate a cache key for a given query
 * @param {string} table - Table name
 * @param {object} params - Query parameters
 * @returns {string} - Cache key
 */
function generateCacheKey(table, params) {
  return `${table}:${JSON.stringify(params)}`;
}

/**
 * Get user data with caching (replacement for getCachedUser)
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - User data
 */
export async function getCachedUser(userId, guildId) {
  // Guard against missing parameters
  if (!userId || !guildId) {
    logger.warn(`getCachedUser called with missing parameters: userId=${userId}, guildId=${guildId}`);
    throw new Error("Both userId and guildId are required for getCachedUser");
  }
  
  const cacheKey = `user:${userId}:${guildId}`;
  
  // Check cache first
  if (userDataCache.has(cacheKey)) {
    return userDataCache.get(cacheKey);
  }
  
  // Not in cache, fetch from database
  try {
    const { data, error } = await supabase
      .from('user_conversations')
      .select('system_prompt, context_length, personality_preferences, conversation')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      logger.error(`Error fetching user data for ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    // Cache the result
    userDataCache.set(cacheKey, data);
    
    return data;
  } catch (error) {
    logger.error(`Error in getCachedUser for ${userId} in guild ${guildId}:`, error);
    throw error;
  }
}

/**
 * Invalidate cache entries related to a user (updated to work with write-through approach)
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 */
export function invalidateUserCache(userId, guildId = null) {
  // This function still exists for backward compatibility
  // but in a write-through caching system, we should rarely need it
  
  if (guildId) {
    // Log but don't invalidate in most cases
    logger.debug(`Cache invalidation requested for user ${userId} in guild ${guildId} (limited to critical keys)`);
    
    // Only invalidate critical keys that might cause serious problems if stale
    const criticalKeys = [
      `user:${userId}:${guildId}`,
      `userData:${userId}:${guildId}`
    ];
    
    for (const key of criticalKeys) {
      if (userDataCache.has(key)) {
        userDataCache.delete(key);
      }
    }
  } else {
    // Full user invalidation across all guilds - should be rare
    logger.warn(`Full cache invalidation requested for user ${userId} across all guilds`);
    
    // Find and remove all keys for this user
    for (const key of userDataCache.keys()) {
      if (key.includes(`${userId}:`)) {
        userDataCache.delete(key);
      }
    }
    
    for (const key of memoryCache.keys()) {
      if (key.includes(`${userId}:`)) {
        memoryCache.delete(key);
      }
    }
    
    for (const key of vectorSearchCache.keys()) {
      if (key.includes(`${userId}:`)) {
        vectorSearchCache.delete(key);
      }
    }
  }
}

/**
 * Execute a function with timeout
 * @param {Function} fn - Function to execute
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} - Result or timeout error
 */
function withTimeout(fn, timeout = QUERY_TIMEOUT) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Database query timeout")), timeout)
      )
    ]);
}

/**
 * Cached vector search using RPC (replacement for cachedVectorSearch)
 * @param {string} userId - User ID
 * @param {Array} embedding - Query embedding vector
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Matching memories
 */
export async function cachedVectorSearch(userId, embedding, options = {}) {
  const { 
    threshold = 0.6, 
    limit = 5, 
    memoryType = null, 
    category = null,
    guildId = null  // Add guild ID parameter
  } = options;
  
  // Create a simplified cache key (don't include the full embedding vector as it's too large)
  const embeddingHash = hashEmbedding(embedding);
  const cacheKey = `vector:${userId}:${guildId || 'any'}:${limit}:${memoryType || 'any'}:${category || 'any'}:${threshold}:${embeddingHash}`;
  
  // Check cache
  if (vectorSearchCache.has(cacheKey)) {
    return vectorSearchCache.get(cacheKey);
  }
  
  // Direct RPC call with timeout
  try {
    const data = await withTimeout(async () => {
      // Use the multi-server RPC if guild ID is provided
      if (guildId) {
        const { data, error } = await supabase.rpc('match_unified_memories_multi_server', {
          p_user_id: userId,
          p_guild_id: guildId,
          p_query_embedding: embedding,
          p_match_threshold: threshold,
          p_match_count: limit,
          p_memory_type: memoryType,
          p_category: category
        });
        
        if (error) throw error;
        return data || [];
      } else {
        // Use the original single-server RPC for backward compatibility
        const { data, error } = await supabase.rpc('match_unified_memories', {
          p_user_id: userId,
          p_query_embedding: embedding,
          p_match_threshold: threshold,
          p_match_count: limit,
          p_memory_type: memoryType,
          p_category: category
        });
        
        if (error) throw error;
        return data || [];
      }
    });
    
    // Cache the result
    vectorSearchCache.set(cacheKey, data);
    
    return data;
  } catch (error) {
    logger.error(`Error in cachedVectorSearch for ${userId} in guild ${guildId || 'any'}:`, error);
    
    // If timeout, return empty array rather than hanging
    if (error.message === "Database query timeout") {
      logger.warn(`Vector search timed out for user ${userId} in guild ${guildId || 'any'}`);
      return [];
    }
    
    throw error;
  }
}

/**
 * Create a simple hash of an embedding array for cache keys
 * @param {Array} embedding - Embedding array
 * @returns {string} - Hash string
 */
function hashEmbedding(embedding) {
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    return 'empty';
  }
  
  // Sample a few values from the embedding for the hash
  const samples = [0, 
                  Math.floor(embedding.length * 0.25), 
                  Math.floor(embedding.length * 0.5),
                  Math.floor(embedding.length * 0.75), 
                  embedding.length - 1].map(i => 
    embedding[i] !== undefined ? embedding[i].toFixed(2) : '0'
  );
  return samples.join(':');
}

/**
 * Warm up cache for a specific user (replacement for warmupUserCache)
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 */
export async function warmupUserCache(userId, guildId) {
  try {
    // Guard against missing guildId
    if (!guildId) {
      logger.warn(`warmupUserCache called without guildId for user ${userId}`);
      return; // Exit early rather than causing database errors
    }
    
    // Check if we already have this user's data cached
    const cacheKey = `user:${userId}:${guildId}`;
    if (userDataCache.has(cacheKey)) {
      logger.debug(`Cache already warm for user ${userId} in guild ${guildId}`);
      return;
    }
    
    // Fetch user data
    await getCachedUser(userId, guildId);
    
    logger.debug(`Warmed up cache for user ${userId} in guild ${guildId}`);
  } catch (error) {
    logger.error(`Error warming up cache for user ${userId} in guild ${guildId}:`, error);
  }
}

/**
 * Get cache statistics
 * @returns {Object} - Cache statistics
 */
export function getCacheStats() {
  return {
    userCache: {
      size: userDataCache.size,
      maxSize: userDataCache.max,
      // Show a sample of what's in the cache
      sampleKeys: Array.from(userDataCache.keys()).slice(0, 5)
    },
    memoryCache: {
      size: memoryCache.size,
      maxSize: memoryCache.max
    },
    vectorSearchCache: {
      size: vectorSearchCache.size,
      maxSize: vectorSearchCache.max
    },
    queryCache: {
      size: queryCache.size,
      maxSize: queryCache.max
    },
    // Return a timestamp for when the stats were generated
    timestamp: new Date().toISOString()
  };
}

// Additional functions to make the module a complete replacement for databaseCache.js

/**
 * Get user memories with caching (replacement for getCachedMemories)
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Object} filters - Optional query filters
 * @returns {Promise<Array>} - User memories
 */
export async function getCachedMemories(userId, guildId, filters = {}) {
  const cacheKey = `memories:${userId}:${guildId}:${JSON.stringify(filters)}`;
  
  // Check cache first
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }
  
  // Not in cache, fetch from database
  try {
    let query = supabase
      .from('unified_memories')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId);
      
    // Apply filters if provided
    if (filters.type) {
      query = query.eq('memory_type', filters.type);
    }
    
    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    
    if (filters.active !== undefined) {
      query = query.eq('active', filters.active);
    }
    
    // Apply ordering if provided
    if (filters.orderBy) {
      query = query.order(filters.orderBy, filters.ascending ? { ascending: true } : { ascending: false });
    }
    
    const { data, error } = await query;
      
    if (error) {
      logger.error(`Error fetching memories for ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    // Cache the result
    memoryCache.set(cacheKey, data);
    
    return data;
  } catch (error) {
    logger.error(`Error in getCachedMemories for ${userId} in guild ${guildId}:`, error);
    throw error;
  }
}

/**
 * Execute a generic cached query (replacement for cachedQuery)
 * @param {string} table - Table name
 * @param {Object} params - Query parameters
 * @param {string} guildId - Guild ID
 * @param {boolean} skipCache - Whether to skip cache
 * @returns {Promise<Array>} - Query results
 */
export async function cachedQuery(table, params, guildId, skipCache = false) {
  const cacheKey = `${table}:${guildId}:${JSON.stringify(params)}`;
    
  // Check cache first unless skipping
  if (!skipCache && queryCache.has(cacheKey)) {
    return queryCache.get(cacheKey);
  }
  
  // Not in cache, execute query
  try {
    let query = supabase.from(table).select(params.select || '*');
    
    // Apply guild filter for tables that support it
    if (table !== 'bot_settings' && guildId) { // Skip for global settings
      query = query.eq('guild_id', guildId);
    }
    
    // Apply other filters
    if (params.eq) {
      for (const [column, value] of Object.entries(params.eq)) {
        query = query.eq(column, value);
      }
    }
    if (params.neq) {
      for (const [column, value] of Object.entries(params.neq)) {
        query = query.neq(column, value);
      }
    }
    
    if (params.in) {
      for (const [column, values] of Object.entries(params.in)) {
        query = query.in(column, values);
      }
    }
    
    if (params.order) {
      query = query.order(params.order.column, { 
        ascending: params.order.ascending !== false 
      });
    }
    
    if (params.limit) {
      query = query.limit(params.limit);
    }
    
    // Execute query
    const { data, error } = await query;
    
    if (error) {
      logger.error(`Error executing query on ${table}:`, error);
      throw error;
    }
    
    // Cache the result with guild-specific key
    queryCache.set(cacheKey, data);
    
    return data;
  } catch (error) {
    logger.error(`Error in cachedQuery for ${table} in guild ${guildId}:`, error);
    throw error;
  }
}

/**
 * Invalidate specific table cache entries
 * @param {string} table - Table name
 */
export function invalidateTableCache(table) {
  // Clear all query cache entries for this table
  for (const key of queryCache.keys()) {
    if (key.startsWith(`${table}:`)) {
      queryCache.delete(key);
    }
  }
  
  logger.debug(`Invalidated cache for table ${table}`);
}

/**
 * Store image URLs for a specific user
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Array<string>} imageUrls - Array of image URLs
 * @param {string} messageId - Original message ID containing the images
 * @returns {void}
 */
export function cacheUserImages(userId, guildId, imageUrls, messageId) {
  if (!userId || !guildId || !imageUrls || imageUrls.length === 0) {
    logger.warn('cacheUserImages called with missing parameters');
    return;
  }
  
  try {
    const cacheKey = `images:${userId}:${guildId}`;
    
    // Store information about the images
    const imageData = {
      imageUrls: imageUrls,
      messageId: messageId,
      timestamp: Date.now()
    };
    
    // Save to cache
    imageCache.set(cacheKey, imageData);
    logger.debug(`Cached ${imageUrls.length} images for user ${userId} in guild ${guildId}`);
  } catch (error) {
    logger.error(`Error caching images for user ${userId} in guild ${guildId}:`, error);
  }
}

/**
 * Retrieve cached image URLs for a user
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Object|null} - Object containing image URLs and message ID, or null if not found
 */
export function getCachedUserImages(userId, guildId) {
  if (!userId || !guildId) {
    logger.warn('getCachedUserImages called with missing parameters');
    return null;
  }
  
  try {
    const cacheKey = `images:${userId}:${guildId}`;
    
    // Check if we have cached images for this user
    if (imageCache.has(cacheKey)) {
      return imageCache.get(cacheKey);
    }
    
    return null; // No cached images found
  } catch (error) {
    logger.error(`Error retrieving cached images for user ${userId} in guild ${guildId}:`, error);
    return null;
  }
}

/**
 * Get cache statistics
 * @returns {Object} - Cache statistics
 */
export function getCacheStats() {
  return {
    userCache: {
      size: userDataCache.size,
      maxSize: userDataCache.max,
      // Show a sample of what's in the cache
      sampleKeys: Array.from(userDataCache.keys()).slice(0, 5)
    },
    memoryCache: {
      size: memoryCache.size,
      maxSize: memoryCache.max
    },
    vectorSearchCache: {
      size: vectorSearchCache.size,
      maxSize: vectorSearchCache.max
    },
    queryCache: {
      size: queryCache.size,
      maxSize: queryCache.max
    },
    imageCache: {
      size: imageCache.size,
      maxSize: imageCache.max
    },
    // Return a timestamp for when the stats were generated
    timestamp: new Date().toISOString()
  };
}

// Export all functions to make this a complete replacement
export {
  userDataCache,
  memoryCache,
  vectorSearchCache,
  queryCache,
  imageCache
};