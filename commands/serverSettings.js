// commands/serverSettings.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { 
  getServerConfig, 
  updateServerConfig, 
  isFeatureEnabled
} from '../utils/serverConfigManager.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('server-settings')
  .setDescription('Configure Bri for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
            { name: 'Character Development', value: 'character' }
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
      .setDescription('View current server settings'));

export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
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
    }
  } catch (error) {
    logger.error('Error in server-settings command:', error);
    return interaction.editReply('An error occurred while updating server settings.');
  }
}