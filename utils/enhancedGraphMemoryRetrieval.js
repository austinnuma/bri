// enhancedGraphMemoryRetrieval.js - Enhanced memory retrieval with graph and temporal understanding
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getEmbedding } from './improvedEmbeddings.js';
import { processRetrievedMemories } from './memoryConfidence.js';
import { enhanceMemoriesWithGraph, formatEnhancedMemoriesForPrompt } from './memoryGraphManager.js';
import { getBasicTemporalContext, getTemporalQueryContext, enhanceMemoriesWithTemporal, formatMemoriesWithTemporal } from './temporalMemoryUnderstanding.js';

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
    
    // Step 2: Use the fast non-blocking temporal context analysis
    const temporalContext = getBasicTemporalContext(query);
    
    // The detailed analysis will happen asynchronously in the background
    
    // Step 3: Use the direct vector search with manual query instead of RPC function
    // to avoid timestamp type mismatch errors
    let queryObj = supabase
      .from('unified_memories')
      .select('*')
      .eq('user_id', userId)
      .limit(limit * 2);  // Get more than we need for reranking
    
    // Add optional filters
    if (guildId) {
      queryObj = queryObj.eq('guild_id', guildId);
    }
    
    if (memoryType) {
      queryObj = queryObj.eq('memory_type', memoryType);
    }
    
    if (category) {
      queryObj = queryObj.eq('category', category);
    }
    
    // Order by last_accessed (most recently accessed first)
    // and then by confidence (highest first)
    queryObj = queryObj.order('last_accessed', { ascending: false, nullsLast: true })
                       .order('confidence', { ascending: false });
    
    const { data: memories, error } = await queryObj;
    
    if (error) {
      logger.error("Error retrieving memories with direct query:", { error, userId, guildId });
      return "";
    }
    
    if (!memories || memories.length === 0) {
      return "";
    }
    
    // Filter memories by vector similarity manually since we can't use the RPC function
    // This is less efficient but will work as a fallback
    const similarMemories = await filterMemoriesByVectorSimilarity(memories, embedding, 0.5, limit * 2);
    
    // Step 4: Process and rerank memories based on confidence and similarity
    const processedMemories = processRetrievedMemories(similarMemories);
    
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
    // Fallback to a simpler approach
    return await getSimpleMemories(userId, query, limit, memoryType, category, guildId);
  }
}

/**
 * Calculates cosine similarity between two embedding vectors
 * @param {Array} vec1 - First embedding vector
 * @param {Array} vec2 - Second embedding vector
 * @returns {number} - Cosine similarity (between -1 and 1)
 */
function cosineSimilarity(vec1, vec2) {
  let dotProduct = 0;
  let vec1Magnitude = 0;
  let vec2Magnitude = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    vec1Magnitude += vec1[i] * vec1[i];
    vec2Magnitude += vec2[i] * vec2[i];
  }
  
  vec1Magnitude = Math.sqrt(vec1Magnitude);
  vec2Magnitude = Math.sqrt(vec2Magnitude);
  
  if (vec1Magnitude === 0 || vec2Magnitude === 0) {
    return 0;
  }
  
  return dotProduct / (vec1Magnitude * vec2Magnitude);
}

/**
 * Filters memories by vector similarity
 * @param {Array} memories - Array of memory objects with embeddings
 * @param {Array} queryEmbedding - Query embedding vector
 * @param {number} threshold - Similarity threshold (0-1)
 * @param {number} limit - Maximum number of memories to return
 * @returns {Array} - Filtered and sorted memories
 */
async function filterMemoriesByVectorSimilarity(memories, queryEmbedding, threshold, limit) {
  try {
    // Add similarity score to each memory
    const memoriesWithSimilarity = memories.map(memory => {
      // Some memories might not have embeddings
      if (!memory.embedding) {
        return { ...memory, similarity: 0 };
      }
      
      const similarity = cosineSimilarity(memory.embedding, queryEmbedding);
      return { ...memory, similarity };
    });
    
    // Filter by threshold and sort by similarity
    return memoriesWithSimilarity
      .filter(memory => memory.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  } catch (error) {
    logger.error("Error in filterMemoriesByVectorSimilarity:", error);
    // Return original memories as fallback
    return memories.slice(0, limit);
  }
}

/**
 * Simple backup memory retriever that doesn't use vector search
 * @param {string} userId - The user's ID
 * @param {string} query - The query text
 * @param {number} limit - Maximum number of memories to return
 * @param {string} memoryType - Filter by memory type (optional)
 * @param {string} category - Filter by category (optional)
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - Relevant memories as text
 */
async function getSimpleMemories(userId, query, limit = 5, memoryType = null, category = null, guildId) {
  try {
    // Prepare query builder
    let queryObj = supabase
      .from('unified_memories')
      .select('*')
      .eq('user_id', userId)
      .order('confidence', { ascending: false })
      .limit(limit);
    
    // Add optional filters
    if (guildId) {
      queryObj = queryObj.eq('guild_id', guildId);
    }
    
    if (memoryType) {
      queryObj = queryObj.eq('memory_type', memoryType);
    }
    
    if (category) {
      queryObj = queryObj.eq('category', category);
    }
    
    // Try keyword match on memory_text if we have a query
    if (query && query.trim()) {
      const keywords = query.toLowerCase().split(/\s+/)
        .filter(word => word.length > 3) // Only use meaningful words
        .slice(0, 3);  // Take top 3 words
      
      // If we have useful keywords, add ILIKE conditions
      if (keywords.length > 0) {
        let ilikeConditions = keywords.map(word => `memory_text.ilike.%${word}%`);
        queryObj = queryObj.or(ilikeConditions.join(','));
      }
    }
    
    const { data: memories, error } = await queryObj;
    
    if (error) {
      logger.error("Error in getSimpleMemories:", error);
      return "";
    }
    
    if (!memories || memories.length === 0) {
      return "";
    }
    
    // Format memories as simple text
    return memories
      .map(memory => `- ${memory.memory_text}`)
      .join("\n");
  } catch (error) {
    logger.error("Error in getSimpleMemories:", error);
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
    // Get basic temporal query context (non-blocking)
    const temporalContext = getBasicTemporalContext(query);
    
    // Get embedding for query
    const embedding = await getEmbedding(query);
    
    // Use direct query instead of rpc function
    let queryObj = supabase
      .from('unified_memories')
      .select('*')
      .eq('user_id', userId)
      .order('confidence', { ascending: false })
      .limit(5);
    
    if (guildId) {
      queryObj = queryObj.eq('guild_id', guildId);
    }
    
    const { data: matches, error } = await queryObj;
    
    if (error || !matches || matches.length === 0) {
      return {
        has_context: false,
        temporal_focus: temporalContext.time_focus,
        memories_found: 0
      };
    }
    
    // Filter by vector similarity
    const filteredMatches = await filterMemoriesByVectorSimilarity(matches, embedding, 0.6, 5);
    
    if (filteredMatches.length === 0) {
      return {
        has_context: false,
        temporal_focus: temporalContext.time_focus,
        memories_found: 0
      };
    }
    
    // Process the matches
    const processedMemories = processRetrievedMemories(filteredMatches);
    
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