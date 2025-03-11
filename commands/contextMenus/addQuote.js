// commands/contextMenus/addQuote.js
import { ContextMenuCommandBuilder, ApplicationCommandType } from 'discord.js';
import { addQuote } from '../../utils/quoteManager.js';
import { logger } from '../../utils/logger.js';

export const data = new ContextMenuCommandBuilder()
    .setName('Add Quote')
    .setType(ApplicationCommandType.Message);

export async function execute(interaction) {
    try {
        // Only defer if not already deferred or replied to
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }
        
        // Get the target message
        const targetMessage = interaction.targetMessage;
        
        // Don't allow self-quoting (removed the bot check)
        if (targetMessage.author.id === interaction.user.id) {
            return interaction.editReply("You can't quote yourself! That's just showing off!");
        }

        // Quote must have actual content
        if (!targetMessage.content || targetMessage.content.trim() === '') {
            return interaction.editReply("I can't add this as a quote because it doesn't have any text content.");
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
            return interaction.editReply(`Added quote from ${targetMessage.author.username}!`);
        } else {
            // This could happen if the quote already exists
            return interaction.editReply("This message has already been quoted or there was an error adding it.");
        }
    } catch (error) {
        logger.error("Error in Add Quote context menu:", error);
        
        // Check if we already replied, and use the appropriate method
        if (interaction.deferred || interaction.replied) {
            return interaction.editReply("Something went wrong while adding the quote.");
        } else {
            return interaction.reply({ 
                content: "Something went wrong while adding the quote.",
                ephemeral: true 
            });
        }
    }
}