// commands/remind.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { createEvent, getUserTimezone, parseTimeSpecification, EVENT_TYPES, REMINDER_TIMES } from '../utils/timeSystem.js';

// Import credit management functions
import { hasEnoughCredits, useCredits, CREDIT_COSTS, getServerCredits } from '../utils/creditManager.js';
import { getServerConfig } from '../utils/serverConfigManager.js';
// Import subscription management functions
import { isFeatureSubscribed, SUBSCRIPTION_FEATURES } from '../utils/subscriptionManager.js';

export const data = new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Have Bri remind you about something')
    .addStringOption(option =>
        option
            .setName('what')
            .setDescription('What do you want to be reminded about?')
            .setRequired(true))
    .addStringOption(option =>
        option
            .setName('when')
            .setDescription('When should I remind you? (e.g., "tomorrow at 3pm", "in 2 hours")')
            .setRequired(true))
    .addStringOption(option =>
        option
            .setName('reminder_time')
            .setDescription('When to send the reminder')
            .setRequired(false)
            .addChoices(
                { name: 'At the exact time', value: 'exact' },
                { name: '5 minutes before', value: '5min' },
                { name: '30 minutes before', value: '30min' },
                { name: '1 hour before', value: '1hour' },
                { name: '1 day before', value: '1day' }
            ));

export async function execute(interaction) {
    await interaction.deferReply();
    
    try {
        const what = interaction.options.getString('what');
        const when = interaction.options.getString('when');
        const reminderTime = interaction.options.getString('reminder_time') || 'exact';
        
        // Get guild ID for credit checks
        const guildId = interaction.guildId;
        
        // Check if this server has credits enabled
        const serverConfig = await getServerConfig(guildId);
        const creditsEnabled = serverConfig?.credits_enabled === true;
        
        // Check if user has unlimited reminders with subscription
        const hasUnlimitedReminders = await isFeatureSubscribed(guildId, SUBSCRIPTION_FEATURES.UNLIMITED_REMINDERS);
        
        // If credits are enabled and user doesn't have unlimited reminders, check if there are enough credits
        if (creditsEnabled && !hasUnlimitedReminders) {
            const operationType = 'REMINDER_CREATION';
            
            // Check if server has enough credits
            const hasCredits = await hasEnoughCredits(guildId, operationType);
            
            if (!hasCredits) {
                // Get current credit information for a more helpful message
                const credits = await getServerCredits(guildId);
                
                const creditsEmbed = new EmbedBuilder()
                    .setTitle('Insufficient Credits')
                    .setDescription(`This server doesn't have enough credits to create a reminder.`)
                    .setColor(0xFF0000)
                    .addFields(
                        {
                            name: '💰 Available Credits',
                            value: `${credits?.remaining_credits || 0} credits`,
                            inline: true
                        },
                        {
                            name: '💸 Required Credits',
                            value: `${CREDIT_COSTS[operationType]} credits`,
                            inline: true
                        },
                        {
                            name: '📊 Credit Cost',
                            value: `Creating a reminder costs ${CREDIT_COSTS[operationType]} credits.`,
                            inline: true
                        }
                    )
                    .setFooter({ 
                        text: 'Purchase more credits or subscribe to Premium for unlimited reminders!'
                    });
                    
                return interaction.editReply({ embeds: [creditsEmbed] });
            }
        }
        
        // Get the user's timezone
        const timezone = await getUserTimezone(interaction.user.id);
        
        // Parse the time specification
        const parsedDate = await parseTimeWithAI(when, timezone);
        
        if (!parsedDate) {
            return interaction.editReply("Sorry, I couldn't understand when you want to be reminded. Please try using a clearer time format like 'tomorrow at 3pm' or 'March 15 at 14:00'.");
        }
        
        // Calculate reminder minutes based on selection
        let reminderMinutes = [];
        
        switch (reminderTime) {
            case 'exact':
                reminderMinutes = [0]; // At the exact time
                break;
            case '5min':
                reminderMinutes = [5]; // 5 minutes before
                break;
            case '30min':
                reminderMinutes = [30]; // 30 minutes before
                break;
            case '1hour':
                reminderMinutes = [60]; // 1 hour before
                break;
            case '1day':
                reminderMinutes = [1440]; // 1 day before
                break;
            default:
                reminderMinutes = [0]; // Default to exact time
        }
        
        // Create the reminder event
        const event = await createEvent({
            user_id: interaction.user.id,
            event_type: EVENT_TYPES.REMINDER,
            title: what,
            description: `Reminder set by ${interaction.user.tag} on ${new Date().toLocaleDateString()}`,
            event_date: parsedDate.toISOString(),
            reminder_minutes: reminderMinutes,
            channel_id: interaction.channelId, // Store the channel where the reminder was set
            guild_id: interaction.guildId // Store the guild where the reminder was set
        });
        
        if (!event) {
            return interaction.editReply("Sorry, I couldn't create that reminder. Please try again.");
        }
        
        // If credits are enabled and user doesn't have unlimited reminders, use credits
        if (creditsEnabled && !hasUnlimitedReminders) {
            await useCredits(guildId, 'REMINDER_CREATION');
            logger.info(`Used ${CREDIT_COSTS['REMINDER_CREATION']} credits for reminder creation in server ${guildId}`);
        } else if (hasUnlimitedReminders) {
            logger.info(`Created reminder in server ${guildId} with Premium subscription (no credits used)`);
        }
        
        // Format the reminder time in the user's timezone
        const formattedTime = parsedDate.toLocaleString('en-US', { 
            timeZone: timezone,
            dateStyle: 'full',
            timeStyle: 'short'
        });
        
        // Respond with confirmation
        return interaction.editReply({
            content: `✅ I'll remind you about **${what}** on **${formattedTime}**!`
        });
    } catch (error) {
        logger.error('Error in remind command:', error);
        return interaction.editReply("Sorry, something went wrong setting your reminder. Please try again with a clearer time description.");
    }
}

