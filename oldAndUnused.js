/**
 * Extracts key personal details from a conversation summary.
 * @param {string} summaryText - The conversation summary text.
 * @param {string} userId - The user's ID for deduplication purposes.
 * @returns {Promise<Array<string>>} - An array of extracted details.
 */
export async function extractIntuitedMemories(summaryText, userId) {
  // More specific extraction prompt with examples of what to look for
  const extractionPrompt = `
  Extract BOTH explicit and implied facts about the user from the conversation summary below.
  Pay special attention to:

  EXPLICIT INFORMATION:
  - Name, age, location (city, country)
  - Job title, workplace, industry
  - Hobbies, interests, skills
  - Family members, pets
  - Important dates (birthdays, anniversaries)

  IMPLIED PREFERENCES (Must infer these even when not directly stated):
  - Food preferences (if they react positively to food mentions, they likely enjoy that food)
  - Entertainment preferences (shows, movies, music they discuss positively)
  - Activity preferences (what they sound excited about or interested in)
  - Emotional reactions (what makes them happy, sad, excited)

  DO NOT extract:
  - Opinions about general topics that aren't personal preferences
  - Temporary states (feeling tired today)
  - Bot responses or actions
  - Questions the user asked without answers
  - Statements with "not provided," "unknown," or similar null phrases
  - Hypothetical statements that aren't actually true
  - Future plans without certainty

  OUTPUT EXAMPLES:
  Good: "User enjoys chocolate cookies" (if they responded positively to cookie mention)
  Good: "User has a dog named Max"
  Good: "User works as a software engineer"
  Bad: "User's name is not provided" (Never include "not provided" statements)
  Bad: "User might like cookies" (Too uncertain)

  Output ONLY a JSON array of simple, clear statements in the format:
  ["User's name is John", "User lives in Seattle", "User works as a software engineer"]

  If no concrete personal facts are found, output an empty array: []
  -----
  SUMMARY: ${summaryText}`;
  
  try {
    // Extract facts from the summary
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You extract specific personal facts and preferences about users. Be precise and confident in your extractions. Never include meta-statements about missing information."
        },
        { role: "user", content: extractionPrompt }
      ],
      max_tokens: 1000,
    });
    
    let output = completion.choices[0].message.content.trim();
    output = stripCodeBlock(output);
    
    let extractedFacts;
    try {
      extractedFacts = JSON.parse(output);
      if (!Array.isArray(extractedFacts)) extractedFacts = [];
    } catch (e) {
      logger.error("Error parsing extraction JSON:", e);
      extractedFacts = [];
  }
  
  // Apply post-processing filters to remove invalid memories
  extractedFacts = postProcessExtractedFacts(extractedFacts);
  
  // If nothing was extracted, return empty array
  if (extractedFacts.length === 0) {
    return [];
  }
  
  // Deduplicate against existing memories
  const deduplicatedFacts = await deduplicateAgainstExisting(extractedFacts, userId);
  
  return deduplicatedFacts;
} catch (error) {
  logger.error("Error extracting intuited memories:", error);
  return [];
}
}


// // Custom error classes for more specific error handling
// class UserMemoryError extends Error {
//   constructor(message, code = 'UNKNOWN_ERROR') {
//     super(message);
//     this.name = 'UserMemoryError';
//     this.code = code;
//   }
// }

// class InputValidationError extends UserMemoryError {
//   constructor(message) {
//     super(message, 'INPUT_VALIDATION_ERROR');
//   }
// }

// class UserNotFoundError extends UserMemoryError {
//   constructor(username) {
//     super(`User "${username}" not found`, 'USER_NOT_FOUND');
//   }
// }

// // Validation utility functions
// function validateUsername(username) {
//   if (!username || typeof username !== 'string') {
//     throw new InputValidationError('Username must be a non-empty string');
//   }
  
//   // Validate username format (alphanumeric, underscore, no spaces)
//   const usernameRegex = /^[a-zA-Z0-9_]+$/;
//   if (!usernameRegex.test(username)) {
//     throw new InputValidationError('Invalid username format');
//   }
// }

// function validateQuery(query) {
//   if (!query || typeof query !== 'string') {
//     throw new InputValidationError('Query must be a non-empty string');
//   }
  
