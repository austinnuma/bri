// utils/db/userSettings.js - Database-backed user settings functions with write-through caching
import { supabase } from '../../services/combinedServices.js';
import { logger } from '../logger.js';
import { defaultContextLength, STATIC_CORE_PROMPT } from '../unifiedMemoryManager.js';
import { LRUCache } from 'lru-cache';

import { getCachedUser, invalidateUserCache } from '../cacheManager.js';

// Configure caches for different types of user data
const userConversationCache = new LRUCache({
  max: 500,            // Store up to 500 users' conversations
  ttl: 30 * 60 * 1000, // 30 minute TTL
  updateAgeOnGet: true // Reset TTL on access
});

const userSettingsCache = new LRUCache({
  max: 500,            // Store up to 500 users' settings
  ttl: 60 * 60 * 1000, // 60 minute TTL
  updateAgeOnGet: true
});

/**
 * Generate cache key for specific user data
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {string} dataType - Type of data (conversation, contextLength, etc.)
 * @returns {string} - Cache key
 */
function getUserCacheKey(userId, guildId, dataType, threadId = null) {
  if (threadId) {
    return `${userId}:${guildId}:${threadId}:${dataType}`;
  }
  return `${userId}:${guildId}:${dataType}`;
}

/**
 * Gets a user's conversation context from the database with write-through caching
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {string|null} threadId - Optional thread ID for thread-specific conversations
 * @returns {Promise<Array>} - The conversation context
 */
export async function getUserConversation(userId, guildId, threadId = null) {
  try {
    const cacheKey = getUserCacheKey(userId, guildId, 'conversation', threadId);
    
    // Check cache first
    if (userConversationCache.has(cacheKey)) {
      logger.debug(`Cache hit for conversation: ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}`);
      return userConversationCache.get(cacheKey);
    }
    
    logger.debug(`Cache miss for conversation: ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}`);
    
    // If not in cache, fetch directly from database
    const query = supabase
      .from('user_conversations')
      .select('conversation')
      .eq('user_id', userId)
      .eq('guild_id', guildId);
      
    // Add thread filter if provided
    if (threadId) {
      query.eq('thread_id', threadId);
    } else {
      query.is('thread_id', null);
    }
    
    const { data, error } = await query.single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        const defaultConversation = [{ role: "system", content: STATIC_CORE_PROMPT }];
        // Cache default value
        userConversationCache.set(cacheKey, defaultConversation);
        return defaultConversation;
      }
      logger.error(`Error fetching conversation for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
      throw error;
    }
    
    const conversation = data.conversation || [{ role: "system", content: STATIC_CORE_PROMPT }];
    
    // Store in cache
    userConversationCache.set(cacheKey, conversation);
    
    return conversation;
  } catch (error) {
    logger.error(`Error in getUserConversation for ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
    // Default fallback
    return [{ role: "system", content: STATIC_CORE_PROMPT }];
  }
}

/**
 * Sets a user's conversation context in the database with write-through caching
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {Array} conversation - The conversation context
 * @param {string|null} threadId - Optional thread ID for thread-specific conversations
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserConversation(userId, guildId, conversation, threadId = null) {
  try {
    const cacheKey = getUserCacheKey(userId, guildId, 'conversation', threadId);
    
    // Update database
    const { error } = await supabase.from('user_conversations').upsert({
      user_id: userId,
      guild_id: guildId,
      thread_id: threadId,
      conversation,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,guild_id,thread_id'
    });
    
    if (error) {
      logger.error(`Error saving conversation for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
      // On error, delete from cache to prevent stale data
      userConversationCache.delete(cacheKey);
      return false;
    }
    
    // Update cache with new data (write-through) instead of invalidating
    userConversationCache.set(cacheKey, conversation);
    logger.debug(`Updated conversation cache for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}`);
    
    return true;
  } catch (error) {
    logger.error(`Error in setUserConversation for ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
    return false;
  }
}

/**
 * Gets a user's context length from the database with caching
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<number>} - The context length
 */
