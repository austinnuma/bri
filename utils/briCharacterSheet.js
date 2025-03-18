// briCharacterSheet.js - Character sheet and routine tracking for Bri's journal system
import { openai, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getUserTimezone } from './timeSystem.js';

/**
 * Schema for character sheet and routine tracking
 * Contains information about Bri's life extracted from journal entries
 */
const CHARACTER_SHEET_SCHEMA = {
  // Personal information
  name: "Bri",
  age: 14,
  
  // Relationships
  family: [], // Array of family members {name, relation, details}
  friends: [], // Array of friends {name, details, lastMentioned}
  pets: [], // Array of pets {name, type, details}
  
  // Activities and routines
  hobbies: [], // Array of hobbies {name, details, lastMentioned}
  
  // School information
  school: {
    name: null,
    grade: null,
    favoriteSubjects: [],
    classes: [], // Array of classes {name, time, day, details}
    teachers: [], // Array of teachers {name, subject, details}
  },
  
  // Life events and plans
  upcomingEvents: [], // Array of future events {name, date, details, mentioned}
  recentEvents: [], // Array of past events {name, date, details, mentioned}
};

/**
 * Schedule information for determining when to post
 * This helps ensure consistency with school/activity schedule
 */
const DEFAULT_ROUTINE = {
  // Default weekday schedule (school days)
  weekday: {
    morningRoutine: "Gets ready for school and has breakfast around 7 AM",
    schoolHours: "In school from 8 AM to 3 PM",
    afterSchool: "Usually home by 3:30 PM, does homework and activities afterwards",
    eveningRoutine: "Dinner around 6 PM, free time until 10 PM bedtime",
  },
  
  // Weekend schedule
  weekend: {
    morningRoutine: "Sleeps in until around 9 AM on weekends",
    daytimeActivities: "Free time for hobbies and hanging out with friends",
    eveningRoutine: "Similar to weekdays but with more flexibility",
  },
  
  // Special schedules (holidays, breaks)
  specialDays: []
};

/**
 * Initialize character sheet and routine system
 * Creates necessary database tables if they don't exist
 */
export async function initializeCharacterSheetSystem() {
  try {
    logger.info("Initializing character sheet and routine system...");
    
    // Check if the bri_character_sheet table exists
    const { error: sheetCheckError } = await supabase
      .from('bri_character_sheet')
      .select('id')
      .limit(1);
      
    // Create table if it doesn't exist
    if (sheetCheckError && sheetCheckError.code === '42P01') {
      logger.info("Creating bri_character_sheet table...");
      
      try {
        // Try to create the table using plain SQL
        const { error } = await supabase.query(`
          CREATE TABLE IF NOT EXISTS bri_character_sheet (
            id SERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            sheet JSONB NOT NULL,
            routine JSONB NOT NULL,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `);
        
        if (error) {
          logger.warn("Manual creation of character sheet table may have failed:", error);
        } else {
          logger.info("Character sheet table created successfully");
        }
      } catch (createError) {
        logger.error("Error creating character sheet table:", createError);
      }
    } else {
      logger.info("Character sheet table already exists");
    }
    
    // Check if the bri_pending_interests table exists
    const { error: pendingInterestsCheckError } = await supabase
      .from('bri_pending_interests')
      .select('id')
      .limit(1);
      
    // Create table if it doesn't exist
    if (pendingInterestsCheckError && pendingInterestsCheckError.code === '42P01') {
      logger.info("Creating bri_pending_interests table...");
      
      try {
        // Try to create the table using plain SQL
        const { error } = await supabase.query(`
          CREATE TABLE IF NOT EXISTS bri_pending_interests (
            id SERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            interest_id INTEGER NOT NULL,
            interest_name TEXT NOT NULL,
            is_new BOOLEAN DEFAULT FALSE,
            level INTEGER,
            added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `);
        
        if (error) {
          logger.warn("Manual creation of pending interests table may have failed:", error);
        } else {
          logger.info("Pending interests table created successfully");
        }
      } catch (createError) {
        logger.error("Error creating pending interests table:", createError);
      }
    } else {
      logger.info("Pending interests table already exists");
    }
    
    logger.info("Character sheet system initialization complete");
  } catch (error) {
    logger.error("Error initializing character sheet system:", error);
  }
}

