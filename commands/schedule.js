// commands/schedule.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { createScheduledMessage, getUserTimezone } from '../utils/timeSystem.js';
import { openai } from '../services/combinedServices.js';

export const data = new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedule recurring messages from Bri')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // Only server managers can use this
    .addSubcommand(subcommand =>
        subcommand
            .setName('daily')
            .setDescription('Schedule a daily message')
            .addStringOption(option =>
                option
                    .setName('type')
                    .setDescription('What type of daily message?')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Good Morning', value: 'morning' },
                        { name: 'Good Night', value: 'night' },
                        { name: 'Daily Quote', value: 'quote' },
                        { name: 'Custom', value: 'custom' }
                    ))
            .addStringOption(option =>
                option
                    .setName('time')
                    .setDescription('What time? (e.g., "8:00", "15:30")')
                    .setRequired(true))
            .addStringOption(option =>
                option
                    .setName('custom_message')
                    .setDescription('Your custom message (only if type is Custom)')
                    .setRequired(false))
            .addChannelOption(option =>
                option
                    .setName('channel')
                    .setDescription('Which channel to post in (defaults to current channel)')
                    .setRequired(false)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('weekly')
            .setDescription('Schedule a weekly message')
            .addStringOption(option =>
                option
                    .setName('day')
                    .setDescription('Which day of the week?')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Monday', value: 'monday' },
                        { name: 'Tuesday', value: 'tuesday' },
                        { name: 'Wednesday', value: 'wednesday' },
                        { name: 'Thursday', value: 'thursday' },
                        { name: 'Friday', value: 'friday' },
                        { name: 'Saturday', value: 'saturday' },
                        { name: 'Sunday', value: 'sunday' }
                    ))
            .addStringOption(option =>
                option
                    .setName('time')
                    .setDescription('What time? (e.g., "8:00", "15:30")')
                    .setRequired(true))
            .addStringOption(option =>
                option
                    .setName('message')
                    .setDescription('What should Bri say?')
                    .setRequired(true))
            .addChannelOption(option =>
                option
                    .setName('channel')
                    .setDescription('Which channel to post in (defaults to current channel)')
                    .setRequired(false)));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'daily') {
            await handleDailySchedule(interaction);
        } else if (subcommand === 'weekly') {
            await handleWeeklySchedule(interaction);
        }
    } catch (error) {
        logger.error('Error in schedule command:', error);
        return interaction.editReply({
            content: "Sorry, something went wrong setting up your scheduled message. Please try again.",
            ephemeral: true
        });
    }
}

/**
 * Handle the 'daily' subcommand
 */
async function handleDailySchedule(interaction) {
    try {
        const messageType = interaction.options.getString('type');
        const timeString = interaction.options.getString('time');
        const customMessage = interaction.options.getString('custom_message');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        
        // Validate the channel is a text channel
        if (!channel.isTextBased()) {
            return interaction.editReply({
                content: "I can only send scheduled messages to text channels.",
                ephemeral: true
            });
        }
        
        // Parse the time (HH:MM)
        const [hours, minutes] = timeString.split(':').map(part => parseInt(part.trim()));
        
        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return interaction.editReply({
                content: "Please provide a valid time in 24-hour format (e.g., '8:00' or '15:30').",
                ephemeral: true
            });
        }
        
        // Get the timezone for the guild/server
        const guildTimezone = await getGuildTimezone(interaction.guildId) || 'America/New_York';
        
        // Create cron schedule for daily at the specified time
        const cronSchedule = `${minutes} ${hours} * * *`;
        
        // Generate message content based on type
        let messageContent;
        
        switch (messageType) {
            case 'morning':
                messageContent = await generateGreeting('morning');
                break;
            case 'night':
                messageContent = await generateGreeting('night');
                break;
            case 'quote':
                messageContent = await generateGreeting('quote');
                break;
            case 'custom':
                if (!customMessage) {
                    return interaction.editReply({
                        content: "Please provide a custom message for your scheduled message.",
                        ephemeral: true
                    });
                }
                messageContent = customMessage;
                break;
            default:
                return interaction.editReply({
                    content: "Please select a valid message type.",
                    ephemeral: true
                });
        }
        
        // Create the scheduled message
        const scheduled = await createScheduledMessage({
            channel_id: channel.id,
            message_type: messageType,
            message_content: messageContent,
            cron_schedule: cronSchedule,
            timezone: guildTimezone
        });
        
        if (!scheduled) {
            return interaction.editReply({
                content: "Sorry, I couldn't create that scheduled message. Please try again.",
                ephemeral: true
            });
        }
        
        // Format time for display
        const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        
        return interaction.editReply({
            content: `✅ I'll post a **${messageType}** message in ${channel} every day at **${formattedTime}** (${guildTimezone}).`,
            ephemeral: true
        });
    } catch (error) {
        logger.error('Error in daily schedule command:', error);
        return interaction.editReply({
            content: "Sorry, something went wrong. Please try again.",
            ephemeral: true
        });
    }
}

