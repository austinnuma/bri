import { openai, defaultAskModel } from '../services/openaiService.js';
import { retrieveRelevantMemories } from './memoryManager.js';
import { supabase } from '../services/supabaseService.js';
import { logger } from './logger.js';
import { getEffectiveSystemPrompt } from './memoryManager.js';
import { replaceEmoticons } from './textUtils.js';
import { getEmbedding } from './embeddings.js';
import natural from 'natural';

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
    
    // Get memories from various sources
    const vectorMemories = await retrieveRelevantMemories(targetUserId, query);
    const plainTextMemories = await retrieveRelevantPlainTextMemories(targetUserId, query);
    const intuitedMemories = await retrieveRelevantIntuitedMemoriesText(targetUserId, query);
    
    // Combine all memories into one string
    const allMemories = [
      vectorMemories, 
      plainTextMemories, 
      intuitedMemories
    ].filter(m => m && m.trim() !== "").join("\n\n");
    
    if (!allMemories || allMemories.trim() === "") {
      return `I know ${targetUsername}, but I don't remember anything specific about their ${query}.`;
    }
    
    // Generate a response based on the memories
    const promptText = `
The user is asking about ${targetUsername}'s ${query}.
Here are relevant memories I have about ${targetUsername}:
${allMemories}

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
 * Retrieves relevant plain text memories from the user_conversations table
 * by scanning the memory field and finding lines that match the query.
 * 
 * @param {string} userId - The target user's ID
 * @param {string} query - The search query
 * @returns {Promise<string>} - Relevant memories as text
 */
async function retrieveRelevantPlainTextMemories(userId, query) {
  try {
    // Get the user's memories from the memory field
    const { data, error } = await supabase
      .from('user_conversations')
      .select('memory')
      .eq('user_id', userId)
      .single();
      
    if (error || !data || !data.memory) {
      return "";
    }
    
    // Split the memories by newline
    const memories = data.memory.split('\n').filter(m => m.trim() !== "");
    if (memories.length === 0) {
      return "";
    }
    
    // Search for relevant memories using basic text similarity
    const queryTerms = query.toLowerCase().split(/\s+/);
    
    // Score each memory based on how many query terms it contains
    const scoredMemories = memories.map(memory => {
      const text = memory.toLowerCase();
      let score = 0;
      
      // Calculate how many query terms are in the memory
      for (const term of queryTerms) {
        if (text.includes(term)) {
          score++;
        }
      }
      
      // Also use Jaro-Winkler distance for fuzzy matching
      // (this helps catch slight variations in spelling)
      let maxSimilarity = 0;
      const memoryTerms = text.split(/\s+/);
      for (const memTerm of memoryTerms) {
        for (const queryTerm of queryTerms) {
          const similarity = natural.JaroWinklerDistance(memTerm, queryTerm);
          if (similarity > 0.85) { // High similarity threshold
            score += 0.5; // Partial score for similar terms
          }
          maxSimilarity = Math.max(maxSimilarity, similarity);
        }
      }
      
      // Extra points if the entire query has a high similarity
      if (text.includes(query.toLowerCase())) {
        score += 3; // Big bonus for exact match
      }
      
      return { memory, score, similarity: maxSimilarity };
    });
    
    // Sort by score, highest first
    scoredMemories.sort((a, b) => b.score - a.score || b.similarity - a.similarity);
    
    // Return the top memories (at least 25% relevant or top 3)
    const threshold = Math.max(queryTerms.length * 0.25, 1); // At least 25% of terms
    const relevantMemories = scoredMemories
      .filter(m => m.score >= threshold)
      .slice(0, 3) // Take top 3
      .map(m => m.memory);
      
    return relevantMemories.join('\n');
  } catch (error) {
    logger.error("Error retrieving plain text memories", { error });
    return "";
  }
}

/**
 * Helper function to retrieve relevant intuited memories in plain text form
 * 
 * @param {string} userId - The target user's ID
 * @param {string} query - The search query
 * @returns {Promise<string>} - Relevant intuited memories as text
 */
async function retrieveRelevantIntuitedMemoriesText(userId, query) {
  try {
    // Get all intuited memories for this user
    const { data, error } = await supabase
      .from('user_intuited_memories')
      .select('memory_text, embedding')
      .eq('user_id', userId);
      
    if (error || !data || data.length === 0) {
      return "";
    }
    
    // Get embedding for the query
    let queryEmbedding;
    try {
      queryEmbedding = await getEmbedding(query);
    } catch (err) {
      logger.error("Error getting embedding for query", { error: err });
      
      // Fallback to text similarity if embedding fails
      const queryTerms = query.toLowerCase().split(/\s+/);
      const relevantMemories = data
        .filter(item => {
          const text = item.memory_text.toLowerCase();
          return queryTerms.some(term => text.includes(term));
        })
        .slice(0, 3)
        .map(item => item.memory_text);
        
      return relevantMemories.join('\n');
    }
    
    // Calculate similarity for each memory
    const RECALL_THRESHOLD = 0.6;
    const similarities = data.map(item => {
      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      return {
        memory: item.memory_text,
        similarity
      };
    });
    
    // Sort by similarity (highest first) and filter by threshold
    similarities.sort((a, b) => b.similarity - a.similarity);
    const relevantMemories = similarities
      .filter(item => item.similarity > RECALL_THRESHOLD)
      .slice(0, 3)
      .map(item => item.memory);
      
    return relevantMemories.join('\n');
  } catch (error) {
    logger.error("Error retrieving intuited memories", { error });
    return "";
  }
}

/**
 * Helper function for cosine similarity calculation
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}