//   // Prevent overly long queries
//   if (query.length > 500) {
//     throw new InputValidationError('Query is too long (max 500 characters)');
//   }
  
//   // Optional: Add more specific query validation if needed
//   const forbiddenPatterns = [
//     /script>/i,  // Basic XSS prevention
//     /<[^>]*>/,   // Prevent HTML tags
//   ];
  
//   if (forbiddenPatterns.some(pattern => pattern.test(query))) {
//     throw new InputValidationError('Invalid characters in query');
//   }
// }

// // Configuration for query and category detection
// const QUERY_DETECTION = {
//   patterns: [
//     // "Do you know what austin's favorite food is?"
//     /(?:do you know|tell me|what is|what's|who is|who's|how is|how's)\s+(?:what|who|how|if|about)?\s*(?:is\s+)?(\w+)(?:'s|\s+)(.+?)(?:\s+is)?(?:\?|$)/i,
    
//     // "What is austin's favorite food?"
//     /(?:what|who|how)\s+(?:is|are)\s+(\w+)(?:'s|\s+)(.+?)(?:\?|$)/i,
    
//     // "Tell me about austin's hobbies"
//     /(?:tell me|do you know)\s+(?:about\s+)?(\w+)(?:'s|\s+)(.+?)(?:\?|$)/i,
    
//     // "What do you know about austin?"
//     /(?:what|who|how|tell me|do you know)\s+(?:do you know\s+)?(?:about\s+)?(\w+)(?:\?|$)/i
//   ],
  
//   categoryPatterns: [
//     { 
//       category: MemoryCategories.PERSONAL, 
//       terms: ['name', 'age', 'birthday', 'born', 'lives', 'from', 'where', 'family', 'married', 'children'] 
//     },
//     { 
//       category: MemoryCategories.PROFESSIONAL, 
//       terms: ['job', 'work', 'career', 'company', 'business', 'profession', 'school', 'study', 'degree'] 
//     },
//     { 
//       category: MemoryCategories.PREFERENCES, 
//       terms: ['like', 'love', 'enjoy', 'prefer', 'favorite', 'favourite', 'hate', 'dislike'] 
//     },
//     { 
//       category: MemoryCategories.HOBBIES, 
//       terms: ['hobby', 'hobbies', 'collect', 'play', 'game', 'sport', 'activity', 'free time'] 
//     },
//     { 
//       category: MemoryCategories.CONTACT, 
//       terms: ['email', 'phone', 'address', 'contact', 'reach'] 
//     }
//   ]
// };

// /**
//  * Detects if a message is asking about another user and extracts the username.
//  * @param {string} message - The user's message
//  * @returns {object|null} - { username, query, category } if asking about another user, null otherwise
//  */
// export function detectUserQuery(message) {
//   try {
//     validateQuery(message);
    
//     for (const pattern of QUERY_DETECTION.patterns) {
//       const match = message.match(pattern);
//       if (match) {
//         const username = match[1].toLowerCase();
//         validateUsername(username);
        
//         const query = match[2] ? match[2].toLowerCase() : "general information";
//         validateQuery(query);
        
//         const category = detectCategory(query);
        
//         return { username, query, category };
//       }
//     }
    
//     return null;
//   } catch (error) {
//     logger.warn('User query detection failed', { 
//       message, 
//       error: error.message 
//     });
//     return null;
//   }
// }

// /**
//  * Detects the memory category from the query text
//  * @param {string} query - The query text
//  * @returns {string|null} - Category name or null
//  */
// function detectCategory(query) {
//   const lowered = query.toLowerCase();
  
//   for (const pattern of QUERY_DETECTION.categoryPatterns) {
//     if (pattern.terms.some(term => lowered.includes(term))) {
//       return pattern.category;
//     }
//   }
  
//   return null;
// }

// /**
//  * Finds a Discord user ID from a username or nickname.
//  * @param {string} username - The username to search for
//  * @returns {Promise<string|null>} - User ID or null if not found
//  */
// export async function findUserIdByName(username) {
//   try {
//     // Validate input
//     validateUsername(username);
    
