// briCharacterSheet.js - Character sheet and routine tracking for Bri's journal system
import { openai, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getUserTimezone } from './timeSystem.js';

/**
 * Schema for character sheet and routine tracking
 * Contains information about Bri's life extracted from journal entries
 */
// Enhanced CHARACTER_SHEET_SCHEMA with temporal awareness
const CHARACTER_SHEET_SCHEMA = {
  // Personal information with tracking for age changes
  name: "Bri",
  age: 14,
  birthday: "June 15", // Add birthday to track age progression
  lastBirthdayCelebrated: "2024-06-15", // ISO date format for last birthday recognized
  
  // Current grade tracking for school advancement
  currentSchoolYear: "2024-2025",
  currentGrade: 9, // Freshman (9th grade)
  gradeAdvancementDate: "2025-06-05", // When to advance to next grade
  
  // Relationships with temporal information
  family: [], // Array of family members {name, relation, details, lastMentioned, importance}
  friends: [], // Array of friends {name, details, lastMentioned, status, importance}
  pets: [], // Array of pets {name, type, details, lastMentioned}
  
  // Activities and routines
  hobbies: [], // Array of hobbies {name, details, lastMentioned, currentlyActive, importance}
  
  // School information
  school: {
    name: null,
    grade: null,
    favoriteSubjects: [],
    classes: [], // Array of classes {name, time, day, details, semester, schoolYear}
    teachers: [], // Array of teachers {name, subject, details, schoolYear}
  },
  
  // Life events with clear temporal categorization
  upcomingEvents: [], // Array of future events {name, date, details, importance}
  recentEvents: [], // Array of past events that occurred in the last 60 days
  pastEvents: [], // Archive of significant historical events older than 60 days
  
  // Memory categories to differentiate information importance
  significantMemories: [], // Important events/people that should persist longer
  routineMemories: [], // Day-to-day things that can fade more quickly
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

    await ensureScheduledJournalEntriesTable();
    
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

    // Schedule character sheet aging for all known guilds
    const { data: guildSheets, error: gsError } = await supabase
      .from('bri_character_sheet')
      .select('guild_id');
      
    if (!gsError && guildSheets && guildSheets.length > 0) {
      for (const sheet of guildSheets) {
        scheduleCharacterSheetAging(sheet.guild_id);
      }
    }
    
    // Add migration for existing character sheets to update their schema
    await migrateExistingCharacterSheets();
    
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
 * Extracts character information from journal entries with temporal awareness
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
    
    // Get the current date
    const currentDate = new Date().toISOString().split('T')[0];
    
    const prompt = `
You are analyzing a teenage girl's journal entries to update her character sheet and routine.
Today's date is ${currentDate}.

CURRENT CHARACTER SHEET:
${currentSheetJson}

CURRENT ROUTINE:
${currentRoutineJson}

RECENT JOURNAL ENTRIES:
${entriesText}

Extract information from these journal entries that should update the character sheet or routine.
Look for:
1. Mentions of family members, friends, or pets
2. School details (classes, teachers, subjects)
3. Hobbies and interests
4. Upcoming plans or events
5. Recent past events that were significant
6. Daily routine information

IMPORTANT TEMPORAL GUIDELINES:

1. NEW vs EXISTING INFORMATION:
   - For new entities (people, events, etc.), create complete entries with all available details
   - For existing entities, update with new information while preserving important historical context

2. EVENTS TIMING:
   - Add specific dates to events whenever possible (use ISO format YYYY-MM-DD)
   - Move events from "upcomingEvents" to "recentEvents" if they've now occurred
   - For events without specific dates, use relative timing (e.g., "next week", "last month")

3. RELATIONSHIPS & ACTIVITY TRACKING:
   - For every person or activity mentioned, update the "lastMentioned" field to today's date
   - Add "importance" ratings (high, medium, low) to relationships and hobbies based on context
   - If something previously important hasn't been mentioned recently, don't remove it, but don't artificially increase its prominence
   - Mark activities or relationships as inactive/dormant if context suggests they've ended

4. TEMPORAL CONSISTENCY:
   - Ensure the character sheet reflects an internally consistent timeline
   - Resolve contradictions by preferring more recent information
   - Maintain key developmental information (age, grade, significant life events)

Format your response as JSON with two main objects:
{
  "updatedSheet": {
    // Full updated character sheet with temporal awareness
  },
  "updatedRoutine": {
    // Full updated routine
  },
  "rationale": "Brief explanation of what was added or changed and temporal considerations"
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are a specialist in analyzing journal entries and building consistent character profiles. You carefully extract details while maintaining temporal consistency and realistic character development."
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
      model: "gpt-4o-mini",
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
  
  RECENT JOURNAL ENTRIES (IMPORTANT: for context only, don't repeat these topics directly or focus too much on the activities that already exist. create new events and activities for bri to engage in to prevent repetition):
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
  
  Format your response as a valid JSON with the following structure:
  {
    "title": "Journal title (creative and authentic to teen journal)",
    "content": "The full journal entry text (2-4 paragraphs)"
  }
  
  Make sure your response is properly formatted JSON that can be parsed. Include both a title and content field.
  `;
  
      // Option 1: Use gpt-3.5-turbo (without 16k) which supports response_format
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Changed from gpt-3.5-turbo-16k to standard gpt-3.5-turbo
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
      
      try {
        // Try to parse the JSON response
        return JSON.parse(completion.choices[0].message.content);
      } catch (parseError) {
        // If JSON parsing fails, try to extract title and content using regex
        logger.warn(`JSON parsing failed for journal entry, attempting regex extraction: ${parseError}`);
        
        const content = completion.choices[0].message.content;
        
        // Try to match JSON-like structure with regex
        const titleMatch = content.match(/"title"\s*:\s*"([^"]+)"/);
        const contentMatch = content.match(/"content"\s*:\s*"([^"]*)"/);
        
        if (titleMatch && contentMatch) {
          return {
            title: titleMatch[1],
            content: contentMatch[1].replace(/\\n/g, '\n')
          };
        }
        
        // If regex fails too, return a fallback entry
        logger.error(`Failed to extract journal entry from response: ${content}`);
        return {
          title: "My Day So Far",
          content: "Just writing a quick entry about my day. It's been pretty normal, but I wanted to get my thoughts down. Sometimes it helps to just write things out, you know? Anyway, I should get back to what I was doing. More later!"
        };
      }
    } catch (error) {
      logger.error(`Error generating contextual journal entry for guild ${guildId}:`, error);
      
      // Try fallback method without response_format if we got a specific error about response_format
      if (error.message && error.message.includes("'response_format'")) {
        try {
          logger.info(`Attempting fallback method for journal entry generation for guild ${guildId}`);
          return await generateFallbackJournalEntry(guildId);
        } catch (fallbackError) {
          logger.error(`Fallback journal generation also failed for guild ${guildId}:`, fallbackError);
        }
      }
      
      return null;
    }
}

  /**
 * Fallback method for generating journal entries that doesn't rely on response_format
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - Generated entry with title and content
 */
