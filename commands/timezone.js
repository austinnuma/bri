// commands/timezone.js
import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { setUserTimezone, getUserTimezone } from '../utils/timeSystem.js';

// List of common timezones for the autocomplete option
const COMMON_TIMEZONES = [
  "America/New_York",       // Eastern Time
  "America/Chicago",        // Central Time
  "America/Denver",         // Mountain Time
  "America/Los_Angeles",    // Pacific Time
  "America/Anchorage",      // Alaska Time
  "Pacific/Honolulu",       // Hawaii Time
  "America/Phoenix",        // Arizona (no DST)
  "America/Toronto",        // Eastern Canada
  "America/Vancouver",      // Pacific Canada
  "Europe/London",          // UK
  "Europe/Paris",           // Central Europe
  "Europe/Berlin",          // Germany
  "Europe/Moscow",          // Russia
  "Asia/Bangkok",            // Thailand
  "Asia/Tokyo",             // Japan
  "Asia/Shanghai",          // China
  "Asia/Kolkata",           // India
  "Australia/Sydney",       // Eastern Australia
  "Australia/Perth",        // Western Australia
  "Pacific/Auckland"        // New Zealand
];

// Helper for timezone validation
function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
}

export const data = new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Set or view your timezone for events and reminders')
    .addSubcommand(subcommand =>
        subcommand
            .setName('set')
            .setDescription('Set your timezone')
            .addStringOption(option =>
                option
                    .setName('timezone')
                    .setDescription('Your timezone (IANA format, e.g., America/New_York)')
                    .setRequired(true)
                    .setAutocomplete(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('view')
            .setDescription('View your current timezone'));

export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    let filtered = COMMON_TIMEZONES;
    
    if (focusedValue) {
        filtered = COMMON_TIMEZONES.filter(tz => 
            tz.toLowerCase().includes(focusedValue)
        );
    }
    
    await interaction.respond(
        filtered.map(tz => ({ name: tz, value: tz })).slice(0, 25)
    );
}

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'set') {
        await handleSetTimezone(interaction);
    } else if (subcommand === 'view') {
        await handleViewTimezone(interaction);
    }
}

/**
 * Handle the 'set' subcommand
 */
async function handleSetTimezone(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const timezone = interaction.options.getString('timezone');
        
        // Validate the timezone
        if (!isValidTimezone(timezone)) {
            return interaction.editReply({
                content: "That doesn't seem to be a valid timezone. Please use a standard IANA timezone format (e.g., 'America/New_York').",
                ephemeral: true
            });
        }
        
        // Set the timezone
        const success = await setUserTimezone(interaction.user.id, timezone);
        
        if (!success) {
            return interaction.editReply({
                content: "Sorry, I couldn't set your timezone. Please try again later.",
                ephemeral: true
            });
        }
        
        // Get current time in their timezone
        const now = new Date();
        const localTime = now.toLocaleString('en-US', { timeZone: timezone });
        
        return interaction.editReply({
            content: `✅ Your timezone has been set to **${timezone}**!\nYour local time is now: **${localTime}**`,
            ephemeral: true
        });
    } catch (error) {
        logger.error('Error in timezone set command:', error);
        return interaction.editReply({
            content: "Sorry, something went wrong. Please try again later.",
            ephemeral: true
        });
    }
}

/**
 * Handle the 'view' subcommand
 */
async function handleViewTimezone(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        // Get the user's timezone
        const timezone = await getUserTimezone(interaction.user.id);
        
        // Get current time in their timezone
        const now = new Date();
        const localTime = now.toLocaleString('en-US', { timeZone: timezone });
        
        return interaction.editReply({
            content: `Your timezone is set to: **${timezone}**\nYour local time is: **${localTime}**`,
            ephemeral: true
        });
    } catch (error) {
        logger.error('Error in timezone view command:', error);
        return interaction.editReply({
            content: "Sorry, something went wrong. Please try again later.",
            ephemeral: true
        });
    }
}