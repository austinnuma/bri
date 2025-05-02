// timeParser.js - Enhanced date and time parsing functions
import { createClient } from '@supabase/supabase-js';
import * as chrono from 'chrono-node';
import { zonedTimeToUtc, utcToZonedTime, format } from 'date-fns-tz';
import { addDays, addHours, isBefore, isAfter, parse } from 'date-fns';
import { logger } from './logger.js';
import { supabase } from '../services/combinedServices.js';
import { openai } from '../services/combinedServices.js';
import { getUserTimezone } from './timeSystem.js';



// Default timezone (fallback when user hasn't set one)
const DEFAULT_TIMEZONE = 'America/Chicago';

/**
 * Enhanced function to parse time specifications using chrono-node
 * @param {string} dateText - The date text (e.g., "tomorrow", "next Monday")
 * @param {string} timeText - The time text (e.g., "3pm", "15:30")
 * @param {string} timezone - The user's timezone
 * @param {Date|null} referenceDate - Optional reference date (defaults to now)
 * @returns {Date|null} - Parsed Date object or null if invalid
 */
export function parseTimeSpecification(dateText, timeText, timezone = DEFAULT_TIMEZONE, referenceDate = null) {
  try {
    // If no dateText or timeText, return null
    if ((!dateText || dateText.trim() === '') && (!timeText || timeText.trim() === '')) {
      return null;
    }

    // Create reference date in the user's timezone if not provided
    if (!referenceDate) {
      const now = new Date();
      referenceDate = utcToZonedTime(now, timezone);
    }

    // Combine date and time text
    const combinedText = `${dateText || ''} ${timeText || ''}`.trim();
    
    // Try with chrono-node custom parsing
    const customChrono = createCustomChrono();
    const chronoResults = customChrono.parse(combinedText, referenceDate, {
      forwardDate: true, // Try to interpret dates as in the future
    });
    
    // If chrono found a valid date
    if (chronoResults && chronoResults.length > 0) {
      const parsedDate = chronoResults[0].start.date();
      
      // Handle special case: If only time (no date) is specified and it's earlier than now,
      // it might refer to tomorrow
      if (!dateText && timeText && 
          isOnlyTimeSpecified(chronoResults[0]) && 
          isBefore(parsedDate, referenceDate)) {
        // Add a day if the parsed time is earlier than current time
        return addDays(parsedDate, 1);
      }
      
      // Return the parsed date
      return parsedDate;
    }
    
    // If chrono-node fails, try fallback parsing
    const result = fallbackParsing(dateText, timeText, timezone, referenceDate);
    
    if (result) {
      return result;
    }
    
    // If all parsing fails
    logger.warn(`Could not parse date/time: ${combinedText} in timezone ${timezone}`);
    return null;
  } catch (error) {
    logger.error("Error in parseTimeSpecification:", error);
    // Fall back to the legacy parser as last resort
    return legacyParseTimeSpecification(dateText, timeText, timezone);
  }
}

/**
 * Create a customized instance of chrono with enhanced parsing capabilities
 * @returns {chrono.Chrono} - Custom chrono instance
 */
