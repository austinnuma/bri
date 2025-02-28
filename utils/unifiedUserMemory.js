// Enhanced user memory query system for the unified memory structure
import { openai, defaultAskModel } from '../services/openaiService.js';
import { supabase } from '../services/supabaseService.js';
import { logger } from './logger.js';
import { replaceEmoticons } from './textUtils.js';
import { 
  getEffectiveSystemPrompt, 
  retrieveRelevantMemories, 
  MemoryTypes, 
  MemoryCategories 
} from './unifiedMemoryManager.js';

// Common English words that are often mistaken for usernames
const COMMON_WORDS = new Set([
  // Time-related
  'today', 'tomorrow', 'yesterday', 'morning', 'evening', 'night', 'week', 'month', 'year',
  
  // Question topics
  'your', 'their', 'that', 'this', 'these', 'those', 'there', 'here', 
  
  // Common subjects
  'weather', 'time', 'news', 'information', 'computer', 'phone', 'data', 'system',
  'people', 'person', 'human', 'world', 'country', 'city', 'place', 'thing',
  
  // Technical terms
  'computer', 'software', 'hardware', 'program', 'device', 'internet', 'website',
  'data', 'file', 'code', 'system', 'network', 'server', 'database', 'api',
  'app', 'application', 'semiconductor', 'technology', 'artificial', 'intelligence',
  
  // Conversation words
  'hello', 'help', 'please', 'thanks', 'thank', 'sorry', 'excuse',
  
  // Articles and connectors
  'the', 'and', 'but', 'for', 'not', 'with', 'without', 'from', 'about'
]);

/**
 * Cache of known Discord usernames to avoid repeated DB queries
 * Format: { username: userId, ... }
 */
const usernameCache = new Map();

/**
 * Checks if a potential username is valid by checking against:
 * 1. Known Discord users in our database
 * 2. A list of common words that are unlikely to be usernames
 * 
 * @param {string} potentialUsername - The potential username to validate
 * @returns {Promise<string|null>} - The user ID if valid, null otherwise
 */
async function validateUsername(potentialUsername) {
  if (!potentialUsername || potentialUsername.length < 2) return null;
  
  // Normalize to lowercase for all checks
  const username = potentialUsername.toLowerCase();
  
  // Check against common words list first (quick rejection)
  if (COMMON_WORDS.has(username)) {
    return null;
  }
  
  // Check if we already know this is a valid username
  if (usernameCache.has(username)) {
    return usernameCache.get(username);
  }
  
  // Query the database to check if this is a known Discord username or nickname
  try {
    const { data, error } = await supabase
      .from('discord_users')
      .select('user_id')
      .or(`username.ilike.${username},nickname.ilike.${username}`)
      .limit(1);
      
    if (error) {
      logger.error("Error validating username:", error);
      return null;
    }
    
    if (data && data.length > 0) {
      // Valid username found - cache it
      usernameCache.set(username, data[0].user_id);
      return data[0].user_id;
    }
    
    // If not found in discord_users, try one more place - memory text
    const { data: memoryData, error: memoryError } = await supabase
      .from('unified_memories')
      .select('user_id')
      .or(`memory_text.ilike.%name is ${username}%,memory_text.ilike.%called ${username}%`)
      .limit(1);
      
    if (memoryError || !memoryData || memoryData.length === 0) {
      return null;
    }
    
    // Found in memories - cache and return
    usernameCache.set(username, memoryData[0].user_id);
    return memoryData[0].user_id;
  } catch (error) {
    logger.error("Error in validateUsername:", error);
    return null;
  }
}

/**
 * Detects if a message is asking about another user and extracts the username.
 * Includes validation to prevent false positives.
 * 
 * @param {string} message - The user's message
 * @returns {Promise<object|null>} - { username, query, category } if asking about another user, null otherwise
 */
export async function detectUserQuery(message) {
  if (!message || typeof message !== 'string') return null;
  
  // More specific patterns for user queries with proper possessive context
  const patterns = [
    // "What is austin's favorite food?" - Possessive form
    /(?:what|who|how)\s+(?:is|are)\s+(\w+)['']s\s+(.+?)(?:\?|$)/i,
    
    // "Tell me about austin's hobbies" - Possessive form
    /(?:tell me|do you know)\s+about\s+(\w+)['']s\s+(.+?)(?:\?|$)/i,
    
    // "What do you know about austin?" - Direct about pattern
    /(?:what|who|how|tell me|do you know)\s+(?:do you know\s+)?about\s+(\w+)(?:\?|$)/i,
    
    // Specific "do you remember" pattern
    /do\s+you\s+(?:know|remember)\s+(\w+)(?:\?|$)/i,
    
    // User-specific commands
    /^(?:user|profile|info|about):?\s+(\w+)(?:\s+(.+))?(?:\?|$)/i
  ];
  
  // Try each pattern
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;
    
    // Extract potential username and query
    const potentialUsername = match[1].toLowerCase();
    const query = match[2] ? match[2].toLowerCase() : "general information";
    
    // Validate the username
    const validUserId = await validateUsername(potentialUsername);
    
    // If username is valid, proceed
    if (validUserId) {
      // Try to detect the category from the query
      const category = detectCategory(query);
      
      return { 
        username: potentialUsername, 
        query, 
        category,
        userId: validUserId  // Add the userId for convenience
      };
    }
  }
  
  // Special case for asking explicitly with user: prefix
  if (message.toLowerCase().startsWith('user:')) {
    const parts = message.slice(5).trim().split(/\s+/, 2);
    if (parts.length > 0) {
      const potentialUsername = parts[0].toLowerCase();
      const validUserId = await validateUsername(potentialUsername);
      
      if (validUserId) {
        const query = parts.length > 1 ? parts[1] : "general information";
        const category = detectCategory(query);
        
        return { 
          username: potentialUsername, 
          query, 
          category,
          userId: validUserId
        };
      }
    }
  }
  
  return null;
}

