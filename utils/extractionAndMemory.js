
import { openai, defaultAskModel, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { replaceEmoticons, stripCodeBlock, normalizeText } from './textUtils.js';
import natural from 'natural';
import { 
  getEffectiveSystemPrompt, 
  retrieveRelevantMemories, 
  MemoryTypes, 
  MemoryCategories 
} from './unifiedMemoryManager.js';

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

/**
 * Post-processes extracted facts to remove invalid or low-quality memories
 * while preserving legitimate negative preferences
 * @param {Array<string>} facts - The extracted facts
 * @returns {Array<string>} - Filtered and improved facts
 */
function postProcessExtractedFacts(facts) {
  // Filter out problematic patterns
  const filteredFacts = facts.filter(fact => {
    const lowercaseFact = fact.toLowerCase();
    
    // Filter out "not provided" statements (meta-statements about missing info)
    if (lowercaseFact.includes('not provided') || 
        lowercaseFact.includes('unknown') || 
        lowercaseFact.includes('doesn\'t mention') ||
        lowercaseFact.includes('did not mention') ||
        lowercaseFact.includes('no information')) {
      return false;
    }
    
    // Filter out uncertain statements
    if (lowercaseFact.includes('might be') || 
        lowercaseFact.includes('possibly') ||
        lowercaseFact.includes('probably') ||
        lowercaseFact.includes('could be') ||
        lowercaseFact.includes('may have')) {
      return false;
    }
    
    // Special case for negative preferences vs meta-statements
    // Keep legitimate negative preferences while filtering meta-statements
    if (lowercaseFact.includes('didn\'t') || 
        lowercaseFact.includes('did not') ||
        lowercaseFact.includes('doesn\'t') ||
        lowercaseFact.includes('does not') ||
        lowercaseFact.includes('has not')) {
      
      // Preserve negative preferences about specific things
      const isNegativePreference = 
        (lowercaseFact.includes('like') || 
         lowercaseFact.includes('enjoy') ||
         lowercaseFact.includes('prefer') ||
         lowercaseFact.includes('want') ||
         lowercaseFact.includes('care for'));
         
      // Also preserve negative facts about allergies, dietary restrictions, etc.
      const isRelevantNegativeFact =
        (lowercaseFact.includes('allergic') ||
         lowercaseFact.includes('eat') ||
         lowercaseFact.includes('drink') ||
         lowercaseFact.includes('own') ||
         lowercaseFact.includes('have'));
      
      return isNegativePreference || isRelevantNegativeFact;
    }
    
    // Ensure fact has some substance (more than just "User is" or similar)
    if (lowercaseFact.length < 12) {
      return false;
    }
    
    return true;
  });
  
  // Normalize and improve the remaining facts
  return filteredFacts.map(fact => {
    // Ensure facts start with "User" for consistency
    if (!fact.toLowerCase().startsWith('user')) {
      fact = 'User ' + fact;
    }
    
    return fact;
  });
}


/**
 * Two-stage memory extraction that first summarizes then infers preferences
 * @param {string} userId - User ID
 * @param {Array} conversation - Conversation history
 * @returns {Promise<Array<string>>} - Extracted memories
 */
export async function enhancedMemoryExtraction(userId, conversation) {
  try {
    logger.info(`Running enhanced two-stage memory extraction for user ${userId}`);
    
    // Step 1: Generate conversation summary
    const summary = await summarizeConversation(conversation);
    if (!summary) {
      logger.warn(`Failed to generate summary for user ${userId}`);
      return [];
    }
    
    // Step 2: Extract explicit facts from summary
    const explicitFacts = await extractExplicitFacts(summary);
    
    // Step 3: Extract implied preferences and reactions
    const impliedPreferences = await extractImpliedPreferences(summary, conversation);
    
    // Combine all extracted information
    const allExtractions = [...explicitFacts, ...impliedPreferences];
    
    // Post-process to filter, normalize, and deduplicate
    const filteredExtractions = postProcessExtractedFacts(allExtractions);
    const deduplicatedFacts = await deduplicateAgainstExisting(filteredExtractions, userId);
    
    logger.info(`Extracted ${deduplicatedFacts.length} memories for user ${userId}`);
    return deduplicatedFacts;
  } catch (error) {
    logger.error(`Error in enhanced memory extraction for user ${userId}:`, error);
    return [];
  }
}

/**
 * Extracts explicit facts from summary
 * @param {string} summary - Conversation summary
 * @returns {Promise<Array<string>>} - Extracted explicit facts
 */
async function extractExplicitFacts(summary) {
  const explicitPrompt = `
Extract ONLY clearly stated, explicit facts about the user from this conversation summary.
Focus on biographical information, concrete details, and directly stated preferences.

Include:
- Biographical information (name, age, location, etc.)
- Professional information (job, education, etc.)
- Clearly stated likes/dislikes ("I love pizza", "I hate horror movies")
- Family details, pets
- Concrete hobbies and activities they engage in

Exclude:
- Implied preferences without direct statements
- Uncertain information (might, maybe, possibly)
- Hypothetical statements
- Negative information (what they don't have/like)
- Meta-statements about missing information

Output ONLY a JSON array of facts:
["User's name is John", "User works as a software engineer"]

If no explicit facts are found, output an empty array: []
-----
SUMMARY: ${summary}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You extract only explicit, clearly stated facts about users. Be precise and factual."
        },
        { role: "user", content: explicitPrompt }
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
      logger.error("Error parsing explicit facts JSON:", e);
      extractedFacts = [];
    }
    
    return extractedFacts;
  } catch (error) {
    logger.error("Error extracting explicit facts:", error);
    return [];
  }
}

/**
 * Extracts implied preferences from conversation context
 * @param {string} summary - Conversation summary
 * @param {Array} conversation - Original conversation
 * @returns {Promise<Array<string>>} - Extracted implied preferences
 */
async function extractImpliedPreferences(summary, conversation) {
  // Extract user messages for context
  const userMessages = conversation
    .filter(msg => msg.role === "user")
    .map(msg => msg.content)
    .join("\n");
  
  const preferencePrompt = `
Analyze this conversation summary and user messages to identify IMPLIED preferences and interests.
Look for:

1. Emotional reactions to topics (positive or negative)
2. Engagement patterns (what topics the user engages with enthusiastically)
3. Subtle cues about likes/dislikes without direct statements
4. Food, entertainment, or activity preferences based on context
5. Values and priorities revealed through conversation

Examples of good inferences:
- If user responds positively to cookies → "User enjoys cookies"
- If user asks detailed questions about a topic → "User is interested in [topic]"
- If user mentions watching a show multiple times → "User enjoys [show]"

Do NOT include:
- Anything already covered in explicit facts
- General opinions unrelated to personal preferences
- Highly uncertain inferences
- "Not provided" statements

Output ONLY a JSON array of inferred preferences:
["User enjoys action movies", "User is interested in astronomy"]

If no preferences can be confidently inferred, output an empty array: []
-----
SUMMARY: ${summary}

USER MESSAGES: ${userMessages}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You extract implied preferences and interests from conversations. Be insightful but reasonably confident in your inferences."
        },
        { role: "user", content: preferencePrompt }
      ],
      max_tokens: 1000,
    });
    
    let output = completion.choices[0].message.content.trim();
    output = stripCodeBlock(output);
    
    let extractedPreferences;
    try {
      extractedPreferences = JSON.parse(output);
      if (!Array.isArray(extractedPreferences)) extractedPreferences = [];
    } catch (e) {
      logger.error("Error parsing implied preferences JSON:", e);
      extractedPreferences = [];
    }
    
    return extractedPreferences;
  } catch (error) {
    logger.error("Error extracting implied preferences:", error);
    return [];
  }
}


