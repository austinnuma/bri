// utils/monthlyCreditRollover.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { processMonthlyRollover } from './subscriptionManager.js';
import { scheduleMonthlyFreeCredits } from './creditManager.js';
import cron from 'node-cron';

/**
 * Initialize the monthly credit rollover system
 */
export function initializeMonthlyCreditRollover() {
  try {
    // Schedule rollover process to run on the 1st of each month at 00:05 UTC
    // We use 00:05 instead of 00:00 to avoid potential high-load times
    cron.schedule('5 0 1 * *', async () => {
      logger.info('Running monthly credit rollover process');
      await runMonthlyRollover();
    });
    
    logger.info('Monthly credit rollover process scheduled');
    return true;
  } catch (error) {
    logger.error('Error initializing monthly credit rollover:', error);
    return false;
  }
}

/**
 * Run the monthly credit rollover for all servers
 */
export async function runMonthlyRollover() {
  try {
    logger.info('Starting monthly credit rollover for all servers');
    
    // Get all servers with active credits
    const { data, error } = await supabase
      .from('server_credits')
      .select('guild_id');
      
    if (error) {
      logger.error('Error fetching servers for credit rollover:', error);
      return false;
    }
    
    if (!data || data.length === 0) {
      logger.info('No servers found for credit rollover');
      return true;
    }
    
    logger.info(`Processing rollover for ${data.length} servers`);
    
    // Process each server
    let successCount = 0;
    let errorCount = 0;
    
    for (const server of data) {
      try {
        await processMonthlyRollover(server.guild_id);
        successCount++;
      } catch (serverError) {
        logger.error(`Error processing rollover for guild ${server.guild_id}:`, serverError);
        errorCount++;
      }
    }
    
    logger.info(`Monthly rollover complete: ${successCount} successes, ${errorCount} errors`);
    
    // After rollover, schedule the free credits for all servers
    await scheduleMonthlyFreeCredits();
    
    return true;
  } catch (error) {
    logger.error('Error in runMonthlyRollover:', error);
    return false;
  }
}

/**
 * Force a credit rollover for a specific server (admin function)
 * @param {string} guildId - Guild ID to process
 * @returns {Promise<boolean>} - Success or failure
 */
export async function forceRolloverForServer(guildId) {
  try {
    logger.info(`Forcing credit rollover for guild ${guildId}`);
    
    const success = await processMonthlyRollover(guildId);
    
    if (success) {
      logger.info(`Successfully processed forced rollover for guild ${guildId}`);
      return true;
    } else {
      logger.error(`Failed to process forced rollover for guild ${guildId}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error in forceRolloverForServer for guild ${guildId}:`, error);
    return false;
  }
}

export default {
  initializeMonthlyCreditRollover,
  runMonthlyRollover,
  forceRolloverForServer
};