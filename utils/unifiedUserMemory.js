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

/**
 * Detects if a message is asking about another user and extracts the username.
 * @param {string} message - The user's message
 * @returns {object|null} - { username, query, category } if asking about another user, null otherwise
 */
export function detectUserQuery(message) {
  // Common patterns for asking about other users
  const patterns = [
    // "Do you know what austin's favorite food is?"
    /(?:do you know|tell me|what is|what's|who is|who's|how is|how's)\s+(?:what|who|how|if|about)?\s*(?:is\s+)?(\w+)(?:'s|\s+)(.+?)(?:\s+is)?(?:\?|$)/i,
    
    // "What is austin's favorite food?"
    /(?:what|who|how)\s+(?:is|are)\s+(\w+)(?:'s|\s+)(.+?)(?:\?|$)/i,
    
    // "Tell me about austin's hobbies"
    /(?:tell me|do you know)\s+(?:about\s+)?(\w+)(?:'s|\s+)(.+?)(?:\?|$)/i,
    
    // "What do you know about austin?"
    /(?:what|who|how|tell me|do you know)\s+(?:do you know\s+)?(?:about\s+)?(\w+)(?:\?|$)/i
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      // Extract username and query
      const username = match[1].toLowerCase();
      // If we have a second capture group, use it as the query, otherwise use a general query
      const query = match[2] ? match[2].toLowerCase() : "general information";
      
      // Try to detect the category from the query
      const category = detectCategory(query);
      
      return { username, query, category };
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