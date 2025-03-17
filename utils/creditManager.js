// utils/creditManager.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getServerConfig } from './serverConfigManager.js';

// Credit costs for different operations
export const CREDIT_COSTS = {
  CHAT_MESSAGE: 1,             // Regular chat message
  IMAGE_GENERATION: 10,        // Image generation
  MEMORY_OPERATION: 2,         // Memory related operations
  REMINDER_CREATION: 5,        // Creating reminders
  SCHEDULE_MESSAGE: 15,        // Scheduling recurring messages
  GEMINI_QUERY: 5              // Using Google Gemini API
};

// Default free credits given to servers each month
export const DEFAULT_FREE_MONTHLY_CREDITS = 1000;

/**
 * Initialize the credit system - ensures tables exist
 * @returns {Promise<void>}
 */
export async function initializeCreditSystem() {
  try {
    logger.info('Initializing credit system');
    
    // Check if server_credits table exists, if not create it
    const { error } = await supabase.from('server_credits').select('count(*)', { count: 'exact', head: true });
    
    if (error && error.code === '42P01') {
      logger.info('Creating server_credits table');
      
      // Since we can't create tables directly with Supabase client,
      // we'll log that this needs to be done manually or through an RPC function
      logger.error('server_credits table does not exist and needs to be created manually in Supabase');
      
      /* 
      SQL to create the table:
      
      CREATE TABLE IF NOT EXISTS server_credits (
        guild_id TEXT PRIMARY KEY,
        remaining_credits INTEGER NOT NULL DEFAULT 0,
        total_used_credits INTEGER NOT NULL DEFAULT 0,
        last_free_refresh TIMESTAMP WITH TIME ZONE,
        next_free_refresh TIMESTAMP WITH TIME ZONE,
        credits_purchased INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS credit_transactions (
        id SERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        feature_type TEXT,
        payment_id TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (guild_id) REFERENCES server_credits(guild_id)
      );
      */
    }
    
    // Schedule the monthly refresh for free credits
    scheduleMonthlyFreeCredits();
    
  } catch (error) {
    logger.error('Error initializing credit system:', error);
  }
}

/**
 * Get a server's credit information
 * @param {string} guildId - The Discord guild ID
 * @returns {Promise<Object>} - The server's credit information
 */
export async function getServerCredits(guildId) {
  try {
    // Check if server exists in the credits system
    const { data, error } = await supabase
      .from('server_credits')
      .select('*')
      .eq('guild_id', guildId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Server not found, initialize with default free credits
        return initializeServerCredits(guildId);
      }
      
      logger.error(`Error fetching server credits for ${guildId}:`, error);
      return null;
    }
    
    // Check if monthly refresh is needed
    await checkAndRefreshFreeCredits(data);
    
    return data;
  } catch (error) {
    logger.error(`Error in getServerCredits for ${guildId}:`, error);
    return null;
  }
}

/**
 * Initialize a new server in the credits system
 * @param {string} guildId - The Discord guild ID
 * @returns {Promise<Object>} - The server's credit information
 */
async function initializeServerCredits(guildId) {
  try {
    const now = new Date();
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);
    
    const newServer = {
      guild_id: guildId,
      remaining_credits: DEFAULT_FREE_MONTHLY_CREDITS,
      total_used_credits: 0,
      last_free_refresh: now.toISOString(),
      next_free_refresh: nextMonth.toISOString(),
      credits_purchased: 0
    };
    
    const { data, error } = await supabase
      .from('server_credits')
      .insert(newServer)
      .select()
      .single();
    
    if (error) {
      logger.error(`Error initializing server credits for ${guildId}:`, error);
      return null;
    }
    
    // Log the transaction
    await logCreditTransaction(guildId, DEFAULT_FREE_MONTHLY_CREDITS, 'free_monthly', null);
    
    logger.info(`Initialized credits for new server ${guildId} with ${DEFAULT_FREE_MONTHLY_CREDITS} free credits`);
    return data;
  } catch (error) {
    logger.error(`Error in initializeServerCredits for ${guildId}:`, error);
    return null;
  }
}

/**
 * Check if a server has enough credits for an operation
 * @param {string} guildId - The Discord guild ID
 * @param {string} operationType - The type of operation
 * @returns {Promise<boolean>} - Whether the server has enough credits
 */
export async function hasEnoughCredits(guildId, operationType) {
  try {
    // Check if credits are enabled in server config
    const serverConfig = await getServerConfig(guildId);
    if (!serverConfig.credits_enabled) {
      return true; // Credits not enabled, so always return true
    }
    
    const creditCost = CREDIT_COSTS[operationType] || 1;
    const credits = await getServerCredits(guildId);
    
    if (!credits) return false;
    
    return credits.remaining_credits >= creditCost;
  } catch (error) {
    logger.error(`Error checking credits for ${guildId}:`, error);
    return false;
  }
}

/**
 * Use credits for an operation
 * @param {string} guildId - The Discord guild ID
 * @param {string} operationType - The type of operation
 * @returns {Promise<boolean>} - Whether the credits were successfully used
 */