/**
 * Gets the character sheet for a specific guild
 * @param {string} guildId - The guild ID 
 * @returns {Promise<Object>} - The character sheet and routine
 */
export async function getCharacterSheet(guildId) {
  try {
    // Try to get existing character sheet for this guild
    const { data, error } = await supabase
      .from('bri_character_sheet')
      .select('sheet, routine')
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        // Create a new character sheet for this guild
        const newSheet = { ...CHARACTER_SHEET_SCHEMA };
        const newRoutine = { ...DEFAULT_ROUTINE };
        
        const { data: createdData, error: createError } = await supabase
          .from('bri_character_sheet')
          .insert({
            guild_id: guildId,
            sheet: newSheet,
            routine: newRoutine
          })
          .select('sheet, routine')
          .single();
          
        if (createError) {
          logger.error(`Error creating character sheet for guild ${guildId}:`, createError);
          return { sheet: newSheet, routine: newRoutine };
        }
        
        return createdData;
      }
      
      logger.error(`Error fetching character sheet for guild ${guildId}:`, error);
      return { sheet: { ...CHARACTER_SHEET_SCHEMA }, routine: { ...DEFAULT_ROUTINE } };
    }
    
    return data;
  } catch (error) {
    logger.error(`Error in getCharacterSheet for guild ${guildId}:`, error);
    return { sheet: { ...CHARACTER_SHEET_SCHEMA }, routine: { ...DEFAULT_ROUTINE } };
  }
}

/**
 * Updates the character sheet for a specific guild
 * @param {string} guildId - The guild ID
 * @param {Object} sheet - Updated character sheet
 * @param {Object} routine - Updated routine
 * @returns {Promise<boolean>} - Success status
 */
