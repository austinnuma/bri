// blockuser.js - Command to block/unblock users from using Bri
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { blockUser, unblockUser, getBlockedUsers } from '../utils/moderation/userBlocker.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('blockuser')
  .setDescription('Block or unblock users from interacting with Bri')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) // Require manage messages permission
  .addSubcommand(subcommand =>
    subcommand
      .setName('block')
      .setDescription('Block a user from interacting with Bri')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to block')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('reason')
          .setDescription('Reason for blocking the user')
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('unblock')
      .setDescription('Unblock a user to allow interaction with Bri')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to unblock')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List all blocked users'));

export async function execute(interaction) {
  try {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    
    switch (subcommand) {
      case 'block': {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || "No reason provided";
        
        // Check if the user has the necessary permissions
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
          await interaction.reply({ 
            content: "❌ You don't have permission to block users.", 
            ephemeral: true 
          });
          return;
        }
        
        // Block the user
        const result = await blockUser(user.id, guildId, interaction.user.id, reason);
        
        if (result) {
          await interaction.reply({ 
            content: `✅ Successfully blocked ${user.username} from interacting with Bri.\nReason: ${reason}`, 
            ephemeral: true 
          });
        } else {
          await interaction.reply({ 
            content: "❌ Failed to block user. Please try again later.", 
            ephemeral: true 
          });
        }
        break;
      }
      
      case 'unblock': {
        const user = interaction.options.getUser('user');
        
        // Check if the user has the necessary permissions
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
          await interaction.reply({ 
            content: "❌ You don't have permission to unblock users.", 
            ephemeral: true 
          });
          return;
        }
        
        // Unblock the user
        const result = await unblockUser(user.id, guildId);
        
        if (result) {
          await interaction.reply({ 
            content: `✅ Successfully unblocked ${user.username}. They can now interact with Bri again.`, 
            ephemeral: true 
          });
        } else {
          await interaction.reply({ 
            content: "❌ Failed to unblock user. They may not be blocked or there was an error.", 
            ephemeral: true 
          });
        }
        break;
      }
      
      case 'list': {
        // Check if the user has the necessary permissions
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
          await interaction.reply({ 
            content: "❌ You don't have permission to view blocked users.", 
            ephemeral: true 
          });
          return;
        }
        
        // Get list of blocked users
        const blockedUsers = await getBlockedUsers(guildId);
        
        if (blockedUsers.length === 0) {
          await interaction.reply({ 
            content: "🔍 No users are currently blocked in this server.", 
            ephemeral: true 
          });
          return;
        }
        
        // Format the list of blocked users
        let content = '🚫 **Blocked Users**\n\n';
        
        for (const block of blockedUsers) {
          try {
            // Try to fetch user to get their username
            const user = await interaction.client.users.fetch(block.user_id);
            const blockedBy = await interaction.client.users.fetch(block.blocked_by);
            
            content += `👤 **${user.username}** (${block.user_id})\n`;
            content += `📝 Reason: ${block.reason || "No reason provided"}\n`;
            content += `🛡️ Blocked by: ${blockedBy.username}\n`;
            content += `⏰ When: <t:${Math.floor(new Date(block.blocked_at).getTime() / 1000)}:R>\n\n`;
          } catch (fetchError) {
            // If we can't fetch the user, just use their ID
            content += `👤 User ID: ${block.user_id}\n`;
            content += `📝 Reason: ${block.reason || "No reason provided"}\n`;
            content += `🛡️ Blocked by: ${block.blocked_by}\n`;
            content += `⏰ When: <t:${Math.floor(new Date(block.blocked_at).getTime() / 1000)}:R>\n\n`;
          }
        }
        
        await interaction.reply({ content, ephemeral: true });
        break;
      }
    }
  } catch (error) {
    logger.error('Error executing blockuser command:', error);
    
    // Send a generic error message to the user
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: "❌ An error occurred while executing this command.", 
          ephemeral: true 
        });
      } else {
        await interaction.editReply({ 
          content: "❌ An error occurred while executing this command." 
        });
      }
    } catch (replyError) {
      logger.error('Error sending error reply for blockuser command:', replyError);
    }
  }
}