//     // Try to find from our database mapping
//     const { data, error } = await supabase
//       .from('discord_users')
//       .select('user_id')
//       .or(`username.ilike.%${username}%,nickname.ilike.%${username}%`)
//       .limit(1);
      
//     if (error) {
//       logger.error("Error querying user mapping", { error, username });
//       throw new UserMemoryError('Database query failed', 'DATABASE_ERROR');
//     }
    
//     if (data && data.length > 0) {
//       return data[0].user_id;
//     }
    
//     // If we can't find in our mapping, check unified_memories for name mentions
//     const { data: memoryData, error: memoryError } = await supabase
//       .from('unified_memories')
//       .select('user_id, memory_text')
//       .or(`memory_text.ilike.%name is ${username}%,memory_text.ilike.%called ${username}%,memory_text.ilike.%named ${username}%`)
//       .limit(5);
      
//     if (memoryError) {
//       logger.error("Error searching memories for username", { error: memoryError, username });
//       throw new UserMemoryError('Memory search failed', 'DATABASE_ERROR');
//     }
    
//     if (!memoryData || memoryData.length === 0) {
//       throw new UserNotFoundError(username);
//     }
    
//     // Return the first user ID found
//     return memoryData[0].user_id;
//   } catch (error) {
//     if (error instanceof UserNotFoundError) {
//       logger.info(`User not found: ${username}`);
//       return null;
//     }
    
//     logger.error("Unexpected error finding user by name", { 
//       error, 
//       username 
//     });
    
//     return null;
//   }
// }

// /**
//  * Handles a query about another user's information.
//  * @param {string} askingUserId - ID of the user asking the question
//  * @param {string} targetUsername - Username being asked about
//  * @param {string} query - What they're asking about
//  * @param {string} category - Optional category to filter by
//  * @returns {Promise<string|null>} - Response or null if can't generate one
//  */
// export async function handleUserInfoQuery(askingUserId, targetUsername, query, category = null) {
//   try {
//     // Validate inputs
//     validateUsername(targetUsername);
//     validateQuery(query);
    
//     // Find the target user ID
//     const targetUserId = await findUserIdByName(targetUsername);
//     if (!targetUserId) {
//       return `I don't think I've met ${targetUsername} before! Or maybe they go by a different name?`;
//     }
    
//     // Validate optional category
//     if (category && !Object.values(MemoryCategories).includes(category)) {
//       throw new InputValidationError('Invalid memory category');
//     }
    
//     // Get relevant memories (from all memory types, with optional category filter)
//     const memories = await retrieveRelevantMemories(targetUserId, query, 6, null, category);
    
//     if (!memories || memories.trim() === "") {
//       if (category) {
//         return `I know ${targetUsername}, but I don't remember anything specific about their ${query} in the ${category} category.`;
//       } else {
//         return `I know ${targetUsername}, but I don't remember anything specific about their ${query}.`;
//       }
//     }
    
//     // Generate a response based on the memories
//     const promptText = `
// The user is asking about ${targetUsername}'s ${query}.
// Here are relevant memories I have about ${targetUsername}:
// ${memories}

// Based on these memories, create a natural response about what I know about ${targetUsername}'s ${query}.
// If the memories don't contain clear information about their query, explain that I don't have specific information about that.
// Remember to maintain my 10-year-old girl personality when responding.
// `;

//     const completion = await openai.chat.completions.create({
//       model: defaultAskModel,
//       messages: [
//         { role: "system", content: getEffectiveSystemPrompt(askingUserId) },
//         { role: "user", content: promptText }
//       ],
//       max_tokens: 1500,
//     });
    
//     return replaceEmoticons(completion.choices[0].message.content);
//   } catch (error) {
//     if (error instanceof InputValidationError) {
//       logger.warn('Invalid input in user info query', { 
//         error: error.message, 
//         username: targetUsername, 
//         query 
//       });
//       return "Sorry, I couldn't process that request. Could you try asking differently?";
//     }
    
//     logger.error("Unexpected error handling user info query", { 
//       error, 
//       username: targetUsername, 
//       query 
//     });
    
//     return null;
//   }
// }


/**
 * Manually creates tables if RPC method fails
 */