function createCustomChrono() {
  // Create a custom parser that extends chrono's capabilities
  const custom = chrono.casual.clone();
  
  // Add custom parsers for specific patterns
  // Examples:
  // - "gotta be up at 5am" (implied tomorrow morning)
  // - "need to leave in 20" (implied 20 minutes)
  
  // Parser for "in X" where X is just a number (assumed to be minutes)
  custom.parsers.push({
    pattern: () => {
      return /\b(?:in|within)\s+(\d+)(?:\s*(?:mins?|minutes?))?\b/i;
    },
    extract: (context, match) => {
      const minutes = parseInt(match[1]);
      if (isNaN(minutes)) return null;
      
      const result = context.createParsingResult(
        match.index, 
        match.index + match[0].length
      );
      
      const refDate = context.refDate || new Date();
      result.start.imply('hour', refDate.getHours());
      result.start.imply('minute', refDate.getMinutes() + minutes);
      
      return result;
    }
  });
  
  // Parser for sleep-related time patterns like "gotta be up at 5am"
  custom.parsers.push({
    pattern: () => {
      return /\b(?:(?:have|got|gotta|need)\s+to\s+(?:be\s+up|wake|wake\s+up|get\s+up))(?:\s+(?:at|by|before))?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
    },
    extract: (context, match) => {
      let hour = parseInt(match[1]);
      const minute = match[2] ? parseInt(match[2]) : 0;
      const meridiem = match[3] ? match[3].toLowerCase() : null;
      
      // Default to AM for waking up times if not specified
      if (!meridiem && hour < 12) {
        // Assume AM for wake-up times 1-11
      } else if (meridiem === 'pm' && hour < 12) {
        hour += 12;
      } else if (meridiem === 'am' && hour === 12) {
        hour = 0;
      }
      
      const result = context.createParsingResult(
        match.index, 
        match.index + match[0].length
      );
      
      const refDate = context.refDate || new Date();
      let targetDate = new Date(refDate);
      
      // Set the time
      targetDate.setHours(hour, minute, 0, 0);
      
      // If the time would be in the past, assume tomorrow
      if (targetDate <= refDate) {
        targetDate = addDays(targetDate, 1);
      }
      
      result.start.assign('hour', hour);
      result.start.assign('minute', minute);
      result.start.assign('day', targetDate.getDate());
      result.start.assign('month', targetDate.getMonth() + 1);
      result.start.assign('year', targetDate.getFullYear());
      
      return result;
    }
  });
  
  return custom;
}

/**
 * Check if only time is specified in the chrono parse result
 * @param {Object} chronoResult - A single chrono parse result
 * @returns {boolean} - Whether only time was specified
 */
function isOnlyTimeSpecified(chronoResult) {
  // If the component doesn't have day, month, or year, but has hour,
  // it's likely only the time was specified
  const components = chronoResult.start.knownValues;
  const impliedComponents = chronoResult.start.impliedValues;
  
  const hasTimeComponent = components.hasOwnProperty('hour');
  const hasExplicitDateComponent = 
    components.hasOwnProperty('day') || 
    components.hasOwnProperty('month') || 
    components.hasOwnProperty('year') ||
    components.hasOwnProperty('weekday');
  
  return hasTimeComponent && !hasExplicitDateComponent;
}

/**
 * Fallback parsing method for when chrono-node fails
 * @param {string} dateText - Date text
 * @param {string} timeText - Time text
 * @param {string} timezone - Timezone
 * @param {Date} referenceDate - Reference date
 * @returns {Date|null} - Parsed date or null
 */
