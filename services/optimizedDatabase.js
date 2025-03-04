// optimizedDatabase.js - Optimized database access patterns
import { supabase } from './supabaseService.js';
import { logger } from '../utils/logger.js';
//import LRU from 'lru-cache';

// Cache for database queries
const queryCache = new LRU({
  max: 1000, // Store up to 1000 query results
  maxAge: 5 * 60 * 1000, // 5 minutes in milliseconds
  updateAgeOnGet: true,
});

// Cache for user data to reduce DB access
const userDataCache = new LRU({
  max: 500, // Store up to 500 users
  maxAge: 30 * 60 * 1000, // 30 minutes in milliseconds
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
 * Cached database select with optimized parameters
 * @param {string} table - Table name
 * @param {object} params - Query parameters
 * @param {boolean} bypassCache - Whether to bypass cache
 * @returns {Promise<Array>} - Query results
 */
export async function cachedSelect(table, params, bypassCache = false) {
  const cacheKey = generateCacheKey(table, params);
  
  // Return cached result if available and not bypassed
  if (!bypassCache && queryCache.has(cacheKey)) {
    return queryCache.get(cacheKey);
  }
  
  try {
    // Build the query
    let query = supabase.from(table).select(params.select || '*');
    
    // Apply filters
    if (params.filters) {
      for (const filter of params.filters) {
        if (filter.type === 'eq') {
          query = query.eq(filter.column, filter.value);
        } else if (filter.type === 'in') {
          query = query.in(filter.column, filter.values);
        } else if (filter.type === 'gt') {
          query = query.gt(filter.column, filter.value);
        } else if (filter.type === 'lt') {
          query = query.lt(filter.column, filter.value);
        } else if (filter.type === 'like') {
          query = query.like(filter.column, filter.value);
        } else if (filter.type === 'or') {
          query = query.or(filter.value);
        }
      }
    }
    
    // Apply ordering
    if (params.order) {
      query = query.order(params.order.column, {
        ascending: params.order.ascending,
        nullsFirst: params.order.nullsFirst
      });
    }
    
    // Apply pagination
    if (params.limit) {
      query = query.limit(params.limit);
    }
    
    if (params.offset) {
      query = query.offset(params.offset);
    }
    
    // Execute query
    const { data, error } = await query;
    
    if (error) {
      logger.error(`Error in cachedSelect for ${table}:`, error);
      throw error;
    }
    
    // Cache the result
    queryCache.set(cacheKey, data);
    
    return data;
  } catch (error) {
    logger.error(`Error in cachedSelect for ${table}:`, error);
    throw error;
  }
}

/**
 * Fetch user data and memories in a single optimized query
 * @param {string} userId - User ID
 * @returns {Promise<object>} - User data with memories
 */
export async function getUserWithMemories(userId) {
  const cacheKey = `user:${userId}`;
  
  // Return from cache if available
  if (userDataCache.has(cacheKey)) {
    return userDataCache.get(cacheKey);
  }
  
  try {
    // Get user base data
    const { data: userData, error: userError } = await supabase
      .from('user_conversations')
      .select('system_prompt, context_length, personality_preferences')
      .eq('user_id', userId)
      .single();
      
    if (userError) {
      logger.error(`Error fetching user data for ${userId}:`, userError);
      throw userError;
    }
    
    // Get user memories (only active ones)
    const { data: memories, error: memoriesError } = await supabase
      .from('unified_memories')
      .select('id, memory_text, memory_type, category, confidence')
      .eq('user_id', userId)
      .eq('active', true)
      .order('confidence', { ascending: false });
      
    if (memoriesError) {
      logger.error(`Error fetching memories for ${userId}:`, memoriesError);
      throw memoriesError;
    }
    
    // Combine data
    const result = {
      ...userData,
      memories
    };
    
    // Cache the result
    userDataCache.set(cacheKey, result);
    
    return result;
  } catch (error) {
    logger.error(`Error in getUserWithMemories for ${userId}:`, error);
    throw error;
  }
}

/**
 * Efficiently upsert memories in bulk
 * @param {Array} memories - Array of memory objects
 * @returns {Promise<object>} - Result with success count
 */
export async function bulkUpsertMemories(memories) {
  if (!memories || memories.length === 0) {
    return { count: 0 };
  }
  
  try {
    // Process in batches of 50 to avoid exceeding request limits
    const batchSize = 50;
    const results = [];
    
    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize);
      
      const { data, error } = await supabase
        .from('unified_memories')
        .upsert(batch, { onConflict: 'user_id,memory_text' })
        .select('id');
        
      if (error) {
        logger.error(`Error in batch ${i / batchSize} of bulkUpsertMemories:`, error);
        throw error;
      }
      
      results.push(...(data || []));
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < memories.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Invalidate relevant caches
    const userIds = new Set(memories.map(m => m.user_id));
    for (const userId of userIds) {
      userDataCache.delete(`user:${userId}`);
    }
    
    return { count: results.length };
  } catch (error) {
    logger.error("Error in bulkUpsertMemories:", error);
    throw error;
  }
}

/**
 * Execute an RPC function with caching
 * @param {string} functionName - Name of the RPC function
 * @param {object} params - Parameters for the function
 * @param {boolean} bypassCache - Whether to bypass cache
 * @returns {Promise<any>} - Result of the RPC
 */
export async function cachedRPC(functionName, params, bypassCache = false) {
  const cacheKey = `rpc:${functionName}:${JSON.stringify(params)}`;
  
  // Return cached result if available and not bypassed
  if (!bypassCache && queryCache.has(cacheKey)) {
    return queryCache.get(cacheKey);
  }
  
  try {
    const { data, error } = await supabase.rpc(functionName, params);
    
    if (error) {
      logger.error(`Error in cachedRPC for ${functionName}:`, error);
      throw error;
    }
    
    // Cache the result
    queryCache.set(cacheKey, data);
    
    return data;
  } catch (error) {
    logger.error(`Error in cachedRPC for ${functionName}:`, error);
    throw error;
  }
}

/**
 * Clear caches for a specific user
 * @param {string} userId - User ID
 */
export function clearUserCache(userId) {
  userDataCache.delete(`user:${userId}`);
  
  // Clear query cache keys containing this user ID
  for (const key of queryCache.keys()) {
    if (key.includes(userId)) {
      queryCache.delete(key);
    }
  }
}

/**
 * Get database cache statistics
 */
export function getDBCacheStats() {
  return {
    queryCache: {
      size: queryCache.size,
      maxSize: queryCache.max
    },
    userCache: {
      size: userDataCache.size,
      maxSize: userDataCache.max
    }
  };
}