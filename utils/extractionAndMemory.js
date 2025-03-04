
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
Extract ONLY concrete facts about the user from the conversation summary below.
Focus specifically on:
- Name, age, location (city, country)
- Job title, workplace, industry
- Hobbies, interests, skills
- Preferences (foods, colors, music, movies, books)
- Family members, pets
- Important dates (birthdays, anniversaries)

DO NOT extract:
- Opinions about general topics
- Temporary states (feeling tired today)
- Bot responses or actions
- Questions the user asked
- Things the user is planning to do in the future
- Any information that isn't a clear fact about the user

Output ONLY a JSON array of simple, clear statements in the format:
["User's name is John", "User lives in Seattle", "User works as a software engineer"]

If no concrete personal facts are found, output an empty array: []
-----
SUMMARY: ${summaryText}`;
  
  try {
    // Extract facts from the summary
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Use a consistent model name from openaiService
      messages: [
        { 
          role: "system", 
          content: "You extract specific personal facts about users. Be precise and factual."
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