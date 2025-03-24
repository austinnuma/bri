// enhancedGraphMemoryRetrieval.js - Enhanced memory retrieval with graph and temporal understanding
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getEmbedding } from './improvedEmbeddings.js';
import { processRetrievedMemories } from './memoryConfidence.js';
import { enhanceMemoriesWithGraph, formatEnhancedMemoriesForPrompt } from './memoryGraphManager.js';
import { getTemporalQueryContext, enhanceMemoriesWithTemporal, formatMemoriesWithTemporal } from './temporalMemoryUnderstanding.js';

/**
 * Retrieves memories with enhanced graph traversal and temporal understanding
 * @param {string} userId - The user's ID
 * @param {string} query - The query text
 * @param {number} limit - Maximum number of memories to return
 * @param {string} memoryType - Filter by memory type (optional)
 * @param {string} category - Filter by category (optional)
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - Relevant memories as text
 */
export async function retrieveMemoriesWithGraphAndTemporal(userId, query, limit = 5, memoryType = null, category = null, guildId) {
  try {
    // Step 1: Get embedding for query
    const embedding = await getEmbedding(query);
    
    // Step 2: Analyze query for temporal context
    const temporalContext = await getTemporalQueryContext(query);
    
    // Step 3: Use the RPC function for vector search
    const { data: matches, error } = await supabase.rpc('match_unified_memories', {
      p_user_id: userId,
      p_guild_id: guildId,
      p_query_embedding: embedding,
      p_match_threshold: 0.5, // Lower threshold to catch more memories
      p_match_count: limit * 2, // Get more than we need for reranking
      p_memory_type: memoryType
    });
    
    if (error) {
      logger.error("Error retrieving memories with graph and temporal:", { error, userId, guildId });
      return "";
    }
    
    if (!matches || matches.length === 0) {
      return "";
    }
    
    // Step 4: Process and rerank memories based on confidence and similarity
    const processedMemories = processRetrievedMemories(matches);
    
    // Step 5: Enhance with graph connections
    const graphEnhancedMemories = await enhanceMemoriesWithGraph(
      userId, 
      query, 
      guildId, 
      processedMemories.slice(0, limit), // Use top memories for graph enhancement
      Math.max(2, Math.floor(limit / 2)) // Add up to half as many related memories
    );
    
    // Step 6: Enhance with temporal understanding
    const temporallyEnhancedMemories = enhanceMemoriesWithTemporal(
      graphEnhancedMemories,
      temporalContext
    );
    
    // Step 7: Format memories for prompt, integrating both graph and temporal context
    // Choose formatting based on which enhancements provide more value
    let formattedMemories;
    
    // If the query has strong temporal aspects, prioritize temporal formatting
    if (temporalContext.includes_time_reference) {
      formattedMemories = formatMemoriesWithTemporal(temporallyEnhancedMemories);
    } 
    // Otherwise, if we have graph relationships, prioritize those
    else if (graphEnhancedMemories.some(m => m.graph_relationship)) {
      formattedMemories = formatEnhancedMemoriesForPrompt(temporallyEnhancedMemories);
    }
    // If neither enhancement is particularly valuable, use simpler formatting
    else {
      formattedMemories = temporallyEnhancedMemories
        .slice(0, limit)
        .map(memory => `- ${memory.memory_text}`)
        .join("\n");
    }
    
    return formattedMemories;
  } catch (error) {
    logger.error("Error in retrieveMemoriesWithGraphAndTemporal:", error, error.stack, { userId, guildId });
    return "";
  }
}

/**
 * Retrieves context-aware memories based on conversation history with graph and temporal enhancements
 * @param {string} userId - The user's ID
 * @param {string} currentQuery - Current user message
 * @param {Array} conversationHistory - Recent conversation messages
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - Relevant memories as text
 */