/**
 * Detects the memory category from the query text
 * @param {string} query - The query text
 * @returns {string|null} - Category name or null
 */
function detectCategory(query) {
  const lowered = query.toLowerCase();
  
  // Category detection patterns
  const categoryPatterns = [
    { category: MemoryCategories.PERSONAL, terms: ['name', 'age', 'birthday', 'born', 'lives', 'from', 'where', 'family', 'married', 'children'] },
    { category: MemoryCategories.PROFESSIONAL, terms: ['job', 'work', 'career', 'company', 'business', 'profession', 'school', 'study', 'degree'] },
    { category: MemoryCategories.PREFERENCES, terms: ['like', 'love', 'enjoy', 'prefer', 'favorite', 'favourite', 'hate', 'dislike'] },
    { category: MemoryCategories.HOBBIES, terms: ['hobby', 'hobbies', 'collect', 'play', 'game', 'sport', 'activity', 'free time'] },
    { category: MemoryCategories.CONTACT, terms: ['email', 'phone', 'address', 'contact', 'reach'] }
  ];
  
  for (const pattern of categoryPatterns) {
    if (pattern.terms.some(term => lowered.includes(term))) {
      return pattern.category;
    }
  }
  
  return null;
}

/**
 * Finds a Discord user ID from a username or nickname.
 * @param {string} username - The username to search for
 * @returns {Promise<string|null>} - User ID or null if not found
 */
export async function findUserIdByName(username) {
  try {
    // Try to find from our database mapping
    const { data, error } = await supabase
      .from('discord_users')
      .select('user_id')
      .or(`username.ilike.%${username}%,nickname.ilike.%${username}%`)
      .limit(1);
      
    if (error) {
      logger.error("Error querying user mapping", { error });
      return null;
    }
    
    if (data && data.length > 0) {
      return data[0].user_id;
    }
    
    // If we can't find in our mapping, check unified_memories for name mentions
    const { data: memoryData, error: memoryError } = await supabase
      .from('unified_memories')
      .select('user_id, memory_text')
      .or(`memory_text.ilike.%name is ${username}%,memory_text.ilike.%called ${username}%,memory_text.ilike.%named ${username}%`)
      .limit(5);
      
    if (memoryError || !memoryData || memoryData.length === 0) {
      return null;
    }
    
    // Return the first user ID found
    return memoryData[0].user_id;
  } catch (error) {
    logger.error("Error finding user by name", { error });
    return null;
  }
}

/**
 * Handles a query about another user's information.
 * @param {string} askingUserId - ID of the user asking the question
 * @param {string} targetUsername - Username being asked about
 * @param {string} query - What they're asking about
 * @param {string} category - Optional category to filter by
 * @returns {Promise<string|null>} - Response or null if can't generate one
 */
export async function handleUserInfoQuery(askingUserId, targetUsername, query, category = null) {
  try {
    // Find the target user ID
    const targetUserId = await findUserIdByName(targetUsername);
    if (!targetUserId) {
      return `I don't think I've met ${targetUsername} before! Or maybe they go by a different name?`;
    }
    
    // Get relevant memories (from all memory types, with optional category filter)
    const memories = await retrieveRelevantMemories(targetUserId, query, 6, null, category);
    
    if (!memories || memories.trim() === "") {
      if (category) {
        return `I know ${targetUsername}, but I don't remember anything specific about their ${query} in the ${category} category.`;
      } else {
        return `I know ${targetUsername}, but I don't remember anything specific about their ${query}.`;
      }
    }
    
    // Generate a response based on the memories
    const promptText = `
The user is asking about ${targetUsername}'s ${query}.
Here are relevant memories I have about ${targetUsername}:
${memories}

Based on these memories, create a natural response about what I know about ${targetUsername}'s ${query}.
If the memories don't contain clear information about their query, explain that I don't have specific information about that.
Remember to maintain my 10-year-old girl personality when responding.
`;

    const completion = await openai.chat.completions.create({
      model: defaultAskModel,
      messages: [
        { role: "system", content: getEffectiveSystemPrompt(askingUserId) },
        { role: "user", content: promptText }
      ],
      max_tokens: 1500,
    });
    
    return replaceEmoticons(completion.choices[0].message.content);
  } catch (error) {
    logger.error("Error handling user info query", { error });
    return null;
  }
}

/**
 * Gets statistics about a user's memories
 * @param {string} userId - The user's ID
 * @returns {Promise<object>} - Memory statistics
 */
export async function getUserMemoryStats(userId) {
  try {
    const { data, error } = await supabase
      .from('unified_memories')
      .select('memory_type, category')
      .eq('user_id', userId);
      
    if (error) {
      logger.error("Error fetching memory stats", { error });
      return { total: 0 };
    }
    
    if (!data || data.length === 0) {
      return { total: 0 };
    }
    
    // Calculate statistics
    const stats = {
      total: data.length,
      byType: {},
      byCategory: {}
    };
    
    // Count by type
    for (const memory of data) {
      // Count by type
      if (!stats.byType[memory.memory_type]) {
        stats.byType[memory.memory_type] = 0;
      }
      stats.byType[memory.memory_type]++;
      
      // Count by category
      if (!stats.byCategory[memory.category]) {
        stats.byCategory[memory.category] = 0;
      }
      stats.byCategory[memory.category]++;
    }
    
    return stats;
  } catch (error) {
    logger.error("Error getting user memory stats", { error });
    return { total: 0 };
  }
}