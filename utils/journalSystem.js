// journalSystem.js - Bri's journal system for sharing storylines and interests
import { openai, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getEmbedding } from './improvedEmbeddings.js';
import { normalizeText } from './textUtils.js';

// Reference to Discord client (set during initialization)
let discordClientRef = null;
let journalChannelId = null;

// Constants for journal entry types
export const JOURNAL_ENTRY_TYPES = {
  STORYLINE_UPDATE: 'storyline_update',
  NEW_INTEREST: 'new_interest',
  INTEREST_UPDATE: 'interest_update',
  DAILY_THOUGHT: 'daily_thought',
  FUTURE_PLAN: 'future_plan'
};

// Queue for pending journal entries when channel isn't available
const pendingEntries = [];

/**
 * Initialize the journal system
 * @param {Object} client - Discord client
 * @param {string} channelId - Channel ID for journal entries
 */
export async function initializeJournalSystem(client, channelId) {
  try {
    logger.info("Initializing Bri's journal system...");
    
    // Store references
    discordClientRef = client;
    journalChannelId = channelId;
    
    // Check if the journal_entries table exists
    const { error: journalCheckError } = await supabase
      .from('bri_journal_entries')
      .select('id')
      .limit(1);
      
    // Create table if it doesn't exist
    if (journalCheckError && journalCheckError.code === '42P01') {
      logger.info("Creating bri_journal_entries table...");
      
      try {
        // Try RPC method first
        const createJournalEntriesTable = await supabase.rpc('create_journal_entries_table');
        
        // Check if table was created
        const { error: checkAgain } = await supabase
          .from('bri_journal_entries')
          .select('id')
          .limit(1);
          
        if (checkAgain && checkAgain.code === '42P01') {
          logger.warn("RPC call did not create journal table. Falling back to manual creation...");
          await manuallyCreateJournalTable();
        } else {
          logger.info("Journal entries table created via RPC");
        }
      } catch (rpcError) {
        logger.warn("RPC table creation failed:", rpcError);
        logger.info("Falling back to manual table creation...");
        await manuallyCreateJournalTable();
      }
    } else {
      logger.info("Journal entries table already exists");
    }
    
    // Process any pending entries that might exist
    await processPendingEntries();
    
    // Schedule random daily thoughts
    scheduleRandomJournalEntries();
    
    logger.info("Journal system initialization complete");
  } catch (error) {
    logger.error("Error initializing journal system:", error);
  }
}

/**
 * Manually creates the journal entries table
 */
async function manuallyCreateJournalTable() {
  try {
    const { error } = await supabase.query(`
      CREATE TABLE IF NOT EXISTS bri_journal_entries (
        id SERIAL PRIMARY KEY,
        entry_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        related_id TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        metadata JSONB,
        embedding VECTOR(1536)
      );
    `);
    
    if (error) {
      logger.warn("Manual creation of journal table failed, but this is expected if using Supabase: ", error);
    } else {
      logger.info("Journal entries table created manually");
    }
  } catch (error) {
    logger.error("Error creating journal table manually:", error);
  }
}

/**
 * Creates a journal entry for a storyline update
 * @param {Object} storyline - Storyline object
 * @returns {Promise<Object|null>} - Created journal entry
 */
export async function createStorylineJournalEntry(storyline) {
  try {
    const latestUpdate = getLatestUpdate(storyline);
    
    if (!latestUpdate) {
      logger.warn(`No updates found for storyline: ${storyline.title}`);
      return null;
    }
    
    // Generate a journal-style entry using OpenAI
    const entry = await generateStorylineJournalEntry(storyline, latestUpdate);
    
    // Post to Discord
    const message = await postJournalEntry(entry.title, entry.content);
    
    // Store in database
    const storedEntry = await storeJournalEntry({
      entry_type: JOURNAL_ENTRY_TYPES.STORYLINE_UPDATE,
      title: entry.title,
      content: entry.content,
      related_id: storyline.id,
      metadata: {
        storyline_id: storyline.id,
        storyline_title: storyline.title,
        storyline_progress: storyline.progress,
        update_content: latestUpdate.content,
        update_date: latestUpdate.date
      }
    });
    
    return storedEntry;
  } catch (error) {
    logger.error(`Error creating storyline journal entry: ${error}`);
    return null;
  }
}