export async function contextAwareMemoryRetrievalWithEnhancements(userId, currentQuery, conversationHistory, guildId) {
  try {
    // Extract recent context from conversation
    const recentMessages = conversationHistory.slice(-3)
      .filter(msg => msg.role === "user")
      .map(msg => msg.content)
      .join(" ");
    
    // Create a combined contextual query
    const contextualQuery = `${currentQuery} ${recentMessages}`.trim();
    
    // Use the embedding of this combined query
    return await retrieveMemoriesWithGraphAndTemporal(userId, contextualQuery, 6, null, null, guildId);
  } catch (error) {
    logger.error("Error in contextAwareMemoryRetrievalWithEnhancements:", error);
    // Fall back to basic retrieval if context-aware fails
    return await retrieveMemoriesWithGraphAndTemporal(userId, currentQuery, 5, null, null, guildId);
  }
}

/**
 * Identifies relevant memory contexts based on combination of graph and temporal analysis
 * @param {string} userId - The user ID
 * @param {string} query - The query text
 * @param {string} guildId - The guild ID
 * @returns {Promise<Object|null>} - Memory context information
 */
export async function identifyMemoryContext(userId, query, guildId) {
  try {
    // Get temporal query context
    const temporalContext = await getTemporalQueryContext(query);
    
    // Get initial memories
    const embedding = await getEmbedding(query);
    const { data: matches, error } = await supabase.rpc('match_unified_memories', {
      p_user_id: userId,
      p_guild_id: guildId,
      p_query_embedding: embedding,
      p_match_threshold: 0.6,
      p_match_count: 5
    });
    
    if (error || !matches || matches.length === 0) {
      return {
        has_context: false,
        temporal_focus: temporalContext.time_focus,
        memories_found: 0
      };
    }
    
    // Process the matches
    const processedMemories = processRetrievedMemories(matches);
    
    // Get the top memory
    const topMemory = processedMemories[0];
    
    // Find connected memories for the top result
    const { data: connections, error: connError } = await supabase
      .from('memory_connections')
      .select('relationship_type, confidence, target_memory_id')
      .eq('source_memory_id', topMemory.id)
      .order('confidence', { ascending: false });
      
    const hasConnections = !connError && connections && connections.length > 0;
    
    // Determine the memory context
    return {
      has_context: true,
      temporal_focus: temporalContext.time_focus,
      includes_time_reference: temporalContext.includes_time_reference,
      memories_found: processedMemories.length,
      has_graph_connections: hasConnections,
      top_memory_category: topMemory.category,
      top_memory_created_at: topMemory.created_at,
      confidence: topMemory.confidence
    };
  } catch (error) {
    logger.error("Error in identifyMemoryContext:", error);
    return {
      has_context: false,
      temporal_focus: 'present',
      memories_found: 0
    };
  }
}

/**
 * Enhances system prompt with memory context information
 * @param {string} basePrompt - Base system prompt
 * @param {Object} memoryContext - Memory context from identifyMemoryContext
 * @returns {string} - Enhanced prompt
 */
export function enhancePromptWithMemoryContext(basePrompt, memoryContext) {
  if (!memoryContext || !memoryContext.has_context) {
    return basePrompt;
  }
  
  let contextNote = "\nMEMORY CONTEXT: ";
  
  // Add temporal focus
  if (memoryContext.includes_time_reference) {
    switch (memoryContext.temporal_focus) {
      case 'past':
        contextNote += "The user is asking about past information. ";
        break;
      case 'present':
        contextNote += "The user is asking about current information. ";
        break;
      case 'changes':
        contextNote += "The user is asking about changes over time. ";
        break;
      case 'future':
        contextNote += "The user is asking about future possibilities. ";
        break;
    }
  }
  
  // Add memory graph context
  if (memoryContext.has_graph_connections) {
    contextNote += "There are connected memories that provide additional context. ";
  }
  
  // Add memory category context
  if (memoryContext.top_memory_category) {
    contextNote += `The most relevant memories are in the '${memoryContext.top_memory_category}' category. `;
  }
  
  // Add confidence context
  if (memoryContext.confidence < 0.7) {
    contextNote += "You're working with moderately confident memories. Use tentative language when referring to these memories.";
  } else if (memoryContext.confidence > 0.9) {
    contextNote += "You have high-confidence memories about this topic. Speak confidently about this information.";
  }
  
  return basePrompt + contextNote;
}