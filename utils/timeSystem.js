// timeSystem.js - Time awareness and calendar system for Bri
import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';
import { openai } from '../services/combinedServices.js';
import { supabase } from '../services/combinedServices.js';
import { getServerConfig } from './serverConfigManager.js';
import { getCharacterSheetForPrompt } from './userCharacterSheet.js';
import { 
  getActivePoliticsGuilds, 
  isPoliticsSummaryDue, 
  generateAndSendPoliticsSummary, 
  setupPoliticsTables 
} from '../services/newsService.js';

let discordClientRef = null;

// Separate Supabase client
//const dedicatedDb = createClient(
//    process.env.SUPABASE_URL,
//    process.env.SUPABASE_KEY
//  );

// Default timezone (fallback when user hasn't set one)
const DEFAULT_TIMEZONE = 'America/Chicago';

// Table name constants - modify these to match your actual table names
const TABLE_NAMES = {
    USER_TIMEZONE: 'user_timezones',
    EVENTS: 'bri_events',
    SCHEDULED_MESSAGES: 'bri_scheduled_messages',
    MESSAGE_COLLECTIONS: 'bri_message_collections'
  };
  
// Static core prompt for AI interactions
const STATIC_CORE_PROMPT = `You are Bri, a 14-year-old AI assistant. You are friendly, helpful, and empathetic. Your responses should be appropriate for a teenage girl with a casual, relatable tone. Use age-appropriate language, occasional emojis when relevant, and show enthusiasm for topics the user might be interested in.`;

// Event types
export const EVENT_TYPES = {
  BIRTHDAY: 'birthday',
  APPOINTMENT: 'appointment',
  REMINDER: 'reminder',
  FOLLOW_UP: 'follow_up',
  CUSTOM: 'custom'
};

// Reminder timing (in minutes)
export const REMINDER_TIMES = {
  IMMEDIATE: 0,
  HOUR_BEFORE: 60,
  DAY_BEFORE: 1440, // 24 hours
  WEEK_BEFORE: 10080 // 7 days
};

/**
 * Initialize the time system.
 * Creates necessary database tables if they don't exist.
 */
export async function initializeTimeSystem(client) {
    try {
      logger.info("Initializing time system...");
      
      // Store client reference separately, don't modify global state
      if (client) {
        discordClientRef = client;
        logger.info("Discord client reference stored in timeSystem");
      }
      
      // Check if the user_timezones table exists
      const { error: timezoneCheckError } = await supabase
        .from('user_timezones')
        .select('user_id')
        .limit(1);
        
      // Create timezone table if it doesn't exist
      if (timezoneCheckError && timezoneCheckError.code === '42P01') {
        logger.info("The 'user_timezones' table doesn't exist.");
      } else {
          logger.info("The user_timezones table exists.");
      }
      
      // Check if the bri_events table exists
      const { error: eventsCheckError } = await supabase
        .from('bri_events')
        .select('id')
        .limit(1);
        
      // Create events table if it doesn't exist
      if (eventsCheckError && eventsCheckError.code === '42P01') {
        logger.info("The 'bri_events' table doesn't exist.");
      } else {
          logger.info("The bri_events table exists.");
      }
      
      // Check if the bri_scheduled_messages table exists
      const { error: scheduledCheckError } = await supabase
        .from('bri_scheduled_messages')
        .select('id')
        .limit(1);
        
      // Create scheduled messages table if it doesn't exist
      if (scheduledCheckError && scheduledCheckError.code === '42P01') {
        logger.info("The 'bri_scheduled_messages' table doesn't exist.");
      } else {
          logger.info("The bri_scheduled_messages table exists.");
      }
      
      logger.info("Time system initialization complete.");
    } catch (error) {
      logger.error("Error initializing time system:", error);
      throw error;
    }
  }

/**
 * Gets a user's timezone
 * @param {string} userId - The user's ID
 * @returns {Promise<string>} - The user's timezone
 */