/**
 * Creates a journal entry for a new or updated interest
 * @param {Object} interest - Interest object
 * @param {boolean} isNew - Whether this is a new interest
 * @returns {Promise<Object|null>} - Created journal entry
 */
export async function createInterestJournalEntry(interest, isNew = false) {
  try {
    // Generate a journal-style entry using OpenAI
    const entry = await generateInterestJournalEntry(interest, isNew);
    
    // Post to Discord
    const message = await postJournalEntry(entry.title, entry.content);
    
    // Store in database
    const storedEntry = await storeJournalEntry({
      entry_type: isNew ? JOURNAL_ENTRY_TYPES.NEW_INTEREST : JOURNAL_ENTRY_TYPES.INTEREST_UPDATE,
      title: entry.title,
      content: entry.content,
      related_id: interest.id.toString(),
      metadata: {
        interest_id: interest.id,
        interest_name: interest.name,
        interest_level: interest.level,
        is_new_interest: isNew
      }
    });
    
    return storedEntry;
  } catch (error) {
    logger.error(`Error creating interest journal entry: ${error}`);
    return null;
  }
}

/**
 * Creates a random daily journal entry
 * @returns {Promise<Object|null>} - Created journal entry
 */
export async function createRandomJournalEntry() {
  try {
    // Get existing interests to potentially reference
    const { data: interests, error: interestsError } = await supabase
      .from('bri_interests')
      .select('name, level')
      .order('level', { ascending: false })
      .limit(5);
      
    if (interestsError) {
      logger.error("Error fetching interests for random journal:", interestsError);
    }
    
    // Get in-progress storylines to potentially reference
    const { data: storylines, error: storylinesError } = await supabase
      .from('bri_storyline')
      .select('title, description')
      .eq('status', 'in_progress')
      .limit(3);
      
    if (storylinesError) {
      logger.error("Error fetching storylines for random journal:", storylinesError);
    }
    
    const interestNames = interests?.map(i => i.name) || [];
    const storylineTitles = storylines?.map(s => s.title) || [];
    
    // Generate a random journal entry
    const entry = await generateRandomJournalEntry(interestNames, storylineTitles);
    
    // Post to Discord
    const message = await postJournalEntry(entry.title, entry.content);
    
    // Store in database
    const storedEntry = await storeJournalEntry({
      entry_type: entry.type || JOURNAL_ENTRY_TYPES.DAILY_THOUGHT,
      title: entry.title,
      content: entry.content,
      related_id: null,
      metadata: {
        referenced_interests: entry.referencedInterests || [],
        referenced_storylines: entry.referencedStorylines || [],
        entry_mood: entry.mood
      }
    });
    
    return storedEntry;
  } catch (error) {
    logger.error(`Error creating random journal entry: ${error}`);
    return null;
  }
}

/**
 * Posts a journal entry to the Discord channel
 * @param {string} title - Entry title
 * @param {string} content - Entry content
 * @returns {Promise<Object|null>} - Discord message object or null
 */
async function postJournalEntry(title, content) {
  try {
    // Make sure we have client and channel references
    if (!discordClientRef || !journalChannelId) {
      logger.warn("Missing Discord client or channel ID. Queuing journal entry for later.");
      pendingEntries.push({ title, content });
      return null;
    }
    
    // Try to get the channel
    try {
      const channel = await discordClientRef.channels.fetch(journalChannelId);
      
      if (!channel) {
        logger.warn(`Journal channel ${journalChannelId} not found. Queuing entry for later.`);
        pendingEntries.push({ title, content });
        return null;
      }
      
      // Format the message
      const dateString = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      // Send formatted message with title and date as header, content below
      const formattedMessage = `## 📔 ${title}\n*${dateString}*\n\n${content}`;
      
      const message = await channel.send(formattedMessage);
      return message;
    } catch (channelError) {
      logger.error("Error accessing journal channel:", channelError);
      pendingEntries.push({ title, content });
      return null;
    }
  } catch (error) {
    logger.error("Error posting journal entry:", error);
    return null;
  }
}

/**
 * Process any pending journal entries
 */
