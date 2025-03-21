// commands/resetProfile.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/combinedServices.js';
import { USER_CHARACTER_SHEET_SCHEMA } from '../utils/userCharacterSheet.js';
import { isFeatureEnabled } from '../utils/serverConfigManager.js';

export const data = new SlashCommandBuilder()
    .setName('reset-profile')
    .setDescription('Reset a user\'s profile information (Admin only)')
    .addUserOption(option => 
        option.setName('user')
            .setDescription('The user whose profile you want to reset')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    try {
        // Check if character feature is enabled for this server
        const characterEnabled = await isFeatureEnabled(interaction.guildId, 'character');
        if (!characterEnabled) {
            return interaction.reply({ 
                content: "The character features are currently disabled on this server.",
                ephemeral: true 
            });
        }

        // Only admins can use this command (enforced by setDefaultMemberPermissions above)
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ 
                content: "You don't have permission to use this command. Only administrators can reset profiles.",
                ephemeral: true 
            });
        }
        
        // Get the target user
        const targetUser = interaction.options.getUser('user');
        
        // Delete the user's character sheet from the database
        const { error } = await supabase
            .from('user_character_sheet')
            .delete()
            .eq('user_id', targetUser.id)
            .eq('guild_id', interaction.guildId);
            
        if (error) {
            logger.error(`Error resetting profile for user ${targetUser.id}:`, error);
            return interaction.reply({ 
                content: `Error resetting the profile for ${targetUser.username}. Please try again later.`,
                ephemeral: true 
            });
        }
        
        // Respond with confirmation
        await interaction.reply({ 
            content: `Successfully reset the profile for ${targetUser.username}. Their character sheet information has been removed from this server.`,
            ephemeral: true 
        });
        
    } catch (error) {
        logger.error("Error in reset-profile command:", error);
        await interaction.reply({ 
            content: "Sorry, there was an error processing this command. Please try again later.",
            ephemeral: true 
        });
    }
}