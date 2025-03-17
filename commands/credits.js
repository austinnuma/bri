// commands/credits.js
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { 
  getServerCredits, 
  DEFAULT_FREE_MONTHLY_CREDITS, 
  CREDIT_COSTS 
} from '../utils/creditManager.js';
import { getServerConfig } from '../utils/serverConfigManager.js';
import { supabase } from '../services/combinedServices.js';

export const data = new SlashCommandBuilder()
  .setName('credits')
  .setDescription('Check and manage server credits')
  .addSubcommand(subcommand =>
    subcommand
      .setName('check')
      .setDescription('Check current credit balance and usage'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('usage')
      .setDescription('View detailed credit usage history')
      .addIntegerOption(option =>
        option
          .setName('days')
          .setDescription('Number of days to show (default: 7)')
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('info')
      .setDescription('Information about the credit system'));

export async function execute(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });
    
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    
    if (!guildId) {
      return interaction.editReply("This command can only be used in a server.");
    }
    
    // Get server configuration to check if credits are enabled
    const serverConfig = await getServerConfig(guildId);
    const creditsEnabled = serverConfig?.credits_enabled === true;
    
    switch (subcommand) {
      case 'check':
        await handleCreditsCheck(interaction, guildId, creditsEnabled);
        break;
      case 'usage':
        await handleCreditsUsage(interaction, guildId, creditsEnabled);
        break;
      case 'info':
        await handleCreditsInfo(interaction);
        break;
      default:
        await interaction.editReply("Unknown subcommand. Please try again.");
    }
  } catch (error) {
    logger.error('Error executing credits command:', error);
    await interaction.editReply("Sorry, something went wrong while checking credits. Please try again later.");
  }
}

/**
 * Handle the 'check' subcommand - shows current credit balance
 * @param {Interaction} interaction - Discord interaction
 * @param {string} guildId - Guild ID
 * @param {boolean} creditsEnabled - Whether credits are enabled
 */
async function handleCreditsCheck(interaction, guildId, creditsEnabled) {
  try {
    // Get credit information
    const credits = await getServerCredits(guildId);
    
    if (!credits) {
      return interaction.editReply("Unable to retrieve credit information for this server.");
    }
    
    // Format dates
    const lastRefreshDate = new Date(credits.last_free_refresh).toLocaleDateString();
    const nextRefreshDate = new Date(credits.next_free_refresh).toLocaleDateString();
    
    // Calculate percentage of credits used
    const totalCredits = credits.remaining_credits + credits.total_used_credits;
    const percentUsed = Math.min(Math.round((credits.total_used_credits / totalCredits) * 100), 100) || 0;
    
    // Create a visual progress bar for credits used
    const progressBar = createProgressBar(percentUsed, 15);
    
    // Create the embed
    const creditsEmbed = new EmbedBuilder()
      .setTitle('Bri Credits')
      .setDescription(`Credit information for ${interaction.guild.name}`)
      .setColor(0x00AAFF)
      .addFields(
        {
          name: '💰 Available Credits',
          value: `${credits.remaining_credits} credits`,
          inline: true
        },
        {
          name: '📊 Used Credits',
          value: `${credits.total_used_credits} credits`,
          inline: true
        },
        {
          name: '🔄 Credit Usage',
          value: `${progressBar} ${percentUsed}%`,
          inline: false
        },
        {
          name: '📆 Next Free Credit Refresh',
          value: `${nextRefreshDate} (${DEFAULT_FREE_MONTHLY_CREDITS} credits)`,
          inline: false
        }
      )
      .setFooter({ 
        text: creditsEnabled 
          ? 'Use /credits info to learn more about the credit system' 
          : 'Credits are currently disabled for this server'
      });
    
    if (!creditsEnabled) {
      creditsEmbed.addFields({
        name: '⚠️ Credits Disabled',
        value: 'The credit system is currently disabled for this server. Server administrators can enable it using the `/server-settings` command.'
      });
    }
    
    return interaction.editReply({ embeds: [creditsEmbed] });
  } catch (error) {
    logger.error('Error in handleCreditsCheck:', error);
    return interaction.editReply("Sorry, I couldn't retrieve the credit information right now.");
  }
}

/**
 * Handle the 'usage' subcommand - shows detailed credit usage history
 * @param {Interaction} interaction - Discord interaction
 * @param {string} guildId - Guild ID
 * @param {boolean} creditsEnabled - Whether credits are enabled
 */