export async function getUserTimezone(userId) {
  try {
    // Get the user's timezone from the database
    const { data, error } = await supabase
      .from('user_timezones')
      .select('timezone')
      .eq('user_id', userId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        return DEFAULT_TIMEZONE;
      }
      
      logger.error(`Error fetching timezone for user ${userId}:`, error);
      return DEFAULT_TIMEZONE;
    }
    
    return data.timezone;
  } catch (error) {
    logger.error(`Error in getUserTimezone for user ${userId}:`, error);
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Sets a user's timezone
 * @param {string} userId - The user's ID
 * @param {string} timezone - The IANA timezone string
 * @returns {Promise<boolean>} - Success status
 */
export async function setUserTimezone(userId, timezone) {
  try {
    // Validate the timezone
    if (!isValidTimezone(timezone)) {
      logger.warn(`Invalid timezone provided for user ${userId}: ${timezone}`);
      return false;
    }
    
    // Upsert the user's timezone
    const { error } = await supabase
      .from('user_timezones')
      .upsert({
        user_id: userId,
        timezone: timezone,
        updated_at: new Date().toISOString()
      });
      
    if (error) {
      logger.error(`Error setting timezone for user ${userId}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in setUserTimezone for user ${userId}:`, error);
    return false;
  }
}

/**
 * Validates if a timezone string is a valid IANA timezone
 * @param {string} timezone - The timezone string to validate
 * @returns {boolean} - Whether the timezone is valid
 */
function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Creates a new event
 * @param {Object} eventData - Event data
 * @returns {Promise<Object|null>} - Created event or null
 */
export async function createEvent(eventData) {
  try {
    // Validate required fields
    if (!eventData.user_id || !eventData.event_type || !eventData.title || !eventData.event_date) {
      logger.error("Missing required fields for event creation:", eventData);
      return null;
    }
    
    // Ensure event_date is a valid date
    const eventDate = new Date(eventData.event_date);
    if (isNaN(eventDate.getTime())) {
      logger.error("Invalid event date:", eventData.event_date);
      return null;
    }
    
    // Create the event
    const { data, error } = await supabase
      .from('bri_events')
      .insert({
        user_id: eventData.user_id,
        event_type: eventData.event_type,
        title: eventData.title,
        description: eventData.description || null,
        event_date: eventDate.toISOString(),
        end_date: eventData.end_date ? new Date(eventData.end_date).toISOString() : null,
        reminder_minutes: eventData.reminder_minutes || [REMINDER_TIMES.HOUR_BEFORE],
        recurrence: eventData.recurrence || null,
        recurrence_params: eventData.recurrence_params || null,
        channel_id: eventData.channel_id || null
      })
      .select()
      .single();
      
    if (error) {
      logger.error("Error creating event:", error);
      return null;
    }
    
    logger.info(`Created new event: ${data.title} for user ${data.user_id}`);
    return data;
  } catch (error) {
    logger.error("Error in createEvent:", error);
    return null;
  }
}

/**
 * Updates an existing event
 * @param {number} eventId - Event ID
 * @param {Object} eventData - Updated event data
 * @returns {Promise<Object|null>} - Updated event or null
 */
export async function updateEvent(eventId, eventData) {
  try {
    // Create the event
    const { data, error } = await supabase
      .from('bri_events')
      .update(eventData)
      .eq('id', eventId)
      .select()
      .single();
      
    if (error) {
      logger.error(`Error updating event ${eventId}:`, error);
      return null;
    }
    
    logger.info(`Updated event ${eventId}: ${data.title}`);
    return data;
  } catch (error) {
    logger.error(`Error in updateEvent for event ${eventId}:`, error);
    return null;
  }
}

/**
 * Deletes an event
 * @param {number} eventId - Event ID
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteEvent(eventId) {
  try {
    const { error } = await supabase
      .from('bri_events')
      .delete()
      .eq('id', eventId);
      
    if (error) {
      logger.error(`Error deleting event ${eventId}:`, error);
      return false;
    }
    
    logger.info(`Deleted event ${eventId}`);
    return true;
  } catch (error) {
    logger.error(`Error in deleteEvent for event ${eventId}:`, error);
    return false;
  }
}

/**
 * Gets events for a user
 * @param {string} userId - User ID
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} - User events
 */
export async function getUserEvents(userId, options = {}) {
  try {
    let query = supabase
      .from('bri_events')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);
      
    // Apply date range filter if provided
    if (options.startDate) {
      query = query.gte('event_date', new Date(options.startDate).toISOString());
    }
    
    if (options.endDate) {
      query = query.lte('event_date', new Date(options.endDate).toISOString());
    }
    
    // Apply event type filter if provided
    if (options.eventType) {
      query = query.eq('event_type', options.eventType);
    }
    
    // Order by date (default ascending)
    const ascending = options.ascending !== undefined ? options.ascending : true;
    query = query.order('event_date', { ascending });
    
    // Apply limit if provided
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    const { data, error } = await query;
      
    if (error) {
      logger.error(`Error fetching events for user ${userId}:`, error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error(`Error in getUserEvents for user ${userId}:`, error);
    return [];
  }
}

/**
 * Gets upcoming events for all users
 * @param {number} minutes - Minutes in the future to check
 * @returns {Promise<Array>} - Upcoming events
 */
export async function getUpcomingEvents(minutes = 60) {
  try {
    const now = new Date();
    const future = new Date(now.getTime() + minutes * 60 * 1000);
    
    const { data, error } = await supabase
      .from('bri_events')
      .select('*')
      .eq('is_active', true)
      .gte('event_date', now.toISOString())
      .lt('event_date', future.toISOString());
      
    if (error) {
      logger.error(`Error fetching upcoming events (${minutes} minutes):`, error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error(`Error in getUpcomingEvents (${minutes} minutes):`, error);
    return [];
  }
}

/**
 * Gets events with pending reminders
 * @returns {Promise<Array>} - Events with pending reminders
 */
export async function getEventsWithPendingReminders() {
  try {
    const now = new Date();
    
    // Use a custom query to find events with pending reminders
    // This is a bit complex because we need to check each reminder time
    const { data, error } = await supabase.rpc('get_events_with_pending_reminders', {
      p_current_time: now.toISOString()
    });
    
    if (error) {
      logger.error("Error fetching events with pending reminders:", error);
      
      // Fallback implementation if RPC fails
      return await fallbackGetPendingReminders(now);
    }
    
    return data || [];
  } catch (error) {
    logger.error("Error in getEventsWithPendingReminders:", error);
    return [];
  }
}

/**
 * Fallback implementation for getting events with pending reminders
 * @param {Date} now - Current time
 * @returns {Promise<Array>} - Events with pending reminders
 */
async function fallbackGetPendingReminders(now) {
  try {
    // This is a simplified fallback that's not as efficient as the RPC
    // It gets all upcoming events and filters them in JavaScript
    
    // Get events in the next 24 hours
    const { data, error } = await supabase
      .from('bri_events')
      .select('*')
      .eq('is_active', true)
      .gte('event_date', now.toISOString())
      .lt('event_date', new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString());
      
    if (error) {
      logger.error("Error in fallback reminder check:", error);
      return [];
    }
    
    if (!data || data.length === 0) {
      return [];
    }
    
    // Filter events with pending reminders
    const eventsWithReminders = [];
    
    for (const event of data) {
      if (!event.reminder_minutes || event.reminder_minutes.length === 0) {
        continue;
      }
      
      const eventTime = new Date(event.event_date).getTime();
      
      for (const minutes of event.reminder_minutes) {
        const reminderTime = eventTime - (minutes * 60 * 1000);
        const reminderDate = new Date(reminderTime);
        
        // Check if the reminder is due (between now and 5 minutes ago)
        if (reminderDate <= now && reminderDate >= new Date(now.getTime() - 5 * 60 * 1000)) {
          // Check if we haven't already sent this reminder
          if (!event.last_reminded_at || new Date(event.last_reminded_at) < reminderDate) {
            eventsWithReminders.push({
              ...event,
              current_reminder_minutes: minutes
            });
            break; // Only add the event once
          }
        }
      }
    }
    
    return eventsWithReminders;
  } catch (error) {
    logger.error("Error in fallbackGetPendingReminders:", error);
    return [];
  }
}

/**
 * Marks a reminder as sent
 * @param {number} eventId - Event ID
 * @returns {Promise<boolean>} - Success status
 */
export async function markReminderSent(eventId) {
  try {
    const { error } = await supabase
      .from('bri_events')
      .update({
        last_reminded_at: new Date().toISOString()
      })
      .eq('id', eventId);
      
    if (error) {
      logger.error(`Error marking reminder sent for event ${eventId}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in markReminderSent for event ${eventId}:`, error);
    return false;
  }
}

/**
 * Creates a scheduled message
 * @param {Object} messageData - Scheduled message data
 * @returns {Promise<Object|null>} - Created scheduled message or null
 */
export async function createScheduledMessage(messageData) {
  try {
    // Validate required fields
    if (!messageData.channel_id || !messageData.message_type || 
        !messageData.cron_schedule) {
      logger.error("Missing required fields for scheduled message creation:", messageData);
      return null;
    }
    
    // Check if this is a dynamic message
    const isDynamic = messageData.is_dynamic === true;
    
    // Check if this message uses a collection
    const isCollection = Array.isArray(messageData.message_collection) && 
                        messageData.message_collection.length > 0;
    
    // Create the scheduled message
    const { data, error } = await supabase
      .from('bri_scheduled_messages')
      .insert({
        channel_id: messageData.channel_id,
        message_type: messageData.message_type,
        message_content: !isCollection ? messageData.message_content : null,
        cron_schedule: messageData.cron_schedule,
        timezone: messageData.timezone || DEFAULT_TIMEZONE,
        is_active: true,
        guild_id: messageData.guild_id,
        is_dynamic: isDynamic,
        using_collection: isCollection
      })
      .select()
      .single();
      
    if (error) {
      logger.error("Error creating scheduled message:", error);
      return null;
    }
    
    // If this message uses a collection, store the messages in a separate table
    if (isCollection) {
      const messageCollection = messageData.message_collection.map(message => ({
        message_id: data.id,
        content: message
      }));
      
      const { error: collectionError } = await supabase
        .from(TABLE_NAMES.MESSAGE_COLLECTIONS)
        .insert(messageCollection);
        
      if (collectionError) {
        logger.error("Error creating message collection:", collectionError);
        
        // Clean up the scheduled message since collection failed
        await supabase
          .from(TABLE_NAMES.SCHEDULED_MESSAGES)
          .delete()
          .eq('id', data.id);
          
        return null;
      }
      
      logger.info(`Added ${messageCollection.length} messages to collection for scheduled message ${data.id}`);
    }
    
    logger.info(`Created new scheduled message in channel ${data.channel_id}`);
    return data;
  } catch (error) {
    logger.error("Error in createScheduledMessage:", error);
    return null;
  }
}

/**
 * Gets scheduled messages that are due to be sent
 * @returns {Promise<Array>} - Due scheduled messages
 */
export async function getDueScheduledMessages() {
  try {
    // Get all active scheduled messages
    const { data, error } = await supabase
      .from('bri_scheduled_messages')
      .select('*')
      .eq('is_active', true);
      
    if (error) {
      logger.error("Error fetching scheduled messages:", error);
      return [];
    }
    
    if (!data || data.length === 0) {
      return [];
    }
    
    // Check which messages are due based on their cron schedules
    const now = new Date();
    const dueMessages = [];
    
    for (const message of data) {
      if (isCronScheduleDue(message.cron_schedule, message.timezone, message.last_sent_at)) {
        dueMessages.push(message);
      }
    }
    
    return dueMessages;
  } catch (error) {
    logger.error("Error in getDueScheduledMessages:", error);
    return [];
  }
}

/**
 * Checks if a cron schedule is due to run
 * @param {string} cronExpression - Cron expression
 * @param {string} timezone - IANA timezone
 * @param {string|null} lastRunTime - ISO timestamp of last run
 * @returns {boolean} - Whether the schedule is due
 */
function isCronScheduleDue(cronExpression, timezone, lastRunTime) {
  try {
    // Parse the cron expression (simple implementation)
    const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.split(' ');
    
    // Get current time in the specified timezone
    const now = new Date();
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    
    const currentMinute = tzNow.getMinutes();
    const currentHour = tzNow.getHours();
    const currentDayOfMonth = tzNow.getDate();
    const currentMonth = tzNow.getMonth() + 1; // 1-12
    const currentDayOfWeek = tzNow.getDay(); // 0-6 (Sunday-Saturday)
    
    // Check if the current time matches the cron expression
    const minuteMatch = minute === '*' || minute.split(',').includes(String(currentMinute));
    const hourMatch = hour === '*' || hour.split(',').includes(String(currentHour));
    const dayOfMonthMatch = dayOfMonth === '*' || dayOfMonth.split(',').includes(String(currentDayOfMonth));
    const monthMatch = month === '*' || month.split(',').includes(String(currentMonth));
    const dayOfWeekMatch = dayOfWeek === '*' || dayOfWeek.split(',').includes(String(currentDayOfWeek));
    
    const isTimeMatch = minuteMatch && hourMatch && dayOfMonthMatch && monthMatch && dayOfWeekMatch;
    
    if (!isTimeMatch) {
      return false;
    }
    
    // Check if it's already been run recently
    if (lastRunTime) {
      const lastRun = new Date(lastRunTime);
      const minutesSinceLastRun = (now - lastRun) / (60 * 1000);
      
      // If it's been run in the last 5 minutes, don't run again
      if (minutesSinceLastRun < 5) {
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error(`Error checking cron schedule: ${cronExpression}`, error);
    return false;
  }
}

/**
 * Marks a scheduled message as sent
 * @param {number} messageId - Scheduled message ID
 * @returns {Promise<boolean>} - Success status
 */
export async function markScheduledMessageSent(messageId) {
  try {
    const { error } = await supabase
      .from('bri_scheduled_messages')
      .update({
        last_sent_at: new Date().toISOString()
      })
      .eq('id', messageId);
      
    if (error) {
      logger.error(`Error marking scheduled message ${messageId} as sent:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in markScheduledMessageSent for message ${messageId}:`, error);
    return false;
  }
}

/**
 * Extracts time and event information from a message
 * @param {string} message - The message content
 * @returns {Promise<Object|null>} - Extracted time/event or null
 */
export async function extractTimeAndEvent(message) {
  try {
    const prompt = `
Extract any time-related information and potential events from this message.
Look for:
1. Specific dates and times
2. Relative timeframes ("tomorrow", "next week", "in 3 days")
3. Event types (meeting, appointment, birthday, reminder, etc.)
4. Event details (title, description, location)
5. If no specific date is mentioned but a time is, assume it's today. If the time mentioned has already passed, assume it's tomorrow.

Format your response as JSON:
{
  "hasTimeInfo": true/false,
  "event": {
    "title": "Event title",
    "date": "2025-03-15", // YYYY-MM-DD format, null if unclear
    "time": "14:30", // 24-hour format, null if unclear
    "endDate": "2025-03-15", // For multi-day events, null if same as date
    "endTime": "16:00", // For timed events, null if not specified
    "type": "appointment", // appointment, birthday, reminder, etc.
    "description": "Additional details about the event"
  }
}

If no time information is present, return {"hasTimeInfo": false}

MESSAGE: ${message}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are a specialized time and event extraction assistant that identifies date, time, and event information in messages."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });
    
    const result = JSON.parse(completion.choices[0].message.content);
    
    if (!result.hasTimeInfo) {
      return null;
    }
    
    return result.event;
  } catch (error) {
    logger.error("Error extracting time and event information:", error);
    return null;
  }
}

/**
 * Converts a user-friendly time specification to a Date object
 * @param {string} dateText - The date text (e.g., "tomorrow", "next Monday", "March 15")
 * @param {string} timeText - The time text (e.g., "3pm", "15:30")
 * @param {string} timezone - The user's timezone
 * @returns {Date|null} - Converted Date object or null if invalid
 */
export function parseTimeSpecification(dateText, timeText, timezone = DEFAULT_TIMEZONE) {
  try {
    // Current date in the user's timezone
    const now = new Date();
    const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    
    let targetDate = null;
    
    // Parse date text
    const lowerDateText = (dateText || '').toLowerCase().trim();
    
    if (!lowerDateText || lowerDateText === 'today') {
      targetDate = new Date(userNow);
    } else if (lowerDateText === 'tomorrow') {
      targetDate = new Date(userNow);
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (lowerDateText.startsWith('next ')) {
      // Handle "next Monday", "next week", etc.
      const dayOrPeriod = lowerDateText.substring(5).trim();
      targetDate = new Date(userNow);
      
      const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayIndex = daysOfWeek.indexOf(dayOrPeriod);
      
      if (dayIndex !== -1) {
        // "next Monday", "next Tuesday", etc.
        const currentDayIndex = targetDate.getDay();
        let daysToAdd = dayIndex - currentDayIndex;
        if (daysToAdd <= 0) daysToAdd += 7; // Next week
        targetDate.setDate(targetDate.getDate() + daysToAdd);
      } else if (dayOrPeriod === 'week') {
        // "next week" (same day next week)
        targetDate.setDate(targetDate.getDate() + 7);
      } else if (dayOrPeriod === 'month') {
        // "next month" (same day next month)
        targetDate.setMonth(targetDate.getMonth() + 1);
      } else {
        // Try to parse as a date
        return parseCustomDate(dateText, timeText, timezone);
      }
    } else if (lowerDateText.includes('in ')) {
      // Handle "in 3 days", "in 2 weeks", etc.
      const match = lowerDateText.match(/in (\d+) (minute|minutes|hour|hours|day|days|week|weeks|month|months)/);
      if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2];
        
        targetDate = new Date(userNow);
        
        if (unit === 'minute' || unit === 'minutes') {
          // Add minutes
          targetDate.setMinutes(targetDate.getMinutes() + amount);
        } else if (unit === 'hour' || unit === 'hours') {
          // Add hours
          targetDate.setHours(targetDate.getHours() + amount);
        } else if (unit === 'day' || unit === 'days') {
          targetDate.setDate(targetDate.getDate() + amount);
        } else if (unit === 'week' || unit === 'weeks') {
          targetDate.setDate(targetDate.getDate() + (amount * 7));
        } else if (unit === 'month' || unit === 'months') {
          targetDate.setMonth(targetDate.getMonth() + amount);
        }
      } else {
        // Try to parse as a date
        return parseCustomDate(dateText, timeText, timezone);
      }
    } else {
      // Try to parse as a date
      return parseCustomDate(dateText, timeText, timezone);
    }
    
    // Parse time text if present
    if (timeText) {
      const lowerTimeText = timeText.toLowerCase().trim();
      
      // Try to parse various time formats
      if (lowerTimeText.includes(':')) {
        // Format: "15:30" or "3:30pm"
        const [hours, minutesPart] = lowerTimeText.split(':');
        let minutes = minutesPart;
        let isPM = false;
        
        if (minutesPart.includes('pm')) {
          minutes = minutesPart.replace('pm', '');
          isPM = true;
        } else if (minutesPart.includes('am')) {
          minutes = minutesPart.replace('am', '');
        }
        
        let hoursNum = parseInt(hours);
        if (isPM && hoursNum < 12) hoursNum += 12;
        if (!isPM && hoursNum === 12) hoursNum = 0;
        
        targetDate.setHours(hoursNum, parseInt(minutes), 0, 0);
      } else if (lowerTimeText.includes('am') || lowerTimeText.includes('pm')) {
        // Format: "3pm" or "3am"
        const isPM = lowerTimeText.includes('pm');
        const hours = parseInt(lowerTimeText.replace(/[^0-9]/g, ''));
        
        let hoursNum = hours;
        if (isPM && hoursNum < 12) hoursNum += 12;
        if (!isPM && hoursNum === 12) hoursNum = 0;
        
        targetDate.setHours(hoursNum, 0, 0, 0);
      } else {
        // Format: "15" or "3" (assuming hour)
        const hours = parseInt(lowerTimeText);
        if (!isNaN(hours)) {
          targetDate.setHours(hours, 0, 0, 0);
        }
      }
    }
    
    return targetDate;
  } catch (error) {
    logger.error("Error parsing time specification:", error);
    return null;
  }
}

/**
 * Parse a custom date format
 * @param {string} dateText - Date text
 * @param {string} timeText - Time text
 * @param {string} timezone - Timezone
 * @returns {Date|null} - Parsed date or null
 */
function parseCustomDate(dateText, timeText, timezone) {
  try {
    // Try to parse using Date constructor
    const dateString = `${dateText} ${timeText || ''}`.trim();
    const parsed = new Date(dateString);
    
    if (!isNaN(parsed.getTime())) {
      // Adjust for timezone
      return new Date(parsed.toLocaleString('en-US', { timeZone: timezone }));
    }
    
    // If that fails, try other formats...
    // This is a simplified implementation - in a real system, you might want
    // to use a library like date-fns or moment.js for more robust parsing
    
    return null;
  } catch (error) {
    logger.error("Error parsing custom date:", error);
    return null;
  }
}

/**
 * Main function to check for and process events and reminders
 * Should be called periodically (e.g., every minute)
 */
export async function processTimeAwareEvents() {
  try {
    //logger.info("Processing time-aware events...");
    
    // Step 1: Process event reminders
    await processEventReminders();
    
    // Step 2: Process scheduled messages
    await processScheduledMessages();
    
    // Step 3: Process event follow-ups (for events that just ended)
    await processEventFollowUps();
    
    //logger.info("Finished processing time-aware events");
  } catch (error) {
    logger.error("Error in processTimeAwareEvents:", error);
  }
}

/**
 * Processes event reminders
 */
async function processEventReminders() {
  try {
    // Get events with pending reminders
    const eventsWithReminders = await getEventsWithPendingReminders();
    
    if (eventsWithReminders.length === 0) {
      return;
    }
    
    logger.info(`Found ${eventsWithReminders.length} events with pending reminders`);
    
    // Process each reminder
    for (const event of eventsWithReminders) {
      try {
        // Get the user's timezone
        const timezone = await getUserTimezone(event.user_id);
        
        // Format the event time in the user's timezone
        const eventDate = new Date(event.event_date);
        const formattedTime = eventDate.toLocaleString('en-US', { 
          timeZone: timezone,
          dateStyle: 'full',
          timeStyle: 'short'
        });
        
        // Create a reminder message
        let reminderMessage = '';
        
        if (event.current_reminder_minutes === 0) {
          reminderMessage = `🔔 **Event Now**: "${event.title}" is happening now!`;
        } else if (event.current_reminder_minutes < 60) {
          reminderMessage = `🔔 **Event Soon**: "${event.title}" is happening in ${event.current_reminder_minutes} minutes!`;
        } else if (event.current_reminder_minutes === 60) {
          reminderMessage = `🔔 **Event Reminder**: "${event.title}" is happening in 1 hour!`;
        } else if (event.current_reminder_minutes === 1440) {
          reminderMessage = `🔔 **Event Tomorrow**: "${event.title}" is happening tomorrow at ${eventDate.toLocaleTimeString('en-US', { 
            timeZone: timezone,
            timeStyle: 'short'
          })}!`;
        } else {
          const reminderHours = event.current_reminder_minutes / 60;
          reminderMessage = `🔔 **Event Reminder**: "${event.title}" is happening in ${reminderHours} hours!`;
        }
        
        if (event.description) {
          reminderMessage += `\n\nDetails: ${event.description}`;
        }
        
        reminderMessage += `\n\nTime: ${formattedTime}`;
        
        // Send the reminder
        await sendReminderMessage(event.user_id, reminderMessage, event.channel_id);
        
        // Mark the reminder as sent
        await markReminderSent(event.id);
        
        logger.info(`Sent reminder for event ${event.id}: ${event.title}`);
      } catch (eventError) {
        logger.error(`Error processing reminder for event ${event.id}:`, eventError);
        // Continue with next event
      }
    }
  } catch (error) {
    logger.error("Error processing event reminders:", error);
  }
}

/**
 * Processes scheduled messages
 */
async function processScheduledMessages() {
  try {
    // Get due scheduled messages
    const dueMessages = await getDueScheduledMessages();
    
    if (dueMessages.length === 0) {
      return;
    }
    
    logger.info(`Found ${dueMessages.length} due scheduled messages`);
    
    // Process each message
    for (const message of dueMessages) {
      try {
        // Send the message
        await sendScheduledMessage(message);
        
        // Mark the message as sent
        await markScheduledMessageSent(message.id);
        
        logger.info(`Sent scheduled message ${message.id}`);
      } catch (messageError) {
        logger.error(`Error processing scheduled message ${message.id}:`, messageError);
        // Continue with next message
      }
    }
  } catch (error) {
    logger.error("Error processing scheduled messages:", error);
  }
}

/**
 * Processes event follow-ups
 */
async function processEventFollowUps() {
  try {
    // Get events that just ended (in the last 30 minutes)
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    
    const { data, error } = await supabase
      .from('bri_events')
      .select('*')
      .eq('is_active', true)
      .eq('event_type', EVENT_TYPES.FOLLOW_UP)
      .gte('event_date', thirtyMinutesAgo.toISOString())
      .lt('event_date', now.toISOString());
      
    if (error) {
      logger.error("Error fetching events for follow-up:", error);
      return;
    }
    
    if (!data || data.length === 0) {
      return;
    }
    
    logger.info(`Found ${data.length} events for follow-up`);
    
    // Process each follow-up
    for (const event of data) {
      try {
        // Generate a follow-up message
        const followUpMessage = await generateFollowUpMessage(event);
        
        // Send the follow-up
        await sendReminderMessage(event.user_id, followUpMessage, event.channel_id);
        
        // Mark the event as inactive (follow-up sent)
        await supabase
          .from('bri_events')
          .update({
            is_active: false
          })
          .eq('id', event.id);
          
        logger.info(`Sent follow-up for event ${event.id}: ${event.title}`);
      } catch (eventError) {
        logger.error(`Error processing follow-up for event ${event.id}:`, eventError);
        // Continue with next event
      }
    }
  } catch (error) {
    logger.error("Error processing event follow-ups:", error);
  }
}

/**
 * Generates a follow-up message for an event
 * @param {Object} event - Event data
 * @returns {Promise<string>} - Follow-up message
 */
async function generateFollowUpMessage(event) {
  try {
    const prompt = `
Generate a friendly follow-up message for an event that just happened.
The event was: "${event.title}"
${event.description ? `Description: ${event.description}` : ''}

Write a natural, friendly message as Bri (a helpful AI assistant with the personality of a 14-year-old girl)
asking how the event went. Be enthusiastic but keep it brief (2-3 sentences maximum).
Don't add any emoji at the beginning or end of the message.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are Bri, a helpful AI assistant with the personality of a 14-year-old girl." },
        { role: "user", content: prompt }
      ],
      max_tokens: 150,
    });
    
    let followUpMessage = completion.choices[0].message.content.trim();
    
    // Add emoji at the beginning
    followUpMessage = `📝 **Event Follow-up**\n\n${followUpMessage}`;
    
    return followUpMessage;
  } catch (error) {
    logger.error("Error generating follow-up message:", error);
    return `📝 **Event Follow-up**\n\nHey! How did "${event.title}" go? I'd love to hear about it!`;
  }
}

/**
 * Sends a reminder message to a user
 * @param {string} userId - User ID
 * @param {string} message - Reminder message
 * @param {string|null} channelId - Optional channel ID (if null, sends DM)
 */
async function sendReminderMessage(userId, message, channelId = null) {
  try {
    // Check if client is available
    if (!discordClientRef) {
        logger.error(`No Discord client available for sending reminder to user ${userId}`);
        return;
      }

    if (channelId) {
      // Send to specified channel
      const channel = await discordClientRef.channels.fetch(channelId);
      if (channel) {
        await channel.send(`<@${userId}> ${message}`);
        return;
      }
    }
    
    // If no channel specified or channel not found, try to send DM
    try {
      const user = await discordClientRef.users.fetch(userId);
      await user.send(message);
    } catch (dmError) {
      logger.error(`Error sending DM to user ${userId}:`, dmError);
      
      // If DM fails, try to find a common guild and send there
      const guilds = discordClientRef.guilds.cache.filter(guild => 
        guild.members.cache.has(userId) || 
        guild.members.resolve(userId)
      );
      
      if (guilds.size > 0) {
        // Use the first guild
        const guild = guilds.first();
        
        // Try to find a general or bot channel
        const channelNames = ['general', 'bot', 'bot-commands', 'bri'];
        for (const name of channelNames) {
          const channel = guild.channels.cache.find(ch => 
            ch.name.includes(name) && ch.type === 'GUILD_TEXT'
          );
          
          if (channel) {
            await channel.send(`<@${userId}> ${message}`);
            return;
          }
        }
        
        // If no suitable channel found, use the first text channel
        const channel = guild.channels.cache.find(ch => ch.type === 'GUILD_TEXT');
        if (channel) {
          await channel.send(`<@${userId}> ${message}`);
        }
      }
    }
  } catch (error) {
    logger.error(`Error sending reminder message to user ${userId}:`, error);
  }
}

/**
 * Sends a scheduled message
 * @param {Object} scheduledMessage - Scheduled message data
 */
async function sendScheduledMessage(scheduledMessage) {
  try {
    // Check if client is available
    if (!discordClientRef) {
        logger.error(`No Discord client available for scheduled message ${scheduledMessage.id}`);
        return;
    }    
    // Get the channel
    const channel = await discordClientRef.channels.fetch(scheduledMessage.channel_id);
    
    if (!channel) {
      logger.error(`Channel not found for scheduled message ${scheduledMessage.id}: ${scheduledMessage.channel_id}`);
      return;
    }
    
    // Determine what message content to send
    let messageContent;
    
    // Check if this message uses a collection
    if (scheduledMessage.using_collection === true) {
      // Get all messages from the collection
      const { data: messageCollection, error } = await supabase
        .from(TABLE_NAMES.MESSAGE_COLLECTIONS)
        .select('content')
        .eq('message_id', scheduledMessage.id);
        
      if (error || !messageCollection || messageCollection.length === 0) {
        logger.error(`Error fetching message collection for message ${scheduledMessage.id}:`, error);
        // Fallback to the stored message content if available
        messageContent = scheduledMessage.message_content || "Sorry, I couldn't find the message content.";
      } else {
        // Pick a random message from the collection
        const randomIndex = Math.floor(Math.random() * messageCollection.length);
        messageContent = messageCollection[randomIndex].content;
        logger.info(`Selected random message ${randomIndex + 1}/${messageCollection.length} from collection for message ${scheduledMessage.id}`);
      }
    } 
    // Check if this is a dynamic message that should be generated
    else if (scheduledMessage.is_dynamic === true) {
      // Generate a dynamic message based on message type
      messageContent = await generateDynamicMessage(scheduledMessage.message_type);
      logger.info(`Generated dynamic message for scheduled message ${scheduledMessage.id}`);
    }
    // Otherwise, use the stored message content
    else {
      messageContent = scheduledMessage.message_content;
    }
    
    // Send the message
    await channel.send(messageContent);
    
    logger.info(`Sent scheduled message to channel ${scheduledMessage.channel_id}`);
  } catch (error) {
    logger.error(`Error sending scheduled message ${scheduledMessage.id}:`, error);
  }
}

/**
 * Generates a dynamic message based on message type
 * @param {string} messageType - Type of message to generate
 * @returns {Promise<string>} - Generated message content
 */
async function generateDynamicMessage(messageType) {
  try {
    // Process different types of dynamic messages
    const type = messageType.toLowerCase();
    
    // Time-based greetings (morning, evening, etc.)
    const timeBasedTypes = ['morning', 'afternoon', 'evening', 'night', 'weekend'];
    if (timeBasedTypes.includes(type)) {
      return await generateGreeting(type);
    }
    
    // Handle other types of dynamic messages
    const prompt = `
Generate a friendly, conversational message from Bri, a 14-year-old AI assistant.
This is for a scheduled message with the type/theme: "${messageType}".

Guidelines:
- Keep it brief (2-3 sentences max)
- Include appropriate emoji(s)
- Sound natural and conversational, like a 14-year-old would write
- Make it feel fresh and unique, not generic
- Include a question or conversation starter when appropriate
- Don't include a signature

The message should be warm, friendly, and engaging.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are Bri, a helpful AI assistant with the personality of a 14-year-old girl. You create varied, natural-sounding messages." },
        { role: "user", content: prompt }
      ],
      max_tokens: 200,
      temperature: 0.8, // Higher temperature for more variety
    });
    
    return completion.choices[0].message.content.trim();
  } catch (error) {
    logger.error(`Error generating dynamic message for type ${messageType}:`, error);
    return `Hello everyone! I hope you're having a great day! 😊`;
  }
}

/**
 * Generates a greeting message based on type
 * @param {string} type - Type of greeting (morning, afternoon, evening, etc.)
 * @returns {Promise<string>} - Generated greeting message
 */
async function generateGreeting(type) {
  try {
    // Standardize type to lowercase
    const greetingType = type.toLowerCase();
    
    // Define characteristics and context for different greeting types
    const greetingContexts = {
      morning: {
        time: "morning",
        tone: "energetic and cheerful",
        themes: "starting the day, breakfast, plans for the day, sunshine, new beginnings",
        emoji: "morning-related like 🌞, 🌅, ☀️, 🌻, 🐦"
      },
      afternoon: {
        time: "afternoon",
        tone: "friendly and casual",
        themes: "lunch, mid-day activities, how the day is going so far, afternoon breaks",
        emoji: "afternoon-related like ☀️, 🌤️, 🌈, 👋, 😊"
      },
      evening: {
        time: "evening",
        tone: "warm and reflective",
        themes: "winding down, dinner, reflection on the day, relaxation",
        emoji: "evening-related like 🌙, 🌆, 🌇, ✨, 🦉"
      },
      night: {
        time: "night",
        tone: "calm and peaceful",
        themes: "sleep, rest, dreams, relaxation, end of day",
        emoji: "night-related like 💤, 🌙, 🌃, 😴, ✨"
      },
      weekend: {
        time: "weekend",
        tone: "excited and relaxed",
        themes: "free time, fun activities, relaxation, hobbies, friend hangouts",
        emoji: "weekend-related like 🎉, 🥳, 🎊, 🌈, 🎮"
      }
    };
    
    // Get context for this greeting type (default to afternoon if not found)
    const context = greetingContexts[greetingType] || greetingContexts.afternoon;
    
    // Generate a unique greeting using OpenAI
    const prompt = `
Generate a friendly, casual greeting message as if from Bri, a 14-year-old AI assistant.
This is for a ${context.time} greeting.

Guidelines:
- Use a ${context.tone} tone
- Keep it brief (1-2 sentences)
- Focus on themes like: ${context.themes}
- Include an appropriate emoji (${context.emoji})
- This message will be for a group chat, so make it feel inclusive
- Make it sound natural and conversational, like how a 14-year-old would talk
- Make it feel personal and warm
- Don't include a signature - just the greeting message

The message should feel fresh and unique, not generic.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are Bri, a helpful AI assistant with the personality of a 14-year-old girl. You create varied, natural-sounding greetings." },
        { role: "user", content: prompt }
      ],
      max_tokens: 150,
      temperature: 0.8, // Higher temperature for more variety
    });
    
    return completion.choices[0].message.content.trim();
  } catch (error) {
    logger.error(`Error generating greeting for type ${type}:`, error);
    return `Hey everyone! 👋 Hope you're all doing great today!`;
  }
}

// For cron schedules, you may want to add a library like 'node-cron'
// But here's a simple setup for periodic checking
let timeEventInterval = null;

/**
 * Start the time-aware event processing
 * @param {Object} client - Discord client
 * @param {number} intervalMinutes - Check interval in minutes
 * @param {Function} processingFunction - Function to call (defaults to regular processTimeAwareEvents)
 */
export function startTimeEventProcessing(client, intervalMinutes = 1, processingFunction = processTimeAwareEvents) {
  if (client) {
    discordClientRef = client;
    logger.info("Discord client reference stored in timeSystem");
  }
  
  // Stop any existing interval
  if (timeEventInterval) {
    clearInterval(timeEventInterval);
  }
  
  // Convert minutes to milliseconds
  const intervalMs = intervalMinutes * 60 * 1000;
  
  // Set up interval with the provided processing function
  timeEventInterval = setInterval(() => {
    processingFunction().catch(error => {
      logger.error("Error in time event processing interval:", error);
    });
  }, intervalMs);
  
  logger.info(`Started time event processing with ${intervalMinutes} minute interval`);
  
  // Run once immediately
  processingFunction().catch(error => {
    logger.error("Error in initial time event processing:", error);
  });
}

/**
 * Cancels a scheduled message by setting it inactive
 * @param {number} messageId - Scheduled message ID
 * @returns {Promise<boolean>} - Success status
 */
export async function cancelScheduledMessage(messageId) {
    try {
      const { error } = await supabase
        .from('bri_scheduled_messages')
        .update({
          is_active: false
        })
        .eq('id', messageId);
        
      if (error) {
        logger.error(`Error canceling scheduled message ${messageId}:`, error);
        return false;
      }
      
      logger.info(`Canceled scheduled message ${messageId}`);
      return true;
    } catch (error) {
      logger.error(`Error in cancelScheduledMessage for message ${messageId}:`, error);
      return false;
    }
  }

  /**
 * Gets active scheduled messages for a guild
 * @param {string} guildId - Guild ID (optional, if provided will filter by channels in this guild)
 * @returns {Promise<Array>} - Active scheduled messages
 */
export async function getActiveScheduledMessages(guildId = null) {
    try {
        // Check if we have a client reference
        if (!discordClientRef && guildId) {
            logger.error(`No Discord client available for getting scheduled messages`);
            return [];
        }
      // Build query for active messages
      let query = supabase
        .from('bri_scheduled_messages')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      
      // Get the data
      const { data, error } = await query;
        
      if (error) {
        logger.error("Error fetching scheduled messages:", error);
        return [];
      }
      
      if (!data || data.length === 0) {
        return [];
      }
      
      // If guildId is provided, filter messages by channels in this guild
      if (guildId && discordClientRef) {
        try {
          const guild = await discordClientRef.guilds.fetch(guildId);
          if (guild) {
            // Get all channel IDs for this guild
            const guildChannelIds = Array.from(guild.channels.cache.keys());
            
            // Filter messages to only include those for channels in this guild
            return data.filter(msg => guildChannelIds.includes(msg.channel_id));
          }
        } catch (guildError) {
          logger.error(`Error filtering messages for guild ${guildId}:`, guildError);
          // Fall back to returning all messages if we can't filter
        }
      }
      
      return data;
    } catch (error) {
      logger.error("Error in getActiveScheduledMessages:", error);
      return [];
    }
  }

  /**
 * Gets upcoming time events for context enhancement
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<string>} - Formatted time context string
 */
export async function getTimeEventsForContextEnhancement(userId, guildId) {
  try {
    // Get upcoming events for this user
    const upcomingEvents = await getUpcomingContextEvents(userId, guildId);
    
    if (!upcomingEvents || upcomingEvents.length === 0) {
      return ""; // No events to add
    }
    
    // Create context about upcoming events
    let eventContext = "";
    
    for (const event of upcomingEvents) {
      const eventDate = new Date(event.event_date);
      const now = new Date();
      
      // Format the date/time in a natural way
      let timeContext;
      const millisecondsUntil = eventDate - now;
      const minutesUntil = Math.floor(millisecondsUntil / (1000 * 60));
      const hoursUntil = Math.floor(minutesUntil / 60);
      const daysUntil = Math.floor(hoursUntil / 24);
      
      if (minutesUntil < 60) {
        timeContext = minutesUntil <= 0 ? "right now" : `in ${minutesUntil} minutes`;
      } else if (hoursUntil < 24) {
        timeContext = `in ${hoursUntil} hour${hoursUntil > 1 ? 's' : ''}`;
      } else if (daysUntil < 7) {
        timeContext = `in ${daysUntil} day${daysUntil > 1 ? 's' : ''}`;
      } else {
        // Format a date like "March 15th"
        timeContext = `on ${eventDate.toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric' 
        })}`;
      }
      
      // Add to context in a format similar to memories
      eventContext += `- The user has ${event.event_type === 'event' ? 'an' : 'a'} ${event.event_type} "${event.event_title}" ${timeContext}`;
      
      // Add time if available
      if (event.event_time) {
        eventContext += ` at ${event.event_time}`;
      }
      
      // Add description if available
      if (event.description) {
        eventContext += `. Details: ${event.description}`;
      }
      
      eventContext += "\n";
      
      // Mark as added to context
      await markContextAdded(event.id);
    }
    
    return eventContext.trim();
  } catch (error) {
    logger.error(`Error getting time events for context enhancement for user ${userId}:`, error);
    return ""; // Return empty string on error
  }
}

/**
 * Enhanced function to analyze and store conversation instructions for future reference
 * @param {string} userId - User ID
 * @param {string} content - Message content that contains time information
 * @param {Object} eventInfo - Extracted event information
 * @param {string} guildId - Guild ID
 * @returns {Promise<string>} - Conversation instructions
 */
async function generateConversationInstructions(userId, content, eventInfo, guildId) {
  try {
    // Create a prompt that asks for instructions on how to bring this up later
    const prompt = `
You are analyzing a message to prepare contextual instructions for a future conversation.

USER MESSAGE: "${content}"

TIME-RELATED EVENT DETECTED:
- Title: ${eventInfo.title || 'Unnamed event'}
- Type: ${eventInfo.type || 'event'}
- Date: ${eventInfo.date || 'unknown date'}
- Time: ${eventInfo.time || 'unspecified time'}
- Description: ${eventInfo.description || 'No additional details'}

Provide concise, natural conversation instructions for how to bring up this event later when it's about to happen. The instructions should:
1. Guide how to naturally mention the event
2. Suggest appropriate questions or comments based on the event type
3. Include sensitivity/tone guidance (is this a serious event, fun event, etc.)
4. NOT include specific phrasings or templates - just conversation guidance

Format as a short paragraph of instructions only. These instructions will be used by an AI assistant named Bri who has the personality of a friendly 14-year-old girl.`;

    // Call OpenAI to generate conversation instructions
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are an AI conversation planning assistant. You analyze messages and create natural conversation instructions." },
        { role: "user", content: prompt }
      ],
      max_tokens: 300,
    });
    
    const instructions = completion.choices[0].message.content.trim();
    logger.info(`Generated conversation instructions for user ${userId} event: ${eventInfo.title}`);
    
    return instructions;
  } catch (error) {
    logger.error(`Error generating conversation instructions: ${error}`);
    // Fallback instructions if we can't generate custom ones
    return `Reference the upcoming ${eventInfo.type || 'event'} in a natural, conversational way. Ask how the user feels about it and if they're prepared.`;
  }
}

/**
 * Stores a context event with conversation instructions
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Object} eventInfo - Event information
 * @param {string} originalMessage - The original message that mentioned the event
 * @returns {Promise<Object|null>} - Created event or null
 */
export async function storeContextEventWithInstructions(userId, guildId, eventInfo, originalMessage) {
  try {
    // Validate required fields
    if (!userId || !guildId || !eventInfo.title || !eventInfo.date) {
      logger.error("Missing required fields for context event creation:", { userId, guildId, eventInfo });
      return null;
    }
    
    // Generate conversation instructions for this event
    const conversationInstructions = await generateConversationInstructions(
      userId, 
      originalMessage, 
      eventInfo, 
      guildId
    );
    
    // Validate date format and create valid date object
    let eventDate;
    try {
      // Ensure date is in YYYY-MM-DD format
      if (!eventInfo.date || !/^\d{4}-\d{2}-\d{2}$/.test(eventInfo.date)) {
        logger.error("Invalid date format in eventInfo:", eventInfo);
        return null;
      }
      
      // Safely create the date object with proper time
      eventDate = new Date(eventInfo.date + (eventInfo.time ? `T${eventInfo.time}` : 'T12:00:00')).toISOString();
    } catch (dateError) {
      logger.error("Invalid time value in eventInfo:", eventInfo, dateError);
      return null;
    }
    
    // Create the event in the database
    const { data, error } = await supabase
      .from('bri_context_events')
      .insert({
        user_id: userId,
        guild_id: guildId,
        event_title: eventInfo.title,
        event_type: eventInfo.type || 'event',
        event_date: eventDate,
        event_time: eventInfo.time || null,
        description: eventInfo.description || null,
        extracted_from: 'conversation',
        context_added: false,
        unprompted_sent: false,
        conversation_instructions: conversationInstructions
      })
      .select()
      .single();
      
    if (error) {
      logger.error("Error creating context event:", error);
      return null;
    }
    
    logger.info(`Created new context event with instructions: "${data.event_title}" for user ${data.user_id} in guild ${data.guild_id}`);
    return data;
  } catch (error) {
    logger.error("Error in storeContextEventWithInstructions:", error);
    return null;
  }
}

/**
 * Sends a dynamically generated unprompted message about an upcoming event
 * @param {Object} event - Event data
 * @returns {Promise<boolean>} - Success status
 */
export async function sendDynamicUnpromptedEventMessage(event) {
  try {
    // Check if client is available
    if (!discordClientRef) {
      logger.error(`No Discord client available for sending unprompted message about event ${event.id}`);
      return false;
    }
    
    // Get the server configuration to find the designated channel
    const serverConfig = await getServerConfig(event.guild_id);
    if (!serverConfig || !serverConfig.designated_channels || serverConfig.designated_channels.length === 0) {
      logger.error(`No designated channels found for guild ${event.guild_id}`);
      return false;
    }
    
    // Use the first designated channel
    const channelId = serverConfig.designated_channels[0];
    
    // Try to fetch the channel
    let channel;
    try {
      channel = await discordClientRef.channels.fetch(channelId);
    } catch (channelError) {
      logger.error(`Error fetching channel ${channelId}:`, channelError);
      return false;
    }
    
    if (!channel) {
      logger.error(`Channel not found: ${channelId}`);
      return false;
    }
    
    // Get user's character sheet
    let characterSheetInfo = "";
    try {
      characterSheetInfo = await getCharacterSheetForPrompt(event.user_id, event.guild_id);
    } catch (charError) {
      logger.error(`Error getting character sheet for user ${event.user_id}:`, charError);
    }
    
    // Format event timing information
    const eventDate = new Date(event.event_date);
    const now = new Date();
    const minutesUntil = Math.floor((eventDate - now) / (1000 * 60));
    
    // Create a natural time description
    let timeDescription;
    if (minutesUntil < 15) {
      timeDescription = "happening right now";
    } else if (minutesUntil < 30) {
      timeDescription = "happening in less than 30 minutes";
    } else if (minutesUntil < 60) {
      timeDescription = "happening in less than an hour";
    } else {
      timeDescription = "happening soon";
    }
    
    // Build the prompt for generating the message
    const systemPrompt = `${STATIC_CORE_PROMPT}

${characterSheetInfo ? characterSheetInfo : ""}

You are about to send an unprompted message to a user about an upcoming event they mentioned. This is NOT a response to anything they just said - you are initiating this conversation.

Event details:
- Title: ${event.event_title}
- Type: ${event.event_type}
- Time: ${timeDescription}
${event.description ? `- Details: ${event.description}` : ""}

How to mention this event: ${event.conversation_instructions || "Mention this event in a natural, conversational way. Ask how they feel about it."}

Important guidelines:
1. Start with a greeting that includes the user's name or a ping (@user)
2. Be concise but friendly - this is an unprompted message
3. Make it sound natural, as if you just remembered this event is coming up
4. Include appropriate emojis (1-2 is enough) to match the tone
5. Keep the entire message under 2-3 sentences
6. Don't explicitly mention that this is an automated reminder`;
    
    // Generate a personalized message using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate an unprompted message to mention this upcoming event." }
      ],
      max_tokens: 300,
      temperature: 0.7, // Slightly more creative
    });
    
    // Get the generated message
    let generatedMessage = completion.choices[0].message.content.trim();
    
    // Ensure the message mentions the user with a ping if it doesn't include their name already
    if (!generatedMessage.includes("@")) {
      generatedMessage = `<@${event.user_id}> ${generatedMessage}`;
    } else {
      // If it has @user placeholder, replace with actual ping
      generatedMessage = generatedMessage.replace(/@user/gi, `<@${event.user_id}>`);
    }
    
    // Send the message
    await channel.send(generatedMessage);
    
    logger.info(`Sent dynamic unprompted message to user ${event.user_id} in channel ${channelId} about event ${event.id}`);
    return true;
  } catch (error) {
    logger.error(`Error sending dynamic unprompted message for event ${event.id}:`, error);
    return false;
  }
}