export async function updateCharacterSheet(guildId, sheet, routine) {
  try {
    const { error } = await supabase
      .from('bri_character_sheet')
      .update({
        sheet: sheet,
        routine: routine,
        last_updated: new Date().toISOString()
      })
      .eq('guild_id', guildId);
      
    if (error) {
      logger.error(`Error updating character sheet for guild ${guildId}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in updateCharacterSheet for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Extracts character information from journal entries
 * @param {Array} entries - Recent journal entries
 * @param {Object} currentSheet - Current character sheet
 * @param {Object} currentRoutine - Current routine
 * @returns {Promise<Object>} - Updated character sheet and routine
 */
export async function extractCharacterInfo(entries, currentSheet, currentRoutine) {
  try {
    if (!entries || entries.length === 0) {
      return { sheet: currentSheet, routine: currentRoutine };
    }
    
    // Combine entries into a single text for analysis
    const entriesText = entries.map(entry => 
      `TITLE: ${entry.title}\nCONTENT: ${entry.content}\nDATE: ${new Date(entry.created_at).toISOString()}`
    ).join('\n\n');
    
    // Current sheet and routine as JSON strings
    const currentSheetJson = JSON.stringify(currentSheet, null, 2);
    const currentRoutineJson = JSON.stringify(currentRoutine, null, 2);
    
    const prompt = `
You are analyzing a 14-year-old girl's journal entries to update her character sheet and routine.

CURRENT CHARACTER SHEET:
${currentSheetJson}

CURRENT ROUTINE:
${currentRoutineJson}

RECENT JOURNAL ENTRIES:
${entriesText}

Extract any new information from these journal entries that should be added to the character sheet or routine.
Look for:
1. Mentions of family members, friends, or pets
2. School details (classes, teachers, subjects)
3. Hobbies and interests
4. Upcoming plans or events
5. Recent past events that were significant
6. Daily routine information

Format your response as JSON with two main objects:
{
  "updatedSheet": {
    // Full updated character sheet including all previous and new information
    // (Just copy each section from the current sheet and add/update as needed)
  },
  "updatedRoutine": {
    // Full updated routine including all previous and new information
    // (Just copy each section from the current routine and add/update as needed)
  },
  "rationale": "Brief explanation of what was added or changed"
}

IMPORTANT: Maintain the same structure as the original objects. Include ALL existing information plus any new details.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-16k",
      messages: [
        { 
          role: "system", 
          content: "You are a specialist in analyzing journal entries and building consistent character profiles. You carefully extract details while maintaining the existing character information."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 3000,
    });
    
    const result = JSON.parse(completion.choices[0].message.content);
    
    // Log the rationale to understand what was changed
    logger.info(`Character sheet update rationale: ${result.rationale}`);
    
    return {
      sheet: result.updatedSheet,
      routine: result.updatedRoutine
    };
  } catch (error) {
    logger.error("Error extracting character info from journal entries:", error);
    return { sheet: currentSheet, routine: currentRoutine };
  }
}

/**
 * Queue an interest for a consolidated update post
 * @param {Object} interest - Interest object
 * @param {boolean} isNew - Whether this is a new interest
 * @param {string} guildId - Guild ID
 * @returns {Promise<boolean>} - Success status
 */
export async function queueInterestForJournal(interest, isNew, guildId) {
  try {
    // Insert into pending interests table
    const { error } = await supabase
      .from('bri_pending_interests')
      .insert({
        guild_id: guildId,
        interest_id: interest.id,
        interest_name: interest.name,
        is_new: isNew,
        level: interest.level || interest.guild_level || 1
      });
      
    if (error) {
      logger.error(`Error queuing interest ${interest.name} for journal:`, error);
      return false;
    }
    
    logger.info(`Queued interest ${interest.name} for journal in guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error in queueInterestForJournal for ${interest.name}:`, error);
    return false;
  }
}

/**
 * Checks for pending interest updates and creates a consolidated journal entry
 * @param {string} guildId - Guild ID
 * @returns {Promise<boolean>} - Whether an entry was created
 */
export async function processConsolidatedInterestUpdates(guildId) {
  try {
    // Check if there are any pending interest updates
    const { data, error } = await supabase
      .from('bri_pending_interests')
      .select('*')
      .eq('guild_id', guildId);
      
    if (error) {
      logger.error(`Error checking pending interests for guild ${guildId}:`, error);
      return false;
    }
    
    if (!data || data.length === 0) {
      logger.info(`No pending interests for guild ${guildId}`);
      return false;
    }
    
    // Group interests by new vs updated
    const newInterests = data.filter(i => i.is_new);
    const updatedInterests = data.filter(i => !i.is_new);
    
    // Generate consolidated journal entry
    const entry = await generateConsolidatedInterestEntry(newInterests, updatedInterests, guildId);
    if (!entry) {
      return false;
    }
    
    // Import only what we need from journalSystem to avoid circular dependencies
    const { postJournalEntry, storeJournalEntry, JOURNAL_ENTRY_TYPES } = await import('./journalSystem.js');
    
    // Post to Discord
    const message = await postJournalEntry(entry.title, entry.content, guildId);
    
    // Store in database
    const storedEntry = await storeJournalEntry({
      entry_type: JOURNAL_ENTRY_TYPES.INTEREST_UPDATE,
      title: entry.title,
      content: entry.content,
      related_id: null,
      metadata: {
        new_interests: newInterests.map(i => i.interest_name),
        updated_interests: updatedInterests.map(i => i.interest_name)
      },
      guild_id: guildId
    });
    
    // Clear the pending interests
    const { error: clearError } = await supabase
      .from('bri_pending_interests')
      .delete()
      .eq('guild_id', guildId);
      
    if (clearError) {
      logger.error(`Error clearing pending interests for guild ${guildId}:`, clearError);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in processConsolidatedInterestUpdates for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Generates a consolidated journal entry for multiple interest updates
 * @param {Array} newInterests - New interests
 * @param {Array} updatedInterests - Updated interests
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} - Generated entry with title and content
 */
async function generateConsolidatedInterestEntry(newInterests, updatedInterests, guildId) {
  try {
    // Get full interest details for each interest
    const interestIds = [...newInterests, ...updatedInterests].map(i => i.interest_id);
    
    // If no interests, return null
    if (interestIds.length === 0) {
      return null;
    }
    
    const { data: interestDetails, error } = await supabase
      .from('bri_interests')
      .select('*')
      .in('id', interestIds);
      
    if (error) {
      logger.error(`Error fetching interest details for consolidated entry:`, error);
      return null;
    }
    
    // Prepare the data for the prompt
    const newInterestsData = newInterests.map(i => {
      const details = interestDetails.find(d => d.id === i.interest_id);
      return {
        name: i.interest_name,
        description: details?.description || "",
        facts: details?.facts || [],
        level: i.level
      };
    });
    
    const updatedInterestsData = updatedInterests.map(i => {
      const details = interestDetails.find(d => d.id === i.interest_id);
      return {
        name: i.interest_name,
        description: details?.description || "",
        facts: details?.facts || [],
        level: i.level
      };
    });
    
    const prompt = `
Generate a journal entry written by Bri, a 14-year-old girl, about her interests.

${newInterestsData.length > 0 ? 
  `NEW INTERESTS:
${JSON.stringify(newInterestsData, null, 2)}` : 
  "NO NEW INTERESTS"}

${updatedInterestsData.length > 0 ? 
  `UPDATED INTERESTS:
${JSON.stringify(updatedInterestsData, null, 2)}` : 
  "NO UPDATED INTERESTS"}

Write a personal journal entry from Bri's perspective about these interests.
The entry should:
1. Be written in first person as a 14-year-old girl's journal
2. Express excitement about her interests
3. Discuss BOTH new discoveries and deeper explorations of existing interests
4. Include specific facts or details about the interests
5. Express emotions and feelings
6. Be 2-4 paragraphs long
7. Use appropriate language, tone, and vocabulary for a 14-year-old
8. Sound authentic and personal
9. Include thoughts about how she wants to explore these interests further

Format your response as JSON:
{
  "title": "Journal title (creative and specific to the interests)",
  "content": "The full journal entry text (2-4 paragraphs)"
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are a creative writer specialized in authentic teen journal writing. Generate journal entries that sound like they were truly written by a 14-year-old girl, with age-appropriate vocabulary, concerns, and style."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });
    
    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    logger.error("Error generating consolidated interest journal entry:", error);
    // Return a fallback entry
    return {
      title: `My Latest Obsessions and Interests`,
      content: `I've been getting into some new things lately and also really diving deeper into stuff I already liked. ${newInterests.length > 0 ? `I just started getting into ${newInterests.map(i => i.interest_name).join(', ')}!` : ''} ${updatedInterests.length > 0 ? `I'm also getting more and more into ${updatedInterests.map(i => i.interest_name).join(', ')}.` : ''} It's so fun having new things to learn about!`
    };
  }
}

/**
 * Generates a time-appropriate journal entry based on character sheet and routine
 * @param {string} guildId - Guild ID
 * @param {Date} currentTime - Current date and time
 * @returns {Promise<Object|null>} - Generated entry with title and content
 */
export async function generateContextualJournalEntry(guildId, currentTime = new Date()) {
  try {
    // Get character sheet and routine
    const { sheet, routine } = await getCharacterSheet(guildId);
    
    // Get timezone for this guild (using first user's timezone as fallback)
    let timezone = 'America/New_York'; // Default fallback
    try {
      const { data: timezoneData } = await supabase
        .from('user_timezones')
        .select('timezone')
        .eq('guild_id', guildId)
        .limit(1)
        .single();
        
      if (timezoneData && timezoneData.timezone) {
        timezone = timezoneData.timezone;
      }
    } catch (tzError) {
      logger.debug(`Using default timezone for journal entry: ${tzError.message}`);
    }
    
    // Get time context
    const localTime = new Date(currentTime.toLocaleString('en-US', { timeZone: timezone }));
    const hour = localTime.getHours();
    const dayOfWeek = localTime.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isSchoolDay = !isWeekend && !isHoliday(localTime);
    
    // Determine general time of day
    let timeOfDay;
    if (hour >= 5 && hour < 12) {
      timeOfDay = "morning";
    } else if (hour >= 12 && hour < 17) {
      timeOfDay = "afternoon";
    } else if (hour >= 17 && hour < 22) {
      timeOfDay = "evening";
    } else {
      timeOfDay = "night";
    }
    
    // Determine specific context based on time and routine
    let specificContext;
    if (isSchoolDay) {
      if (hour >= 5 && hour < 8) {
        specificContext = "before school";
      } else if (hour >= 8 && hour < 15) {
        specificContext = "at school";
      } else if (hour >= 15 && hour < 17) {
        specificContext = "after school";
      } else {
        specificContext = "evening at home";
      }
    } else {
      // Weekend or holiday
      if (hour < 10) {
        specificContext = "weekend morning";
      } else if (hour >= 10 && hour < 18) {
        specificContext = "weekend day";
      } else {
        specificContext = "weekend evening";
      }
    }
    
    // Format date
    const dateString = localTime.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    // Format time
    const timeString = localTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: 'numeric'
    });
    
    // Get recent journal entries for context
    const { data: recentEntries, error: entriesError } = await supabase
      .from('bri_journal_entries')
      .select('title, content, created_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(3);
      
    if (entriesError) {
      logger.error(`Error fetching recent journal entries for guild ${guildId}:`, entriesError);
    }
    
    const recentEntriesText = recentEntries ? 
      recentEntries.map(entry => 
        `TITLE: ${entry.title}\nCONTENT: ${entry.content}\nDATE: ${new Date(entry.created_at).toLocaleDateString()}`
      ).join('\n\n') : 
      "No recent entries.";
    
    // Prepare the prompt with all context
    const prompt = `
Generate a journal entry written by Bri, a 14-year-old girl, on ${dateString} at ${timeString} (${timeOfDay}, ${specificContext}).

CHARACTER SHEET:
${JSON.stringify(sheet, null, 2)}

ROUTINE:
${JSON.stringify(routine, null, 2)}

TIME CONTEXT:
- Current date and time: ${dateString}, ${timeString}
- Day of week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}
- Is weekend: ${isWeekend}
- Is school day: ${isSchoolDay}
- Time of day: ${timeOfDay}
- Specific context: ${specificContext}

RECENT JOURNAL ENTRIES (for context only, don't repeat these topics directly):
${recentEntriesText}

Write a personal journal entry that:
1. Is completely authentic to a 14-year-old girl's writing style
2. Is appropriate for the current time, day, and context
3. Reflects her character and routine
4. Includes specific details about what she's doing, thinking, or feeling right now
5. Is 2-4 paragraphs long
6. Shows authentic emotions
7. Occasionally references previously mentioned friends, family, hobbies, or events from her character sheet
8. Is NOT repetitive of recent entries
9. Feels spontaneous and genuine, as if actually written by a real teen in their journal

Format your response as JSON:
{
  "title": "Journal title (creative and authentic to teen journal)",
  "content": "The full journal entry text (2-4 paragraphs)"
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-16k",
      messages: [
        { 
          role: "system", 
          content: "You are a creative writer specialized in authentic teen journal writing. Generate journal entries that sound like they were truly written by a 14-year-old girl, with age-appropriate vocabulary, concerns, and style."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });
    
    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    logger.error(`Error generating contextual journal entry for guild ${guildId}:`, error);
    return null;
  }
}

/**
 * Checks if a date is a holiday
 * @param {Date} date - The date to check
 * @returns {boolean} - Whether the date is a holiday
 */
function isHoliday(date) {
  // This is a simplified function - you could expand it with a more comprehensive list
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();
  
  // Major US holidays
  const holidays = [
    { month: 1, day: 1 },     // New Year's Day
    { month: 7, day: 4 },     // Independence Day
    { month: 12, day: 25 },   // Christmas
    { month: 12, day: 31 },   // New Year's Eve
  ];
  
  return holidays.some(h => h.month === month && h.day === day);
}

/**
 * Schedule routine journal entries based on server timezone
 * @param {string} guildId - Guild ID
 */
export async function scheduleRoutineJournalEntries(guildId) {
  try {
    // Get timezone for this guild (using first user's timezone as fallback)
    let timezone = 'America/New_York'; // Default fallback
    try {
      const { data: timezoneData } = await supabase
        .from('user_timezones')
        .select('timezone')
        .eq('guild_id', guildId)
        .limit(1)
        .single();
        
      if (timezoneData && timezoneData.timezone) {
        timezone = timezoneData.timezone;
      }
    } catch (tzError) {
      logger.debug(`Using default timezone for scheduling: ${tzError.message}`);
    }
    
    // Schedule morning entry (around 7 AM)
    const morningHour = 7;
    const morningMinute = Math.floor(Math.random() * 30); // 0-30 minutes past the hour
    scheduleContextualEntry(morningHour, morningMinute, guildId, timezone);
    
    // Schedule lunch entry (around 11:30 AM - 12:30 PM)
    const lunchHour = Math.random() < 0.5 ? 11 : 12;
    const lunchMinute = lunchHour === 11 ? 30 + Math.floor(Math.random() * 30) : Math.floor(Math.random() * 30);
    scheduleContextualEntry(lunchHour, lunchMinute, guildId, timezone);
    
    // Schedule evening entry (between 5 PM - 9 PM)
    const eveningHour = Math.floor(Math.random() * 4) + 17; // 17-20 (5 PM - 8 PM)
    const eveningMinute = Math.floor(Math.random() * 60); // 0-59 minutes
    scheduleContextualEntry(eveningHour, eveningMinute, guildId, timezone);
    
    // Add a 30% chance for a random "bonus" entry at an unexpected time
    if (Math.random() < 0.3) {
      // Random hour between 1 PM and 4 PM, or between 9 PM and 10 PM
      const randomHour = Math.random() < 0.7 ? 
        Math.floor(Math.random() * 4) + 13 : // 1 PM - 4 PM
        Math.floor(Math.random() * 2) + 21;  // 9 PM - 10 PM
      const randomMinute = Math.floor(Math.random() * 60);
      scheduleContextualEntry(randomHour, randomMinute, guildId, timezone);
    }
    
    logger.info(`Scheduled routine journal entries for guild ${guildId} in timezone ${timezone}`);
  } catch (error) {
    logger.error(`Error scheduling routine journal entries for guild ${guildId}:`, error);
  }
}

/**
 * Schedules a contextual journal entry
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 * @param {string} guildId - Guild ID
 * @param {string} timezone - Timezone
 */
function scheduleContextualEntry(hour, minute, guildId, timezone = 'America/New_York') {
  // Calculate the next occurrence of this time
  const now = new Date();
  const targetTime = new Date(now);
  
  // Convert target time to specified timezone
  const targetInTz = new Date(targetTime.toLocaleString('en-US', { timeZone: timezone }));
  
  // Set the hour and minute
  targetInTz.setHours(hour, minute, 0, 0);
  
  // If the time has already passed today, schedule for tomorrow
  if (targetInTz <= now) {
    targetInTz.setDate(targetInTz.getDate() + 1);
  }
  
  // Convert back to UTC for scheduling
  const targetUTC = new Date(targetInTz.toLocaleString('en-US', { timeZone: 'UTC' }));
  const delay = targetUTC - now;
  
  // Schedule the entry creation
  setTimeout(async () => {
    try {
      // Import only what we need from journalSystem to avoid circular dependencies
      const { postJournalEntry, storeJournalEntry, JOURNAL_ENTRY_TYPES } = await import('./journalSystem.js');
      
      // Generate contextual entry
      const entry = await generateContextualJournalEntry(guildId);
      
      if (entry) {
        // Post to Discord
        const message = await postJournalEntry(entry.title, entry.content, guildId);
        
        // Store in database
        const storedEntry = await storeJournalEntry({
          entry_type: JOURNAL_ENTRY_TYPES.DAILY_THOUGHT,
          title: entry.title,
          content: entry.content,
          related_id: null,
          metadata: {
            scheduled_hour: hour,
            scheduled_minute: minute,
            context: { 
              hour: new Date().getHours(), 
              is_weekend: [0, 6].includes(new Date().getDay()) 
            }
          },
          guild_id: guildId
        });
        
        // Process this entry to update character sheet
        await updateCharacterSheetFromEntry(guildId, { 
          title: entry.title, 
          content: entry.content,
          created_at: new Date().toISOString()
        });
      }
      
      // Reschedule for the next day
      scheduleContextualEntry(hour, minute, guildId, timezone);
    } catch (error) {
      logger.error(`Error creating scheduled contextual entry for guild ${guildId}:`, error);
      // Retry in 30 minutes
      setTimeout(() => scheduleContextualEntry(hour, minute, guildId, timezone), 30 * 60 * 1000);
    }
  }, delay);
  
  const scheduleTime = new Date(now.getTime() + delay);
  logger.info(`Scheduled journal entry for guild ${guildId} at ${scheduleTime.toLocaleString()} (${timezone}, in ${Math.round(delay/60000)} minutes)`);
}

/**
 * Updates character sheet based on a new journal entry
 * @param {string} guildId - Guild ID 
 * @param {Object} entry - Journal entry
 * @returns {Promise<boolean>} - Success status
 */
export async function updateCharacterSheetFromEntry(guildId, entry) {
  try {
    // Get current character sheet and routine
    const { sheet, routine } = await getCharacterSheet(guildId);
    
    // Extract info from the new entry
    const updatedInfo = await extractCharacterInfo([entry], sheet, routine);
    
    // Update in database
    await updateCharacterSheet(guildId, updatedInfo.sheet, updatedInfo.routine);
    
    return true;
  } catch (error) {
    logger.error(`Error updating character sheet from entry for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Processes pending interest updates on a schedule
 * @param {string} guildId - Guild ID
 */
export function schedulePendingInterestCheck(guildId) {
  try {
    // Check pending interests once a day
    const checkHour = 18; // 6 PM
    const checkMinute = Math.floor(Math.random() * 30); // 0-30 minutes past the hour
    
    // Get timezone for this guild (using default timezone as fallback)
    let timezone = 'America/New_York'; // Default fallback
    try {
      const { data: timezoneData } = supabase
        .from('user_timezones')
        .select('timezone')
        .eq('guild_id', guildId)
        .limit(1)
        .single();
        
      if (timezoneData && timezoneData.timezone) {
        timezone = timezoneData.timezone;
      }
    } catch (tzError) {
      logger.debug(`Using default timezone for interest checks: ${tzError.message}`);
    }
    
    // Calculate the next occurrence of this time
    const now = new Date();
    const targetTime = new Date(now);
    
    // Convert target time to specified timezone
    const targetInTz = new Date(targetTime.toLocaleString('en-US', { timeZone: timezone }));
    
    // Set the hour and minute
    targetInTz.setHours(checkHour, checkMinute, 0, 0);
    
    // If the time has already passed today, schedule for tomorrow
    if (targetInTz <= now) {
      targetInTz.setDate(targetInTz.getDate() + 1);
    }
    
    // Convert back to UTC for scheduling
    const targetUTC = new Date(targetInTz.toLocaleString('en-US', { timeZone: 'UTC' }));
    const delay = targetUTC - now;
    
    // Schedule the check
    setTimeout(async () => {
      try {
        // Process any pending interests
        await processConsolidatedInterestUpdates(guildId);
        
        // Reschedule for the next day
        schedulePendingInterestCheck(guildId);
      } catch (error) {
        logger.error(`Error processing pending interests for guild ${guildId}:`, error);
        // Retry in 60 minutes
        setTimeout(() => schedulePendingInterestCheck(guildId), 60 * 60 * 1000);
      }
    }, delay);
    
    const scheduleTime = new Date(now.getTime() + delay);
    logger.info(`Scheduled pending interest check for guild ${guildId} at ${scheduleTime.toLocaleString()} (${timezone}, in ${Math.round(delay/60000)} minutes)`);
  } catch (error) {
    logger.error(`Error scheduling pending interest check for guild ${guildId}:`, error);
  }
}