async function processPendingEntries() {
  if (pendingEntries.length === 0) {
    return;
  }
  
  logger.info(`Processing ${pendingEntries.length} pending journal entries`);
  
  // Make a copy of the queue and clear it
  const entriesToProcess = [...pendingEntries];
  pendingEntries.length = 0;
  
  for (const entry of entriesToProcess) {
    try {
      await postJournalEntry(entry.title, entry.content);
      // Add a small delay between posts
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error("Error processing pending journal entry:", error);
      // Add back to queue if failed
      pendingEntries.push(entry);
    }
  }
}

/**
 * Stores a journal entry in the database
 * @param {Object} entry - Entry data
 * @returns {Promise<Object|null>} - Stored entry or null
 */
async function storeJournalEntry(entry) {
  try {
    // Generate embedding for searchability
    const embeddingText = `${entry.title} ${entry.content}`;
    const embedding = await getEmbedding(embeddingText);
    
    // Store in database
    const { data, error } = await supabase
      .from('bri_journal_entries')
      .insert({
        entry_type: entry.entry_type,
        title: entry.title,
        content: entry.content,
        related_id: entry.related_id,
        metadata: entry.metadata,
        embedding: embedding
      })
      .select()
      .single();
      
    if (error) {
      logger.error("Error storing journal entry:", error);
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error("Error in storeJournalEntry:", error);
    return null;
  }
}

/**
 * Gets the latest update from a storyline event
 * @param {Object} storyline - Storyline event
 * @returns {Object|null} - Latest update or null
 */
function getLatestUpdate(storyline) {
  if (!storyline.updates || storyline.updates.length === 0) {
    return null;
  }
  
  // Get the latest update
  return storyline.updates.sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  )[0];
}

/**
 * Generates a journal-style entry for a storyline update
 * @param {Object} storyline - The storyline object
 * @param {Object} update - The latest update
 * @returns {Promise<Object>} - Generated entry with title and content
 */
