// journalSystem.js - Bri's journal system for sharing storylines and interests
import { openai, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getEmbedding } from './improvedEmbeddings.js';
import { normalizeText } from './textUtils.js';
import {
  initializeCharacterSheetSystem,
  queueInterestForJournal,
  processConsolidatedInterestUpdates,
  scheduleRoutineJournalEntries,
  schedulePendingInterestCheck,
  generateContextualJournalEntry,
  updateCharacterSheetFromEntry
} from './briCharacterSheet.js';


// Reference to Discord client (set during initialization)
let discordClientRef = null;

// Store channel IDs by guild ID
const journalChannels = new Map();

// Constants for journal entry types
export const JOURNAL_ENTRY_TYPES = {
  STORYLINE_UPDATE: 'storyline_update',
  NEW_INTEREST: 'new_interest',
  INTEREST_UPDATE: 'interest_update',
  DAILY_THOUGHT: 'daily_thought',
  FUTURE_PLAN: 'future_plan'
};

// Queue for pending journal entries when channel isn't available
// Store by guild ID
const pendingEntries = new Map();


// Modify the initializeJournalSystem function to also initialize the character sheet system
export async function initializeJournalSystem(client, channelId, guildId) {
  try {
    // If a specific guild was provided, log it, otherwise indicate it's global initialization
    if (guildId) {
      logger.info(`Initializing Bri's journal system for guild ${guildId}...`);
    } else {
      logger.info(`Initializing Bri's journal system globally...`);
    }
    
    // Store references
    discordClientRef = client;
    
    // Add this channel to our map if both channelId and guildId are provided
    if (channelId && guildId) {
      journalChannels.set(guildId, channelId);
      logger.info(`Set journal channel for guild ${guildId} to ${channelId}`);
    }
    
    // If no specific guild was provided, attempt to load all guild journal channels
    if (!guildId) {
      await loadAllJournalChannels();
    }
    
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
    
    // Initialize the character sheet system
    try {
      await initializeCharacterSheetSystem();
      logger.info("Character sheet system initialized");
    } catch (characterSheetError) {
      logger.error("Error initializing character sheet system:", characterSheetError);
    }
    
    // Process any pending entries for this guild or all guilds if guildId is not provided
    await processPendingEntries(guildId);
    
    // If a specific guild ID was provided, schedule for that guild
    if (guildId) {
      // Schedule the enhanced journal entries
      await scheduleRoutineJournalEntries(guildId);
      
      // Schedule the interest check
      schedulePendingInterestCheck(guildId);
    } else {
      // If no specific guild was provided, schedule for all known guilds
      const allGuildIds = Array.from(journalChannels.keys());
      for (const gId of allGuildIds) {
        // Skip the "legacy" key as it's not a real guild ID
        if (gId !== 'legacy') {
          // Schedule the enhanced journal entries
          await scheduleRoutineJournalEntries(gId);
          
          // Schedule the interest check
          schedulePendingInterestCheck(gId);
        }
      }
    }
    
    if (guildId) {
      logger.info(`Journal system initialization complete for guild ${guildId}`);
    } else {
      logger.info("Journal system initialization complete for all guilds");
    }
  } catch (error) {
    if (guildId) {
      logger.error(`Error initializing journal system for guild ${guildId}:`, error);
    } else {
      logger.error("Error initializing journal system globally:", error);
    }
  }
}

/**
 * Load all journal channels from the database
 */
