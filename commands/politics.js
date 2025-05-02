// commands/politics.js
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { 
  getPoliticsSettings, 
  updatePoliticsSettings, 
  generateAndSendPoliticsSummary, 
  setupPoliticsTables 
} from '../services/newsService.js';

// Import credit management functions
import { hasEnoughCredits, useCredits, CREDIT_COSTS, getServerCredits } from '../utils/creditManager.js';
import { getServerConfig } from '../utils/serverConfigManager.js';
import { isFeatureSubscribed, SUBSCRIPTION_FEATURES } from '../utils/subscriptionManager.js';

// Valid timezone list (subset)
const VALID_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Honolulu',
  'America/Phoenix',
  'America/Indiana/Indianapolis',
  'America/Toronto',
  'Europe/London'
];

export const data = new SlashCommandBuilder()
  .setName('politics')
  .setDescription('Set up daily U.S. political news summaries')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // Only server managers can use this
  .addSubcommand(subcommand =>
    subcommand
      .setName('setup')
      .setDescription('Configure daily political news updates')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Channel to post daily news in')
          .setRequired(true))
      .addStringOption(option =>
        option
          .setName('time')
          .setDescription('Time to post daily news (e.g., "8:00")')
          .setRequired(true))
      .addStringOption(option =>
        option
          .setName('timezone')
          .setDescription('Your timezone')
          .setRequired(true)
          .addChoices(
            { name: 'US Eastern', value: 'America/New_York' },
            { name: 'US Central', value: 'America/Chicago' },
            { name: 'US Mountain', value: 'America/Denver' },
            { name: 'US Pacific', value: 'America/Los_Angeles' },
            { name: 'US Alaska', value: 'America/Anchorage' },
            { name: 'US Hawaii', value: 'America/Honolulu' }
          ))
      .addStringOption(option =>
        option
          .setName('perspective')
          .setDescription('Political perspective to emphasize')
          .setRequired(false)
          .addChoices(
            { name: 'Balanced (include multiple viewpoints)', value: 'balanced' },
            { name: 'Progressive (emphasize progressive perspectives)', value: 'progressive' },
            { name: 'Conservative (emphasize conservative perspectives)', value: 'conservative' }
          ))
      .addStringOption(option =>
        option
          .setName('detail')
          .setDescription('How detailed should the summary be?')
          .setRequired(false)
          .addChoices(
            { name: 'Brief (shorter summary)', value: 'brief' },
            { name: 'Medium (standard length)', value: 'medium' },
            { name: 'Detailed (comprehensive coverage)', value: 'detailed' }
          ))
      .addStringOption(option =>
        option
          .setName('tone')
          .setDescription('Tone of the summary')
          .setRequired(false)
          .addChoices(
            { name: 'Neutral (formal news tone)', value: 'neutral' },
            { name: 'Conversational (Bri\'s friendly tone)', value: 'conversational' }
          ))
      .addBooleanOption(option =>
        option
          .setName('sources')
          .setDescription('Include sources list at the end?')
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('status')
      .setDescription('Check current political news configuration'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('disable')
      .setDescription('Disable political news updates'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('test')
      .setDescription('Send a test political news summary'));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const subcommand = interaction.options.getSubcommand();
    logger.info(`Executing politics command with subcommand: ${subcommand}`);
    
    // Initialize tables if needed
    await setupPoliticsTables();
    
    // For 'setup' and 'test', check credits and subscription
    if (subcommand === 'setup' || subcommand === 'test') {
      const guildId = interaction.guildId;
      
      // Check if this server has credits enabled
      const serverConfig = await getServerConfig(guildId);
      const creditsEnabled = serverConfig?.credits_enabled === true;
      
      // Check if server has unlimited scheduling with subscription
      const hasUnlimitedFeature = await isFeatureSubscribed(guildId, SUBSCRIPTION_FEATURES.UNLIMITED_SCHEDULING);
      
      // If credits are enabled and server doesn't have unlimited feature, check credits
      if (creditsEnabled && !hasUnlimitedFeature) {
        const operationType = 'SCHEDULING'; // Use same cost as scheduling
        
        // Check if server has enough credits
        const hasCredits = await hasEnoughCredits(guildId, operationType);
        
        if (!hasCredits) {
          // Get current credit information for a more helpful message
          const credits = await getServerCredits(guildId);
          
          const creditsEmbed = new EmbedBuilder()
            .setTitle('Insufficient Credits')
            .setDescription(`This server doesn't have enough credits to set up political news updates.`)
            .setColor(0xFF0000)
            .addFields(
              {
                name: '💰 Available Credits',
                value: `${credits?.remaining_credits || 0} credits`,
                inline: true
              },
              {
                name: '💸 Required Credits',
                value: `${CREDIT_COSTS['SCHEDULING']} credits`,
                inline: true
              },
              {
                name: '📊 Credit Cost',
                value: `Setting up political news updates costs ${CREDIT_COSTS['SCHEDULING']} credits.`,
                inline: true
              }
            )
            .setFooter({ 
              text: 'Purchase more credits or subscribe for unlimited features!'
            });
            
          return interaction.editReply({ embeds: [creditsEmbed] });
        }
      }
    }
    
    // Process the command
    let success = false;
    
    switch (subcommand) {
      case 'setup':
        success = await handleSetup(interaction);
        break;
      case 'status':
        success = await handleStatus(interaction);
        break;
      case 'disable':
        success = await handleDisable(interaction);
        break;
      case 'test':
        success = await handleTest(interaction);
        break;
      default:
        return interaction.editReply({
          content: "Unknown subcommand. Please try again with a valid option.",
          ephemeral: true
        });
    }
    
    // Only charge credits for successful setup or test (if enabled and not subscription)
    if (success && (subcommand === 'setup' || subcommand === 'test')) {
      const guildId = interaction.guildId;
      const serverConfig = await getServerConfig(guildId);
      const creditsEnabled = serverConfig?.credits_enabled === true;
      const hasUnlimitedFeature = await isFeatureSubscribed(guildId, SUBSCRIPTION_FEATURES.UNLIMITED_SCHEDULING);
      
      if (creditsEnabled && !hasUnlimitedFeature) {
        await useCredits(guildId, 'SCHEDULING');
        logger.info(`Used ${CREDIT_COSTS['SCHEDULING']} credits for politics ${subcommand} in server ${guildId}`);
      }
    }
  } catch (error) {
    logger.error('Error in politics command:', error);
    
    return interaction.editReply({
      content: "Sorry, something went wrong. Please try again.",
      ephemeral: true
    });
  }
}

