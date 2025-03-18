// utils/subscriptionManager.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { addCredits } from './creditManager.js';

// Constants for subscription plans
export const SUBSCRIPTION_PLANS = {
  STANDARD: 'standard',
  PREMIUM: 'premium',
  ENTERPRISE: 'enterprise'
};

// Constants for subscription features
export const SUBSCRIPTION_FEATURES = {
  JOURNALING: 'journaling',
  CUSTOM_PROMPT: 'custom_prompt',
  UNLIMITED_REMINDERS: 'unlimited_reminders',
  UNLIMITED_VISION: 'unlimited_vision',
  UNLIMITED_SCHEDULING: 'unlimited_scheduling'
};

// Credits included with subscription plans
export const SUBSCRIPTION_CREDITS = {
  [SUBSCRIPTION_PLANS.STANDARD]: 500,
  [SUBSCRIPTION_PLANS.PREMIUM]: 1000,
  [SUBSCRIPTION_PLANS.ENTERPRISE]: 2000
};

// Initialize subscription system
export async function initializeSubscriptionSystem() {
  try {
    // Check if the subscriptions table exists
    const { data, error } = await supabase.rpc('check_server_subscriptions_table_exists');
    
    if (error) {
      logger.error('Error checking for server_subscriptions table:', error);
      return false;
    }
    
    // Table doesn't exist
    if (!data) {
      logger.error('server_subscriptions table does not exist. Run the setup SQL script first.');
      return false;
    }
    
    logger.info('Subscription system initialized successfully');
    return true;
  } catch (error) {
    logger.error('Error initializing subscription system:', error);
    return false;
  }
}

/**
 * Create or update a server's subscription
 * @param {string} guildId - The guild/server ID
 * @param {Object} data - Subscription data
 * @returns {Promise<boolean>} - Success or failure
 */