export async function useCredits(guildId, operationType) {
    try {
      // Check if credits are enabled in server config
      const serverConfig = await getServerConfig(guildId);
      if (!serverConfig.credits_enabled) {
        return true; // Credits not enabled, so always return true
      }
      
      const creditCost = CREDIT_COSTS[operationType] || 1;
      
      // Check if server has enough credits
      const hasCredits = await hasEnoughCredits(guildId, operationType);
      if (!hasCredits) {
        logger.warn(`Server ${guildId} attempted ${operationType} but has insufficient credits`);
        return false;
      }
      
      // First, get the current credit values
      const { data, error: fetchError } = await supabase
        .from('server_credits')
        .select('remaining_credits, total_used_credits')
        .eq('guild_id', guildId)
        .single();
      
      if (fetchError) {
        logger.error(`Error fetching credits for update in ${guildId}:`, fetchError);
        return false;
      }
      
      // Then update with calculated values
      const { error } = await supabase
        .from('server_credits')
        .update({
          remaining_credits: data.remaining_credits - creditCost,
          total_used_credits: data.total_used_credits + creditCost,
          updated_at: new Date().toISOString()
        })
        .eq('guild_id', guildId);
      
      if (error) {
        logger.error(`Error using credits for ${guildId}:`, error);
        return false;
      }
      
      // Log the transaction
      await logCreditTransaction(guildId, -creditCost, 'usage', operationType);
      
      // Check if credits are now low and send warning if needed
      await checkLowCredits(guildId);
      
      return true;
    } catch (error) {
      logger.error(`Error in useCredits for ${guildId}:`, error);
      return false;
    }
}

/**
 * Add credits to a server (from purchase or other sources)
 * @param {string} guildId - The Discord guild ID
 * @param {number} amount - The amount of credits to add
 * @param {string} source - The source of the credits (purchase, admin, etc.)
 * @param {string} paymentId - Optional payment ID for purchases
 * @returns {Promise<boolean>} - Whether the credits were successfully added
 */
export async function addCredits(guildId, amount, source, paymentId = null) {
    try {
      // Make sure server exists in credit system
      let credits = await getServerCredits(guildId);
      if (!credits) {
        credits = await initializeServerCredits(guildId);
        if (!credits) return false;
      }
      
      // First, get current values
      const { data, error: fetchError } = await supabase
        .from('server_credits')
        .select('remaining_credits, credits_purchased')
        .eq('guild_id', guildId)
        .single();
      
      if (fetchError) {
        logger.error(`Error fetching credits for update in ${guildId}:`, fetchError);
        return false;
      }
      
      // Update with calculated values
      const updatedCredits = {
        remaining_credits: data.remaining_credits + amount,
        updated_at: new Date().toISOString()
      };
      
      // Only update purchased credits if this is a purchase
      if (source === 'purchase') {
        updatedCredits.credits_purchased = data.credits_purchased + amount;
      }
      
      // Update credits in database
      const { error } = await supabase
        .from('server_credits')
        .update(updatedCredits)
        .eq('guild_id', guildId);
      
      if (error) {
        logger.error(`Error adding credits to ${guildId}:`, error);
        return false;
      }
      
      // Log the transaction
      await logCreditTransaction(guildId, amount, source, null, paymentId);
      
      logger.info(`Added ${amount} credits to server ${guildId} from ${source}`);
      return true;
    } catch (error) {
      logger.error(`Error in addCredits for ${guildId}:`, error);
      return false;
    }
}

/**
 * Log a credit transaction
 * @param {string} guildId - The Discord guild ID
 * @param {number} amount - The amount of credits (positive for additions, negative for deductions)
 * @param {string} transactionType - The type of transaction (purchase, usage, free_monthly, etc.)
 * @param {string|null} featureType - The feature used (for usage transactions)
 * @param {string|null} paymentId - The payment ID (for purchase transactions)
 */
async function logCreditTransaction(guildId, amount, transactionType, featureType = null, paymentId = null) {
  try {
    const transaction = {
      guild_id: guildId,
      amount,
      transaction_type: transactionType,
      feature_type: featureType,
      payment_id: paymentId
    };
    
    const { error } = await supabase
      .from('credit_transactions')
      .insert(transaction);
    
    if (error) {
      logger.error(`Error logging credit transaction for ${guildId}:`, error);
    }
  } catch (error) {
    logger.error(`Error in logCreditTransaction for ${guildId}:`, error);
  }
}

/**
 * Check if a server's credits are low (below 10%) and send a warning if needed
 * @param {string} guildId - The Discord guild ID
 * @returns {Promise<void>}
 */
async function checkLowCredits(guildId) {
  try {
    const credits = await getServerCredits(guildId);
    if (!credits) return;
    
    // Total credits is the sum of remaining + used
    const totalCredits = credits.remaining_credits + credits.total_used_credits;
    const lowThreshold = Math.max(totalCredits * 0.1, DEFAULT_FREE_MONTHLY_CREDITS * 0.1);
    
    // Check if credits are low and a warning hasn't been sent recently
    if (credits.remaining_credits <= lowThreshold && !credits.low_credits_warning_sent) {
      logger.info(`Server ${guildId} is low on credits (${credits.remaining_credits} remaining)`);
      
      // Mark that a warning has been sent
      await supabase
        .from('server_credits')
        .update({ low_credits_warning_sent: true })
        .eq('guild_id', guildId);
      
      // TODO: Send a message to the server's default channel or to the server owner
      // This would require access to the Discord client and server information
      // For now, we just log it, and this would be implemented later
    }
  } catch (error) {
    logger.error(`Error checking low credits for ${guildId}:`, error);
  }
}

