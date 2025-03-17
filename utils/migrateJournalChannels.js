// utils/migrateJournalChannels.js
// Utility to migrate existing journal channel settings to the new format
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';

/**
 * Migrates existing journal channel settings to the guild-specific format
 * @returns {Promise<object>} Result of the migration
 */
export async function migrateJournalChannels() {
  try {
    logger.info("Starting journal channel settings migration");
    
    const results = {
      created_table: false,
      migrated_legacy: 0,
      migrated_global: false,
      errors: []
    };
    
    // First, check if the new table exists and create it if not
    const { error: tableCheckError } = await supabase
      .from('guild_journal_channels')
      .select('guild_id')
      .limit(1);
      
    if (tableCheckError && tableCheckError.code === '42P01') {
      logger.info("Creating guild_journal_channels table...");
      
      try {
        // Try to use RPC for table creation (for Supabase)
        const createTableRPC = await supabase.rpc('create_guild_journal_channels_table');
        results.created_table = true;
        logger.info("Created guild_journal_channels table via RPC");
      } catch (rpcError) {
        // Manual creation as fallback would go here in a non-Supabase env
        logger.warn("RPC table creation failed:", rpcError);
        results.errors.push({
          step: 'create_table',
          error: rpcError.message
        });
      }
    } else {
      logger.info("guild_journal_channels table already exists");
      results.created_table = true;
    }
    
    // Only proceed with migration if the table exists or was created
    if (results.created_table) {
      // Check for legacy per-guild settings (journal_channel_id:guildId format)
      const { data: legacySettings, error: legacyError } = await supabase
        .from('bot_settings')
        .select('key, value')
        .like('key', 'journal_channel_id:%');
        
      if (!legacyError && legacySettings && legacySettings.length > 0) {
        logger.info(`Found ${legacySettings.length} legacy guild-specific journal channel settings`);
        
        for (const setting of legacySettings) {
          const guildId = setting.key.split(':')[1];
          
          if (!guildId) {
            logger.warn(`Could not extract guild ID from key: ${setting.key}`);
            continue;
          }
          
          try {
            // Insert into the new table
            const { error: insertError } = await supabase
              .from('guild_journal_channels')
              .upsert({
                guild_id: guildId,
                channel_id: setting.value,
                updated_at: new Date().toISOString()
              });
              
            if (insertError) {
              logger.error(`Error migrating legacy setting for guild ${guildId}:`, insertError);
              results.errors.push({
                step: 'migrate_legacy',
                guild_id: guildId,
                error: insertError.message
              });
            } else {
              logger.info(`Migrated legacy journal channel for guild ${guildId}`);
              results.migrated_legacy++;
            }
          } catch (error) {
            logger.error(`Error during legacy migration for guild ${guildId}:`, error);
            results.errors.push({
              step: 'migrate_legacy',
              guild_id: guildId,
              error: error.message
            });
          }
        }
      }
      
      // Check for global setting
      const { data: globalSetting, error: globalError } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'journal_channel_id')
        .single();
        
      if (!globalError && globalSetting && globalSetting.value) {
        logger.info(`Found global journal channel setting: ${globalSetting.value}`);
        
        // We need to know which guild this channel belongs to
        // This requires the Discord client, so we'll mark it for later handling
        results.global_channel_id = globalSetting.value;
      }
    }
    
    logger.info("Journal channel migration complete:", results);
    return results;
  } catch (error) {
    logger.error("Error during journal channel migration:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Completes the migration by handling the global channel setting
 * This needs to be called when the Discord client is available
 * @param {Object} client - Discord client
 * @param {string} globalChannelId - ID of the global journal channel
 * @returns {Promise<object>} Result of the migration
 */
export async function migrateGlobalJournalChannel(client, globalChannelId) {
  try {
    logger.info(`Attempting to migrate global journal channel: ${globalChannelId}`);
    
    // Try to fetch the channel
    const channel = await client.channels.fetch(globalChannelId);
    
    if (!channel) {
      logger.warn(`Global journal channel ${globalChannelId} not found`);
      return {
        success: false,
        reason: 'channel_not_found'
      };
    }
    
    // Get the guild ID from the channel
    const guildId = channel.guild.id;
    
    // Insert into the new table
    const { error: insertError } = await supabase
      .from('guild_journal_channels')
      .upsert({
        guild_id: guildId,
        channel_id: globalChannelId,
        updated_at: new Date().toISOString()
      });
      
    if (insertError) {
      logger.error(`Error migrating global journal channel to guild ${guildId}:`, insertError);
      return {
        success: false,
        error: insertError.message
      };
    }
    
    logger.info(`Successfully migrated global journal channel to guild ${guildId}`);
    return {
      success: true,
      guild_id: guildId
    };
  } catch (error) {
    logger.error("Error during global journal channel migration:", error);
    return {
      success: false,
      error: error.message
    };
  }
}