function fallbackParsing(dateText, timeText, timezone, referenceDate) {
  try {
    // Check for common patterns that chrono might miss
    
    // Handle "this weekend", "next weekend", etc.
    if (dateText && dateText.toLowerCase().includes('weekend')) {
      const now = referenceDate || new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
      
      let targetDate = new Date(now);
      
      if (dateText.toLowerCase().includes('next')) {
        // Next weekend
        const daysUntilNextSaturday = (13 - currentDay) % 7; // Days until Saturday
        targetDate.setDate(now.getDate() + daysUntilNextSaturday);
      } else {
        // This weekend (current or upcoming)
        const daysUntilSaturday = (6 - currentDay + 7) % 7; // Days until Saturday
        if (daysUntilSaturday === 0 && now.getHours() >= 18) {
          // If it's already Saturday evening, interpret as tomorrow (Sunday)
          targetDate.setDate(now.getDate() + 1);
        } else if (daysUntilSaturday === 0 || daysUntilSaturday === 6) {
          // If today is already weekend (Sat or Sun)
          // Keep the current date
        } else {
          // Set to the upcoming Saturday
          targetDate.setDate(now.getDate() + daysUntilSaturday);
        }
      }
      
      // If time is specified, try to set it
      if (timeText) {
        const timeParts = parseTimeParts(timeText);
        if (timeParts) {
          targetDate.setHours(timeParts.hours, timeParts.minutes, 0, 0);
        }
      } else {
        // Default weekend time to noon if not specified
        targetDate.setHours(12, 0, 0, 0);
      }
      
      return targetDate;
    }
    
    // Handle numeric dates in various formats (MM/DD, DD.MM, etc.)
    if (dateText && /^(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{2,4}))?$/.test(dateText)) {
      const match = dateText.match(/^(\d{1,2})[\/\.-](\d{1,2})(?:[\/\.-](\d{2,4}))?$/);
      let [_, first, second, year] = match;
      
      const now = referenceDate || new Date();
      let month, day;
      
      // Try to determine if it's MM/DD or DD/MM format
      // For US users, assume MM/DD, for others, assume DD/MM
      // This is a simplified approach - in production, you'd want to use locale
      if (timezone.includes('America')) {
        // US format: MM/DD
        month = parseInt(first) - 1; // 0-based month
        day = parseInt(second);
      } else {
        // Non-US format: DD/MM
        day = parseInt(first);
        month = parseInt(second) - 1; // 0-based month
      }
      
      // Validate month and day
      if (month < 0 || month > 11 || day < 1 || day > 31) {
        return null;
      }
      
      // If year is not specified, use current year
      if (!year) {
        year = now.getFullYear();
      } else {
        // Handle 2-digit years
        year = parseInt(year);
        if (year < 100) {
          year += year < 50 ? 2000 : 1900;
        }
      }
      
      const parsedDate = new Date(year, month, day);
      
      // If time is specified, try to set it
      if (timeText) {
        const timeParts = parseTimeParts(timeText);
        if (timeParts) {
          parsedDate.setHours(timeParts.hours, timeParts.minutes, 0, 0);
        }
      }
      
      return parsedDate;
    }
    
    return null;
  } catch (error) {
    logger.error("Error in fallback date parsing:", error);
    return null;
  }
}

/**
 * Parse time parts from a time string
 * @param {string} timeText - Time text (e.g. "3:30pm", "15:45")
 * @returns {Object|null} - Object with hours and minutes
 */
function parseTimeParts(timeText) {
  if (!timeText) return null;
  
  const lowerTimeText = timeText.toLowerCase().trim();
  
  // Handle "3:30pm" format
  if (lowerTimeText.includes(':')) {
    const [hoursStr, minutesPart] = lowerTimeText.split(':');
    let minutes = minutesPart;
    let isPM = false;
    
    if (minutesPart.includes('pm')) {
      minutes = minutesPart.replace(/pm.*/, '').trim();
      isPM = true;
    } else if (minutesPart.includes('am')) {
      minutes = minutesPart.replace(/am.*/, '').trim();
    }
    
    let hours = parseInt(hoursStr);
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    
    return {
      hours,
      minutes: parseInt(minutes)
    };
  } 
  // Handle "3pm" format
  else if (lowerTimeText.includes('am') || lowerTimeText.includes('pm')) {
    const isPM = lowerTimeText.includes('pm');
    const hours = parseInt(lowerTimeText.replace(/[^0-9]/g, ''));
    
    let adjustedHours = hours;
    if (isPM && adjustedHours < 12) adjustedHours += 12;
    if (!isPM && adjustedHours === 12) adjustedHours = 0;
    
    return {
      hours: adjustedHours,
      minutes: 0
    };
  } 
  // Handle "15" or "3" format (assuming hour)
  else {
    const hours = parseInt(lowerTimeText);
    if (!isNaN(hours)) {
      return {
        hours,
        minutes: 0
      };
    }
  }
  
  return null;
}

/**
 * Legacy implementation of time parsing (kept as fallback)
 * @param {string} dateText - Date text
 * @param {string} timeText - Time text
 * @param {string} timezone - Timezone
 * @returns {Date|null} - Parsed date
 */
function legacyParseTimeSpecification(dateText, timeText, timezone = DEFAULT_TIMEZONE) {
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
    logger.error("Error in legacy parseTimeSpecification:", error);
    return null;
  }
}

