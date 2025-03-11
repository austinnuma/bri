// utils/serverConfigManager.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';

// Cache for server configurations
const serverConfigCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const lastFetchTime = new Map();

// Default server configuration
const DEFAULT_CONFIG = {
  prefix: 'bri',
  enabled_features: {
    quotes: true,
    memory: true,
    reminders: true, 
    character: true
  },
  designated_channels: [],
  allow_quoting_bots: true
};

/**
 * Get the configuration for a server
 * @param {string} guildId - The Discord server ID
 * @returns {Promise<Object>} - The server configuration
 */
export async function getServerConfig(guildId) {
  // Check cache first
  if (serverConfigCache.has(guildId)) {
    const now = Date.now();
    const lastFetch = lastFetchTime.get(guildId) || 0;
    
    // If cache is still valid, return it
    if (now - lastFetch < CACHE_TTL) {
      return serverConfigCache.get(guildId);
    }
  }
  
  try {
    // Fetch from database
    const { data, error } = await supabase
      .from('server_config')
      .select('*')
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      // If no configuration exists, create one with defaults
      if (error.code === 'PGRST116') { // No rows returned
        return await createServerConfig(guildId);
      }
      
      logger.error(`Error fetching server config for ${guildId}:`, error);
      // Return default config as fallback
      return DEFAULT_CONFIG;
    }
    
    // Update cache
    serverConfigCache.set(guildId, data);
    lastFetchTime.set(guildId, Date.now());
    
    return data;
  } catch (error) {
    logger.error(`Error in getServerConfig for ${guildId}:`, error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Create a new server configuration with defaults
 * @param {string} guildId - The Discord server ID
 * @returns {Promise<Object>} - The created server configuration
 */
async function createServerConfig(guildId) {
  try {
    const newConfig = {
      guild_id: guildId,
      ...DEFAULT_CONFIG,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('server_config')
      .insert(newConfig)
      .select()
      .single();
      
    if (error) {
      logger.error(`Error creating server config for ${guildId}:`, error);
      return DEFAULT_CONFIG;
    }
    
    // Update cache
    serverConfigCache.set(guildId, data);
    lastFetchTime.set(guildId, Date.now());
    
    logger.info(`Created new server configuration for guild ${guildId}`);
    return data;
  } catch (error) {
    logger.error(`Error in createServerConfig for ${guildId}:`, error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Update a server configuration
 * @param {string} guildId - The Discord server ID
 * @param {Object} updates - The fields to update
 * @returns {Promise<Object>} - The updated server configuration
 */
export async function updateServerConfig(guildId, updates) {
  try {
    // Ensure we're not overwriting all fields
    const currentConfig = await getServerConfig(guildId);
    
    const { data, error } = await supabase
      .from('server_config')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .select()
      .single();
      
    if (error) {
      logger.error(`Error updating server config for ${guildId}:`, error);
      return currentConfig;
    }
    
    // Update cache
    serverConfigCache.set(guildId, data);
    lastFetchTime.set(guildId, Date.now());
    
    logger.info(`Updated server configuration for guild ${guildId}`);
    return data;
  } catch (error) {
    logger.error(`Error in updateServerConfig for ${guildId}:`, error);
    const currentConfig = await getServerConfig(guildId);
    return currentConfig;
  }
}

/**
 * Check if a feature is enabled for a server
 * @param {string} guildId - The Discord server ID
 * @param {string} featureName - The feature to check
 * @returns {Promise<boolean>} - Whether the feature is enabled
 */
export async function isFeatureEnabled(guildId, featureName) {
  const config = await getServerConfig(guildId);
  return config.enabled_features?.[featureName] === true;
}

/**
 * Get the prefix for a server
 * @param {string} guildId - The Discord server ID
 * @returns {Promise<string>} - The server's command prefix
 */
export async function getServerPrefix(guildId) {
  const config = await getServerConfig(guildId);
  return config.prefix || DEFAULT_CONFIG.prefix;
}

/**
 * Clear the cache for a server or all servers
 * @param {string|null} guildId - The Discord server ID, or null to clear all
 */
export function clearServerConfigCache(guildId = null) {
  if (guildId) {
    serverConfigCache.delete(guildId);
    lastFetchTime.delete(guildId);
  } else {
    serverConfigCache.clear();
    lastFetchTime.clear();
  }
}