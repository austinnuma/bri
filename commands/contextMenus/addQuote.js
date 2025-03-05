// commands/contextMenus/addQuote.js
import { ContextMenuCommandBuilder, ApplicationCommandType } from 'discord.js';
import { addQuote } from '../../utils/quoteManager.js';
import { logger } from '../../utils/logger.js';

export const data = new ContextMenuCommandBuilder()
    .setName('Add Quote')
    .setType(ApplicationCommandType.Message);

export async function execute(interaction) {
    try {
        // Get the target message
        const targetMessage = interaction.targetMessage;
        
        // Don't allow quoting bots or the same user adding their own quote
        if (targetMessage.author.bot) {
            return interaction.reply({ 
                content: "Sorry, I can't quote bots!", 
                ephemeral: true 
            });
        }
        
        if (targetMessage.author.id === interaction.user.id) {
            return interaction.reply({ 
                content: "You can't quote yourself! That's just showing off!", 
                ephemeral: true 
            });
        }

        // Quote must have actual content
        if (!targetMessage.content || targetMessage.content.trim() === '') {
            return interaction.reply({ 
                content: "I can't add this as a quote because it doesn't have any text content.",
                ephemeral: true 
            });
        }

        // Add the quote
        const success = await addQuote(
            targetMessage.author.id,
            interaction.guild.id,
            targetMessage.content,
            interaction.user.id,
            targetMessage.id,
            false
        );

        if (success) {
            return interaction.reply({ 
                content: `Added quote from ${targetMessage.author.username}!`,
                ephemeral: true 
            });
        } else {
            return interaction.reply({ 
                content: "Sorry, I couldn't add that quote. Please try again later.",
                ephemeral: true 
            });
        }
    } catch (error) {
        logger.error("Error in Add Quote context menu:", error);
        return interaction.reply({ 
            content: "Something went wrong while adding the quote.",
            ephemeral: true 
        });
    }
}