/**
 * Parse a custom date format (legacy function)
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
    
    return null;
  } catch (error) {
    logger.error("Error parsing custom date:", error);
    return null;
  }
}

/**
 * Temporary storage for recently processed messages to avoid duplicates
 * Uses a Map with keys as message IDs and values as timestamps
 */
const recentProcessedMessages = new Map();

/**
 * Process cleanup for the recentProcessedMessages Map
 * Removes entries older than the specified TTL
 */
function cleanupRecentProcessedMessages() {
  const now = Date.now();
  const TTL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
  
  for (const [messageId, timestamp] of recentProcessedMessages.entries()) {
    if (now - timestamp > TTL) {
      recentProcessedMessages.delete(messageId);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupRecentProcessedMessages, 60 * 60 * 1000);


/**
 * Enhanced function to extract time and event information from messages
 * @param {string} message - The message content
 * @param {string} userId - The user's ID (optional)
 * @param {string} messageId - Unique message ID to prevent duplicate processing (optional)
 * @returns {Promise<Object|null>} - Extracted time/event or null
 */
export async function extractTimeAndEvent(message, userId = null, messageId = null) {
  try {
    // If message is too short, skip processing
    if (!message || message.length < 3) {
      return null;
    }

    // Skip if the message doesn't contain any potential time indicators
    // This is a quick check before doing more expensive processing
    const timeIndicators = [
      'today', 'tomorrow', 'tonight', 'morning', 'afternoon', 'evening',
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'next week', 'weekend', 'month', 'year',
      'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
      'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
      ':00', ':15', ':30', ':45', 'am', 'pm', 'noon', 'midnight',
      'schedule', 'appointment', 'meeting', 'reminder', 'event',
      'in a ', 'in an ', 'in two ', 'in three ', 'in four ', 'in five ', 'in 1 ', 'in 2 ', 'in 3 ',
      'wake up', 'be up', 'wake me', 'alarm'
    ];
    
    const lowerMessage = message.toLowerCase();
    // Check if message contains time indicators or has numbers with potential time formats
    const hasTimeIndicator = timeIndicators.some(indicator => lowerMessage.includes(indicator));
    const hasTimePattern = /\b([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]\b/.test(lowerMessage) || // HH:MM format
                           /\b([0-9]|1[0-2])\s*(am|pm)\b/i.test(lowerMessage) || // H AM/PM format
                           /\b(at|by|before|after|around|circa)\s+([0-9]|1[0-2])\b/i.test(lowerMessage); // "at X" time pattern
    
    if (!hasTimeIndicator && !hasTimePattern) {
      return null;
    }
    
    // Get the user's timezone if userId is provided
    let userTimezone = DEFAULT_TIMEZONE;
    if (userId) {
      userTimezone = await getUserTimezone(userId);
    }
    
    // Get current date/time in the user's timezone
    const now = new Date();
    
    // Format current date and time in a readable way for the AI
    const currentDate = format(now, 'EEEE, MMMM d, yyyy', { timeZone: userTimezone });
    const currentTime = format(now, 'h:mm a', { timeZone: userTimezone });
    
    // Format the prompt for the AI assistant
    const prompt = `
Extract any time-related information and potential events from this message.

CURRENT CONTEXT:
- Current Date: ${currentDate}
- Current Time: ${currentTime}
- User's Timezone: ${userTimezone}

Look for:
1. Specific dates and times
2. Relative timeframes ("tomorrow", "next week", "in 3 days")
3. Event types (meeting, appointment, birthday, reminder, etc.)
4. Event details (title, description, location)

Special cases to handle carefully:
- If no specific date is mentioned but a time is (e.g., "5am"), assume it's today or tomorrow based on context:
  - If the time has already passed today, assume tomorrow
  - If it's late at night (after 9pm) and someone mentions a morning time (before noon), assume tomorrow
  - For phrases like "goodnight, gotta be up at 5am", always assume they mean the next morning
- For vague phrases like "this evening" or "tonight", interpret based on current time
- If someone mentions a day of the week, determine if they mean this week or next week based on the current day

Format your response as JSON:
{
  "hasTimeInfo": true/false,
  "event": {
    "title": "Event title or good guess based on context",
    "date": "YYYY-MM-DD", // formatted date, null if unclear
    "time": "HH:MM", // 24-hour format, null if unclear
    "endDate": "YYYY-MM-DD", // for multi-day events, null if same as date
    "endTime": "HH:MM", // for timed events, null if not specified
    "type": "appointment/reminder/event/etc", // best guess at event type
    "description": "Additional details about the event"
  }
}

If no time information is present, return {"hasTimeInfo": false}

USER MESSAGE: "${message}"`;

    // Generate a system message that emphasizes the current context
    const systemMessage = `You are a specialized time and event extraction assistant that identifies date, time, and event information in messages.

Key aspects of your role:
1. Be attentive to implied dates/times based on context
2. Remember that the CURRENT TIME plays a crucial role in interpreting relative time references
3. Always convert ambiguous times to concrete dates/times based on the current context
4. Focus on extracting practical, usable time information for scheduling purposes
5. Return hasTimeInfo: false if the message doesn't contain actionable time information`;

    // Call the AI to extract time information
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
      temperature: 0.2, // Lower temperature for more consistent parsing
    });
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(completion.choices[0].message.content);
    } catch (parseError) {
      logger.error("Error parsing AI response:", parseError);
      return null;
    }
    
    // If no time information was found
    if (!result.hasTimeInfo) {
      return null;
    }
    
    // Store the extraction result for future context
    if (userId) {
      storeTimeExtractionResultForContext(userId, message, result.event).catch(error => {
        logger.error("Error storing time extraction result:", error);
      });
    }
    
    return result.event;
  } catch (error) {
    logger.error("Error extracting time and event information:", error);
    return null;
  }
}

