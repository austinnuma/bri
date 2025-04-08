// userBlocker.js - Manages user blocking functionality for Bri
import { supabase } from '../../services/combinedServices.js';
import { logger } from '../logger.js';

/**
 * Initialize the user blocking system
 * Creates necessary database tables if they don't exist
 */
export async function initializeUserBlockingSystem() {
  try {
    logger.info("Initializing user blocking system...");
    
    // Check if the bri_blocked_users table exists
    const { error: checkError } = await supabase
      .from('bri_blocked_users')
      .select('id')
      .limit(1);
      
    // Create table if it doesn't exist
    if (checkError && checkError.code === '42P01') {
      logger.info("Creating bri_blocked_users table...");
      
      try {
        // Try to create the table using plain SQL
        const { error } = await supabase.query(`
          CREATE TABLE IF NOT EXISTS bri_blocked_users (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            blocked_by TEXT NOT NULL,
            reason TEXT,
            blocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(user_id, guild_id)
          );
        `);
        
        if (error) {
          logger.warn("Manual creation of blocked users table may have failed:", error);
        } else {
          logger.info("Blocked users table created successfully");
        }
      } catch (createError) {
        logger.error("Error creating blocked users table:", createError);
      }
    } else {
      logger.info("Blocked users table already exists");
    }
    
    logger.info("User blocking system initialization complete");
  } catch (error) {
    logger.error("Error initializing user blocking system:", error);
  }
}

/**
 * Blocks a user from interacting with Bri
 * @param {string} userId - The ID of the user to block
 * @param {string} guildId - The ID of the guild where the user is blocked
 * @param {string} blockedBy - The ID of the user or system that initiated the block
 * @param {string} reason - Optional reason for the block
 * @returns {Promise<boolean>} - True if the block was successful, false otherwise
 */
export async function blockUser(userId, guildId, blockedBy, reason = '') {
  try {
    // Check if the user is already blocked
    const { data: existingBlock, error: checkError } = await supabase
      .from('bri_blocked_users')
      .select('id')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (!checkError && existingBlock) {
      // User is already blocked, update the block reason
      const { error: updateError } = await supabase
        .from('bri_blocked_users')
        .update({
          blocked_by: blockedBy,
          reason: reason,
          blocked_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('guild_id', guildId);
        
      if (updateError) {
        logger.error(`Error updating block for user ${userId} in guild ${guildId}:`, updateError);
        return false;
      }
      
      logger.info(`Updated block for user ${userId} in guild ${guildId}`);
      return true;
    }
    
    // User is not blocked yet, insert a new block
    const { error: insertError } = await supabase
      .from('bri_blocked_users')
      .insert({
        user_id: userId,
        guild_id: guildId,
        blocked_by: blockedBy,
        reason: reason
      });
      
    if (insertError) {
      logger.error(`Error blocking user ${userId} in guild ${guildId}:`, insertError);
      return false;
    }
    
    logger.info(`Blocked user ${userId} in guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error in blockUser for user ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Unblocks a user to allow interactions with Bri again
 * @param {string} userId - The ID of the user to unblock
 * @param {string} guildId - The ID of the guild where the user is unblocked
 * @returns {Promise<boolean>} - True if the unblock was successful, false otherwise
 */
export async function unblockUser(userId, guildId) {
  try {
    // Delete the block record
    const { error } = await supabase
      .from('bri_blocked_users')
      .delete()
      .eq('user_id', userId)
      .eq('guild_id', guildId);
      
    if (error) {
      logger.error(`Error unblocking user ${userId} in guild ${guildId}:`, error);
      return false;
    }
    
    logger.info(`Unblocked user ${userId} in guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error in unblockUser for user ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Checks if a user is blocked from interacting with Bri
 * @param {string} userId - The ID of the user to check
 * @param {string} guildId - The ID of the guild where to check the block status
 * @returns {Promise<{isBlocked: boolean, reason: string|null}>} - Block status and reason
 */
export async function isUserBlocked(userId, guildId) {
  try {
    // Get block record if it exists
    const { data, error } = await supabase
      .from('bri_blocked_users')
      .select('reason')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        return { isBlocked: false, reason: null };
      }
      
      logger.error(`Error checking if user ${userId} is blocked in guild ${guildId}:`, error);
      return { isBlocked: false, reason: null }; // Default to not blocked on error
    }
    
    return { isBlocked: true, reason: data.reason || "No reason provided" };
  } catch (error) {
    logger.error(`Error in isUserBlocked for user ${userId} in guild ${guildId}:`, error);
    return { isBlocked: false, reason: null }; // Default to not blocked on error
  }
}

/**
 * Gets a list of all blocked users in a guild
 * @param {string} guildId - The ID of the guild
 * @returns {Promise<Array>} - List of blocked users
 */
export async function getBlockedUsers(guildId) {
  try {
    const { data, error } = await supabase
      .from('bri_blocked_users')
      .select('*')
      .eq('guild_id', guildId)
      .order('blocked_at', { ascending: false });
      
    if (error) {
      logger.error(`Error getting blocked users for guild ${guildId}:`, error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error(`Error in getBlockedUsers for guild ${guildId}:`, error);
    return [];
  }
}