async function loadAllJournalChannels() {
  try {
    // First try to load from the dedicated table
    const { data: channelData, error } = await supabase
      .from('guild_journal_channels')
      .select('guild_id, channel_id');
      
    if (!error && channelData && channelData.length > 0) {
      // Load all channels from the dedicated table
      channelData.forEach(row => {
        journalChannels.set(row.guild_id, row.channel_id);
      });
      
      logger.info(`Loaded ${channelData.length} journal channels from guild_journal_channels table`);
      return;
    }
    
    // Fall back to the legacy method if needed
    if (error && error.code === '42P01') {
      logger.info("guild_journal_channels table doesn't exist, falling back to bot_settings");
      
      // Get all settings with keys starting with 'journal_channel_id:'
      const { data: settingsData, error: settingsError } = await supabase
        .from('bot_settings')
        .select('key, value')
        .like('key', 'journal_channel_id:%');
        
      if (!settingsError && settingsData && settingsData.length > 0) {
        // Process each setting
        settingsData.forEach(setting => {
          // Extract guild ID from the key
          const guildId = setting.key.split(':')[1];
          if (guildId) {
            journalChannels.set(guildId, setting.value);
          }
        });
        
        logger.info(`Loaded ${journalChannels.size} journal channels from bot_settings`);
      } else {
        // Check for the legacy single channel setting
        const { data: legacyData, error: legacyError } = await supabase
          .from('bot_settings')
          .select('value')
          .eq('key', 'journal_channel_id')
          .single();
          
        if (!legacyError && legacyData && legacyData.value) {
          // Store with a special 'legacy' key
          journalChannels.set('legacy', legacyData.value);
          logger.info(`Loaded legacy journal channel: ${legacyData.value}`);
        }
      }
    }
  } catch (error) {
    logger.error("Error loading journal channels:", error);
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
        embedding VECTOR(1536),
        guild_id TEXT
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

/** Creates a journal entry for a storyline update
 * @param {Object} storyline - Storyline object
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} - Created journal entry
 */
export async function createStorylineJournalEntry(storyline, guildId) {
  try {
    // Import the subscription check
    const { isFeatureSubscribed, SUBSCRIPTION_FEATURES } = await import('./subscriptionManager.js');
    
    // Check if this server has the journaling feature via subscription
    const hasJournalingFeature = await isFeatureSubscribed(guildId, SUBSCRIPTION_FEATURES.JOURNALING);
    
    if (!hasJournalingFeature) {
      logger.info(`Journal feature not available for guild ${guildId} - requires subscription`);
      return {
        error: 'subscription_required',
        message: 'The journal feature requires a subscription. Subscribe to access Bri\'s journal capabilities.'
      };
    }
    
    const latestUpdate = getLatestUpdate(storyline);
    
    if (!latestUpdate) {
      logger.warn(`No updates found for storyline: ${storyline.title}`);
      return null;
    }
    
    // Generate a journal-style entry using OpenAI
    const entry = await generateStorylineJournalEntry(storyline, latestUpdate);
    
    // Post to Discord
    const message = await postJournalEntry(entry.title, entry.content, guildId);
    
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
      },
      guild_id: guildId
    });
    
    return storedEntry;
  } catch (error) {
    logger.error(`Error creating storyline journal entry: ${error}`);
    return null;
  }
}

// Modified function to create interest journal entry - now queues the interest instead of posting directly
export async function createInterestJournalEntry(interest, isNew = false, guildId) {
  try {
    // Import the subscription check
    const { isFeatureSubscribed, SUBSCRIPTION_FEATURES } = await import('./subscriptionManager.js');
    
    // Check if this server has the journaling feature via subscription
    const hasJournalingFeature = await isFeatureSubscribed(guildId, SUBSCRIPTION_FEATURES.JOURNALING);
    
    if (!hasJournalingFeature) {
      logger.info(`Journal feature not available for guild ${guildId} - requires subscription`);
      return {
        error: 'subscription_required',
        message: 'The journal feature requires a subscription. Subscribe to access Bri\'s journal capabilities.'
      };
    }
    
    // Queue this interest update instead of immediately creating a journal entry
    const queueResult = await queueInterestForJournal(interest, isNew, guildId);
    
    if (!queueResult) {
      logger.error(`Failed to queue interest ${interest.name} for journal in guild ${guildId}`);
      
      // Fallback to original behavior
      logger.info(`Falling back to immediate interest journal entry for ${interest.name}`);
      
      // Generate a journal-style entry using OpenAI
      const entry = await generateInterestJournalEntry(interest, isNew);
      
      // Post to Discord
      const message = await postJournalEntry(entry.title, entry.content, guildId);
      
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
        },
        guild_id: guildId
      });
      
      return storedEntry;
    }
    
    // Return a placeholder response
    return {
      queued: true,
      interest_name: interest.name,
      is_new: isNew,
      guild_id: guildId
    };
  } catch (error) {
    logger.error(`Error creating interest journal entry: ${error}`);
    return null;
  }
}