/**
 * Handle the 'setup' subcommand
 * @param {Interaction} interaction - Discord interaction
 * @returns {Promise<boolean>} - Success status
 */
async function handleSetup(interaction) {
  try {
    const guildId = interaction.guildId;
    
    // Get all options
    const channel = interaction.options.getChannel('channel');
    const timeString = interaction.options.getString('time');
    const timezone = interaction.options.getString('timezone');
    const perspective = interaction.options.getString('perspective') || 'balanced';
    const detailLevel = interaction.options.getString('detail') || 'medium';
    const tone = interaction.options.getString('tone') || 'conversational';
    const includeSources = interaction.options.getBoolean('sources') ?? true;
    
    // Validate the channel is a text channel
    if (!channel.isTextBased()) {
      await interaction.editReply({
        content: "I can only send political news to text channels.",
        ephemeral: true
      });
      return false;
    }
    
    // Validate timezone
    if (!VALID_TIMEZONES.includes(timezone)) {
      await interaction.editReply({
        content: "Please select a valid timezone.",
        ephemeral: true
      });
      return false;
    }
    
    // Parse the time (HH:MM)
    const [hours, minutes] = timeString.split(':').map(part => parseInt(part.trim()));
    
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await interaction.editReply({
        content: "Please provide a valid time in 24-hour format (e.g., '8:00' or '15:30').",
        ephemeral: true
      });
      return false;
    }
    
    // Create cron schedule for daily at the specified time
    const cronSchedule = `${minutes} ${hours} * * *`;
    
    // Updating the settings
    const settings = {
      enabled: true,
      channel_id: channel.id,
      cron_schedule: cronSchedule,
      timezone: timezone,
      perspective: perspective,
      detail_level: detailLevel,
      tone: tone,
      include_sources: includeSources
    };
    
    // Save the settings
    const updatedSettings = await updatePoliticsSettings(guildId, settings);
    
    if (!updatedSettings) {
      await interaction.editReply({
        content: "Sorry, I couldn't save your politics news settings. Please try again.",
        ephemeral: true
      });
      return false;
    }
    
    // Format time for display
    const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    // Create success embed
    const embed = new EmbedBuilder()
      .setTitle('📰 Political News Updates Configured')
      .setDescription(`I'll post daily U.S. political news summaries in ${channel}`)
      .setColor(0x2874A6) // Blue color
      .addFields(
        {
          name: '⏰ Time', 
          value: `${formattedTime} (${timezone})`,
          inline: true
        },
        {
          name: '🔍 Perspective', 
          value: perspective.charAt(0).toUpperCase() + perspective.slice(1),
          inline: true
        },
        {
          name: '📝 Detail Level', 
          value: detailLevel.charAt(0).toUpperCase() + detailLevel.slice(1),
          inline: true
        },
        {
          name: '💬 Tone', 
          value: tone === 'conversational' ? 'Conversational (Bri\'s voice)' : 'Neutral',
          inline: true
        },
        {
          name: '📚 Sources Included', 
          value: includeSources ? 'Yes' : 'No',
          inline: true
        }
      )
      .setFooter({ 
        text: 'You can update these settings any time with /politics setup'
      });
      
    await interaction.editReply({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.error('Error in politics setup command:', error);
    await interaction.editReply({
      content: "Sorry, something went wrong. Please try again.",
      ephemeral: true
    });
    return false;
  }
}

/**
 * Handle the 'status' subcommand
 * @param {Interaction} interaction - Discord interaction
 * @returns {Promise<boolean>} - Success status
 */
async function handleStatus(interaction) {
  try {
    const guildId = interaction.guildId;
    
    // Get current settings
    const settings = await getPoliticsSettings(guildId);
    
    if (!settings) {
      await interaction.editReply({
        content: "Political news updates are not configured for this server yet. Use `/politics setup` to get started.",
        ephemeral: true
      });
      return true;
    }
    
    // Check if enabled
    if (!settings.enabled) {
      await interaction.editReply({
        content: "Political news updates are currently disabled for this server. Use `/politics setup` to enable them.",
        ephemeral: true
      });
      return true;
    }
    
    // Get channel name
    let channelName = settings.channel_id;
    try {
      const channel = await interaction.client.channels.fetch(settings.channel_id);
      if (channel) {
        channelName = `#${channel.name}`;
      }
    } catch (error) {
      // If channel can't be fetched, just use ID
      logger.warn(`Couldn't fetch channel ${settings.channel_id} for politics status:`, error);
    }
    
    // Parse cron schedule
    const cronParts = settings.cron_schedule.split(' ');
    let scheduleDesc = "Unknown schedule";
    
    if (cronParts.length === 5) {
      const [minute, hour] = cronParts;
      scheduleDesc = `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }
    
    // Create status embed
    const embed = new EmbedBuilder()
      .setTitle('📰 Political News Status')
      .setDescription(`Political news updates are **enabled** for this server.`)
      .setColor(0x2874A6) // Blue color
      .addFields(
        {
          name: '📣 Channel', 
          value: channelName,
          inline: true
        },
        {
          name: '⏰ Schedule', 
          value: `${scheduleDesc} (${settings.timezone})`,
          inline: true
        },
        {
          name: '🔍 Perspective', 
          value: settings.perspective.charAt(0).toUpperCase() + settings.perspective.slice(1),
          inline: true
        },
        {
          name: '📝 Detail Level', 
          value: settings.detail_level.charAt(0).toUpperCase() + settings.detail_level.slice(1),
          inline: true
        },
        {
          name: '💬 Tone', 
          value: settings.tone === 'conversational' ? 'Conversational (Bri\'s voice)' : 'Neutral',
          inline: true
        },
        {
          name: '📚 Sources Included', 
          value: settings.include_sources ? 'Yes' : 'No',
          inline: true
        }
      )
      .setFooter({ 
        text: 'Use /politics setup to modify these settings'
      });
      
    await interaction.editReply({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.error('Error in politics status command:', error);
    await interaction.editReply({
      content: "Sorry, I couldn't retrieve the politics news settings. Please try again.",
      ephemeral: true
    });
    return false;
  }
}

/**
 * Handle the 'disable' subcommand
 * @param {Interaction} interaction - Discord interaction
 * @returns {Promise<boolean>} - Success status
 */
async function handleDisable(interaction) {
  try {
    const guildId = interaction.guildId;
    
    // Get current settings
    const settings = await getPoliticsSettings(guildId);
    
    if (!settings) {
      await interaction.editReply({
        content: "Political news updates are not configured for this server.",
        ephemeral: true
      });
      return true;
    }
    
    // Check if already disabled
    if (!settings.enabled) {
      await interaction.editReply({
        content: "Political news updates are already disabled for this server.",
        ephemeral: true
      });
      return true;
    }
    
    // Disable the updates
    const updated = await updatePoliticsSettings(guildId, { enabled: false });
    
    if (!updated) {
      await interaction.editReply({
        content: "Sorry, I couldn't disable political news updates. Please try again.",
        ephemeral: true
      });
      return false;
    }
    
    await interaction.editReply({
      content: "📰 Political news updates have been disabled. You can re-enable them anytime with `/politics setup`.",
      ephemeral: true
    });
    
    return true;
  } catch (error) {
    logger.error('Error in politics disable command:', error);
    await interaction.editReply({
      content: "Sorry, something went wrong. Please try again.",
      ephemeral: true
    });
    return false;
  }
}

/**
 * Handle the 'test' subcommand
 * @param {Interaction} interaction - Discord interaction
 * @returns {Promise<boolean>} - Success status
 */
async function handleTest(interaction) {
  try {
    const guildId = interaction.guildId;
    
    // Get current settings
    const settings = await getPoliticsSettings(guildId);
    
    if (!settings) {
      await interaction.editReply({
        content: "Political news updates are not configured for this server yet. Use `/politics setup` to get started.",
        ephemeral: true
      });
      return false;
    }
    
    // Get channel info
    let channel;
    try {
      channel = await interaction.client.channels.fetch(settings.channel_id);
      if (!channel || !channel.isTextBased()) {
        await interaction.editReply({
          content: "The configured channel for political news is not available or not a text channel. Please use `/politics setup` to configure a valid channel.",
          ephemeral: true
        });
        return false;
      }
    } catch (error) {
      await interaction.editReply({
        content: "I couldn't access the configured channel for political news. Please use `/politics setup` to configure a valid channel.",
        ephemeral: true
      });
      return false;
    }
    
    // Send a progress message
    await interaction.editReply({
      content: "Generating a test political news summary... This may take a minute or two.",
      ephemeral: true
    });
    
    // Generate and send a test summary
    const success = await generateAndSendPoliticsSummary(settings, interaction.client);
    
    if (!success) {
      await interaction.editReply({
        content: "Sorry, I couldn't generate a test political news summary. Please try again later.",
        ephemeral: true
      });
      return false;
    }
    
    // Update the reply
    await interaction.editReply({
      content: `✅ Test political news summary sent to ${channel}. Political news is ${settings.enabled ? 'enabled' : 'disabled'} for daily updates.`,
      ephemeral: true
    });
    
    return true;
  } catch (error) {
    logger.error('Error in politics test command:', error);
    await interaction.editReply({
      content: "Sorry, something went wrong. Please try again.",
      ephemeral: true
    });
    return false;
  }
}