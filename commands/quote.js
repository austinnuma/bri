// commands/quote.js
import { SlashCommandBuilder } from 'discord.js';
import { supabase } from '../services/combinedServices.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Add or retrieve quotes from server members')
    .addStringOption(option =>
        option.setName('input')
            .setDescription('Either "add" to save a quote you\'re replying to, or a username to get a random quote')
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
 * Adds a quote to the database
 * @param {string} userId - ID of user being quoted
 * @param {string} guildId - ID of the guild/server
 * @param {string} content - The quote content
 * @param {string} addedBy - ID of user who added the quote
 * @param {string} messageId - Original message ID
 * @returns {Promise<boolean>} - Success status
 */
async function addQuote(userId, guildId, content, addedBy, messageId) {
    try {
        const { error } = await supabase
            .from('user_quotes')
            .insert({
                user_id: userId,
                guild_id: guildId,
                content: content,
                added_by: addedBy,
                message_id: messageId,
                added_at: new Date().toISOString(),
                auto_added: false
            });

        if (error) {
            logger.error("Error adding quote:", error);
            return false;
        }
        return true;
    } catch (error) {
        logger.error("Error in addQuote:", error);
        return false;
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
    const input = interaction.options.getString('input');
    
    // Case 1: Adding a quote (must be replying to a message)
    if (input.toLowerCase() === 'add') {
        // Check if this is a reply
        if (!interaction.message?.reference) {
            return interaction.reply({
                content: "You need to reply to a message to add it as a quote! Use `/quote add` while replying to someone's message.",
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();
            
            // Fetch the referenced message
            const referencedMessage = await interaction.channel.messages.fetch(interaction.message.reference.messageId);
            
            // Don't allow quoting bots or the same user adding their own quote
            if (referencedMessage.author.bot) {
                return interaction.editReply("Sorry, I can't quote bots!");
            }
            
            if (referencedMessage.author.id === interaction.user.id) {
                return interaction.editReply("You can't quote yourself! That's just showing off!");
            }

            // Quote must have actual content
            if (!referencedMessage.content || referencedMessage.content.trim() === '') {
                return interaction.editReply("I can't add this as a quote because it doesn't have any text content.");
            }

            // Add the quote
            const success = await addQuote(
                referencedMessage.author.id,
                interaction.guild.id,
                referencedMessage.content,
                interaction.user.id,
                referencedMessage.id
            );

            if (success) {
                return interaction.editReply(`Added quote from ${referencedMessage.author.username}!`);
            } else {
                return interaction.editReply("Sorry, I couldn't add that quote. Please try again later.");
            }
        } catch (error) {
            logger.error("Error handling quote add:", error);
            return interaction.editReply("Something went wrong while adding the quote. Please try again later.");
        }
    }
        // Case 2: Getting a random quote for a username or from anyone
        else {
            try {
                await interaction.deferReply();
                
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
}