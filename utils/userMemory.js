import { openai, defaultAskModel } from '../services/openaiService.js';
import { retrieveRelevantMemories } from './memoryManager.js';
import { supabase } from '../services/supabaseService.js';
import { logger } from './logger.js';
import { getEffectiveSystemPrompt } from './memoryManager.js';
import { replaceEmoticons } from './textUtils.js';

/**
 * Detects if a message is asking about another user and extracts the username.
 * @param {string} message - The user's message
 * @returns {object|null} - { username, query } if asking about another user, null otherwise
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
      return { username, query };
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
    
    // If we can't find in our mapping, let's check user_conversations table
    // This is a fallback approach
    const { data: conversationData, error: conversationError } = await supabase
      .from('user_conversations')
      .select('user_id, intuited_memories, memory')
      .limit(50);  // Get a reasonable number to check
      
    if (conversationError || !conversationData) {
      return null;
    }
    
    // Search through available conversations for name mentions
    for (const record of conversationData) {
      // Check if the username appears in any of their memories
      const allMemories = [
        record.memory || '',
        record.intuited_memories ? JSON.stringify(record.intuited_memories) : ''
      ].join(' ').toLowerCase();
      
      if (allMemories.includes(`name is ${username}`) || 
          allMemories.includes(`called ${username}`) ||
          allMemories.includes(`named ${username}`)) {
        return record.user_id;
      }
    }
    
    return null;
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
 * @returns {Promise<string|null>} - Response or null if can't generate one
 */
export async function handleUserInfoQuery(askingUserId, targetUsername, query) {
  try {
    // Find the target user ID
    const targetUserId = await findUserIdByName(targetUsername);
    if (!targetUserId) {
      return `I don't think I've met ${targetUsername} before! Or maybe they go by a different name?`;
    }
    
    // Get relevant memories about the target user
    const memories = await retrieveRelevantMemories(targetUserId, query);
    if (!memories || memories.trim() === "") {
      return `I know ${targetUsername}, but I don't remember anything specific about their ${query}.`;
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