async function generateStorylineJournalEntry(storyline, update) {
  try {
    const prompt = `
Generate a journal entry written by Bri, a 14-year-old girl, about an update to her project/activity.

PROJECT INFO:
Title: ${storyline.title}
Description: ${storyline.description}
Progress: ${Math.round(storyline.progress * 100)}%
Latest update: ${update.content}

Write a personal journal entry from Bri's perspective about this progress on her project.
The entry should:
1. Be written in first person as a 14-year-old girl's journal
2. Include specific details about what happened with the project
3. Express emotions and feelings about the progress
4. Be 3-4 paragraphs long
5. Use appropriate language, tone, and vocabulary for a 14-year-old
6. Mention any challenges faced and how she overcame them
7. Include thoughts about next steps

Format your response as JSON:
{
  "title": "Journal title (creative and specific to the update)",
  "content": "The full journal entry text (3-4 paragraphs)"
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
    logger.error("Error generating storyline journal entry:", error);
    // Return a fallback entry
    return {
      title: `Update on my ${storyline.title}`,
      content: `I made some progress on my ${storyline.title} today! ${update.content} I'm about ${Math.round(storyline.progress * 100)}% done with it. I'll keep working on it!`
    };
  }
}

/**
 * Generates a journal-style entry for an interest
 * @param {Object} interest - The interest object
 * @param {boolean} isNew - Whether this is a new interest
 * @returns {Promise<Object>} - Generated entry with title and content
 */
async function generateInterestJournalEntry(interest, isNew) {
  try {
    const prompt = `
Generate a journal entry written by Bri, a 14-year-old girl, about ${isNew ? 'a new interest' : 'an existing interest'} of hers.

INTEREST INFO:
Name: ${interest.name}
Level of interest: ${interest.level}/5
Description: ${interest.description}
Facts known: ${interest.facts.join('; ')}
Tags: ${interest.tags.join(', ')}

Write a personal journal entry from Bri's perspective about this interest.
The entry should:
1. Be written in first person as a 14-year-old girl's journal
2. ${isNew ? 'Express excitement about discovering this new interest' : 'Show enthusiasm about continuing to explore this interest'}
3. Include specific facts or details about the interest
4. Express emotions and feelings
5. Be 2-3 paragraphs long
6. Use appropriate language, tone, and vocabulary for a 14-year-old
7. Mention what specifically fascinates her about this interest
8. Include thoughts about how she wants to explore this interest further

Format your response as JSON:
{
  "title": "Journal title (creative and specific to the interest)",
  "content": "The full journal entry text (2-3 paragraphs)"
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
    logger.error("Error generating interest journal entry:", error);
    // Return a fallback entry
    return {
      title: isNew ? `I'm Totally Into ${interest.name} Now!` : `More About My ${interest.name} Obsession`,
      content: isNew 
        ? `I just discovered something super cool - ${interest.name}! ${interest.facts[0] || ''} I can't wait to learn more about it!` 
        : `I've been really into ${interest.name} lately! ${interest.facts[0] || ''} It's just so interesting!`
    };
  }
}

/**
 * Generates a random journal entry
 * @param {Array} interests - Array of interest names to potentially reference
 * @param {Array} storylines - Array of storyline titles to potentially reference
 * @returns {Promise<Object>} - Generated entry with title, content, and metadata
 */
async function generateRandomJournalEntry(interests, storylines) {
  try {
    // Randomly choose whether this is about today or plans for the future
    const isFuturePlan = Math.random() < 0.3; // 30% chance it's about future plans
    
    // Randomly select a mood
    const moods = ['excited', 'happy', 'thoughtful', 'curious', 'calm', 'hopeful', 'busy'];
    const mood = moods[Math.floor(Math.random() * moods.length)];
    
    // Decide if we should reference existing interests or storylines
    const shouldReferenceInterest = interests.length > 0 && Math.random() < 0.7;
    const shouldReferenceStoryline = storylines.length > 0 && Math.random() < 0.5;
    
    // Random topics for when we don't reference interests or storylines
    const randomTopics = [
      "school", "friends", "family", "music", "books", "movies", "social media",
      "shopping", "fashion", "food", "cooking", "baking", "games", "video games",
      "sports", "exercising", "nature", "weather", "seasons", "holidays", "birthday",
      "weekend plans", "homework", "teachers", "classes", "emotions", "dreams",
      "neighborhood", "traveling", "vacation", "technology", "phone", "computer"
    ];
    
    const prompt = `
Generate a journal entry written by Bri, a 14-year-old girl, for her personal journal.

DETAILS:
- Current mood: ${mood}
- Type: ${isFuturePlan ? 'Future plans' : 'Reflection on today/recent events'}
${shouldReferenceInterest ? `- Should mention her interest in: ${interests[Math.floor(Math.random() * interests.length)]}` : ''}
${shouldReferenceStoryline ? `- Should mention her project: ${storylines[Math.floor(Math.random() * storylines.length)]}` : ''}
${!shouldReferenceInterest && !shouldReferenceStoryline ? `- Potential topics: ${randomTopics.sort(() => Math.random() - 0.5).slice(0, 3).join(', ')}` : ''}

Write a personal journal entry that:
1. Is written in first person as a 14-year-old girl's journal
2. Is completely authentic to a teen's writing style and concerns
3. Includes specific details about ${isFuturePlan ? 'plans, hopes, or dreams' : 'events, thoughts, or experiences'}
4. Expresses age-appropriate emotions and feelings
5. Is 2-3 paragraphs long
6. Uses authentic language, slang, and vocabulary for a modern 14-year-old
7. Feels spontaneous and genuine, as if actually written by a real teen in their journal
8. ${isFuturePlan ? 'Describes specific plans, hopes, or goals' : 'Reflects on specific events or thoughts from the day'}

Format your response as JSON:
{
  "title": "Journal title (creative and authentic to teen journal)",
  "content": "The full journal entry text (2-3 paragraphs)",
  "type": "${isFuturePlan ? 'future_plan' : 'daily_thought'}",
  "mood": "${mood}",
  "referencedInterests": [list of any interests mentioned],
  "referencedStorylines": [list of any projects/storylines mentioned]
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
    logger.error("Error generating random journal entry:", error);
    // Return a fallback entry
    return {
      title: "Just Another Day",
      content: "Today was pretty normal. Did some homework, talked with friends, and just chilled out. Nothing too exciting, but it was nice. Maybe tomorrow will be more interesting!",
      type: JOURNAL_ENTRY_TYPES.DAILY_THOUGHT,
      mood: "normal",
      referencedInterests: [],
      referencedStorylines: []
    };
  }
}

/**
 * Gets recent journal entries
 * @param {number} limit - Maximum number of entries to return
 * @param {string} entryType - Filter by entry type (optional)
 * @returns {Promise<Array>} - Array of journal entries
 */
export async function getRecentJournalEntries(limit = 10, entryType = null) {
  try {
    let query = supabase
      .from('bri_journal_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
      
    if (entryType) {
      query = query.eq('entry_type', entryType);
    }
    
    const { data, error } = await query;
    
    if (error) {
      logger.error("Error fetching recent journal entries:", error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error("Error in getRecentJournalEntries:", error);
    return [];
  }
}

/**
 * Gets journal entries related to a specific entity (storyline or interest)
 * @param {string} relatedId - Related entity ID
 * @param {number} limit - Maximum number of entries to return
 * @returns {Promise<Array>} - Array of journal entries
 */
export async function getRelatedJournalEntries(relatedId, limit = 5) {
  try {
    const { data, error } = await supabase
      .from('bri_journal_entries')
      .select('*')
      .eq('related_id', relatedId)
      .order('created_at', { ascending: false })
      .limit(limit);
      
    if (error) {
      logger.error(`Error fetching journal entries for related ID ${relatedId}:`, error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error(`Error in getRelatedJournalEntries for ID ${relatedId}:`, error);
    return [];
  }
}

/**
 * Performs a semantic search across journal entries
 * @param {string} searchText - Text to search for
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} - Matching journal entries
 */
export async function searchJournalEntries(searchText, limit = 5) {
  try {
    const embedding = await getEmbedding(searchText);
    
    const { data, error } = await supabase.rpc('match_journal_entries', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: limit
    });
    
    if (error) {
      logger.error("Error in journal entry vector search:", error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error("Error in searchJournalEntries:", error);
    return [];
  }
}

/**
 * Schedules random journal entries to be created periodically
 */
function scheduleRandomJournalEntries() {
  // Create 1-2 random entries per day at random times
  
  // First entry: random time between 9 AM and 12 PM
  const morningHour = Math.floor(Math.random() * 3) + 9; // 9-11 AM
  const morningMinute = Math.floor(Math.random() * 60); // 0-59 minutes
  
  scheduleEntryAt(morningHour, morningMinute);
  
  // Second entry (70% chance): random time between 3 PM and 8 PM
  if (Math.random() < 0.7) {
    const eveningHour = Math.floor(Math.random() * 5) + 15; // 3-7 PM (15-19 in 24h)
    const eveningMinute = Math.floor(Math.random() * 60); // 0-59 minutes
    
    scheduleEntryAt(eveningHour, eveningMinute);
  }
  
  logger.info("Scheduled random journal entries");
}

/**
 * Schedules a journal entry to be created at a specific time
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 */
function scheduleEntryAt(hour, minute) {
  // Calculate milliseconds until the scheduled time
  const now = new Date();
  const scheduledTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute
  );
  
  // If the scheduled time has already passed today, schedule for tomorrow
  if (scheduledTime <= now) {
    scheduledTime.setDate(scheduledTime.getDate() + 1);
  }
  
  const delay = scheduledTime - now;
  
  // Schedule the entry creation
  setTimeout(async () => {
    try {
      await createRandomJournalEntry();
      
      // Reschedule for the next day
      scheduleEntryAt(hour, minute);
    } catch (error) {
      logger.error("Error creating scheduled journal entry:", error);
      // Retry in 30 minutes
      setTimeout(() => scheduleEntryAt(hour, minute), 30 * 60 * 1000);
    }
  }, delay);
  
  logger.info(`Scheduled journal entry for ${scheduledTime.toLocaleTimeString()} (in ${Math.round(delay/60000)} minutes)`);
}

// Export the journal entry types and main functions
export default {
  initializeJournalSystem,
  createStorylineJournalEntry,
  createInterestJournalEntry,
  createRandomJournalEntry,
  getRecentJournalEntries,
  getRelatedJournalEntries,
  searchJournalEntries,
  JOURNAL_ENTRY_TYPES
};