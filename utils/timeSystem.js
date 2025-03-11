// timeSystem.js - Time awareness and calendar system for Bri
import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';
import { openai } from '../services/combinedServices.js';
import { supabase } from '../services/combinedServices.js';

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
    SCHEDULED_MESSAGES: 'bri_scheduled_messages'
  };

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
        !messageData.message_content || !messageData.cron_schedule) {
      logger.error("Missing required fields for scheduled message creation:", messageData);
      return null;
    }
    
    // Create the scheduled message
    const { data, error } = await supabase
      .from('bri_scheduled_messages')
      .insert({
        channel_id: messageData.channel_id,
        message_type: messageData.message_type,
        message_content: messageData.message_content,
        cron_schedule: messageData.cron_schedule,
        timezone: messageData.timezone || DEFAULT_TIMEZONE,
        is_active: true
      })
      .select()
      .single();
      
    if (error) {
      logger.error("Error creating scheduled message:", error);
      return null;
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
      const match = lowerDateText.match(/in (\d+) (day|days|week|weeks|month|months)/);
      if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2];
        
        targetDate = new Date(userNow);
        
        if (unit === 'day' || unit === 'days') {
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

Write a natural, friendly message as Bri (a helpful AI assistant with the personality of a 10-year-old girl)
asking how the event went. Be enthusiastic but keep it brief (2-3 sentences maximum).
Don't add any emoji at the beginning or end of the message.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are Bri, a helpful AI assistant with the personality of a 10-year-old girl." },
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
    
    // Send the message
    await channel.send(scheduledMessage.message_content);
    
    logger.info(`Sent scheduled message to channel ${scheduledMessage.channel_id}`);
  } catch (error) {
    logger.error(`Error sending scheduled message ${scheduledMessage.id}:`, error);
  }
}

// For cron schedules, you may want to add a library like 'node-cron'
// But here's a simple setup for periodic checking
let timeEventInterval = null;

/**
 * Start the time-aware event processing
 * @param {number} intervalMinutes - Check interval in minutes
 */
export function startTimeEventProcessing(client, intervalMinutes = 1) {
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
  
  // Set up interval
  timeEventInterval = setInterval(() => {
    processTimeAwareEvents().catch(error => {
      logger.error("Error in time event processing interval:", error);
    });
  }, intervalMs);
  
  logger.info(`Started time event processing with ${intervalMinutes} minute interval`);
  
  // Run once immediately
  processTimeAwareEvents().catch(error => {
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