async function manuallyCreateTables() {
  // Create interests table
  const { error: interestsError } = await supabase.query(`
    CREATE TABLE IF NOT EXISTS bri_interests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      facts JSONB,
      tags JSONB,
      last_discussed TIMESTAMP WITH TIME ZONE,
      share_threshold FLOAT DEFAULT 0.5,
      embedding VECTOR(1536)
    );
  `);
  
  if (interestsError) {
    logger.warn("Manual creation of interests table failed, but this is expected if using Supabase: ", interestsError);
  }
  
  // Create storyline table
  const { error: storylineError } = await supabase.query(`
    CREATE TABLE IF NOT EXISTS bri_storyline (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      start_date TIMESTAMP WITH TIME ZONE,
      end_date TIMESTAMP WITH TIME ZONE,
      progress FLOAT DEFAULT 0,
      updates JSONB,
      share_threshold FLOAT DEFAULT 0.5,
      embedding VECTOR(1536)
    );
  `);
  
  if (storylineError) {
    logger.warn("Manual creation of storyline table failed, but this is expected if using Supabase: ", storylineError);
  }
  
  // Create relationships table
  const { error: relationshipsError } = await supabase.query(`
    CREATE TABLE IF NOT EXISTS bri_relationships (
      user_id TEXT PRIMARY KEY,
      level INTEGER NOT NULL DEFAULT 0,
      interaction_count INTEGER DEFAULT 0,
      last_interaction TIMESTAMP WITH TIME ZONE,
      shared_interests JSONB,
      conversation_topics JSONB,
      inside_jokes JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  
  if (relationshipsError) {
    logger.warn("Manual creation of relationships table failed, but this is expected if using Supabase: ", relationshipsError);
  }
}


try {
  // First migrate the journal channel settings
  const migrationResult = await migrateJournalChannels();
  logger.info("Journal settings migration result:", migrationResult);
  
  // If a global channel was found, complete its migration with the client
  if (migrationResult.global_channel_id) {
    const globalMigrationResult = await migrateGlobalJournalChannel(
      client, // Pass the Discord client
      migrationResult.global_channel_id // Pass the global channel ID from the first function
    );
    
    logger.info("Global channel migration result:", globalMigrationResult);
  }
  
  // Then initialize the journal system
  await initializeJournalSystem(client);
  logger.info("Journal system initialized");
} catch (error) {
  logger.error("Error during journal migration or initialization:", error);
}

// Test database access
//const databaseOk = await testDatabaseAccess();
//if (!databaseOk) {
//  logger.warn("Database access issues detected. Time-related features may not work correctly.");
//}

// Run database tests
//await testDatabaseInDepth();


/**
 * Retrieves relevant memories for a query
 * @param {string} userId - The user's ID
 * @param {string} query - The query text
 * @param {number} limit - Maximum number of memories to return
 * @param {string} memoryType - Filter by memory type (optional)
 * @param {string} category - Filter by category (optional)
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - Relevant memories as text
 */
export async function retrieveRelevantMemories(userId, query, limit = 5, memoryType = null, category = null, guildId) {
  try {
    // Get embedding for query
    const embedding = await getEmbedding(query);
    
    // Use the specialized function for vector search
    const matches = await cachedVectorSearch(userId, embedding, {
      threshold: 0.6,
      limit,
      memoryType,
      category,
      guildId
    });
    
    if (!matches || matches.length === 0) {
      return "";
    }
    
    // Sort by confidence * distance to get most reliable and relevant memories first
    const sortedData = [...matches].sort((a, b) => 
      (b.confidence * b.distance) - (a.confidence * a.distance)
    );
    
    // Format memories, adding confidence indicator for intuited memories
    const formattedMemories = sortedData.map(memory => {
      if (memory.memory_type === 'intuited' && memory.confidence < 0.9) {
        // For lower confidence intuited memories, add an indicator
        return `${memory.memory_text} (I think)`;
      }
      return memory.memory_text;
    });
    
    return formattedMemories.join("\n");
  } catch (error) {
    // Make sure to capture and log the full error
    logger.error("Error in retrieveRelevantMemories:", error, error.stack, { userId, guildId });
    return "";
  }
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