/**
 * Process upcoming events and send unprompted messages
 * Updated version that uses dynamic AI-generated messages
 */
export async function processContextEventsForUnprompted() {
  try {
    // Get events coming up in the next 1 hour
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    
    // Find events that:
    // 1. Are happening within the next hour
    // 2. Haven't had an unprompted message sent yet
    const { data, error } = await supabase
      .from('bri_context_events')
      .select('*')
      .gte('event_date', now.toISOString())
      .lt('event_date', oneHourFromNow.toISOString())
      .eq('unprompted_sent', false);
      
    if (error) {
      logger.error("Error fetching events for unprompted messages:", error);
      return;
    }
    
    if (!data || data.length === 0) {
      return;
    }
    
    logger.info(`Found ${data.length} events for potential unprompted messages`);
    
    // Process each event
    for (const event of data) {
      try {
        // Check if user allows unprompted messages
        const allowsUnprompted = await userAllowsUnpromptedMessages(event.user_id, event.guild_id);
        
        if (!allowsUnprompted) {
          // Mark as sent anyway so we don't keep checking
          await markUnpromptedSent(event.id);
          continue;
        }
        
        // Use the dynamic message generation instead of templates
        await sendDynamicUnpromptedEventMessage(event);
        
        // Mark as sent
        await markUnpromptedSent(event.id);
      } catch (eventError) {
        logger.error(`Error processing unprompted message for event ${event.id}:`, eventError);
      }
    }
  } catch (error) {
    logger.error("Error processing context events for unprompted messages:", error);
  }
}

