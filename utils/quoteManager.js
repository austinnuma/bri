// utils/quoteManager.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';

/**
 * Checks if a message is suitable for being saved as a quote
 * @param {object} message - Discord message object
 * @returns {boolean} - True if the message is valid for quoting
 */
function isQuotableMessage(message) {
    // Don't quote bot messages
    if (message.author.bot) return false;
    
    // Message should have content
    if (!message.content || message.content.trim() === '') return false;
    
    // Message should be at least 5 characters
    if (message.content.length < 5) return false;
    
    // Avoid commands and URLs-only messages
    if (message.content.startsWith('/') || message.content.startsWith('!')) return false;
    if (message.content.match(/^https?:\/\/\S+$/i)) return false;
    
    // Avoid very long messages
    if (message.content.length > 300) return false;
    
    return true;
}

/**
 * Adds a quote to the database (works for both manual and auto-added quotes)
 * @param {string} userId - ID of user being quoted
 * @param {string} guildId - ID of the guild/server
 * @param {string} content - The quote content
 * @param {string} addedBy - ID of user who added the quote (or bot ID for auto-added)
 * @param {string} messageId - Original message ID
 * @param {boolean} autoAdded - Whether this was automatically added
 * @returns {Promise<boolean>} - Success status
 */
export async function addQuote(userId, guildId, content, addedBy, messageId, autoAdded = false) {
    try {
        // Check if this message is already quoted
        const { data: existing } = await supabase
            .from('user_quotes')
            .select('id')
            .eq('message_id', messageId)
            .limit(1);
            
        if (existing && existing.length > 0) {
            logger.info(`Message ${messageId} already quoted, skipping`);
            return false;
        }
        
        const { error } = await supabase
            .from('user_quotes')
            .insert({
                user_id: userId,
                guild_id: guildId,
                content: content,
                added_by: addedBy,
                message_id: messageId,
                added_at: new Date().toISOString(),
                auto_added: autoAdded
            });

        if (error) {
            logger.error("Error adding quote:", error);
            return false;
        }
        
        logger.info(`Added ${autoAdded ? 'auto' : 'manual'} quote for user ${userId}`);
        return true;
    } catch (error) {
        logger.error("Error in addQuote:", error);
        return false;
    }
}

/**
 * Randomly decides whether to save a message as a quote
 * @param {object} message - Discord message object
 * @param {string} botId - Bot's user ID
 * @returns {Promise<boolean>} - Whether the message was saved
 */
export async function maybeAutoSaveQuote(message, botId) {
    try {
        // Random chance to save a quote (approximately 1 in 100 messages)
        const saveChance = 0.01;
        if (Math.random() > saveChance) return false;
        
        // Check if this is a suitable message to quote
        if (!isQuotableMessage(message)) return false;
        
        // Auto-save the quote
        return await addQuote(
            message.author.id,
            message.guild.id,
            message.content,
            botId, // Bot is adding this quote
            message.id,
            true // This is auto-added
        );
    } catch (error) {
        logger.error("Error in maybeAutoSaveQuote:", error);
        return false;
    }
}

/**
 * Gets a random quote for a user
 * @param {string} userId - ID of user to get quote for
 * @param {string} guildId - ID of the guild/server
 * @returns {Promise<object|null>} - Quote object or null if none found
 */
export async function getRandomQuote(userId, guildId) {
    try {
        const { data, error } = await supabase
            .from('user_quotes')
            .select('*')
            .eq('user_id', userId)
            .eq('guild_id', guildId);

        if (error) {
            logger.error("Error getting quotes:", error);
            return null;
        }

        if (!data || data.length === 0) {
            return null;
        }

        // Choose a random quote
        const randomIndex = Math.floor(Math.random() * data.length);
        return data[randomIndex];
    } catch (error) {
        logger.error("Error in getRandomQuote:", error);
        return null;
    }
}

/**
 * Creates the necessary database tables for quotes if they don't exist
 */
export async function ensureQuoteTableExists() {
    try {
        // Check if the table exists
        const { error } = await supabase
            .from('user_quotes')
            .select('id')
            .limit(1);
            
        if (error && error.code === '42P01') { // Table doesn't exist error
            logger.info("Quote table doesn't exist. Creating it...");
            
            // This is a basic implementation. In a production environment,
            // you would typically use migrations or a more robust approach.
            const createTableSQL = `
                CREATE TABLE IF NOT EXISTS user_quotes (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    added_by TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    auto_added BOOLEAN DEFAULT FALSE
                );
                CREATE INDEX IF NOT EXISTS user_quotes_user_guild_idx ON user_quotes (user_id, guild_id);
                CREATE INDEX IF NOT EXISTS user_quotes_message_idx ON user_quotes (message_id);
            `;
            
            // Execute SQL using Supabase (if your plan supports it)
            // This may require a different approach depending on your Supabase plan
            // For simplicity, we'll just log that manual setup is required
            logger.warn("Quote table needs to be created manually. Please use the Supabase dashboard to create it.");
        } else {
            logger.info("Quote table exists");
        }
    } catch (error) {
        logger.error("Error checking/creating quote table:", error);
    }
}