/**
 * Check if a server's free credits need to be refreshed
 * @param {Object} serverCredits - The server's credit information
 * @returns {Promise<void>}
 */
async function checkAndRefreshFreeCredits(serverCredits) {
  try {
    const now = new Date();
    const nextRefresh = new Date(serverCredits.next_free_refresh);
    
    // If we've passed the next refresh date
    if (now >= nextRefresh) {
      logger.info(`Refreshing free credits for server ${serverCredits.guild_id}`);
      
      // Calculate next refresh date (1st of next month)
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(1);
      nextMonth.setHours(0, 0, 0, 0);
      
      // Update with new free credits
      const { error } = await supabase
        .from('server_credits')
        .update({
          remaining_credits: DEFAULT_FREE_MONTHLY_CREDITS + serverCredits.credits_purchased,
          last_free_refresh: now.toISOString(),
          next_free_refresh: nextMonth.toISOString(),
          low_credits_warning_sent: false,
          updated_at: now.toISOString()
        })
        .eq('guild_id', serverCredits.guild_id);
      
      if (error) {
        logger.error(`Error refreshing free credits for ${serverCredits.guild_id}:`, error);
        return;
      }
      
      // Log the transaction
      await logCreditTransaction(
        serverCredits.guild_id, 
        DEFAULT_FREE_MONTHLY_CREDITS, 
        'free_monthly', 
        null
      );
      
      logger.info(`Refreshed free credits for server ${serverCredits.guild_id} with ${DEFAULT_FREE_MONTHLY_CREDITS} credits`);
    }
  } catch (error) {
    logger.error(`Error in checkAndRefreshFreeCredits for ${serverCredits.guild_id}:`, error);
  }
}

/**
 * Schedule the monthly refresh for all servers
 * @returns {Promise<void>}
 */
function scheduleMonthlyFreeCredits() {
  // Run at midnight on the 1st of each month
  const runFreeCreditRefresh = async () => {
    try {
      const now = new Date();
      
      // Check if it's the 1st of the month
      if (now.getDate() === 1) {
        logger.info('Running monthly free credit refresh for all servers');
        
        // Get all servers due for a refresh
        const { data, error } = await supabase
          .from('server_credits')
          .select('*')
          .lt('next_free_refresh', now.toISOString());
        
        if (error) {
          logger.error('Error fetching servers for credit refresh:', error);
          return;
        }
        
        // Refresh each server's credits
        for (const server of data) {
          await checkAndRefreshFreeCredits(server);
        }
      }
    } catch (error) {
      logger.error('Error in monthly credit refresh:', error);
    }
  };
  
  // Run once at startup
  runFreeCreditRefresh();
  
  // Then schedule to run daily (will only process on the 1st)
  setInterval(runFreeCreditRefresh, 24 * 60 * 60 * 1000);
}

/**
 * Process a Stripe webhook for credit purchases
 * @param {Object} event - The Stripe webhook event
 * @returns {Promise<boolean>} - Whether the webhook was processed successfully
 */
export async function processStripeWebhook(event) {
  try {
    // Only process successful payment events
    if (event.type !== 'checkout.session.completed') {
      return true; // Not an error, just not a payment event
    }
    
    const session = event.data.object;
    
    // Extract the guild ID from metadata
    const guildId = session.metadata?.guild_id;
    if (!guildId) {
      logger.error('Missing guild ID in Stripe webhook:', session);
      return false;
    }
    
    // Calculate credits based on the product purchased
    // This would need to be customized based on your Stripe product setup
    const lineItems = session.line_items || [];
    let totalCredits = 0;
    
    // In a real implementation, you'd look up credit amounts based on product IDs
    // For now, we'll use a simple mapping from price to credits
    const creditPriceMap = {
      '1000': 1000,    // $10 for 1000 credits
      '5000': 5000,    // $40 for 5000 credits
      '10000': 10000,  // $70 for 10000 credits
      '25000': 25000   // $150 for 25000 credits
    };
    
    // Calculate total credits from purchased items
    for (const item of lineItems) {
      const priceId = item.price?.id;
      const quantity = item.quantity || 1;
      
      // Look up credits for this price
      const creditsPerUnit = creditPriceMap[priceId] || 0;
      totalCredits += creditsPerUnit * quantity;
    }
    
    if (totalCredits === 0) {
      logger.warn('No credits calculated for purchase:', session);
      return false;
    }
    
    // Add the credits to the server
    const success = await addCredits(
      guildId, 
      totalCredits, 
      'purchase', 
      session.id
    );
    
    return success;
  } catch (error) {
    logger.error('Error processing Stripe webhook:', error);
    return false;
  }
}