export async function getUserContextLength(userId, guildId) {
  try {
    const cacheKey = getUserCacheKey(userId, guildId, 'contextLength');
    
    // Check cache first
    if (userSettingsCache.has(cacheKey)) {
      return userSettingsCache.get(cacheKey);
    }
    
    // If not in cache, fetch directly
    const { data, error } = await supabase
      .from('user_conversations')
      .select('context_length')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        // Cache default value
        userSettingsCache.set(cacheKey, defaultContextLength);
        return defaultContextLength;
      }
      logger.error(`Error fetching context length for user ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    const contextLength = data.context_length || defaultContextLength;
    
    // Store in cache
    userSettingsCache.set(cacheKey, contextLength);
    
    return contextLength;
  } catch (error) {
    logger.error(`Error in getUserContextLength for ${userId} in guild ${guildId}:`, error);
    return defaultContextLength;
  }
}

/**
 * Sets a user's context length in the database with write-through caching
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {number} contextLength - The context length
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserContextLength(userId, guildId, contextLength) {
  try {
    const cacheKey = getUserCacheKey(userId, guildId, 'contextLength');
    
    // Update database
    const { error } = await supabase.from('user_conversations').upsert({
      user_id: userId,
      guild_id: guildId,
      context_length: contextLength,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,guild_id'
    });
    
    if (error) {
      logger.error(`Error saving context length for user ${userId} in guild ${guildId}:`, error);
      // On error, delete from cache to prevent stale data
      userSettingsCache.delete(cacheKey);
      return false;
    }
    
    // Update cache with new value (write-through)
    userSettingsCache.set(cacheKey, contextLength);
    
    return true;
  } catch (error) {
    logger.error(`Error in setUserContextLength for ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Gets a user's dynamic prompt from the database with caching
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - The dynamic prompt
 */
export async function getUserDynamicPrompt(userId, guildId) {
  try {
    const cacheKey = getUserCacheKey(userId, guildId, 'dynamicPrompt');
    
    // Check cache first
    if (userSettingsCache.has(cacheKey)) {
      return userSettingsCache.get(cacheKey);
    }
    
    // If not in cache, fetch directly
    const { data, error } = await supabase
      .from('user_conversations')
      .select('system_prompt')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        // Cache empty value
        userSettingsCache.set(cacheKey, "");
        return "";
      }
      logger.error(`Error fetching system prompt for user ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    if (!data.system_prompt) {
      userSettingsCache.set(cacheKey, "");
      return "";
    }
    
    // Strip the static core prompt to get just the dynamic part
    const dynamicPart = data.system_prompt.replace(STATIC_CORE_PROMPT, '').trim();
    
    // Store in cache
    userSettingsCache.set(cacheKey, dynamicPart);
    
    return dynamicPart;
  } catch (error) {
    logger.error(`Error in getUserDynamicPrompt for ${userId} in guild ${guildId}:`, error);
    return "";
  }
}

/**
 * Sets a user's dynamic prompt in the database with write-through caching
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {string} dynamicPrompt - The dynamic prompt
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserDynamicPrompt(userId, guildId, dynamicPrompt) {
  try {
    const cacheKey = getUserCacheKey(userId, guildId, 'dynamicPrompt');
    
    // Store the full system prompt (static + dynamic)
    const fullPrompt = dynamicPrompt 
      ? `${STATIC_CORE_PROMPT}\n\n${dynamicPrompt}` 
      : STATIC_CORE_PROMPT;
      
    // Update database
    const { error } = await supabase.from('user_conversations').upsert({
      user_id: userId,
      guild_id: guildId,
      system_prompt: fullPrompt,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,guild_id'
    });
    
    if (error) {
      logger.error(`Error saving system prompt for user ${userId} in guild ${guildId}:`, error);
      // On error, delete from cache to prevent stale data
      userSettingsCache.delete(cacheKey);
      return false;
    }
    
    // Update cache with new value (write-through)
    userSettingsCache.set(cacheKey, dynamicPrompt);
    
    return true;
  } catch (error) {
    logger.error(`Error in setUserDynamicPrompt for ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Gets a user's personality preferences from the database with caching
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<Object>} - The personality preferences
 */
export async function getUserPersonality(userId, guildId) {
  try {
    const cacheKey = getUserCacheKey(userId, guildId, 'personality');
    
    // Check cache first
    if (userSettingsCache.has(cacheKey)) {
      return userSettingsCache.get(cacheKey);
    }
    
    // Default personality
    const defaultPersonality = {
      responseLength: "normal",
      humor: "light",
      tone: "friendly",
    };
    
    // If not in cache, fetch directly
    const { data, error } = await supabase
      .from('user_conversations')
      .select('personality_preferences')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        // Cache default value
        userSettingsCache.set(cacheKey, defaultPersonality);
        return defaultPersonality;
      }
      logger.error(`Error fetching personality for user ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    const personality = data.personality_preferences || defaultPersonality;
    
    // Store in cache
    userSettingsCache.set(cacheKey, personality);
    
    return personality;
  } catch (error) {
    logger.error(`Error in getUserPersonality for ${userId} in guild ${guildId}:`, error);
    // Return default personality
    return {
      responseLength: "normal",
      humor: "light",
      tone: "friendly",
    };
  }
}

/**
 * Sets a user's personality preferences in the database with write-through caching
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {Object} personality - The personality preferences
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserPersonality(userId, guildId, personality) {
  try {
    const cacheKey = getUserCacheKey(userId, guildId, 'personality');
    
    // Update database
    const { error } = await supabase.from('user_conversations').upsert({
      user_id: userId,
      guild_id: guildId,
      personality_preferences: personality,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,guild_id'
    });
    
    if (error) {
      logger.error(`Error saving personality for user ${userId} in guild ${guildId}:`, error);
      // On error, delete from cache to prevent stale data
      userSettingsCache.delete(cacheKey);
      return false;
    }
    
    // Update cache with new value (write-through)
    userSettingsCache.set(cacheKey, personality);
    
    return true;
  } catch (error) {
    logger.error(`Error in setUserPersonality for ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Efficiently fetch multiple user settings at once
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {string|null} threadId - Optional thread ID for thread-specific conversations
 * @returns {Promise<Object>} - Combined user settings
 */
export async function batchGetUserSettings(userId, guildId, threadId = null) {
  try {
    // Generate cache keys
    const conversationKey = getUserCacheKey(userId, guildId, 'conversation', threadId);
    const contextLengthKey = getUserCacheKey(userId, guildId, 'contextLength');
    const dynamicPromptKey = getUserCacheKey(userId, guildId, 'dynamicPrompt');
    const personalityKey = getUserCacheKey(userId, guildId, 'personality');
    
    // Check if we have all data in cache
    const hasAllCached = 
      userConversationCache.has(conversationKey) &&
      userSettingsCache.has(contextLengthKey) &&
      userSettingsCache.has(dynamicPromptKey) &&
      userSettingsCache.has(personalityKey);
      
    if (hasAllCached) {
      logger.debug(`Complete cache hit for batch user settings: ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}`);
      return {
        conversation: userConversationCache.get(conversationKey),
        contextLength: userSettingsCache.get(contextLengthKey),
        dynamicPrompt: userSettingsCache.get(dynamicPromptKey),
        personality: userSettingsCache.get(personalityKey)
      };
    }
    
    // If not all cached, fetch everything in one go
    logger.debug(`Batch fetching user settings for ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}`);
    
    const query = supabase
      .from('user_conversations')
      .select('conversation, context_length, system_prompt, personality_preferences')
      .eq('user_id', userId)
      .eq('guild_id', guildId);
      
    // Add thread filter if provided
    if (threadId) {
      query.eq('thread_id', threadId);
    } else {
      query.is('thread_id', null);
    }
    
    const { data, error } = await query.single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        // If thread-specific conversation not found but threadId provided, 
        // use the default conversation from non-thread context as a starting point
        if (threadId) {
          try {
            // Try to get the user's default conversation (without thread)
            const defaultResponse = await batchGetUserSettings(userId, guildId, null);
            
            // Use default settings but with empty conversation history (just system prompt)
            const defaults = {
              ...defaultResponse,
              conversation: [{ role: "system", content: defaultResponse.conversation[0]?.content || STATIC_CORE_PROMPT }]
            };
            
            // Cache the thread-specific conversation
            userConversationCache.set(conversationKey, defaults.conversation);
            
            return defaults;
          } catch (err) {
            logger.error(`Failed to fetch default settings for thread initialization: ${err}`);
            // Fall through to standard defaults
          }
        }
        
        // Return and cache defaults
        const defaults = {
          conversation: [{ role: "system", content: STATIC_CORE_PROMPT }],
          contextLength: defaultContextLength,
          dynamicPrompt: "",
          personality: {
            responseLength: "normal",
            humor: "light",
            tone: "friendly",
          }
        };
        
        // Cache all default values
        userConversationCache.set(conversationKey, defaults.conversation);
        userSettingsCache.set(contextLengthKey, defaults.contextLength);
        userSettingsCache.set(dynamicPromptKey, defaults.dynamicPrompt);
        userSettingsCache.set(personalityKey, defaults.personality);
        
        return defaults;
      }
      
      logger.error(`Error batch fetching user settings for ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
      throw error;
    }
    
    // Process the data
    const dynamicPrompt = data.system_prompt 
      ? data.system_prompt.replace(STATIC_CORE_PROMPT, '').trim()
      : "";
      
    const results = {
      conversation: data.conversation || [{ role: "system", content: STATIC_CORE_PROMPT }],
      contextLength: data.context_length || defaultContextLength,
      dynamicPrompt: dynamicPrompt,
      personality: data.personality_preferences || {
        responseLength: "normal",
        humor: "light",
        tone: "friendly",
      }
    };
    
    // Cache all values
    userConversationCache.set(conversationKey, results.conversation);
    userSettingsCache.set(contextLengthKey, results.contextLength);
    userSettingsCache.set(dynamicPromptKey, results.dynamicPrompt);
    userSettingsCache.set(personalityKey, results.personality);
    
    return results;
  } catch (error) {
    logger.error(`Error in batchGetUserSettings for ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
    
    // Return defaults on error
    return {
      conversation: [{ role: "system", content: STATIC_CORE_PROMPT }],
      contextLength: defaultContextLength,
      dynamicPrompt: "",
      personality: {
        responseLength: "normal",
        humor: "light",
        tone: "friendly",
      }
    };
  }
}

/**
 * Warms up cache for a specific user (pre-loads all common settings)
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {string|null} threadId - Optional thread ID for thread-specific conversations
 */
export async function warmupUserCache(userId, guildId, threadId = null) {
  try {
    // Simply call the batch function which caches everything
    await batchGetUserSettings(userId, guildId, threadId);
    logger.debug(`Warmed up cache for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}`);
  } catch (error) {
    logger.error(`Error warming up cache for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
  }
}

/**
 * Get cache statistics for monitoring
 * @returns {Object} - Cache statistics
 */
export function getUserCacheStats() {
  return {
    conversationCache: {
      size: userConversationCache.size,
      maxSize: userConversationCache.max
    },
    settingsCache: {
      size: userSettingsCache.size,
      maxSize: userSettingsCache.max
    }
  };
}