/**
 * Gets upcoming context events for a user
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {number} hoursAhead - Look ahead hours (default 24)
 * @returns {Promise<Array>} - Upcoming events
 */
export async function getUpcomingContextEvents(userId, guildId, hoursAhead = 24) {
  try {
    const now = new Date();
    const futureTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    
    const { data, error } = await supabase
      .from('bri_context_events')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .gte('event_date', now.toISOString())
      .lt('event_date', futureTime.toISOString())
      .order('event_date', { ascending: true });
      
    if (error) {
      logger.error(`Error fetching upcoming context events for user ${userId}:`, error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error(`Error in getUpcomingContextEvents for user ${userId}:`, error);
    return [];
  }
}

/**
 * Marks context as added to system prompt
 * @param {number} eventId - Event ID
 * @returns {Promise<boolean>} - Success status
 */
export async function markContextAdded(eventId) {
  try {
    const { error } = await supabase
      .from('bri_context_events')
      .update({
        context_added: true
      })
      .eq('id', eventId);
      
    if (error) {
      logger.error(`Error marking context added for event ${eventId}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in markContextAdded for event ${eventId}:`, error);
    return false;
  }
}

/**
 * Checks if a user allows unprompted messages
 * Default to true for now
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} - Whether unprompted messages are allowed
 */
export async function userAllowsUnpromptedMessages(userId) {
  try {
    // For now, default to true as requested
    return true;
    
    /* Real implementation would be something like:
    const { data, error } = await supabase
      .from('user_settings')
      .select('allow_unprompted')
      .eq('user_id', userId)
      .single();
      
    if (error || !data) {
      return true; // Default to true if no setting found
    }
    
    return data.allow_unprompted !== false; // Default to true if null
    */
  } catch (error) {
    logger.error(`Error checking unprompted message preference for user ${userId}:`, error);
    return true; // Default to true on error
  }
}

/**
 * Marks an unprompted message as sent
 * @param {number} eventId - Event ID
 * @returns {Promise<boolean>} - Success status
 */
export async function markUnpromptedSent(eventId) {
  try {
    const { error } = await supabase
      .from('bri_context_events')
      .update({
        unprompted_sent: true
      })
      .eq('id', eventId);
      
    if (error) {
      logger.error(`Error marking unprompted sent for event ${eventId}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in markUnpromptedSent for event ${eventId}:`, error);
    return false;
  }
}


export async function processTimeAwareEventsEnhanced() {
  try {
    //logger.info("Processing time-aware events...");
    
    // Existing steps
    await processEventReminders();
    await processScheduledMessages();
    await processEventFollowUps();
    
    // New step: Process context events for unprompted messages
    await processContextEventsForUnprompted();
    
    // New step: Process political news summaries
    await processPoliticalNewsSummaries();
    
    //logger.info("Finished processing time-aware events");
  } catch (error) {
    logger.error("Error in processTimeAwareEventsEnhanced:", error);
  }
}

/**
 * Process political news summaries for all guilds that have them enabled
 */
async function processPoliticalNewsSummaries() {
  try {
    // Ensure the tables are set up
    await setupPoliticsTables();
    
    // Get all guilds with politics enabled
    const activeGuilds = await getActivePoliticsGuilds();
    
    if (!activeGuilds || activeGuilds.length === 0) {
      return; // No active guilds
    }
    
    //logger.debug(`Found ${activeGuilds.length} guilds with political news enabled`);
    
    // Check each guild
    for (const guildSettings of activeGuilds) {
      try {
        // Check if a summary is due
        const isDue = await isPoliticsSummaryDue(guildSettings);
        
        if (isDue) {
          logger.info(`Political news summary is due for guild ${guildSettings.guild_id}`);
          
          // Generate and send the summary
          await generateAndSendPoliticsSummary(guildSettings, discordClientRef);
        }
      } catch (guildError) {
        logger.error(`Error processing political news for guild ${guildSettings.guild_id}:`, guildError);
        // Continue with next guild
      }
    }
  } catch (error) {
    logger.error('Error processing political news summaries:', error);
  }
}