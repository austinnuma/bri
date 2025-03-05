// commands/quote.js
import { SlashCommandBuilder } from 'discord.js';
import { supabase } from '../services/combinedServices.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Retrieve quotes from server members')
    .addStringOption(option =>
        option.setName('input')
            .setDescription('A username to get quotes from, or "all" for random quotes')
            .setRequired(true));

/**
 * Finds a user ID from username/nickname
 * @param {string} name - Username or nickname to search for
 * @param {object} guild - Discord guild object
 * @returns {Promise<string|null>} - User ID or null if not found
 */
async function findUserByName(name, guild) {
    try {
        // First check database mapping
        const { data, error } = await supabase
            .from('discord_users')
            .select('user_id')
            .or(`username.ilike.%${name}%,nickname.ilike.%${name}%`)
            .limit(10);

        if (error) {
            logger.error("Error querying user mapping:", error);
        } else if (data && data.length > 0) {
            // If multiple matches, try to find an exact match first
            const exactMatch = data.find(entry => {
                return entry.username?.toLowerCase() === name.toLowerCase() || 
                      entry.nickname?.toLowerCase() === name.toLowerCase();
            });
            
            // Return exact match if found, otherwise first partial match
            return exactMatch ? exactMatch.user_id : data[0].user_id;
        }

        // Fallback to guild member search if database search fails
        const members = await guild.members.fetch();
        const member = members.find(m => 
            m.user.username.toLowerCase().includes(name.toLowerCase()) || 
            (m.nickname && m.nickname.toLowerCase().includes(name.toLowerCase()))
        );

        return member ? member.id : null;
    } catch (error) {
        logger.error("Error finding user by name:", error);
        return null;
    }
}

/**
 * Gets a random quote for a user
 * @param {string} userId - ID of user to get quote for
 * @param {string} guildId - ID of the guild/server
 * @returns {Promise<object|null>} - Quote object or null if none found
 */
async function getRandomQuote(userId, guildId) {
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

export async function execute(interaction) {
    // ALWAYS defer the reply right at the start
    await interaction.deferReply();
    
    const input = interaction.options.getString('input');
    
    try {
        // Special case for "all" - get a quote from anyone
        if (input.toLowerCase() === 'all') {
            // Get a random quote from anyone in this guild
            const { data, error } = await supabase
                .from('user_quotes')
                .select('*')
                .eq('guild_id', interaction.guild.id)
                .order('RANDOM()') // Order randomly
                .limit(1);         // Just get one
            
            if (error) {
                logger.error("Error getting random quote:", error);
                return interaction.editReply("Something went wrong while retrieving the quote.");
            }
            
            if (!data || data.length === 0) {
                return interaction.editReply("I don't have any quotes saved yet.");
            }
            
            const quote = data[0];
            
            // Try to get the username
            let username = "Unknown User";
            try {
                const member = await interaction.guild.members.fetch(quote.user_id).catch(() => null);
                if (member) {
                    username = member.user.username;
                }
            } catch (userError) {
                logger.warn(`Couldn't fetch user ${quote.user_id} for quote: ${userError}`);
            }
            
            // Format and send the quote
            return interaction.editReply(`"${quote.content}" - ${username}`);
        }
        
        // Standard case - get quote from specific user
        const userId = await findUserByName(input, interaction.guild);
        
        if (!userId) {
            return interaction.editReply(`I couldn't find anyone named "${input}" on this server.`);
        }
        
        // Try to get information about the user
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const username = member ? member.user.username : input;
        
        // Get a random quote
        const quote = await getRandomQuote(userId, interaction.guild.id);
        
        if (!quote) {
            return interaction.editReply(`I don't have any quotes saved for ${username} yet.`);
        }
        
        // Format and send the quote
        return interaction.editReply(`"${quote.content}" - ${username}`);
    } catch (error) {
        logger.error("Error handling quote retrieval:", error);
        return interaction.editReply("Something went wrong while retrieving the quote. Please try again later.");
    }
}