/**
 * Deduplicates newly extracted facts against existing memory database.
 * Uses Jaro-Winkler distance for fuzzy matching to prevent near-duplicates.
 * 
 * @param {Array<string>} newFacts - Newly extracted facts
 * @param {string} userId - User ID to fetch existing memories
 * @returns {Promise<Array<string>>} - Deduplicated facts
 */
async function deduplicateAgainstExisting(newFacts, userId) {
  // Fetch existing memories (both explicit and intuited)
  const existingMemories = await retrieveRelevantMemories(userId);
  
  if (!existingMemories || existingMemories.trim() === "") {
    return newFacts; // No existing memories to deduplicate against
  }
  
  // Convert existing memories to an array
  const existingTexts = existingMemories.split('\n');
  
  // Filter out duplicates
  const SIMILARITY_THRESHOLD = 0.85;
  const uniqueFacts = newFacts.filter(newFact => {
    // Check if this fact is too similar to any existing memory
    return !existingTexts.some(existingText => {
      const similarity = natural.JaroWinklerDistance(
        normalizeForComparison(newFact),
        normalizeForComparison(existingText)
      );
      return similarity > SIMILARITY_THRESHOLD;
    });
  });
  
  return uniqueFacts;
}

/**
 * Normalizes text for better comparison by removing stopwords,
 * converting to lowercase, and removing punctuation.
 * 
 * @param {string} text - Text to normalize
 * @returns {string} - Normalized text
 */
function normalizeForComparison(text) {
  return text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}