async function handleCreditsUsage(interaction, guildId, creditsEnabled) {
  try {
    // Get the number of days to show (default: 7)
    const days = interaction.options.getInteger('days') || 7;
    
    // Limit to a reasonable range
    const limitedDays = Math.min(Math.max(days, 1), 30);
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - limitedDays);
    
    // Get transaction history from database
    const { data: transactions, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('guild_id', guildId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(25);
    
    if (error) {
      logger.error('Error fetching credit transactions:', error);
      return interaction.editReply("Sorry, I couldn't retrieve the credit usage history right now.");
    }
    
    if (!transactions || transactions.length === 0) {
      return interaction.editReply(`No credit usage found for the past ${limitedDays} day${limitedDays !== 1 ? 's' : ''}.`);
    }
    
    // Group transactions by type
    const usageByType = {};
    let totalUsed = 0;
    let totalAdded = 0;
    
    for (const tx of transactions) {
      if (tx.transaction_type === 'usage') {
        const featureType = tx.feature_type || 'Unknown';
        usageByType[featureType] = (usageByType[featureType] || 0) + Math.abs(tx.amount);
        totalUsed += Math.abs(tx.amount);
      } else if (tx.amount > 0) {
        totalAdded += tx.amount;
      }
    }
    
    // Create formatted usage breakdown
    const usageBreakdown = Object.entries(usageByType)
      .sort((a, b) => b[1] - a[1]) // Sort by highest usage first
      .map(([type, amount]) => `• ${formatFeatureType(type)}: ${amount} credits`)
      .join('\n');
    
    // Create the embed
    const usageEmbed = new EmbedBuilder()
      .setTitle('Credit Usage History')
      .setDescription(`Usage for the past ${limitedDays} day${limitedDays !== 1 ? 's' : ''} in ${interaction.guild.name}`)
      .setColor(0x00AAFF)
      .addFields(
        {
          name: '💰 Total Credits Used',
          value: `${totalUsed} credits`,
          inline: true
        },
        {
          name: '💎 Total Credits Added',
          value: `${totalAdded} credits`,
          inline: true
        },
        {
          name: '📊 Usage Breakdown',
          value: usageBreakdown || 'No usage data available.',
          inline: false
        }
      )
      .setFooter({ 
        text: creditsEnabled 
          ? 'Use /credits info to learn more about the credit system' 
          : 'Credits are currently disabled for this server'
      });
    
    return interaction.editReply({ embeds: [usageEmbed] });
  } catch (error) {
    logger.error('Error in handleCreditsUsage:', error);
    return interaction.editReply("Sorry, I couldn't retrieve the credit usage history right now.");
  }
}

/**
 * Handle the 'info' subcommand - shows information about the credit system
 * @param {Interaction} interaction - Discord interaction
 */
async function handleCreditsInfo(interaction) {
  try {
    // Get the current usage rates
    const usageRates = Object.entries(CREDIT_COSTS)
      .map(([operation, cost]) => `• ${formatFeatureType(operation)}: ${cost} credits`)
      .join('\n');
    
    // Create the embed
    const infoEmbed = new EmbedBuilder()
      .setTitle('Bri Credit System Info')
      .setDescription('The credit system lets server administrators manage Bri usage by allocating credits to different operations.')
      .setColor(0x00AAFF)
      .addFields(
        {
          name: '💰 Free Monthly Credits',
          value: `Each server receives ${DEFAULT_FREE_MONTHLY_CREDITS} free credits on the 1st of each month.`,
          inline: false
        },
        {
          name: '💸 Credit Usage Rates',
          value: usageRates,
          inline: false
        },
        {
          name: '🔄 Credit Management',
          value: 'Server administrators can purchase additional credits on the Bri website. They can also enable or disable the credit system using the `/server-settings` command.',
          inline: false
        }
      )
      .setFooter({ 
        text: 'Visit our website for more information and to purchase credits.'
      });
    
    return interaction.editReply({ embeds: [infoEmbed] });
  } catch (error) {
    logger.error('Error in handleCreditsInfo:', error);
    return interaction.editReply("Sorry, I couldn't retrieve the credit system information right now.");
  }
}

/**
 * Format feature type for display
 * @param {string} featureType - The feature type
 * @returns {string} - Formatted feature type
 */
function formatFeatureType(featureType) {
  if (!featureType) return 'Unknown';
  
  // Convert SNAKE_CASE to Title Case with spaces
  return featureType
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Create a visual progress bar
 * @param {number} percent - Percentage (0-100)
 * @param {number} length - Length of the progress bar
 * @returns {string} - ASCII progress bar
 */
function createProgressBar(percent, length) {
  const filledLength = Math.round(length * (percent / 100));
  const emptyLength = length - filledLength;
  
  // Using emoji for a more visually appealing bar
  const filled = '🟦'.repeat(filledLength);
  const empty = '⬜'.repeat(emptyLength);
  
  return filled + empty;
}