/**
 * Parse a time specification using AI assistance
 * @param {string} timeSpec - Time specification from user
 * @param {string} timezone - User's timezone
 * @returns {Promise<Date|null>} - Parsed date or null if invalid
 */
async function parseTimeWithAI(timeSpec, timezone) {
    try {
        // First try the built-in parser
        const directParsed = parseTimeSpecification(timeSpec, '', timezone);
        if (directParsed && !isNaN(directParsed.getTime())) {
            return directParsed;
        }
        
        // If that fails, use the AI parser
        const { openai } = await import('../services/combinedServices.js');
        
        // Get current time in the user's timezone for better context
        const now = new Date();
        const userTimeNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        
        const prompt = `
Parse this time/date specification into a structured format.
Current time: ${userTimeNow.toISOString()}
User's timezone: ${timezone}

Time specification: "${timeSpec}"

Return ONLY a JSON object with these fields:
{
  "parsedOk": true/false,
  "year": YYYY,   // e.g., 2025
  "month": MM,    // 1-12
  "day": DD,      // 1-31
  "hour": HH,     // 0-23 (24-hour format)
  "minute": MM,   // 0-59
  "second": 0     // Always 0
}

If it's a relative time like "in 10 minutes" or "in 3 hours", calculate the exact time.
If you cannot parse the time reliably, set parsedOk to false.
`;

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { 
                    role: "system", 
                    content: "You are a specialized date/time parsing assistant that converts natural language time specifications into structured datetime objects."
                },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            max_tokens: 200,
        });
        
        const result = JSON.parse(completion.choices[0].message.content);
        
        if (!result.parsedOk) {
            return null;
        }
        
        // Create date in correct format
        // First create a date string in ISO format
        const dateString = `${result.year}-${String(result.month).padStart(2, '0')}-${String(result.day).padStart(2, '0')}T${String(result.hour).padStart(2, '0')}:${String(result.minute).padStart(2, '0')}:00`;
        
        // Then create a date object specified as being in the user's timezone
        const options = { timeZone: timezone };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        
        // Create the date object
        const date = new Date(dateString);
        
        // Convert the date to UTC for storage
        // Get the timezone offset in minutes
        const tzOffset = new Date().getTimezoneOffset();
        
        // Create a date string that includes timezone info
        const dateInTz = new Date(date.getTime() - (tzOffset * 60000));
        
        return dateInTz;
    } catch (error) {
        logger.error("Error parsing time with AI:", error);
        return null;
    }
}