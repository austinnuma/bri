// utils/db/userSettings.js - Database-backed user settings functions
import { supabase } from '../../services/combinedServices.js';
import { logger } from '../logger.js';
import { defaultContextLength, STATIC_CORE_PROMPT } from '../unifiedMemoryManager.js';
import { getCachedUser, invalidateUserCache } from '../databaseCache.js';

/**
 * Gets a user's conversation context from the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<Array>} - The conversation context
 */
export async function getUserConversation(userId, guildId) {
  try {
    // Try to get from cache first
    const userData = await getCachedUser(userId, guildId);
    if (userData && userData.conversation) {
      return userData.conversation;
    }
    
    // If not in cache, fetch directly from database
    const { data, error } = await supabase
      .from('user_conversations')
      .select('conversation')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        return [{ role: "system", content: STATIC_CORE_PROMPT }];
      }
      logger.error(`Error fetching conversation for user ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    return data.conversation || [{ role: "system", content: STATIC_CORE_PROMPT }];
  } catch (error) {
    logger.error(`Error in getUserConversation for ${userId} in guild ${guildId}:`, error);
    // Default fallback
    return [{ role: "system", content: STATIC_CORE_PROMPT }];
  }
}

/**
 * Sets a user's conversation context in the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {Array} conversation - The conversation context
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserConversation(userId, guildId, conversation) {
  try {
    const { error } = await supabase.from('user_conversations').upsert({
      user_id: userId,
      guild_id: guildId,
      conversation,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,guild_id'
    });
    
    if (error) {
      logger.error(`Error saving conversation for user ${userId} in guild ${guildId}:`, error);
      return false;
    }
    
    // Invalidate cache
    invalidateUserCache(userId, guildId);
    return true;
  } catch (error) {
    logger.error(`Error in setUserConversation for ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Gets a user's context length from the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<number>} - The context length
 */
export async function getUserContextLength(userId, guildId) {
  try {
    // Try to get from cache first
    const userData = await getCachedUser(userId, guildId);
    if (userData && userData.context_length) {
      return userData.context_length;
    }
    
    // If not in cache, fetch directly from database
    const { data, error } = await supabase
      .from('user_conversations')
      .select('context_length')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        return defaultContextLength;
      }
      logger.error(`Error fetching context length for user ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    return data.context_length || defaultContextLength;
  } catch (error) {
    logger.error(`Error in getUserContextLength for ${userId} in guild ${guildId}:`, error);
    return defaultContextLength;
  }
}

/**
 * Sets a user's context length in the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {number} contextLength - The context length
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserContextLength(userId, guildId, contextLength) {
  try {
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
      return false;
    }
    
    // Invalidate cache
    invalidateUserCache(userId, guildId);
    return true;
  } catch (error) {
    logger.error(`Error in setUserContextLength for ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Gets a user's dynamic prompt from the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - The dynamic prompt
 */
export async function getUserDynamicPrompt(userId, guildId) {
  try {
    // Try to get from cache first
    const userData = await getCachedUser(userId, guildId);
    if (userData && userData.system_prompt) {
      // Strip the static core prompt to get just the dynamic part
      const dynamicPart = userData.system_prompt.replace(STATIC_CORE_PROMPT, '').trim();
      return dynamicPart;
    }
    
    // If not in cache, fetch directly from database
    const { data, error } = await supabase
      .from('user_conversations')
      .select('system_prompt')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        return "";
      }
      logger.error(`Error fetching system prompt for user ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    if (!data.system_prompt) return "";
    
    // Strip the static core prompt to get just the dynamic part
    const dynamicPart = data.system_prompt.replace(STATIC_CORE_PROMPT, '').trim();
    return dynamicPart;
  } catch (error) {
    logger.error(`Error in getUserDynamicPrompt for ${userId} in guild ${guildId}:`, error);
    return "";
  }
}

/**
 * Sets a user's dynamic prompt in the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {string} dynamicPrompt - The dynamic prompt
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserDynamicPrompt(userId, guildId, dynamicPrompt) {
  try {
    // Store the full system prompt (static + dynamic)
    const fullPrompt = dynamicPrompt 
      ? `${STATIC_CORE_PROMPT}\n\n${dynamicPrompt}` 
      : STATIC_CORE_PROMPT;
      
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
      return false;
    }
    
    // Invalidate cache
    invalidateUserCache(userId, guildId);
    return true;
  } catch (error) {
    logger.error(`Error in setUserDynamicPrompt for ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Gets a user's personality preferences from the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<Object>} - The personality preferences
 */
export async function getUserPersonality(userId, guildId) {
  try {
    // Try to get from cache first
    const userData = await getCachedUser(userId, guildId);
    if (userData && userData.personality_preferences) {
      return userData.personality_preferences;
    }
    
    // If not in cache, fetch directly from database
    const { data, error } = await supabase
      .from('user_conversations')
      .select('personality_preferences')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        // Return default personality
        return {
          responseLength: "normal",
          humor: "light",
          tone: "friendly",
        };
      }
      logger.error(`Error fetching personality for user ${userId} in guild ${guildId}:`, error);
      throw error;
    }
    
    return data.personality_preferences || {
      responseLength: "normal",
      humor: "light",
      tone: "friendly",
    };
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
 * Sets a user's personality preferences in the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {Object} personality - The personality preferences
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserPersonality(userId, guildId, personality) {
  try {
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
      return false;
    }
    
    // Invalidate cache
    invalidateUserCache(userId, guildId);
    return true;
  } catch (error) {
    logger.error(`Error in setUserPersonality for ${userId} in guild ${guildId}:`, error);
    return false;
  }
}