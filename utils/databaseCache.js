// databaseCache.js - Simple database caching system
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';

const QUERY_TIMEOUT = 5000; // 5 second timeout for database queries

// Simple cache implementation with expiration
class Cache {
  constructor(maxSize = 500, ttlMs = 5 * 60 * 1000) { // Default 5 minute TTL
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.keys = []; // For LRU tracking
  }
  
  // Get an item from cache
  get(key) {
    if (!this.cache.has(key)) return undefined;
    
    const item = this.cache.get(key);
    
    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.delete(key);
      return undefined;
    }
    
    // Move to most recently used
    this.keys = this.keys.filter(k => k !== key);
    this.keys.push(key);
    
    return item.value;
  }
  
  // Set an item in cache
  set(key, value, ttlMs = this.ttlMs) {
    // If cache is full, remove least recently used item
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      const oldest = this.keys.shift();
      this.cache.delete(oldest);
    }
    
    // Update keys for LRU tracking
    this.keys = this.keys.filter(k => k !== key);
    this.keys.push(key);
    
    // Store with expiration
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }
  
  // Delete an item from cache
  delete(key) {
    this.cache.delete(key);
    this.keys = this.keys.filter(k => k !== key);
  }
  
  // Clear all items
  clear() {
    this.cache.clear();
    this.keys = [];
  }
  
  // Check if key exists and is not expired
  has(key) {
    if (!this.cache.has(key)) return false;
    
    const item = this.cache.get(key);
    if (Date.now() > item.expiresAt) {
      this.delete(key);
      return false;
    }
    
    return true;
  }
  
  // Get cache size
  get size() {
    return this.cache.size;
  }
}

// Create caches for different types of data
const userCache = new Cache(200, 30 * 60 * 1000); // User data cache (30 min TTL)
const memoryCache = new Cache(500, 5 * 60 * 1000); // Memory cache (5 min TTL)
const queryCache = new Cache(1000, 2 * 60 * 1000); // General query cache (2 min TTL)


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
 * Generate a cache key for query parameters with guild ID
 * @param {string} table - Table name
 * @param {Object} params - Query parameters
 * @param {string} guildId - Guild ID
 * @returns {string} - Cache key
 */
function generateCacheKey(table, params, guildId) {
  return `${table}:${guildId}:${JSON.stringify(params)}`;
}

/**
 * Get user data with caching
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
  const cached = userCache.get(cacheKey);
  if (cached) return cached;
  
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
    userCache.set(cacheKey, data);
    
    return data;
  } catch (error) {
    logger.error(`Error in getCachedUser for ${userId} in guild ${guildId}:`, error);
    throw error;
  }
}

/**
 * Get user memories with caching
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Object} filters - Optional query filters
 * @returns {Promise<Array>} - User memories
 */
