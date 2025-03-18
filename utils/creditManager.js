// utils/creditManager.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { hasActiveSubscription, isFeatureSubscribed, SUBSCRIPTION_FEATURES } from './subscriptionManager.js';

// Credit costs for operations
export const CREDIT_COSTS = {
  CHAT_MESSAGE: 1,
  IMAGE_GENERATION: 10,
  GEMINI_QUERY: 5,
  REMINDER_CREATION: 2,
  SCHEDULING: 3,
  VISION_ANALYSIS: 5
};

// Dictionary of features that can be used without credits with a subscription
const SUBSCRIPTION_FREE_FEATURES = {
  'REMINDER_CREATION': SUBSCRIPTION_FEATURES.UNLIMITED_REMINDERS,
  'SCHEDULING': SUBSCRIPTION_FEATURES.UNLIMITED_SCHEDULING,
  'VISION_ANALYSIS': SUBSCRIPTION_FEATURES.UNLIMITED_VISION
};

// Initialize credit system
export async function initializeCreditSystem() {
  try {
    // Check if server_credits table exists - this function needs to be created in your database
    const { data: tableExists, error: checkError } = await supabase
      .from('server_credits')
      .select('count(*)', { count: 'exact', head: true });
    
    if (checkError && checkError.code === '42P01') { // Table doesn't exist error
      logger.info('Creating server_credits table...');
      
      // Create the server_credits table
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS server_credits (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL UNIQUE,
          remaining_credits INTEGER NOT NULL DEFAULT 0,
          total_used_credits INTEGER NOT NULL DEFAULT 0,
          free_credits INTEGER NOT NULL DEFAULT 0,
          subscription_credits INTEGER NOT NULL DEFAULT 0,
          purchased_credits INTEGER NOT NULL DEFAULT 0,
          free_used_credits INTEGER NOT NULL DEFAULT 0,
          subscription_used_credits INTEGER NOT NULL DEFAULT 0,
          last_reset TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;
      
      // Try to create the table with an RPC call or directly
      try {
        // First try RPC method
        await supabase.rpc('create_server_credits_table');
        logger.info('Created server_credits table via RPC');
      } catch (rpcError) {
        // Fall back to direct query
        const { error: createError } = await supabase.query(createTableQuery);
        
        if (createError) {
          logger.error('Error creating server_credits table:', createError);
          return false;
        }
        logger.info('Created server_credits table via direct query');
      }
    } else if (checkError) {
      logger.error('Error checking server_credits table:', checkError);
      return false;
    } else {
      logger.info('Server credits table already exists');
    }
    
    return true;
  } catch (error) {
    logger.error('Error initializing credit system:', error);
    return false;
  }
}

/**
 * Check if a server has enough credits for an operation, considering subscription
 * @param {string} guildId - The guild/server ID
 * @param {string} operationType - Type of operation
 * @returns {Promise<boolean>} - Whether server has enough credits
 */
export async function hasEnoughCredits(guildId, operationType) {
  try {
    if (!CREDIT_COSTS[operationType]) {
      logger.error(`Unknown operation type: ${operationType}`);
      return false;
    }
    
    // First check if this operation is free with subscription
    if (SUBSCRIPTION_FREE_FEATURES[operationType]) {
      const featureName = SUBSCRIPTION_FREE_FEATURES[operationType];
      const featureSubscribed = await isFeatureSubscribed(guildId, featureName);
      
      if (featureSubscribed) {
        logger.debug(`Operation ${operationType} is free for guild ${guildId} with subscription`);
        return true;
      }
    }
    
    // It's not free with subscription, so check credit balance
    const cost = CREDIT_COSTS[operationType];
    
    const { data, error } = await supabase
      .from('server_credits')
      .select('remaining_credits')
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // Not found error
        return false; // No credits record means no credits
      }
      
      logger.error(`Error checking credits for guild ${guildId}:`, error);
      return false;
    }
    
    return data.remaining_credits >= cost;
  } catch (error) {
    logger.error(`Error in hasEnoughCredits for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Use credits for an operation, or don't if it's subscription-free
 * @param {string} guildId - The guild/server ID
 * @param {string} operationType - Type of operation
 * @returns {Promise<boolean>} - Success or failure
 */
export async function useCredits(guildId, operationType) {
  try {
    if (!CREDIT_COSTS[operationType]) {
      logger.error(`Unknown operation type: ${operationType}`);
      return false;
    }
    
    // Check if this operation is free with subscription
    if (SUBSCRIPTION_FREE_FEATURES[operationType]) {
      const featureName = SUBSCRIPTION_FREE_FEATURES[operationType];
      const featureSubscribed = await isFeatureSubscribed(guildId, featureName);
      
      if (featureSubscribed) {
        logger.debug(`Not using credits for ${operationType} in guild ${guildId} with subscription`);
        return true; // No credits used, operation is free with subscription
      }
    }
    
    // Not free with subscription, deduct credits
    const cost = CREDIT_COSTS[operationType];
    
    // Get the current credits record
    const { data, error } = await supabase
      .from('server_credits')
      .select('*')
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // Not found error
        logger.error(`No credits record found for guild ${guildId}`);
        return false;
      }
      
      logger.error(`Error fetching credits for guild ${guildId}:`, error);
      return false;
    }
    
    // Check if there are enough credits
    if (data.remaining_credits < cost) {
      logger.error(`Not enough credits for ${operationType} in guild ${guildId}`);
      return false;
    }
    
    // Calculate which pools to deduct from - first free, then subscription, then purchased
    let freeToUse = 0;
    let subscriptionToUse = 0;
    let purchasedToUse = 0;
    let remainingCost = cost;
    
    // Calculate free credits to use
    const freeRemaining = Math.max(0, data.free_credits - data.free_used_credits);
    if (freeRemaining > 0) {
      freeToUse = Math.min(freeRemaining, remainingCost);
      remainingCost -= freeToUse;
    }
    
    // If there's still cost remaining, use subscription credits
    if (remainingCost > 0) {
      const subscriptionRemaining = Math.max(0, data.subscription_credits - data.subscription_used_credits);
      if (subscriptionRemaining > 0) {
        subscriptionToUse = Math.min(subscriptionRemaining, remainingCost);
        remainingCost -= subscriptionToUse;
      }
    }
    
    // If there's still cost remaining, use purchased credits
    if (remainingCost > 0) {
      purchasedToUse = remainingCost;
    }
    
    // Update the credits record
    const { error: updateError } = await supabase
      .from('server_credits')
      .update({
        remaining_credits: data.remaining_credits - cost,
        total_used_credits: data.total_used_credits + cost,
        free_used_credits: data.free_used_credits + freeToUse,
        subscription_used_credits: data.subscription_used_credits + subscriptionToUse,
        purchased_credits: data.purchased_credits - purchasedToUse,
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId);
      
    if (updateError) {
      logger.error(`Error updating credits for guild ${guildId}:`, updateError);
      return false;
    }
    
    logger.debug(`Used ${cost} credits for ${operationType} in guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error in useCredits for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Add credits to a server (for manual additions or purchases)
 * @param {string} guildId - The guild/server ID
 * @param {number} amount - Amount of credits to add
 * @param {string} source - Source of credits (free, subscription, purchase)
 * @returns {Promise<boolean>} - Success or failure
 */
export async function addCredits(guildId, amount, source = 'purchase') {
  try {
    if (amount <= 0) {
      logger.error(`Invalid credit amount: ${amount}`);
      return false;
    }
    
    // Get the current credits record
    const { data, error } = await supabase
      .from('server_credits')
      .select('*')
      .eq('guild_id', guildId)
      .single();
      
    if (error && error.code !== 'PGRST116') { // Not found error is ok
      logger.error(`Error fetching credits for guild ${guildId}:`, error);
      return false;
    }
    
    // If no credits record exists, create one
    if (!data) {
      const newRecord = {
        guild_id: guildId,
        remaining_credits: amount,
        total_used_credits: 0,
        free_credits: source === 'free' ? amount : 0,
        subscription_credits: source === 'subscription' ? amount : 0,
        purchased_credits: source === 'purchase' ? amount : 0,
        free_used_credits: 0,
        subscription_used_credits: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      const { error: insertError } = await supabase
        .from('server_credits')
        .insert([newRecord]);
        
      if (insertError) {
        logger.error(`Error creating credits record for guild ${guildId}:`, insertError);
        return false;
      }
      
      logger.info(`Added ${amount} ${source} credits to guild ${guildId} (new record)`);
      return true;
    }
    
    // Update the existing record
    const updates = {
      remaining_credits: data.remaining_credits + amount,
      updated_at: new Date().toISOString()
    };
    
    // Update the specific source counter
    if (source === 'free') {
      updates.free_credits = (data.free_credits || 0) + amount;
    } else if (source === 'subscription') {
      updates.subscription_credits = (data.subscription_credits || 0) + amount;
    } else if (source === 'purchase') {
      updates.purchased_credits = (data.purchased_credits || 0) + amount;
    }
    
    const { error: updateError } = await supabase
      .from('server_credits')
      .update(updates)
      .eq('guild_id', guildId);
      
    if (updateError) {
      logger.error(`Error updating credits for guild ${guildId}:`, updateError);
      return false;
    }
    
    logger.info(`Added ${amount} ${source} credits to guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error in addCredits for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Get a server's credit details
 * @param {string} guildId - The guild/server ID
 * @returns {Promise<Object>} - Credit info
 */
export async function getServerCredits(guildId) {
  try {
    const { data, error } = await supabase
      .from('server_credits')
      .select('*')
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // Not found error
        // Return a default object with zero credits
        return {
          remaining_credits: 0,
          total_used_credits: 0,
          free_credits: 0,
          subscription_credits: 0,
          purchased_credits: 0,
          free_used_credits: 0,
          subscription_used_credits: 0
        };
      }
      
      logger.error(`Error fetching credits for guild ${guildId}:`, error);
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error(`Error in getServerCredits for guild ${guildId}:`, error);
    return null;
  }
}

export const FREE_CREDITS_AMOUNT = 100; // 100 free credits per month

/**
 * Schedule monthly free credits for all servers
 */
export async function scheduleMonthlyFreeCredits() {
  try {
    // Get all servers with credits
    const { data, error } = await supabase
      .from('server_credits')
      .select('guild_id');
      
    if (error) {
      logger.error('Error fetching servers for monthly free credits:', error);
      return false;
    }
    
    // Add free credits to each server
    const FREE_CREDITS_AMOUNT = 100; // 100 free credits per month
    
    for (const server of data) {
      try {
        await addCredits(server.guild_id, FREE_CREDITS_AMOUNT, 'free');
        logger.info(`Added ${FREE_CREDITS_AMOUNT} monthly free credits to guild ${server.guild_id}`);
      } catch (serverError) {
        logger.error(`Error adding monthly free credits to guild ${server.guild_id}:`, serverError);
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Error in scheduleMonthlyFreeCredits:', error);
    return false;
  }
}

export default {
  initializeCreditSystem,
  hasEnoughCredits,
  useCredits,
  addCredits,
  getServerCredits,
  scheduleMonthlyFreeCredits,
  CREDIT_COSTS,
  FREE_CREDITS_AMOUNT
};