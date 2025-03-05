// utils/reactionHandler.js
import { logger } from './logger.js';
import { addQuote } from './quoteManager.js';

// The emoji to use for quoting
const QUOTE_EMOJI = '💬'; // You can change this to any emoji

/**
 * Handles reaction add events
 * @param {Object} reaction - The reaction object
 * @param {Object} user - The user who added the reaction
 */
export async function handleReactionAdd(reaction, user) {
    try {
        // Skip if this is a bot reaction
        if (user.bot) return;
        
        // Check if this is the quote emoji
        if (reaction.emoji.name !== QUOTE_EMOJI) return;
        
        // Get the message that was reacted to
        const message = reaction.message;
        
        // Make sure we have the content (fetch if necessary)
        if (!message.content) {
            await message.fetch();
        }
        
        // Skip empty messages
        if (!message.content || message.content.trim() === '') return;
        
        // Don't allow quoting bots or self-quoting
        if (message.author.bot) return;
        if (message.author.id === user.id) {
            // Optionally notify the user they can't quote themselves
            try {
                user.send("You can't quote yourself! That's just showing off!");
            } catch (dmError) {
                // Ignore errors from DM (user might have DMs disabled)
            }
            return;
        }
        
        // Add the quote
        const success = await addQuote(
            message.author.id,
            message.guild.id,
            message.content,
            user.id,
            message.id,
            false
        );
        
        if (success) {
            // Optionally add a confirmation reaction
            try {
                await reaction.message.react('✅');
                
                // Remove the checkmark after a few seconds
                setTimeout(() => {
                    try {
                        reaction.message.reactions.cache
                            .find(r => r.emoji.name === '✅')
                            ?.users.remove(reaction.client.user.id);
                    } catch (removeError) {
                        // Ignore errors from removing reactions
                    }
                }, 5000);
            } catch (reactError) {
                logger.warn("Couldn't add confirmation reaction:", reactError);
            }
        }
    } catch (error) {
        logger.error("Error handling quote reaction:", error);
    }
}

// Add this to your index.js or event handler file:
/*
client.on('messageReactionAdd', async (reaction, user) => {
    await handleReactionAdd(reaction, user);
});
*/