export async function getCachedMemories(userId, guildId, filters = {}) {
  const cacheKey = `memories:${userId}:${guildId}:${JSON.stringify(filters)}`;
  
  // Check cache first
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;
  
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
 * Execute a generic cached query
 * @param {string} table - Table name
 * @param {Object} params - Query parameters
 * @param {string} guildId - Guild ID
 * @param {boolean} skipCache - Whether to skip cache
 * @returns {Promise<Array>} - Query results
 */
export async function cachedQuery(table, params, guildId, skipCache = false) {
  const cacheKey = generateCacheKey(table, params, guildId);
    
  // Ensure this isn't being used for RPC calls
  if (table === 'rpc') {
    logger.warn("cachedQuery should not be used for RPC calls. Use specific RPC functions instead.");
    throw new Error("Use cachedVectorSearch for RPC calls");
  }
  
  // Check cache first unless skipping
  if (!skipCache) {
    const cached = queryCache.get(cacheKey);
    if (cached) return cached;
  }
  
  // Not in cache, execute query
  try {
    let query = supabase.from(table).select(params.select || '*');
    
    // Apply guild filter for tables that support it
    if (table !== 'bot_settings') { // Skip for global settings
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
 * Invalidate cache entries related to a user
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 */
export function invalidateUserCache(userId, guildId = null) {
  if (guildId) {
    // Invalidate specific user+guild cache
    userCache.delete(`user:${userId}:${guildId}`);
    
    // Clear memory caches for this user in this guild
    for (const key of memoryCache.keys) {
      if (key.startsWith(`memories:${userId}:${guildId}`)) {
        memoryCache.delete(key);
      }
    }
    
    // Clear related query caches
    for (const key of queryCache.keys) {
      if (key.includes(userId) && key.includes(guildId)) {
        queryCache.delete(key);
      }
    }
    
    logger.debug(`Invalidated cache for user ${userId} in guild ${guildId}`);
  } else {
    // Invalidate all caches for this user across all guilds
    for (const key of userCache.keys) {
      if (key.startsWith(`user:${userId}:`)) {
        userCache.delete(key);
      }
    }
    
    for (const key of memoryCache.keys) {
      if (key.startsWith(`memories:${userId}:`)) {
        memoryCache.delete(key);
      }
    }
    
    for (const key of queryCache.keys) {
      if (key.includes(userId)) {
        queryCache.delete(key);
      }
    }
    
    logger.debug(`Invalidated all caches for user ${userId} across all guilds`);
  }
}

/**
 * Invalidate specific table cache entries
 * @param {string} table - Table name
 */
export function invalidateTableCache(table) {
  // Clear all query cache entries for this table
  for (const key of queryCache.keys) {
    if (key.startsWith(`${table}:`)) {
      queryCache.delete(key);
    }
  }
  
  logger.debug(`Invalidated cache for table ${table}`);
}

/**
 * Get cache statistics
 * @returns {Object} - Cache statistics
 */
export function getCacheStats() {
  return {
    userCache: {
      size: userCache.size,
      maxSize: userCache.maxSize
    },
    memoryCache: {
      size: memoryCache.size,
      maxSize: memoryCache.maxSize
    },
    queryCache: {
      size: queryCache.size,
      maxSize: queryCache.maxSize
    }
  };
}

/**
 * Wrap an existing insert/update/delete operation with cache invalidation
 * @param {Function} dbOperation - Database operation function
 * @param {string} table - Table name
 * @param {string|Array} affectedUsers - User ID(s) affected by this operation
 * @returns {Function} - Wrapped function
 */
export function withCacheInvalidation(dbOperation, table, affectedUsers = null) {
  return async (...args) => {
    try {
      // Execute the original operation
      const result = await dbOperation(...args);
      
      // Invalidate table cache
      invalidateTableCache(table);
      
      // Invalidate user cache if specified
      if (affectedUsers) {
        if (Array.isArray(affectedUsers)) {
          for (const userId of affectedUsers) {
            invalidateUserCache(userId);
          }
        } else {
          invalidateUserCache(affectedUsers);
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Error in cached database operation for ${table}:`, error);
      throw error;
    }
  };
}

/**
 * Cached vector search using RPC
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
  const cacheKey = `vector:${userId}:${guildId || 'any'}:${limit}:${memoryType || 'any'}:${category || 'any'}:${threshold}`;
  
  // Check cache
  const cached = queryCache.get(cacheKey);
  if (cached) return cached;
  
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
    queryCache.set(cacheKey, data);
    
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
 * Warm up cache for a specific user
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
    
    // Fetch user data
    await getCachedUser(userId, guildId);
    
    // Fetch commonly accessed memory types
    await getCachedMemories(userId, guildId);
    //await getCachedMemories(userId, guildId, { type: 'explicit'});
    
    logger.debug(`Warmed up cache for user ${userId} in guild ${guildId}`);
  } catch (error) {
    logger.error(`Error warming up cache for user ${userId} in guild ${guildId}:`, error);
  }
}