// Modified function to create a random daily journal entry - now uses the contextual generator
export async function createRandomJournalEntry(guildId) {
  try {
    // Import the subscription check
    const { isFeatureSubscribed, SUBSCRIPTION_FEATURES } = await import('./subscriptionManager.js');
    
    // Check if this server has the journaling feature via subscription
    const hasJournalingFeature = await isFeatureSubscribed(guildId, SUBSCRIPTION_FEATURES.JOURNALING);
    
    if (!hasJournalingFeature) {
      logger.info(`Journal feature not available for guild ${guildId} - requires subscription`);
      return {
        error: 'subscription_required',
        message: 'The journal feature requires a subscription. Subscribe to access Bri\'s journal capabilities.'
      };
    }
    
    // Use the enhanced contextual entry generator instead of the old one
    const entry = await generateContextualJournalEntry(guildId);
    
    if (!entry) {
      logger.error(`Failed to generate contextual journal entry for guild ${guildId}`);
      
      // Fallback to old method if new method fails
      return await createFallbackRandomJournalEntry(guildId);
    }
    
    // Post to Discord
    const message = await postJournalEntry(entry.title, entry.content, guildId);
    
    // Store in database
    const storedEntry = await storeJournalEntry({
      entry_type: JOURNAL_ENTRY_TYPES.DAILY_THOUGHT,
      title: entry.title,
      content: entry.content,
      related_id: null,
      metadata: {
        contextual: true,
        hour_of_day: new Date().getHours()
      },
      guild_id: guildId
    });
    
    // Update character sheet with this new entry
    try {
      await updateCharacterSheetFromEntry(guildId, {
        title: entry.title,
        content: entry.content,
        created_at: new Date().toISOString()
      });
    } catch (updateError) {
      logger.error(`Error updating character sheet from entry: ${updateError}`);
    }
    
    return storedEntry;
  } catch (error) {
    logger.error(`Error creating random journal entry: ${error}`);
    return await createFallbackRandomJournalEntry(guildId);
  }
}

// Fallback to original implementation if the new method fails
async function createFallbackRandomJournalEntry(guildId) {
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
    const message = await postJournalEntry(entry.title, entry.content, guildId);
    
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
      },
      guild_id: guildId
    });
    
    return storedEntry;
  } catch (error) {
    logger.error(`Error in fallback journal entry: ${error}`);
    return null;
  }
}


/**
 * Gets the channel ID for a specific guild
 * @param {string} guildId - Guild ID
 * @returns {string|null} - Channel ID or null
 */
function getJournalChannelForGuild(guildId) {
  // If we have a specific channel for this guild, use it
  if (journalChannels.has(guildId)) {
    return journalChannels.get(guildId);
  }
  
  // If we have a legacy channel, use it as fallback
  if (journalChannels.has('legacy')) {
    logger.debug(`No journal channel for guild ${guildId}, using legacy channel`);
    return journalChannels.get('legacy');
  }
  
  return null;
}

/**
 * Posts a journal entry to the Discord channel for a specific guild
 * @param {string} title - Entry title
 * @param {string} content - Entry content
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} - Discord message object or null
 */
