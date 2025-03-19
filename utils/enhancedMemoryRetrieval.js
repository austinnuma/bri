// enhancedMemoryRetrieval.js
import { logger } from './logger.js';
import { supabase } from '../services/combinedServices.js';
import { getEmbedding } from './improvedEmbeddings.js';
import { processRetrievedMemories } from './memoryConfidence.js';

/**
 * Retrieves relevant memories with confidence-weighted relevance scoring
 * @param {string} userId - The user's ID
 * @param {string} query - The query text
 * @param {number} limit - Maximum number of memories to return
 * @param {string} memoryType - Filter by memory type (optional)
 * @param {string} category - Filter by category (optional)
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - Relevant memories as text
 */
export async function retrieveMemoriesWithConfidence(userId, query, limit = 5, memoryType = null, category = null, guildId) {
  try {
    // Get embedding for query
    const embedding = await getEmbedding(query);
    
    // Use the RPC function for vector search
    const { data: matches, error } = await supabase.rpc('match_unified_memories', {
      p_user_id: userId,
      p_guild_id: guildId,
      p_query_embedding: embedding,
      p_match_threshold: 0.5, // Lower threshold to catch more memories
      p_match_count: limit * 2, // Get more than we need for reranking
      p_memory_type: memoryType
    });
    
    if (error) {
      logger.error("Error retrieving memories with confidence:", { error, userId, guildId });
      return "";
    }
    
    if (!matches || matches.length === 0) {
      return "";
    }
    
    // Process and rerank memories based on confidence and similarity
    const rerankedMemories = processRetrievedMemories(matches);
    
    // Take only the requested number of memories
    const topMemories = rerankedMemories.slice(0, limit);
    
    // Format memories, adding confidence indicator for lower confidence
    const formattedMemories = topMemories.map(memory => {
      if (memory.confidence < 0.7) {
        // For lower confidence memories, add an indicator
        return `${memory.memory_text} (I think)`;
      } else if (memory.confidence < 0.5) {
        // For very low confidence, add stronger uncertainty
        return `${memory.memory_text} (I'm not sure about this)`;
      }
      return memory.memory_text;
    });
    
    return formattedMemories.join("\n");
  } catch (error) {
    logger.error("Error in retrieveMemoriesWithConfidence:", error, error.stack, { userId, guildId });
    return "";
  }
}

/**
 * Retrieves context-aware memories based on conversation history
 * @param {string} userId - The user's ID
 * @param {string} currentQuery - Current user message
 * @param {Array} conversationHistory - Recent conversation messages
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - Relevant memories as text
 */
export async function contextAwareMemoryRetrieval(userId, currentQuery, conversationHistory, guildId) {
  try {
    // Extract recent context from conversation
    const recentMessages = conversationHistory.slice(-3)
      .filter(msg => msg.role === "user")
      .map(msg => msg.content)
      .join(" ");
    
    // Create a combined contextual query
    const contextualQuery = `${currentQuery} ${recentMessages}`.trim();
    
    // Use the embedding of this combined query
    return await retrieveMemoriesWithConfidence(userId, contextualQuery, 6, null, null, guildId);
  } catch (error) {
    logger.error("Error in contextAwareMemoryRetrieval:", error);
    // Fall back to basic retrieval if context-aware fails
    return await retrieveMemoriesWithConfidence(userId, currentQuery, 5, null, null, guildId);
  }
}

/**
 * Updates the unified_memories table when accessing memories for retrieval
 * This function should be called whenever retrieveRelevantMemories is used
 * @param {Array} retrievedMemories - Array of memory objects that were retrieved
 * @returns {Promise<boolean>} - Success status
 */
export async function updateMemoryAccessStats(retrievedMemories) {
  try {
    if (!retrievedMemories || retrievedMemories.length === 0) {
      return true;
    }
    
    // Prepare batch update data
    const updates = retrievedMemories.map(memory => ({
      id: memory.id,
      last_accessed: new Date().toISOString(),
      access_count: (memory.access_count || 0) + 1
    }));
    
    // Batch update all memories
    for (const update of updates) {
      await supabase
        .from('unified_memories')
        .update({
          last_accessed: update.last_accessed,
          access_count: update.access_count
        })
        .eq('id', update.id);
    }
    
    return true;
  } catch (error) {
    logger.error("Error updating memory access stats:", error);
    return false;
  }
}

/**
 * Updates the confidence of overlapping memories when a new memory is added
 * @param {string} userId - The user's ID
 * @param {string} newMemoryText - The new memory text
 * @param {number} newMemoryId - ID of the newly created memory
 * @param {string} guildId - The guild ID
 * @returns {Promise<boolean>} - Success status
 */
export async function updateOverlappingMemoriesConfidence(userId, newMemoryText, newMemoryId, guildId) {
  try {
    // Get embedding for the new memory
    const embedding = await getEmbedding(newMemoryText);
    
    // Find similar memories
    const { data: similarMemories, error } = await supabase.rpc('match_unified_memories', {
      p_user_id: userId,
      p_guild_id: guildId,
      p_query_embedding: embedding,
      p_match_threshold: 0.85, // High threshold for similar memories
      p_match_count: 5
    });
    
    if (error) {
      logger.error("Error finding similar memories for confidence update:", error);
      return false;
    }
    
    if (!similarMemories || similarMemories.length === 0) {
      return true; // No similar memories found
    }
    
    // Update similar memories, excluding the new memory itself
    for (const memory of similarMemories) {
      if (memory.id === newMemoryId) continue;
      
      // Confidence adjustment depends on both memories' types
      let confidenceAdjustment = 0;
      
      if (memory.memory_type === 'explicit') {
        // Explicit memory corroborated by a new memory gets small boost
        confidenceAdjustment = 0.05;
      } else {
        // Intuited memory corroborated by another gets moderate boost
        confidenceAdjustment = 0.1;
      }
      
      // Update the confidence
      const newConfidence = Math.min(1.0, memory.confidence + confidenceAdjustment);
      
      await supabase
        .from('unified_memories')
        .update({ confidence: newConfidence })
        .eq('id', memory.id);
    }
    
    return true;
  } catch (error) {
    logger.error("Error updating overlapping memories confidence:", error);
    return false;
  }
}