async function generateFallbackJournalEntry(guildId) {
  try {
    // Simplified prompt
    const prompt = `
Write a journal entry by Bri, a 14-year-old girl. Make it authentic to teen writing style with 2-3 paragraphs.

First, give me a creative title for the journal entry.
Then, write the journal entry itself in 2-3 paragraphs.

Format your response like this:
TITLE: [your title here]

[journal entry content here]
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // This model doesn't support response_format
      messages: [
        { 
          role: "system", 
          content: "You are a creative writer specialized in authentic teen journal writing."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 1000
      // No response_format parameter
    });
    
    const content = completion.choices[0].message.content;
    
    // Extract title and content
    const titleMatch = content.match(/TITLE:\s*(.+?)(?:\n|$)/);
    const title = titleMatch ? titleMatch[1].trim() : "My Journal Entry";
    
    // Extract everything after the title as content
    const contentStart = content.indexOf('\n\n');
    const journalContent = contentStart > -1 ? 
      content.substring(contentStart).trim() : 
      content.replace(/TITLE:\s*.+?\n/, '').trim();
    
    return {
      title: title,
      content: journalContent
    };
  } catch (error) {
    logger.error(`Error in fallback journal generation for guild ${guildId}:`, error);
    
    // Ultimate fallback
    return {
      title: "Quick Thoughts",
      content: "Just jotting down some quick thoughts today. Been busy with school and stuff. Nothing too exciting to report, but wanted to write something down. I'll write more later when I have more time!"
    };
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
    // Make sure the table exists
    await ensureScheduledJournalEntriesTable();
    
    // Get timezone for this guild (using first user's timezone as fallback)
    let timezone = 'America/New_York'; // Default fallback
    try {
      const { data: timezoneData, error: tzError } = await supabase
        .from('user_timezones')
        .select('timezone')
        .eq('guild_id', guildId)
        .limit(1)
        .single();
        
      if (!tzError && timezoneData && timezoneData.timezone) {
        timezone = timezoneData.timezone;
      } else if (tzError) {
        logger.debug(`Using default timezone for scheduling. Error: ${tzError.message}`);
      }
    } catch (tzError) {
      logger.debug(`Using default timezone for scheduling: ${tzError.message}`);
    }
    
    logger.info(`Setting up journal schedule for guild ${guildId} using timezone ${timezone}`);
    
    // Check if we already have schedules for this guild
    const { data: existingSchedules, error } = await supabase
      .from('scheduled_journal_entries')
      .select('*')
      .eq('guild_id', guildId)
      .eq('is_active', true);
      
    if (error) {
      logger.error(`Error checking existing journal schedules for guild ${guildId}:`, error);
    }
    
    // If we already have schedules, just re-activate them
    if (existingSchedules && existingSchedules.length > 0) {
      logger.info(`Found ${existingSchedules.length} existing journal schedules for guild ${guildId}`);
      
      // Schedule all existing entries
      for (const schedule of existingSchedules) {
        scheduleContextualEntry(
          schedule.hour, 
          schedule.minute, 
          guildId, 
          schedule.timezone || timezone, 
          schedule.entry_type
        );
      }
      
      return;
    }
    
    // Create new schedules only if none exist
    logger.info(`Creating new journal schedules for guild ${guildId}`);
    
    // Define the schedules to create
    const newSchedules = [
      // Morning entry (around 7 AM)
      {
        entry_type: "morning",
        hour: 7,
        minute: Math.floor(Math.random() * 30) // 0-30 minutes past the hour
      },
      
      // Lunch entry (around 11:30 AM - 12:30 PM)
      {
        entry_type: "lunch",
        hour: Math.random() < 0.5 ? 11 : 12,
        minute: Math.random() < 0.5 ? 
          30 + Math.floor(Math.random() * 30) : 
          Math.floor(Math.random() * 30)
      },
      
      // Evening entry (between 5 PM - 9 PM)
      {
        entry_type: "evening",
        hour: Math.floor(Math.random() * 4) + 17, // 17-20 (5 PM - 8 PM)
        minute: Math.floor(Math.random() * 60) // 0-59 minutes
      }
    ];
    
    // Add a 99% chance for a random "bonus" entry at an unexpected time
    if (Math.random() < 0.99) {
      // Random hour between 1 PM and 4 PM, or between 9 PM and 10 PM
      const randomHour = Math.random() < 0.7 ? 
        Math.floor(Math.random() * 4) + 13 : // 1 PM - 4 PM
        Math.floor(Math.random() * 2) + 21;  // 9 PM - 10 PM
        
      newSchedules.push({
        entry_type: "random",
        hour: randomHour,
        minute: Math.floor(Math.random() * 60)
      });
    }
    
    // Create each schedule in the database and activate it
    for (const schedule of newSchedules) {
      try {
        // Insert into database
        const { data: insertedSchedule, error: insertError } = await supabase
          .from('scheduled_journal_entries')
          .insert({
            guild_id: guildId,
            entry_type: schedule.entry_type,
            hour: schedule.hour,
            minute: schedule.minute,
            timezone: timezone,
            is_active: true
          })
          .select()
          .single();
          
        if (insertError) {
          logger.error(`Error creating ${schedule.entry_type} journal schedule for guild ${guildId}:`, insertError);
          continue;
        }
        
        // Schedule the entry
        scheduleContextualEntry(
          schedule.hour, 
          schedule.minute, 
          guildId, 
          timezone, 
          schedule.entry_type
        );
        
        logger.info(`Created ${schedule.entry_type} journal schedule for guild ${guildId} at ${schedule.hour}:${schedule.minute.toString().padStart(2, '0')}`);
      } catch (scheduleError) {
        logger.error(`Error creating ${schedule.entry_type} journal schedule for guild ${guildId}:`, scheduleError);
      }
    }
  } catch (error) {
    logger.error(`Error scheduling routine journal entries for guild ${guildId}:`, error);
  }
}

async function ensureScheduledJournalEntriesTable() {
  try {
    logger.info("Checking scheduled_journal_entries table...");
    
    // Check if the table exists
    const { error: checkError } = await supabase
      .from('scheduled_journal_entries')
      .select('id')
      .limit(1);
      
    // Create table if it doesn't exist
    if (checkError && checkError.code === '42P01') {
      logger.info("Creating scheduled_journal_entries table...");
      
      try {
        // Create the table using plain SQL
        const { error } = await supabase.query(`
          CREATE TABLE IF NOT EXISTS scheduled_journal_entries (
            id SERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            entry_type TEXT NOT NULL,
            hour INTEGER NOT NULL,
            minute INTEGER NOT NULL,
            timezone TEXT NOT NULL,
            last_run TIMESTAMP WITH TIME ZONE,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `);
        
        if (error) {
          logger.warn("Manual creation of scheduled entries table may have failed:", error);
        } else {
          logger.info("Scheduled journal entries table created successfully");
        }
      } catch (createError) {
        logger.error("Error creating scheduled journal entries table:", createError);
      }
    } else {
      logger.info("Scheduled journal entries table already exists");
    }
  } catch (error) {
    logger.error("Error ensuring scheduled journal entries table:", error);
  }
}


/**
 * Schedules a contextual journal entry using improved timezone handling
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 * @param {string} guildId - Guild ID
 * @param {string} timezone - Timezone
 */
function scheduleContextualEntry(hour, minute, guildId, timezone = 'America/New_York', entryType = 'generic') {
  try {
    // Get current time in UTC
    const now = new Date();
    
    // Calculate target time in the specified timezone
    // First, convert the current time to the target timezone
    const options = { timeZone: timezone, hour12: false };
    const formatter = new Intl.DateTimeFormat('en-US', {
      ...options,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const dateParts = formatter.formatToParts(now);
    
    // Extract date parts
    const dateObj = dateParts.reduce((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = parseInt(part.value, 10);
      }
      return acc;
    }, {});
    
    // Create a date object with the target timezone's date
    let targetDate = new Date(Date.UTC(
      dateObj.year,
      dateObj.month - 1, // JavaScript months are 0-indexed
      dateObj.day,
      hour,
      minute,
      0
    ));
    
    // Convert to ms timestamp and adjust for timezone offset
    const targetTimestamp = targetDate.getTime();
    const tzOffset = getTimezoneOffset(timezone);
    
    // Calculate the delay until the target time
    let delay = targetTimestamp - now.getTime() - tzOffset;
    
    // If the time has already passed today, add 24 hours
    if (delay < 0) {
      delay += 24 * 60 * 60 * 1000; // Add 24 hours
    }
    
    // Add a random variation (±2 minutes) to make it seem more natural
    const variation = (Math.random() * 4 - 2) * 60 * 1000; // ±2 minutes in milliseconds
    delay += variation;
    
    // Ensure delay is positive
    if (delay < 1000) {
      delay = 1000; // Minimum 1 second delay
    }
    
    const scheduleTime = new Date(now.getTime() + delay);
    logger.info(`Scheduled ${entryType} journal entry for guild ${guildId} at ${scheduleTime.toLocaleString()} (${timezone}, in ${Math.round(delay/60000)} minutes)`);
    
    // Schedule the entry creation
    setTimeout(async () => {
      try {
        // First check if this schedule is still active in the database
        const { data: schedule, error } = await supabase
          .from('scheduled_journal_entries')
          .select('*')
          .eq('guild_id', guildId)
          .eq('entry_type', entryType)
          .eq('hour', hour)
          .eq('minute', minute)
          .eq('is_active', true)
          .maybeSingle(); // Use maybeSingle to avoid errors if no rows found
          
        if (error) {
          logger.error(`Error checking schedule status for guild ${guildId}, entry type ${entryType}:`, error);
        }
        
        // If the schedule no longer exists or is inactive, don't create an entry
        if (!schedule) {
          logger.info(`Schedule for guild ${guildId}, entry type ${entryType} no longer active, skipping`);
          return; // Don't reschedule or create entry
        }
        
        logger.info(`Executing scheduled ${entryType} journal entry for guild ${guildId}`);
        
        // Generate contextual entry
        const entry = await generateContextualJournalEntry(guildId);
        
        if (!entry) {
          logger.error(`Failed to generate contextual journal entry for guild ${guildId}`);
          throw new Error('Entry generation failed');
        }
        
        // Import only what we need from journalSystem.js
        try {
          const { postJournalEntry, storeJournalEntry, JOURNAL_ENTRY_TYPES } = await import('./journalSystem.js');
          
          // Post to Discord
          logger.debug(`Posting journal entry "${entry.title}" to Discord for guild ${guildId}`);
          const message = await postJournalEntry(entry.title, entry.content, guildId);
          
          // Store in database
          logger.debug(`Storing journal entry "${entry.title}" in database for guild ${guildId}`);
          const storedEntry = await storeJournalEntry({
            entry_type: JOURNAL_ENTRY_TYPES.DAILY_THOUGHT,
            title: entry.title,
            content: entry.content,
            related_id: null,
            metadata: {
              scheduled_type: entryType,
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
          logger.debug(`Updating character sheet from entry "${entry.title}" for guild ${guildId}`);
          await updateCharacterSheetFromEntry(guildId, { 
            title: entry.title, 
            content: entry.content,
            created_at: new Date().toISOString()
          });
          
          // Update the last_run timestamp in the database
          const { error: updateError } = await supabase
            .from('scheduled_journal_entries')
            .update({
              last_run: new Date().toISOString()
            })
            .eq('guild_id', guildId)
            .eq('entry_type', entryType)
            .eq('hour', hour)
            .eq('minute', minute);
            
          if (updateError) {
            logger.error(`Error updating last_run for journal schedule:`, updateError);
          }
          
          logger.info(`Successfully processed scheduled ${entryType} journal entry for guild ${guildId}`);
        } catch (importError) {
          logger.error(`Error importing or using journalSystem functions: ${importError}`);
          throw importError;
        }
      } catch (error) {
        logger.error(`Error creating scheduled ${entryType} entry for guild ${guildId}: ${error.message}`);
      } finally {
        // Always reschedule, even if there was an error
        try {
          logger.info(`Rescheduling ${entryType} journal entry for guild ${guildId} for tomorrow`);
          scheduleContextualEntry(hour, minute, guildId, timezone, entryType);
        } catch (rescheduleError) {
          logger.error(`Error rescheduling ${entryType} journal entry for guild ${guildId}: ${rescheduleError}`);
          // Emergency fallback: try again after 12 hours
          setTimeout(() => {
            scheduleContextualEntry(hour, minute, guildId, timezone, entryType);
          }, 12 * 60 * 60 * 1000);
        }
      }
    }, delay);
  } catch (scheduleError) {
    logger.error(`Error setting up ${entryType} journal schedule for guild ${guildId}: ${scheduleError}`);
    // Try again after 1 hour
    setTimeout(() => {
      scheduleContextualEntry(hour, minute, guildId, timezone, entryType);
    }, 60 * 60 * 1000);
  }
}


/**
 * Helper function to get timezone offset in milliseconds
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns {number} - Offset in milliseconds
 */
function getTimezoneOffset(timezone) {
    try {
      const now = new Date();
      const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      return tzDate.getTime() - utcDate.getTime();
    } catch (error) {
      logger.error(`Error calculating timezone offset for ${timezone}: ${error}`);
      return 0; // Default to no offset as fallback
    }
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

/**
 * Manual trigger function to immediately generate and post a journal entry
 * Useful for testing or manual intervention
 * @param {string} guildId - Guild ID
 * @returns {Promise<boolean>} - Success status
 */
export async function manualTriggerJournalEntry(guildId) {
    try {
      logger.info(`Manually triggering journal entry for guild ${guildId}`);
      
      // Generate contextual entry
      const entry = await generateContextualJournalEntry(guildId);
      
      if (!entry) {
        logger.error(`Failed to generate contextual journal entry for guild ${guildId}`);
        return false;
      }
      
      // Import functions from journalSystem
      const { postJournalEntry, storeJournalEntry, JOURNAL_ENTRY_TYPES } = await import('./journalSystem.js');
      
      // Post to Discord
      const message = await postJournalEntry(entry.title, entry.content, guildId);
      
      // Store in database
      const storedEntry = await storeJournalEntry({
        entry_type: JOURNAL_ENTRY_TYPES.DAILY_THOUGHT,
        title: entry.title,
        content: entry.content,
        related_id: null,
        metadata: {
          manual_trigger: true,
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
      
      logger.info(`Successfully triggered manual journal entry for guild ${guildId}`);
      return true;
    } catch (error) {
      logger.error(`Error triggering manual journal entry for guild ${guildId}: ${error}`);
      return false;
    }
}

/**
 * Processes the character sheet to age information and prune outdated entries
 * @param {string} guildId - Guild ID
 * @param {Date} currentDate - Current date (for testing with different dates)
 * @returns {Promise<boolean>} - Success status
 */
export async function ageCharacterSheet(guildId, currentDate = new Date()) {
  try {
    logger.info(`Processing character sheet aging for guild ${guildId}`);
    
    // Get current character sheet and routine
    const { sheet, routine } = await getCharacterSheet(guildId);
    
    // Create deep copy to avoid modifying the original during processing
    const updatedSheet = JSON.parse(JSON.stringify(sheet));
    
    // 1. Check for birthday and age advancement
    if (sheet.birthday && sheet.lastBirthdayCelebrated) {
      const lastCelebrated = new Date(sheet.lastBirthdayCelebrated);
      const thisYearBirthday = new Date(`${currentDate.getFullYear()}-${sheet.birthday.replace(/\w+ (\d+)/, '$1')}`);
      
      // If this year's birthday has passed but hasn't been celebrated yet
      if (thisYearBirthday <= currentDate && lastCelebrated.getFullYear() < currentDate.getFullYear()) {
        // Increment age
        updatedSheet.age += 1;
        updatedSheet.lastBirthdayCelebrated = thisYearBirthday.toISOString().split('T')[0];
        
        // Queue a special birthday journal entry
        await queueBirthdayJournalEntry(guildId, updatedSheet.age);
        
        logger.info(`Advanced Bri's age to ${updatedSheet.age} for guild ${guildId}`);
      }
    }
    
    // 2. Check for grade advancement
    if (sheet.gradeAdvancementDate) {
      const advancementDate = new Date(sheet.gradeAdvancementDate);
      
      // If advancement date has passed
      if (advancementDate <= currentDate) {
        // Advance grade
        updatedSheet.currentGrade += 1;
        
        // Update school year
        const nextYear = parseInt(sheet.currentSchoolYear.split('-')[1]) + 1;
        updatedSheet.currentSchoolYear = `${nextYear-1}-${nextYear}`;
        
        // Set next advancement date
        const newAdvancementDate = new Date(advancementDate);
        newAdvancementDate.setFullYear(advancementDate.getFullYear() + 1);
        updatedSheet.gradeAdvancementDate = newAdvancementDate.toISOString().split('T')[0];
        
        // Queue a grade advancement journal entry
        await queueGradeAdvancementJournalEntry(guildId, updatedSheet.currentGrade);
        
        // Archive old classes and teachers
        if (updatedSheet.school.classes && updatedSheet.school.classes.length > 0) {
          // Set schoolYear for existing classes to the previous school year
          updatedSheet.school.classes.forEach(cls => {
            cls.schoolYear = cls.schoolYear || sheet.currentSchoolYear;
            cls.isCurrentClass = false;
          });
        }
        
        if (updatedSheet.school.teachers && updatedSheet.school.teachers.length > 0) {
          // Set schoolYear for existing teachers to the previous school year
          updatedSheet.school.teachers.forEach(teacher => {
            teacher.schoolYear = teacher.schoolYear || sheet.currentSchoolYear;
            teacher.isCurrentTeacher = false;
          });
        }
        
        logger.info(`Advanced Bri's grade to ${updatedSheet.currentGrade} for guild ${guildId}`);
      }
    }
    
    // 3. Process upcoming events - move past events to recent events
    if (updatedSheet.upcomingEvents && updatedSheet.upcomingEvents.length > 0) {
      const now = currentDate.getTime();
      
      // Identify events that should move
      const pastEvents = updatedSheet.upcomingEvents.filter(event => {
        const eventDate = new Date(event.date).getTime();
        return eventDate < now;
      });
      
      // Add completion details to events that are being moved
      pastEvents.forEach(event => {
        event.occurred = true;
        event.movedToRecentEvents = currentDate.toISOString();
      });
      
      // Move past events to recent events
      updatedSheet.recentEvents = [...pastEvents, ...(updatedSheet.recentEvents || [])];
      
      // Filter out moved events from upcoming events
      updatedSheet.upcomingEvents = updatedSheet.upcomingEvents.filter(event => {
        const eventDate = new Date(event.date).getTime();
        return eventDate >= now;
      });
    }
    
    // 4. Process recent events - move older recent events to past events
    if (updatedSheet.recentEvents && updatedSheet.recentEvents.length > 0) {
      const cutoffDate = new Date(currentDate);
      cutoffDate.setDate(cutoffDate.getDate() - 60); // 60 days cutoff
      const cutoffTime = cutoffDate.getTime();
      
      // Identify events that should move
      const olderEvents = updatedSheet.recentEvents.filter(event => {
        const eventDate = new Date(event.date).getTime();
        return eventDate < cutoffTime;
      });
      
      // Add archival details to events that are being moved
      olderEvents.forEach(event => {
        event.archived = true;
        event.movedToPastEvents = currentDate.toISOString();
      });
      
      // Move older events to past events
      updatedSheet.pastEvents = [...olderEvents, ...(updatedSheet.pastEvents || [])];
      
      // Filter out moved events from recent events
      updatedSheet.recentEvents = updatedSheet.recentEvents.filter(event => {
        const eventDate = new Date(event.date).getTime();
        return eventDate >= cutoffTime;
      });
    }
    
    // 5. Process friends and friendships
    if (updatedSheet.friends && updatedSheet.friends.length > 0) {
      updatedSheet.friends.forEach(friend => {
        // Check if this friend hasn't been mentioned in a long time
        if (friend.lastMentioned) {
          const lastMentionedDate = new Date(friend.lastMentioned);
          const daysSinceLastMention = Math.floor((currentDate - lastMentionedDate) / (1000 * 60 * 60 * 24));
          
          // If not mentioned in 90 days and not marked as a close friend
          if (daysSinceLastMention > 90 && friend.importance !== 'high') {
            // Randomly determine if the friendship should naturally fade
            // (more likely for less important friends)
            const fadeThreshold = friend.importance === 'low' ? 0.7 : 0.3;
            
            if (Math.random() > fadeThreshold) {
              // Mark as inactive rather than removing
              friend.status = friend.status || 'active';
              
              if (friend.status === 'active') {
                friend.status = 'fading';
                friend.statusChangeDate = currentDate.toISOString();
              } else if (friend.status === 'fading' && daysSinceLastMention > 180) {
                friend.status = 'inactive';
                friend.statusChangeDate = currentDate.toISOString();
                
                // Possibly queue a journal entry about growing apart
                if (Math.random() > 0.7) {
                  queueFriendshipChangeJournalEntry(guildId, friend, 'growing_apart');
                }
              }
            }
          }
        }
      });
    }
    
    // 6. Process hobbies - mark inactive hobbies
    if (updatedSheet.hobbies && updatedSheet.hobbies.length > 0) {
      updatedSheet.hobbies.forEach(hobby => {
        // Check if this hobby hasn't been mentioned in a long time
        if (hobby.lastMentioned) {
          const lastMentionedDate = new Date(hobby.lastMentioned);
          const daysSinceLastMention = Math.floor((currentDate - lastMentionedDate) / (1000 * 60 * 60 * 24));
          
          // If not mentioned in 120 days, consider marking as inactive
          if (daysSinceLastMention > 120 && hobby.currentlyActive !== false) {
            // For lower importance hobbies, more likely to become inactive
            const inactiveThreshold = hobby.importance === 'high' ? 0.8 : 
                                      hobby.importance === 'medium' ? 0.6 : 0.4;
                                      
            if (Math.random() > inactiveThreshold) {
              hobby.currentlyActive = false;
              hobby.statusChangeDate = currentDate.toISOString();
              
              // Possibly queue a journal entry about losing interest
              if (Math.random() > 0.6) {
                queueHobbyChangeJournalEntry(guildId, hobby, 'losing_interest');
              }
            }
          }
        }
      });
    }
    
    // Update the character sheet in the database
    await updateCharacterSheet(guildId, updatedSheet, routine);
    
    logger.info(`Successfully processed character sheet aging for guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error processing character sheet aging for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Queue a special birthday journal entry
 * @param {string} guildId - Guild ID
 * @param {number} newAge - New age
 */
async function queueBirthdayJournalEntry(guildId, newAge) {
  try {
    // This would create a special journal entry about Bri's birthday
    // Implementation would depend on your journal system
    logger.info(`Queuing birthday journal entry for age ${newAge} in guild ${guildId}`);
    
    // Import only what we need from journalSystem to avoid circular dependencies
    const { generateContextualJournalEntry, postJournalEntry, storeJournalEntry, JOURNAL_ENTRY_TYPES } = await import('./journalSystem.js');
    
    // Special birthday prompt
    const birthdayPrompt = {
      special_event: "birthday",
      new_age: newAge,
      mood: "excited"
    };
    
    // Generate a birthday journal entry
    // You would need to modify generateContextualJournalEntry to accept special prompts
    // or create a new function specifically for special events
    const entry = await generateSpecialEventJournalEntry(guildId, birthdayPrompt);
    
    if (entry) {
      // Post to Discord
      await postJournalEntry(entry.title, entry.content, guildId);
      
      // Store in database
      await storeJournalEntry({
        entry_type: JOURNAL_ENTRY_TYPES.DAILY_THOUGHT,
        title: entry.title,
        content: entry.content,
        related_id: null,
        metadata: {
          special_event: "birthday",
          new_age: newAge
        },
        guild_id: guildId
      });
    }
  } catch (error) {
    logger.error(`Error queuing birthday journal entry for guild ${guildId}:`, error);
  }
}

/**
 * Queue a special grade advancement journal entry
 * @param {string} guildId - Guild ID
 * @param {number} newGrade - New grade
 */
async function queueGradeAdvancementJournalEntry(guildId, newGrade) {
  try {
    // This would create a special journal entry about Bri advancing to the next grade
    logger.info(`Queuing grade advancement journal entry for grade ${newGrade} in guild ${guildId}`);
    
    // Implementation would be similar to queueBirthdayJournalEntry
    // but with grade-specific content
  } catch (error) {
    logger.error(`Error queuing grade advancement journal entry for guild ${guildId}:`, error);
  }
}

/**
 * Queue a journal entry about changes in a friendship
 * @param {string} guildId - Guild ID
 * @param {Object} friend - Friend object
 * @param {string} changeType - Type of change (growing_apart, etc.)
 */
async function queueFriendshipChangeJournalEntry(guildId, friend, changeType) {
  try {
    // This would create a journal entry about changes in a friendship
    logger.info(`Queuing friendship change journal entry for ${friend.name} (${changeType}) in guild ${guildId}`);
    
    // Implementation would be similar to other special journal entries
  } catch (error) {
    logger.error(`Error queuing friendship change journal entry for guild ${guildId}:`, error);
  }
}

/**
 * Queue a journal entry about changes in interest in a hobby
 * @param {string} guildId - Guild ID
 * @param {Object} hobby - Hobby object
 * @param {string} changeType - Type of change (losing_interest, etc.)
 */
async function queueHobbyChangeJournalEntry(guildId, hobby, changeType) {
  try {
    // This would create a journal entry about changes in interest in a hobby
    logger.info(`Queuing hobby change journal entry for ${hobby.name} (${changeType}) in guild ${guildId}`);
    
    // Implementation would be similar to other special journal entries
  } catch (error) {
    logger.error(`Error queuing hobby change journal entry for guild ${guildId}:`, error);
  }
}

/**
 * Generate a journal entry for a special event
 * @param {string} guildId - Guild ID
 * @param {Object} eventDetails - Details about the special event
 * @returns {Promise<Object|null>} - Generated entry with title and content
 */
async function generateSpecialEventJournalEntry(guildId, eventDetails) {
  try {
    // Get character sheet for context
    const { sheet, routine } = await getCharacterSheet(guildId);
    
    // Build a prompt based on the special event type
    let prompt = '';
    
    if (eventDetails.special_event === 'birthday') {
      prompt = `
Generate a journal entry written by Bri, who just turned ${eventDetails.new_age} years old today.

CHARACTER CONTEXT:
${JSON.stringify(sheet, null, 2)}

Write a personal journal entry that:
1. Is written in first person as a ${eventDetails.new_age}-year-old girl's journal
2. Expresses excitement and reflection about her birthday
3. Might mention gifts, celebrations, or birthday wishes
4. Reflects on the past year and looks forward to the year ahead
5. Is 3-4 paragraphs long
6. Uses appropriate language, tone, and vocabulary for a ${eventDetails.new_age}-year-old
7. References friends and family from her character sheet who might have celebrated with her

Format your response as JSON:
{
  "title": "Journal title about her birthday",
  "content": "The full journal entry text (3-4 paragraphs)"
}
`;
    } else if (eventDetails.special_event === 'grade_advancement') {
      // Similar prompt for grade advancement
    } else if (eventDetails.special_event === 'friendship_change') {
      // Prompt for friendship changes
    } else if (eventDetails.special_event === 'hobby_change') {
      // Prompt for hobby interest changes
    }
    
    // Use OpenAI to generate the entry
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are a creative writer specialized in authentic teen journal writing. Generate journal entries that sound like they were truly written by a teenage girl, with age-appropriate vocabulary, concerns, and style."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });
    
    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    logger.error(`Error generating special event journal entry for guild ${guildId}:`, error);
    return null;
  }
}

/**
 * Schedule periodic character sheet aging
 * @param {string} guildId - Guild ID
 */
export function scheduleCharacterSheetAging(guildId) {
  try {
    // Schedule daily check at a consistent time
    const checkHour = 3; // 3 AM - run when server is likely quiet
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
      logger.debug(`Using default timezone for character sheet aging: ${tzError.message}`);
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
    
    // Schedule the aging process
    setTimeout(async () => {
      try {
        // Process character sheet aging
        await ageCharacterSheet(guildId);
        
        // Reschedule for the next day
        scheduleCharacterSheetAging(guildId);
      } catch (error) {
        logger.error(`Error processing character sheet aging for guild ${guildId}:`, error);
        // Retry in 60 minutes
        setTimeout(() => scheduleCharacterSheetAging(guildId), 60 * 60 * 1000);
      }
    }, delay);
    
    const scheduleTime = new Date(now.getTime() + delay);
    logger.info(`Scheduled character sheet aging for guild ${guildId} at ${scheduleTime.toLocaleString()} (${timezone}, in ${Math.round(delay/60000)} minutes)`);
  } catch (error) {
    logger.error(`Error scheduling character sheet aging for guild ${guildId}:`, error);
  }
}

/**
 * Migrates existing character sheets to the new schema
 */
async function migrateExistingCharacterSheets() {
  try {
    logger.info("Checking for character sheets that need migration...");
    
    // Get all character sheets
    const { data: sheets, error } = await supabase
      .from('bri_character_sheet')
      .select('*');
      
    if (error) {
      logger.error("Error fetching character sheets for migration:", error);
      return;
    }
    
    if (!sheets || sheets.length === 0) {
      logger.info("No character sheets found for migration");
      return;
    }
    
    logger.info(`Found ${sheets.length} character sheets to check for migration`);
    
    let migratedCount = 0;
    
    for (const sheetData of sheets) {
      try {
        // Check if this sheet needs migration
        const sheet = sheetData.sheet;
        
        // Check for key fields that would indicate the new schema
        const needsMigration = !sheet.birthday || 
                               !sheet.lastBirthdayCelebrated || 
                               !sheet.currentSchoolYear ||
                               sheet.recentEvents === undefined ||
                               sheet.pastEvents === undefined;
                               
        if (needsMigration) {
          logger.info(`Migrating character sheet for guild ${sheetData.guild_id}...`);
          
          // Today's date in ISO format for timestamps
          const today = new Date();
          const todayISO = today.toISOString().split('T')[0];
          const currentYear = today.getFullYear();
          
          // Logic for determining the last birthday celebration date
          // If today is before June 15 this year, then last birthday was June 15 last year
          // If today is on or after June 15 this year, then last birthday was June 15 this year
          const birthdayMonth = 6; // June
          const birthdayDay = 15;
          
          const thisYearBirthday = new Date(currentYear, birthdayMonth - 1, birthdayDay);
          const lastBirthdayYear = today < thisYearBirthday ? currentYear - 1 : currentYear;
          const lastBirthdayCelebrated = `${lastBirthdayYear}-06-15`;
          
          // Create new sheet based on old one with proper handling of all fields
          const newSheet = {
            // Personal information with tracking for age changes
            name: sheet.name || "Bri",
            age: sheet.age || 14,
            birthday: "June 15", // Default birthday
            lastBirthdayCelebrated: lastBirthdayCelebrated, // Set to last actual birthday
            
            // Current grade tracking for school advancement
            currentSchoolYear: `${currentYear}-${currentYear+1}`,
            currentGrade: 9, // Default to Freshman (9th grade)
            gradeAdvancementDate: `${currentYear}-06-05`, // June 05 of current year
            
            // Transfer existing data with added temporal fields
            family: Array.isArray(sheet.family) ? 
              sheet.family.map(member => {
                // Check if member is already an object or just a string
                if (typeof member === 'object') {
                  return {
                    ...member,
                    name: member.name || (member.relationship ? `Bri's ${member.relationship}` : "Family member"),
                    lastMentioned: todayISO,
                    importance: member.importance || "high"
                  };
                } else {
                  return {
                    name: member,
                    relation: "family member",
                    details: "",
                    lastMentioned: todayISO,
                    importance: "high"
                  };
                }
              }) : [],
            
            friends: Array.isArray(sheet.friends) ? 
              sheet.friends.map(friend => {
                // Check if friend is already an object or just a string
                if (typeof friend === 'object') {
                  return {
                    ...friend,
                    lastMentioned: todayISO,
                    status: "active",
                    importance: friend.importance || "medium"
                  };
                } else {
                  return {
                    name: friend,
                    details: "",
                    lastMentioned: todayISO,
                    status: "active",
                    importance: "medium"
                  };
                }
              }) : [],
            
            pets: Array.isArray(sheet.pets) ? 
              sheet.pets.map(pet => {
                if (typeof pet === 'object') {
                  return {
                    ...pet,
                    lastMentioned: todayISO
                  };
                } else {
                  return {
                    name: pet,
                    type: "pet",
                    details: "",
                    lastMentioned: todayISO
                  };
                }
              }) : [],
            
            hobbies: Array.isArray(sheet.hobbies) ? 
              sheet.hobbies.map(hobby => {
                if (typeof hobby === 'object') {
                  return {
                    ...hobby,
                    lastMentioned: todayISO,
                    currentlyActive: true,
                    importance: hobby.importance || "medium"
                  };
                } else {
                  return {
                    name: hobby,
                    details: "",
                    lastMentioned: todayISO,
                    currentlyActive: true,
                    importance: "medium"
                  };
                }
              }) : [],
            
            // School information - handle when classes/teachers are strings vs objects
            school: {
              name: sheet.school?.name || null,
              grade: sheet.school?.grade || 9,
              favoriteSubjects: Array.isArray(sheet.school?.favoriteSubjects) ? 
                sheet.school.favoriteSubjects : [],
              
              classes: Array.isArray(sheet.school?.classes) ? 
                sheet.school.classes.map(cls => {
                  if (typeof cls === 'object') {
                    return {
                      ...cls,
                      semester: "current",
                      schoolYear: `${currentYear}-${currentYear+1}`,
                      isCurrentClass: true
                    };
                  } else {
                    return {
                      name: cls,
                      time: "",
                      day: "",
                      details: "",
                      semester: "current",
                      schoolYear: `${currentYear}-${currentYear+1}`,
                      isCurrentClass: true
                    };
                  }
                }) : [],
              
              teachers: Array.isArray(sheet.school?.teachers) ? 
                sheet.school.teachers.map(teacher => {
                  if (typeof teacher === 'object') {
                    return {
                      ...teacher,
                      schoolYear: `${currentYear}-${currentYear+1}`,
                      isCurrentTeacher: true
                    };
                  } else {
                    return {
                      name: teacher,
                      subject: "",
                      details: "",
                      schoolYear: `${currentYear}-${currentYear+1}`,
                      isCurrentTeacher: true
                    };
                  }
                }) : []
            },
            
            // Handle emotions and feelings context
            feelings: sheet.feelings || {},
            
            // Outfit ideas
            outfitIdeas: Array.isArray(sheet.outfitIdeas) ? sheet.outfitIdeas : [],
            
            // Dance details
            danceDetails: sheet.danceDetails || {},
            
            // Friend dynamics
            friendDynamics: sheet.friendDynamics || {},
            
            // Life events with clear temporal categorization
            upcomingEvents: Array.isArray(sheet.upcomingEvents) ? 
              sheet.upcomingEvents.map(event => {
                if (typeof event === 'object') {
                  return event;
                } else {
                  return {
                    name: event,
                    date: "", // Empty string for unknown dates
                    details: "",
                    importance: "medium"
                  };
                }
              }) : [],
            
            // Handle recent events
            recentEvents: Array.isArray(sheet.recentEvents) ? 
              sheet.recentEvents.map(event => {
                if (typeof event === 'object') {
                  return event;
                } else {
                  return {
                    name: event,
                    date: todayISO, // Default to today
                    details: "",
                    importance: "medium"
                  };
                }
              }) : [],
            
            // Create empty past events array
            pastEvents: [], 
            
            // Memory categories
            significantMemories: [],
            routineMemories: []
          };
          
          // Update in database
          const { error: updateError } = await supabase
            .from('bri_character_sheet')
            .update({
              sheet: newSheet,
              last_updated: new Date().toISOString()
            })
            .eq('id', sheetData.id);
            
          if (updateError) {
            logger.error(`Error updating migrated character sheet for guild ${sheetData.guild_id}:`, updateError);
          } else {
            migratedCount++;
            logger.info(`Successfully migrated character sheet for guild ${sheetData.guild_id}`);
          }
        }
      } catch (sheetError) {
        logger.error(`Error processing migration for sheet in guild ${sheetData.guild_id}:`, sheetError);
      }
    }
    
    logger.info(`Migration complete. Migrated ${migratedCount} of ${sheets.length} character sheets.`);
  } catch (error) {
    logger.error("Error in character sheet migration:", error);
  }
}

// Add this to the end of briCharacterSheet.js to expose the new functionality
export {
  generateSpecialEventJournalEntry
}