async function postJournalEntry(title, content, guildId) {
  try {
    // Make sure we have client reference
    if (!discordClientRef) {
      logger.warn("Missing Discord client reference. Queuing journal entry for later.");
      
      // Initialize pending entries queue for this guild if needed
      if (!pendingEntries.has(guildId)) {
        pendingEntries.set(guildId, []);
      }
      
      pendingEntries.get(guildId).push({ title, content, guildId });
      return null;
    }
    
    // Get the channel ID for this guild
    const journalChannelId = getJournalChannelForGuild(guildId);
    
    if (!journalChannelId) {
      logger.warn(`No journal channel configured for guild ${guildId}. Queuing entry for later.`);
      
      // Initialize pending entries queue for this guild if needed
      if (!pendingEntries.has(guildId)) {
        pendingEntries.set(guildId, []);
      }
      
      pendingEntries.get(guildId).push({ title, content, guildId });
      return null;
    }
    
    // Try to get the channel
    try {
      const channel = await discordClientRef.channels.fetch(journalChannelId);
      
      if (!channel) {
        logger.warn(`Journal channel ${journalChannelId} for guild ${guildId} not found. Queuing entry for later.`);
        
        // Initialize pending entries queue for this guild if needed
        if (!pendingEntries.has(guildId)) {
          pendingEntries.set(guildId, []);
        }
        
        pendingEntries.get(guildId).push({ title, content, guildId });
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
      logger.error(`Error accessing journal channel for guild ${guildId}:`, channelError);
      
      // Initialize pending entries queue for this guild if needed
      if (!pendingEntries.has(guildId)) {
        pendingEntries.set(guildId, []);
      }
      
      pendingEntries.get(guildId).push({ title, content, guildId });
      return null;
    }
  } catch (error) {
    logger.error(`Error posting journal entry for guild ${guildId}:`, error);
    return null;
  }
}

/**
 * Process any pending journal entries for a specific guild
 * @param {string} guildId - Guild ID (optional - if not provided, process for all guilds)
 */
async function processPendingEntries(guildId = null) {
  // If a specific guild was provided, only process entries for that guild
  if (guildId) {
    const entries = pendingEntries.get(guildId) || [];
    if (entries.length === 0) {
      return;
    }
    
    logger.info(`Processing ${entries.length} pending journal entries for guild ${guildId}`);
    
    // Make a copy of the queue and clear it
    const entriesToProcess = [...entries];
    pendingEntries.set(guildId, []);
    
    for (const entry of entriesToProcess) {
      try {
        await postJournalEntry(entry.title, entry.content, guildId);
        // Add a small delay between posts
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Error processing pending journal entry for guild ${guildId}:`, error);
        // Add back to queue if failed
        const currentEntries = pendingEntries.get(guildId) || [];
        currentEntries.push(entry);
        pendingEntries.set(guildId, currentEntries);
      }
    }
    return;
  }
  
  // Process for all guilds
  for (const [guildId, entries] of pendingEntries.entries()) {
    if (entries.length === 0) {
      continue;
    }
    
    logger.info(`Processing ${entries.length} pending journal entries for guild ${guildId}`);
    
    // Make a copy of the queue and clear it
    const entriesToProcess = [...entries];
    pendingEntries.set(guildId, []);
    
    for (const entry of entriesToProcess) {
      try {
        await postJournalEntry(entry.title, entry.content, guildId);
        // Add a small delay between posts
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`Error processing pending journal entry for guild ${guildId}:`, error);
        // Add back to queue if failed
        const currentEntries = pendingEntries.get(guildId) || [];
        currentEntries.push(entry);
        pendingEntries.set(guildId, currentEntries);
      }
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
        embedding: embedding,
        guild_id: entry.guild_id
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
export async function generateRandomJournalEntry(interests, storylines) {
  try {
    // Randomly choose whether this is about today or plans for the future
    const isFuturePlan = Math.random() < 0.3; // 30% chance it's about future plans
    
    // Randomly select a mood
    const moods = ['excited', 'happy', 'thoughtful', 'curious', 'calm', 'hopeful', 'busy'];
    const mood = moods[Math.floor(Math.random() * moods.length)];
    
    // Decide if we should reference existing interests or storylines
    const shouldReferenceInterest = interests.length > 0 && Math.random() < 0.3;
    const shouldReferenceStoryline = storylines.length > 0 && Math.random() < 0.3;
    
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
 * @param {string} guildId - Guild ID (optional)
 * @returns {Promise<Array>} - Array of journal entries
 */
export async function getRecentJournalEntries(limit = 10, entryType = null, guildId = null) {
  try {
    let query = supabase
      .from('bri_journal_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
      
    if (entryType) {
      query = query.eq('entry_type', entryType);
    }
    
    if (guildId) {
      query = query.eq('guild_id', guildId);
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
 * @param {string} guildId - Guild ID (optional)
 * @returns {Promise<Array>} - Array of journal entries
 */
export async function getRelatedJournalEntries(relatedId, limit = 5, guildId = null) {
  try {
    let query = supabase
      .from('bri_journal_entries')
      .select('*')
      .eq('related_id', relatedId)
      .order('created_at', { ascending: false })
      .limit(limit);
      
    if (guildId) {
      query = query.eq('guild_id', guildId);
    }
    
    const { data, error } = await query;
      
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
 * @param {string} guildId - Guild ID (optional)
 * @returns {Promise<Array>} - Matching journal entries
 */
export async function searchJournalEntries(searchText, limit = 5, guildId = null) {
  try {
    const embedding = await getEmbedding(searchText);
    
    // If guild ID is provided, use a query parameter version
    if (guildId) {
      const { data, error } = await supabase.rpc('match_journal_entries_by_guild', {
        query_embedding: embedding,
        match_threshold: 0.7,
        match_count: limit,
        p_guild_id: guildId
      });
      
      if (error) {
        // If the RPC function doesn't exist, fall back to the non-guild specific version
        if (error.code === '42883') { // Function does not exist
          logger.warn("match_journal_entries_by_guild function not found, falling back to standard search");
          return await searchJournalEntries(searchText, limit);
        }
        
        logger.error("Error in journal entry vector search by guild:", error);
        return [];
      }
      
      return data || [];
    }
    
    // Standard search without guild filtering
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
 * Returns SQL for creating the RPC function to search journal entries by guild
 * @returns {string} SQL query
 */
export function getJournalSearchByGuildSQL() {
  return `
  CREATE OR REPLACE FUNCTION match_journal_entries_by_guild(
    query_embedding vector(1536),
    match_threshold float,
    match_count int,
    p_guild_id text
  )
  RETURNS TABLE (
    id bigint,
    entry_type text,
    title text,
    content text,
    related_id text,
    created_at timestamptz,
    metadata jsonb,
    guild_id text,
    similarity float
  )
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RETURN QUERY
    SELECT
      bri_journal_entries.id,
      bri_journal_entries.entry_type,
      bri_journal_entries.title,
      bri_journal_entries.content,
      bri_journal_entries.related_id,
      bri_journal_entries.created_at,
      bri_journal_entries.metadata,
      bri_journal_entries.guild_id,
      1 - (bri_journal_entries.embedding <=> query_embedding) as similarity
    FROM
      bri_journal_entries
    WHERE
      bri_journal_entries.guild_id = p_guild_id
      AND 1 - (bri_journal_entries.embedding <=> query_embedding) > match_threshold
    ORDER BY
      bri_journal_entries.embedding <=> query_embedding
    LIMIT match_count;
  END;
  $$;
  `;
}

/**
 * Schedules random journal entries to be created periodically for a specific guild
 * @param {string} guildId - Guild ID
 */
function scheduleRandomJournalEntries(guildId) {
  // Make sure we have a valid guild ID
  if (!guildId || guildId === 'legacy') {
    logger.warn("Cannot schedule journal entries without a valid guild ID");
    return;
  }

  // Create 1-2 random entries per day at random times
  
  // First entry: random time between 9 AM and 12 PM
  const morningHour = Math.floor(Math.random() * 3) + 9; // 9-11 AM
  const morningMinute = Math.floor(Math.random() * 60); // 0-59 minutes
  
  scheduleEntryAt(morningHour, morningMinute, guildId);
  
  // Second entry (70% chance): random time between 3 PM and 8 PM
  if (Math.random() < 0.99) {
    const eveningHour = Math.floor(Math.random() * 5) + 15; // 3-7 PM (15-19 in 24h)
    const eveningMinute = Math.floor(Math.random() * 60); // 0-59 minutes
    
    scheduleEntryAt(eveningHour, eveningMinute, guildId);
  }
  
  logger.info(`Scheduled random journal entries for guild ${guildId}`);
}

/**
 * Schedules a journal entry to be created at a specific time for a specific guild
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 * @param {string} guildId - Guild ID
 */
function scheduleEntryAt(hour, minute, guildId) {
  // Validate guild ID
  if (!guildId || guildId === 'legacy') {
    logger.warn("Cannot schedule journal entry without a valid guild ID");
    return;
  }

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
      await createRandomJournalEntry(guildId);
      
      // Reschedule for the next day
      scheduleEntryAt(hour, minute, guildId);
    } catch (error) {
      logger.error(`Error creating scheduled journal entry for guild ${guildId}:`, error);
      // Retry in 30 minutes
      setTimeout(() => scheduleEntryAt(hour, minute, guildId), 30 * 60 * 1000);
    }
  }, delay);
  
  logger.info(`Scheduled journal entry for guild ${guildId} at ${scheduledTime.toLocaleTimeString()} (in ${Math.round(delay/60000)} minutes)`);
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

// Export the new functions so they can be used elsewhere
export {
  processConsolidatedInterestUpdates,
  generateContextualJournalEntry,
  updateCharacterSheetFromEntry,
  postJournalEntry,
  storeJournalEntry
};