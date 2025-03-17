// commands/serverSettings.js
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { 
  getServerConfig, 
  updateServerConfig, 
  isFeatureEnabled
} from '../utils/serverConfigManager.js';
import { logger } from '../utils/logger.js';
import { 
  getServerCredits, 
  DEFAULT_FREE_MONTHLY_CREDITS,
  CREDIT_COSTS
} from '../utils/creditManager.js';

export const data = new SlashCommandBuilder()
  .setName('server-settings')
  .setDescription('Configure Bri for this server')
  // Set prefix subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('prefix')
      .setDescription('Set the command prefix for this server')
      .addStringOption(option =>
        option.setName('prefix')
          .setDescription('The new prefix (default: bri)')
          .setRequired(true)))
  // Toggle features subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('toggle')
      .setDescription('Enable or disable features')
      .addStringOption(option =>
        option.setName('feature')
          .setDescription('The feature to toggle')
          .setRequired(true)
          .addChoices(
            { name: 'Quotes', value: 'quotes' },
            { name: 'Memory', value: 'memory' },
            { name: 'Reminders', value: 'reminders' },
            { name: 'Character Development', value: 'character' },
          ))
      .addBooleanOption(option =>
        option.setName('enabled')
          .setDescription('Whether the feature is enabled')
          .setRequired(true)))
  // Add/remove designated channel subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('channel')
      .setDescription('Add or remove a designated channel')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('The channel to configure')
          .setRequired(true))
      .addBooleanOption(option =>
        option.setName('designated')
          .setDescription('Whether this is a designated channel for Bri')
          .setRequired(true)))
  // View settings subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View current server settings'))
  // View credits subcommand
  .addSubcommand(subcommand =>
    subcommand
      .setName('credits')
      .setDescription('View server credit information'));

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  }

  // Manually check if the user has the ManageGuild permission
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'You do not have permission to use this command. (Requires Manage Server)', ephemeral: true });
  }

  // Defer reply to avoid timeout
  await interaction.deferReply({ ephemeral: true });

  try {
    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'prefix': {
        const prefix = interaction.options.getString('prefix');
        await updateServerConfig(guildId, { prefix });
        return interaction.editReply(`Command prefix updated to "${prefix}"`);
      }

      case 'toggle': {
        const feature = interaction.options.getString('feature');
        const enabled = interaction.options.getBoolean('enabled');
        
        // Get current config
        const config = await getServerConfig(guildId);
        const enabledFeatures = config.enabled_features || {};
        
        // Update the specific feature
        enabledFeatures[feature] = enabled;
        
        // Save the updated features
        await updateServerConfig(guildId, { enabled_features: enabledFeatures });
        
        return interaction.editReply(`${feature} feature is now ${enabled ? 'enabled' : 'disabled'}`);
      }

      case 'channel': {
        const channel = interaction.options.getChannel('channel');
        const designated = interaction.options.getBoolean('designated');
        
        // Get current config
        const config = await getServerConfig(guildId);
        let designatedChannels = config.designated_channels || [];
        
        // Add or remove the channel
        if (designated && !designatedChannels.includes(channel.id)) {
          designatedChannels.push(channel.id);
        } else if (!designated) {
          designatedChannels = designatedChannels.filter(id => id !== channel.id);
        }
        
        // Save the updated channels
        await updateServerConfig(guildId, { designated_channels: designatedChannels });
        
        return interaction.editReply(
          `Channel ${channel.name} is now ${designated ? 'a designated' : 'no longer a designated'} Bri channel`
        );
      }

      case 'view': {
        // Get current config
        const config = await getServerConfig(guildId);
        
        // Create a readable view of the settings
        const enabledFeatures = config.enabled_features || {};
        const featuresText = Object.entries(enabledFeatures)
          .map(([feature, enabled]) => `• ${feature}: ${enabled ? '✅ Enabled' : '❌ Disabled'}`)
          .join('\n');
        
        const designatedChannels = config.designated_channels || [];
        const channelsText = designatedChannels.length > 0
          ? designatedChannels.map(id => `• <#${id}>`).join('\n')
          : 'None';
        
        const settingsEmbed = {
          title: 'Bri Server Settings',
          description: `Settings for this server (ID: ${guildId})`,
          color: 0x5865F2,
          fields: [
            {
              name: 'Command Prefix',
              value: config.prefix || 'bri'
            },
            {
              name: 'Credit System',
              value: config.credits_enabled ? '✅ Enabled' : '❌ Disabled'
            },
            {
              name: 'Features',
              value: featuresText || 'No features configured'
            },
            {
              name: 'Designated Channels',
              value: channelsText
            }
          ],
          footer: {
            text: 'Server administrators can change these settings.'
          }
        };
        
        return interaction.editReply({ embeds: [settingsEmbed] });
      }

      case 'credits': {
        // Get credit information
        const credits = await getServerCredits(guildId);
        
        if (!credits) {
          return interaction.editReply('Unable to retrieve credit information for this server.');
        }
        
        // Format dates
        const lastRefreshDate = new Date(credits.last_free_refresh).toLocaleDateString();
        const nextRefreshDate = new Date(credits.next_free_refresh).toLocaleDateString();
        
        // Create a credit usage breakdown
        const creditUsageBreakdown = Object.entries(CREDIT_COSTS)
          .map(([operation, cost]) => `• ${formatOperationName(operation)}: ${cost} credits`)
          .join('\n');
        
        // Create the embed
        const creditsEmbed = new EmbedBuilder()
          .setTitle('Bri Credits System')
          .setDescription(`Credit information for this server (ID: ${guildId})`)
          .setColor(0x00AAFF)
          .addFields(
            {
              name: '💰 Available Credits',
              value: `${credits.remaining_credits} credits`,
              inline: true
            },
            {
              name: '🔄 Free Monthly Credits',
              value: `${DEFAULT_FREE_MONTHLY_CREDITS} credits`,
              inline: true
            },
            {
              name: '📊 Total Used Credits',
              value: `${credits.total_used_credits} credits`,
              inline: true
            },
            {
              name: '⏱️ Last Free Credit Refresh',
              value: lastRefreshDate,
              inline: true
            },
            {
              name: '📆 Next Free Credit Refresh',
              value: nextRefreshDate,
              inline: true
            },
            {
              name: '💎 Purchased Credits',
              value: `${credits.credits_purchased} credits`,
              inline: true
            },
            {
              name: '💸 Credit Usage Rates',
              value: creditUsageBreakdown
            }
          )
          .setFooter({ 
            text: 'Purchase more credits on the Bri website. Free credits refresh on the 1st of each month.'
          });
        
        // Get server config to check if credits are enabled
        const config = await getServerConfig(guildId);
        
        if (!config.credits_enabled) {
          creditsEmbed.addFields({
            name: '⚠️ Credit System Disabled',
            value: 'The credit system is currently disabled for this server. Use `/server-settings toggle feature:credits enabled:true` to enable it.'
          });
        }
        
        return interaction.editReply({ embeds: [creditsEmbed] });
      }
    }
  } catch (error) {
    logger.error('Error in server-settings command:', error);
    return interaction.editReply('An error occurred while updating server settings.');
  }
}

/**
 * Format operation name for display
 * @param {string} operation - The operation type
 * @returns {string} - Formatted operation name
 */
function formatOperationName(operation) {
  // Convert SNAKE_CASE to Title Case
  return operation
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}