/**
 * Handle the 'weekly' subcommand
 */
async function handleWeeklySchedule(interaction) {
    try {
        const day = interaction.options.getString('day');
        const timeString = interaction.options.getString('time');
        const message = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        
        // Validate the channel is a text channel
        if (!channel.isTextBased()) {
            return interaction.editReply({
                content: "I can only send scheduled messages to text channels.",
                ephemeral: true
            });
        }
        
        // Parse the time (HH:MM)
        const [hours, minutes] = timeString.split(':').map(part => parseInt(part.trim()));
        
        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return interaction.editReply({
                content: "Please provide a valid time in 24-hour format (e.g., '8:00' or '15:30').",
                ephemeral: true
            });
        }
        
        // Get the timezone for the guild/server
        const guildTimezone = await getGuildTimezone(interaction.guildId) || 'America/New_York';
        
        // Convert day to day number (0-6, Sunday-Saturday)
        const dayMap = {
            'sunday': 0,
            'monday': 1,
            'tuesday': 2,
            'wednesday': 3,
            'thursday': 4,
            'friday': 5,
            'saturday': 6
        };
        
        const dayNumber = dayMap[day.toLowerCase()];
        
        // Create cron schedule for weekly at the specified day and time
        const cronSchedule = `${minutes} ${hours} * * ${dayNumber}`;
        
        // Create the scheduled message
        const scheduled = await createScheduledMessage({
            channel_id: channel.id,
            message_type: 'weekly_custom',
            message_content: message,
            cron_schedule: cronSchedule,
            timezone: guildTimezone
        });
        
        if (!scheduled) {
            return interaction.editReply({
                content: "Sorry, I couldn't create that scheduled message. Please try again.",
                ephemeral: true
            });
        }
        
        // Format time for display
        const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        
        return interaction.editReply({
            content: `✅ I'll post your custom message in ${channel} every **${day}** at **${formattedTime}** (${guildTimezone}).`,
            ephemeral: true
        });
    } catch (error) {
        logger.error('Error in weekly schedule command:', error);
        return interaction.editReply({
            content: "Sorry, something went wrong. Please try again.",
            ephemeral: true
        });
    }
}

/**
 * Get the timezone for a guild
 * Uses the guild owner's timezone as the guild timezone
 * @param {string} guildId - Guild ID
 * @returns {Promise<string>} - Guild timezone
 */
async function getGuildTimezone(guildId) {
    try {
        // Use interaction member's timezone for now
        // In a more complex system, you could store guild timezone separately
        const guild = await interaction.client.guilds.fetch(guildId);
        if (!guild) return 'America/New_York';
        
        const owner = await guild.fetchOwner();
        if (!owner) return 'America/New_York';
        
        const ownerTimezone = await getUserTimezone(owner.id);
        return ownerTimezone;
    } catch (error) {
        logger.error(`Error getting guild timezone for ${guildId}:`, error);
        return 'America/New_York';
    }
}

/**
 * Generate a greeting message based on type
 * @param {string} type - Type of greeting (morning, night, quote)
 * @returns {Promise<string>} - Generated greeting
 */
async function generateGreeting(type) {
    try {
        let prompt;
        
        switch (type) {
            case 'morning':
                prompt = `
Generate a cheerful good morning message as Bri, a 14-year-old AI assistant.
Make it energetic, positive, and friendly - the way a 14-year-old would greet someone in the morning.
Include a positive wish or encouragement for the day ahead.
Keep it under 2 sentences and add appropriate emoji.
`;
                break;
            case 'night':
                prompt = `
Generate a sweet good night message as Bri, a 14-year-old AI assistant.
Make it warm, gentle, and friendly - the way a 14-year-old would say goodnight.
Include a wish for pleasant dreams or rest.
Keep it under 2 sentences and add appropriate emoji.
`;
                break;
            case 'quote':
                prompt = `
Generate an inspirational or motivational quote message as Bri, a 14-year-old AI assistant.
Choose a short, appropriate quote that would resonate with a wide audience.
Add a brief comment from Bri about why she likes this quote or what it means.
Format it with the quote in bold or quotes, followed by Bri's comment.
Add appropriate emoji.
`;
                break;
            default:
                return "Hello everyone! Hope you're having a great day! 😊";
        }
        
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are Bri, a friendly AI assistant with the personality of a cheerful 10-year-old girl." },
                { role: "user", content: prompt }
            ],
            max_tokens: 150,
        });
        
        return completion.choices[0].message.content.trim();
    } catch (error) {
        logger.error(`Error generating ${type} greeting:`, error);
        
        // Fallback greetings
        switch (type) {
            case 'morning':
                return "Good morning everyone! Hope you all have an amazing day today! 🌞";
            case 'night':
                return "Good night everyone! Sweet dreams and sleep tight! 🌙✨";
            case 'quote':
                return "\"Believe you can and you're halfway there.\" - This quote always makes me feel I can do anything! 💫";
            default:
                return "Hello everyone! Hope you're having a great day! 😊";
        }
    }
}