export async function updateServerSubscription(guildId, data) {
  try {
    const { subscriptionId, plan, status, currentPeriodEnd, stripeCustomerId } = data;
    
    // Check if subscription already exists
    const { data: existingSubscription, error: checkError } = await supabase
      .from('server_subscriptions')
      .select('*')
      .eq('guild_id', guildId)
      .single();
      
    if (checkError && checkError.code !== 'PGRST116') { // Not "not found" error
      logger.error(`Error checking existing subscription for guild ${guildId}:`, checkError);
      return false;
    }
    
    // Track if this is a new active subscription
    const isNewActive = status === 'active' && (!existingSubscription || existingSubscription.status !== 'active');
    
    // If subscription exists, update it. Otherwise, insert new.
    if (existingSubscription) {
      const { error: updateError } = await supabase
        .from('server_subscriptions')
        .update({
          subscription_id: subscriptionId,
          plan,
          status,
          current_period_end: currentPeriodEnd,
          stripe_customer_id: stripeCustomerId,
          updated_at: new Date().toISOString()
        })
        .eq('guild_id', guildId);
        
      if (updateError) {
        logger.error(`Error updating subscription for guild ${guildId}:`, updateError);
        return false;
      }
    } else {
      const { error: insertError } = await supabase
        .from('server_subscriptions')
        .insert({
          guild_id: guildId,
          subscription_id: subscriptionId,
          plan,
          status,
          current_period_end: currentPeriodEnd,
          stripe_customer_id: stripeCustomerId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        
      if (insertError) {
        logger.error(`Error inserting subscription for guild ${guildId}:`, insertError);
        return false;
      }
    }
    
    // If this is a new subscription or reactivation, add the included credits
    if (isNewActive) {
      await addSubscriptionCredits(guildId, plan);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in updateServerSubscription for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Add credits included with subscription
 * @param {string} guildId - The guild/server ID
 * @param {string} plan - Subscription plan
 * @returns {Promise<boolean>} - Success or failure
 */
async function addSubscriptionCredits(guildId, plan) {
  try {
    // Get the number of credits for this plan
    const creditsToAdd = SUBSCRIPTION_CREDITS[plan] || 0;
    
    if (creditsToAdd <= 0) {
      return true; // Nothing to add
    }
    
    // Add the credits using the creditManager
    await addCredits(guildId, creditsToAdd, 'subscription');
    
    logger.info(`Added ${creditsToAdd} subscription credits to guild ${guildId} for ${plan} plan`);
    return true;
  } catch (error) {
    logger.error(`Error adding subscription credits for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Check if a server has an active subscription
 * @param {string} guildId - The guild/server ID
 * @returns {Promise<Object>} - Subscription info
 */
export async function hasActiveSubscription(guildId) {
  try {
    const { data, error } = await supabase
      .from('server_subscriptions')
      .select('status, plan')
      .eq('guild_id', guildId)
      .eq('status', 'active')
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // Not found error
        return { subscribed: false };
      }
      logger.error(`Error checking subscription for guild ${guildId}:`, error);
      return { subscribed: false, error: true };
    }
    
    return { 
      subscribed: true,
      plan: data.plan
    };
  } catch (error) {
    logger.error(`Error in hasActiveSubscription for guild ${guildId}:`, error);
    return { subscribed: false, error: true };
  }
}

/**
 * Check if a specific feature is available with the server's subscription
 * @param {string} guildId - The guild/server ID
 * @param {string} featureName - Feature to check
 * @returns {Promise<boolean>} - Whether feature is available
 */
export async function isFeatureSubscribed(guildId, featureName) {
  try {
    const { subscribed, plan, error } = await hasActiveSubscription(guildId);
    
    if (error || !subscribed) {
      return false;
    }
    
    // Define feature access by plan
    const featureAccess = {
      [SUBSCRIPTION_PLANS.STANDARD]: [
        SUBSCRIPTION_FEATURES.JOURNALING
      ],
      [SUBSCRIPTION_PLANS.PREMIUM]: [
        SUBSCRIPTION_FEATURES.JOURNALING,
        SUBSCRIPTION_FEATURES.CUSTOM_PROMPT,
        SUBSCRIPTION_FEATURES.UNLIMITED_REMINDERS
      ],
      [SUBSCRIPTION_PLANS.ENTERPRISE]: [
        SUBSCRIPTION_FEATURES.JOURNALING,
        SUBSCRIPTION_FEATURES.CUSTOM_PROMPT,
        SUBSCRIPTION_FEATURES.UNLIMITED_REMINDERS,
        SUBSCRIPTION_FEATURES.UNLIMITED_VISION,
        SUBSCRIPTION_FEATURES.UNLIMITED_SCHEDULING
      ]
    };
    
    // Check if feature is available in the server's plan
    return featureAccess[plan]?.includes(featureName) || false;
  } catch (error) {
    logger.error(`Error in isFeatureSubscribed for guild ${guildId}, feature ${featureName}:`, error);
    return false;
  }
}

/**
 * Process monthly credit rollover for a server
 * @param {string} guildId - The guild/server ID
 * @returns {Promise<boolean>} - Success or failure
 */
export async function processMonthlyRollover(guildId) {
  try {
    // Get current credits
    const { data: credits, error: creditsError } = await supabase
      .from('server_credits')
      .select('*')
      .eq('guild_id', guildId)
      .single();
      
    if (creditsError) {
      if (creditsError.code === 'PGRST116') { // Not found error
        return true; // No credits to roll over
      }
      logger.error(`Error fetching credits for guild ${guildId}:`, creditsError);
      return false;
    }
    
    // Get subscription status
    const { subscribed, plan } = await hasActiveSubscription(guildId);
    
    // Calculate new values for the next month
    const freeCredits = 100; // Monthly free credits
    const subscriptionCredits = subscribed ? SUBSCRIPTION_CREDITS[plan] || 0 : 0;
    
    // Current values
    const currentFreeCredits = credits.free_credits || 0;
    const currentSubscriptionCredits = credits.subscription_credits || 0;
    const currentPurchasedCredits = credits.purchased_credits || 0;
    const freeUsedCredits = credits.free_used_credits || 0;
    const subscriptionUsedCredits = credits.subscription_used_credits || 0;
    
    // Calculate rollover logic
    // 1. Calculate used credits from each pool
    const effectiveFreeUsed = Math.min(freeUsedCredits, currentFreeCredits);
    const effectiveSubscriptionUsed = Math.min(subscriptionUsedCredits, currentSubscriptionCredits);
    
    // 2. Calculate excess used that would come from purchased credits
    const totalUsed = credits.total_used_credits || 0;
    const excessUsed = Math.max(0, totalUsed - effectiveFreeUsed - effectiveSubscriptionUsed);
    
    // 3. Calculate remaining purchased credits after usage
    const remainingPurchased = Math.max(0, currentPurchasedCredits - excessUsed);
    
    // 4. Calculate total new credits
    const newTotalCredits = freeCredits + subscriptionCredits + remainingPurchased;
    
    // Update the credits record
    const { error: updateError } = await supabase
      .from('server_credits')
      .update({
        remaining_credits: newTotalCredits,
        free_credits: freeCredits,
        subscription_credits: subscriptionCredits,
        purchased_credits: remainingPurchased,
        free_used_credits: 0, // Reset for new month
        subscription_used_credits: 0, // Reset for new month
        total_used_credits: 0, // Reset for new month 
        last_reset: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId);
      
    if (updateError) {
      logger.error(`Error updating credits for guild ${guildId} during rollover:`, updateError);
      return false;
    }
    
    logger.info(`Processed monthly rollover for guild ${guildId}. Rolled over ${remainingPurchased} purchased credits.`);
    return true;
  } catch (error) {
    logger.error(`Error in processMonthlyRollover for guild ${guildId}:`, error);
    return false;
  }
}

export default {
  initializeSubscriptionSystem,
  updateServerSubscription,
  hasActiveSubscription,
  isFeatureSubscribed,
  processMonthlyRollover,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_FEATURES,
  SUBSCRIPTION_CREDITS
};