/**
 * Store time extraction results for future context enhancement
 * @param {string} userId - User ID
 * @param {string} message - Original message
 * @param {Object} eventInfo - Extracted event information
 * @returns {Promise<boolean>} - Success status
 */
async function storeTimeExtractionResultForContext(userId, message, eventInfo) {
  try {
    // Skip storage for events without a date
    if (!eventInfo.date) {
      return false;
    }
    
    // Create a reference date from the extracted event
    const referenceDate = new Date(`${eventInfo.date}T${eventInfo.time || '12:00:00'}`);
    
    // Only store if date is valid
    if (isNaN(referenceDate.getTime())) {
      return false;
    }
    
    // Store in the date_reference_context table
    const { error } = await supabase
      .from('date_reference_context')
      .insert({
        user_id: userId,
        message_context: message.substring(0, 500), // Store only the first 500 chars
        reference_date: referenceDate.toISOString()
      });
      
    if (error) {
      logger.error("Error storing date reference context:", error);
      return false;
    }
    
    // Cleanup old entries (keep only last 10)
    const { error: cleanupError } = await supabase.rpc('cleanup_date_reference_context', {
      p_user_id: userId,
      p_keep_count: 10
    });
    
    if (cleanupError) {
      logger.error("Error cleaning up date reference context:", cleanupError);
    }
    
    return true;
  } catch (error) {
    logger.error("Error in storeTimeExtractionResultForContext:", error);
    return false;
  }
}

/**
 * Get recent time references for a user to provide context for ambiguous messages
 * @param {string} userId - User ID 
 * @param {number} limit - Maximum number of references to return
 * @returns {Promise<Array>} - Recent time references
 */
export async function getRecentTimeReferences(userId, limit = 3) {
  try {
    // Get recent time references from the database
    const { data, error } = await supabase
      .from('date_reference_context')
      .select('message_context, reference_date')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
      
    if (error) {
      logger.error("Error fetching recent time references:", error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error("Error in getRecentTimeReferences:", error);
    return [];
  }
}