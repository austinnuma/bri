// memoryGraphManager.js - Memory graph relationship management
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getEmbedding } from './improvedEmbeddings.js';
import { openai } from '../services/combinedServices.js';

// Relationship types between memories
export const RELATIONSHIP_TYPES = {
  RELATED_TO: 'related_to',     // General relation
  ELABORATES: 'elaborates',     // Memory B gives more detail about Memory A
  CONTRADICTS: 'contradicts',   // Memory B contradicts Memory A
  FOLLOWS: 'follows',           // Memory B is a logical continuation of Memory A
  PRECEDES: 'precedes',         // Memory A happened before Memory B
  CAUSES: 'causes',             // Memory A causes Memory B
  PART_OF: 'part_of'            // Memory B is part of a larger concept in Memory A
};

/**
 * Initialize memory graph system
 * Creates necessary database tables if they don't exist
 */
export async function initializeMemoryGraphSystem() {
  try {
    //logger.info("Initializing memory graph system...");
    
    // Check if the memory_connections table exists
    const { error: connectionCheckError } = await supabase
      .from('memory_connections')
      .select('id')
      .limit(1);
      
    // Create table if it doesn't exist
    if (connectionCheckError && connectionCheckError.code === '42P01') {
      logger.info("Creating memory_connections table...");
      
      try {
        // Try to create the table using supabase.rpc or another method
        // This might need to be adjusted based on your actual Supabase setup
        const { error } = await supabase.query(`
          CREATE TABLE IF NOT EXISTS memory_connections (
            id SERIAL PRIMARY KEY,
            source_memory_id BIGINT NOT NULL,
            target_memory_id BIGINT NOT NULL,
            relationship_type TEXT NOT NULL,
            confidence FLOAT NOT NULL DEFAULT 0.7,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(source_memory_id, target_memory_id, relationship_type)
          );
          
          CREATE INDEX IF NOT EXISTS idx_memory_connections_source
          ON memory_connections(source_memory_id);
          
          CREATE INDEX IF NOT EXISTS idx_memory_connections_target
          ON memory_connections(target_memory_id);
        `);
        
        if (error) {
          logger.warn("Manual creation of memory_connections table may have failed:", error);
        } else {
          logger.info("Memory connections table created successfully");
        }
      } catch (createError) {
        logger.error("Error creating memory_connections table:", createError);
      }
    } else {
      //logger.info("Memory connections table already exists");
    }
    
    //logger.info("Memory graph system initialization complete");
  } catch (error) {
    logger.error("Error initializing memory graph system:", error);
  }
}

/**
 * Creates a connection between two memories
 * @param {number} sourceMemoryId - Source memory ID
 * @param {number} targetMemoryId - Target memory ID 
 * @param {string} relationshipType - Type of relationship
 * @param {number} confidence - Confidence in the relationship (0-1)
 * @returns {Promise<Object|null>} - Created connection or null
 */
export async function createMemoryConnection(sourceMemoryId, targetMemoryId, relationshipType, confidence = 0.7) {
  try {
    // Don't create self-references
    if (sourceMemoryId === targetMemoryId) {
      return null;
    }
    
    // Validate relationship type
    if (!Object.values(RELATIONSHIP_TYPES).includes(relationshipType)) {
      logger.warn(`Invalid relationship type: ${relationshipType}`);
      return null;
    }
    
    // Bound confidence 
    confidence = Math.max(0.1, Math.min(1.0, confidence));
    
    // Create the connection
    const { data, error } = await supabase
      .from('memory_connections')
      .upsert({
        source_memory_id: sourceMemoryId,
        target_memory_id: targetMemoryId,
        relationship_type: relationshipType,
        confidence: confidence,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'source_memory_id, target_memory_id, relationship_type',
        returning: true
      })
      .select()
      .single();
      
    if (error) {
      logger.error("Error creating memory connection:", error);
      return null;
    }
    
    // For bidirectional relationships like "related_to", create the inverse relationship too
    if (relationshipType === RELATIONSHIP_TYPES.RELATED_TO) {
      await supabase
        .from('memory_connections')
        .upsert({
          source_memory_id: targetMemoryId,
          target_memory_id: sourceMemoryId,
          relationship_type: relationshipType,
          confidence: confidence,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'source_memory_id, target_memory_id, relationship_type'
        });
    }
    // For causal and temporal relationships, create the inverse with the appropriate type
    else if (relationshipType === RELATIONSHIP_TYPES.FOLLOWS) {
      await supabase
        .from('memory_connections')
        .upsert({
          source_memory_id: targetMemoryId,
          target_memory_id: sourceMemoryId,
          relationship_type: RELATIONSHIP_TYPES.PRECEDES,
          confidence: confidence,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'source_memory_id, target_memory_id, relationship_type'
        });
    }
    else if (relationshipType === RELATIONSHIP_TYPES.PRECEDES) {
      await supabase
        .from('memory_connections')
        .upsert({
          source_memory_id: targetMemoryId,
          target_memory_id: sourceMemoryId,
          relationship_type: RELATIONSHIP_TYPES.FOLLOWS,
          confidence: confidence,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'source_memory_id, target_memory_id, relationship_type'
        });
    }
    else if (relationshipType === RELATIONSHIP_TYPES.CAUSES) {
      // The inverse of "causes" could be represented as "is caused by" but
      // we don't have that relationship type, so we don't create an inverse here
    }
    
    return data;
  } catch (error) {
    logger.error("Error in createMemoryConnection:", error);
    return null;
  }
}

/**
 * Gets all connected memories for a given memory
 * @param {number} memoryId - The memory ID to find connections for
 * @param {Array<string>} relationshipTypes - Optional filter by relationship types
 * @param {number} minConfidence - Minimum confidence threshold (0-1)
 * @returns {Promise<Array>} - Connected memories
 */
export async function getConnectedMemories(memoryId, relationshipTypes = null, minConfidence = 0.5) {
    try {
      // Start query builder for outgoing connections
      let outgoingQuery = supabase
        .from('memory_connections')
        .select('id, relationship_type, confidence, target_memory_id')
        .eq('source_memory_id', memoryId)
        .gte('confidence', minConfidence);
        
      // Filter by relationship types if provided
      if (relationshipTypes && relationshipTypes.length > 0) {
        outgoingQuery = outgoingQuery.in('relationship_type', relationshipTypes);
      }
      
      // Order by confidence descending
      outgoingQuery = outgoingQuery.order('confidence', { ascending: false });
      
      const { data: outgoingConnections, error: outgoingError } = await outgoingQuery;
      
      if (outgoingError) {
        logger.error("Error fetching outgoing memory connections:", outgoingError);
        return [];
      }
      
      // Fetch target memories for outgoing connections
      const outgoingMemories = [];
      if (outgoingConnections && outgoingConnections.length > 0) {
        // Get all target memory IDs
        const targetMemoryIds = outgoingConnections.map(conn => conn.target_memory_id);
        
        // Fetch all target memories in a single query
        const { data: targetMemories, error: targetError } = await supabase
          .from('unified_memories')
          .select('id, user_id, guild_id, memory_text, memory_type, category, created_at')
          .in('id', targetMemoryIds);
          
        if (!targetError && targetMemories) {
          // Match connections with their target memories
          for (const conn of outgoingConnections) {
            const targetMemory = targetMemories.find(m => m.id === conn.target_memory_id);
            if (targetMemory) {
              outgoingMemories.push({
                connection_id: conn.id,
                memory_id: targetMemory.id,
                memory_text: targetMemory.memory_text,
                memory_type: targetMemory.memory_type,
                category: targetMemory.category,
                relationship: conn.relationship_type,
                confidence: conn.confidence,
                direction: 'outgoing',
                created_at: targetMemory.created_at
              });
            }
          }
        } else if (targetError) {
          logger.error("Error fetching target memories:", targetError);
        }
      }
      
      // Now get incoming connections where this memory is the target
      let incomingQuery = supabase
        .from('memory_connections')
        .select('id, relationship_type, confidence, source_memory_id')
        .eq('target_memory_id', memoryId)
        .gte('confidence', minConfidence);
        
      // Filter by relationship types if provided
      if (relationshipTypes && relationshipTypes.length > 0) {
        incomingQuery = incomingQuery.in('relationship_type', relationshipTypes);
      }
      
      // Order by confidence descending  
      incomingQuery = incomingQuery.order('confidence', { ascending: false });
      
      const { data: incomingConnections, error: incomingError } = await incomingQuery;
      
      if (incomingError) {
        logger.error("Error fetching incoming memory connections:", incomingError);
        return outgoingMemories; // Return just outgoing if incoming fails
      }
      
      // Fetch source memories for incoming connections
      const incomingMemories = [];
      if (incomingConnections && incomingConnections.length > 0) {
        // Get all source memory IDs
        const sourceMemoryIds = incomingConnections.map(conn => conn.source_memory_id);
        
        // Fetch all source memories in a single query
        const { data: sourceMemories, error: sourceError } = await supabase
          .from('unified_memories')
          .select('id, user_id, guild_id, memory_text, memory_type, category, created_at')
          .in('id', sourceMemoryIds);
          
        if (!sourceError && sourceMemories) {
          // Match connections with their source memories
          for (const conn of incomingConnections) {
            const sourceMemory = sourceMemories.find(m => m.id === conn.source_memory_id);
            if (sourceMemory) {
              incomingMemories.push({
                connection_id: conn.id,
                memory_id: sourceMemory.id,
                memory_text: sourceMemory.memory_text,
                memory_type: sourceMemory.memory_type,
                category: sourceMemory.category,
                relationship: conn.relationship_type,
                confidence: conn.confidence,
                direction: 'incoming',
                created_at: sourceMemory.created_at
              });
            }
          }
        } else if (sourceError) {
          logger.error("Error fetching source memories:", sourceError);
        }
      }
      
      // Combine and sort results
      const connectedMemories = [...outgoingMemories, ...incomingMemories];
      
      // Sort by confidence
      return connectedMemories.sort((a, b) => b.confidence - a.confidence);
    } catch (error) {
      logger.error("Error in getConnectedMemories:", error);
      return [];
    }
  }

/**
 * Analyzes two memories and identifies potential relationships between them
 * @param {Object} memoryA - First memory object
 * @param {Object} memoryB - Second memory object
 * @returns {Promise<Array>} - Array of potential relationships with confidence
 */
export async function analyzeMemoryRelationships(memoryA, memoryB) {
  try {
    const textA = memoryA.memory_text;
    const textB = memoryB.memory_text;
    
    // Use OpenAI to analyze the relationship between these memories
    const prompt = `
Analyze the relationship between these two memories about a user:

Memory A: "${textA}"
Memory B: "${textB}"

Identify if there are any of these relationships between them:
1. RELATED_TO: The memories are generally related to each other
2. ELABORATES: Memory B gives more detail or elaborates on Memory A
3. CONTRADICTS: Memory B contradicts or conflicts with Memory A
4. FOLLOWS: Memory B is a logical continuation or follows Memory A
5. PRECEDES: Memory A happened before Memory B (temporal relationship)
6. CAUSES: Memory A causes or leads to Memory B
7. PART_OF: Memory B is part of a larger concept in Memory A

Format your response as JSON:
{
  "relationships": [
    {
      "relationship_type": "RELATIONSHIP_NAME",
      "confidence": 0.7,
      "explanation": "Brief explanation of why this relationship exists"
    }
  ]
}

Only include relationships that are clearly present with confidence > 0.5.
If there are no clear relationships, return {"relationships": []}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Using more capable model for understanding complex memory relationships
      messages: [
        { 
          role: "system", 
          content: "You are an expert system for analyzing relationships between memories. You identify connections between pieces of information about users."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });
    
    // Parse the response with error handling
    try {
      const parsedResponse = JSON.parse(completion.choices[0].message.content);
      
      // Handle different possible response formats
      let relationships = [];
      
      if (parsedResponse && typeof parsedResponse === 'object') {
        // Check if the response has a "relationships" array
        if (Array.isArray(parsedResponse.relationships)) {
          relationships = parsedResponse.relationships;
        } 
        // Check if the response itself is an array
        else if (Array.isArray(parsedResponse)) {
          relationships = parsedResponse;
        } 
        // Last resort: look for any array property
        else {
          for (const key in parsedResponse) {
            if (Array.isArray(parsedResponse[key])) {
              relationships = parsedResponse[key];
              break;
            }
          }
        }
      }
      
      // Ensure relationships is an array before mapping
      relationships = Array.isArray(relationships) ? relationships : [];
      
      // Map OpenAI's output to our relationship types
      return relationships.map(rel => ({
        relationship_type: RELATIONSHIP_TYPES[rel.relationship_type] || RELATIONSHIP_TYPES.RELATED_TO,
        confidence: rel.confidence || 0.6,
        explanation: rel.explanation || "Related information"
      }));
    } catch (parseError) {
      logger.error("Error parsing relationship analysis response:", parseError);
      return []; // Return empty array on parse error
    }
  } catch (error) {
    logger.error("Error analyzing memory relationships:", error);
    return [];
  }
}

/**
 * Creates connections between related memories for a user
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {number} memoryId - Optional specific memory ID to analyze
 * @param {number} batchSize - Number of memories to process
 * @returns {Promise<Object>} - Results of the connection process
 */
export async function buildMemoryGraph(userId, guildId, memoryId = null, batchSize = 10) {
  try {
    let totalConnections = 0;
    const results = {
      processed: 0,
      connections_created: 0,
      errors: 0
    };
    
    // If a specific memory ID is provided, just analyze that one
    if (memoryId) {
      const { data: memory, error } = await supabase
        .from('unified_memories')
        .select('*')
        .eq('id', memoryId)
        .single();
        
      if (error || !memory) {
        logger.error(`Error fetching memory ${memoryId}:`, error);
        return { ...results, errors: 1 };
      }
      
      // Find potential related memories
      const relatedMemories = await findPotentialRelatedMemories(memory);
      
      // Process connections for each related memory
      for (const relatedMemory of relatedMemories) {
        await processMemoryConnection(memory, relatedMemory);
        results.processed++;
      }
      
      return results;
    }
    
    // Otherwise, get active memories for this user and guild
    const { data: memories, error } = await supabase
      .from('unified_memories')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(batchSize);
      
    if (error) {
      logger.error(`Error fetching memories for graph building:`, error);
      return { ...results, errors: 1 };
    }
    
    if (!memories || memories.length === 0) {
      return results;
    }
    
    // Process each memory
    for (const memory of memories) {
      try {
        // Find potential related memories
        const relatedMemories = await findPotentialRelatedMemories(memory);
        
        // Process connections for each related memory
        for (const relatedMemory of relatedMemories) {
          const connectionsCreated = await processMemoryConnection(memory, relatedMemory);
          totalConnections += connectionsCreated;
        }
        
        results.processed++;
      } catch (memoryError) {
        logger.error(`Error processing memory ${memory.id} for graph building:`, memoryError);
        results.errors++;
      }
    }
    
    results.connections_created = totalConnections;
    return results;
  } catch (error) {
    logger.error("Error in buildMemoryGraph:", error);
    return { processed: 0, connections_created: 0, errors: 1 };
  }
}

/**
 * Finds potential related memories for a given memory
 * @param {Object} memory - The memory to find relations for
 * @param {number} limit - Maximum number of potential matches to return
 * @returns {Promise<Array>} - Potentially related memories
 */
async function findPotentialRelatedMemories(memory, limit = 5) {
  try {
    // Use vector similarity to find potential matches
    const { data, error } = await supabase.rpc('match_unified_memories', {
      p_user_id: memory.user_id,
      p_guild_id: memory.guild_id,
      p_query_embedding: memory.embedding,
      p_match_threshold: 0.7,
      p_match_count: limit
    });
    
    if (error) {
      logger.error("Error finding potential related memories:", error);
      return [];
    }
    
    // Filter out the original memory itself
    return (data || []).filter(m => m.id !== memory.id);
  } catch (error) {
    logger.error("Error in findPotentialRelatedMemories:", error);
    return [];
  }
}

/**
 * Processes and creates connections between two memories
 * @param {Object} memoryA - First memory
 * @param {Object} memoryB - Second memory
 * @returns {Promise<number>} - Number of connections created
 */
async function processMemoryConnection(memoryA, memoryB) {
  try {
    // Check if we already have connections between these two memories
    const { data: existingConnections, error: checkError } = await supabase
      .from('memory_connections')
      .select('relationship_type')
      .or(`source_memory_id.eq.${memoryA.id},target_memory_id.eq.${memoryA.id}`)
      .or(`source_memory_id.eq.${memoryB.id},target_memory_id.eq.${memoryB.id}`);
      
    if (!checkError && existingConnections && existingConnections.length > 0) {
      // Already have connections between these memories
      return 0;
    }
    
    // Analyze the relationship between these memories
    const relationships = await analyzeMemoryRelationships(memoryA, memoryB);
    
    if (!relationships || relationships.length === 0) {
      return 0;
    }
    
    // Create each connection
    let connectionsCreated = 0;
    
    for (const rel of relationships) {
      const result = await createMemoryConnection(
        memoryA.id,
        memoryB.id,
        rel.relationship_type,
        rel.confidence
      );
      
      if (result) {
        connectionsCreated++;
      }
    }
    
    return connectionsCreated;
  } catch (error) {
    logger.error("Error processing memory connection:", error);
    return 0;
  }
}

/**
 * Traverses the memory graph to find connected paths of memories
 * @param {number} startMemoryId - Starting memory ID
 * @param {number} maxDepth - Maximum traversal depth
 * @param {number} maxResults - Maximum results to return
 * @param {number} minConfidence - Minimum confidence threshold
 * @returns {Promise<Array>} - Array of memory paths
 */
export async function traverseMemoryGraph(startMemoryId, maxDepth = 2, maxResults = 10, minConfidence = 0.6) {
  try {
    // First get the starting memory
    const { data: startMemory, error: startError } = await supabase
      .from('unified_memories')
      .select('*')
      .eq('id', startMemoryId)
      .single();
      
    if (startError || !startMemory) {
      logger.error(`Error fetching start memory ${startMemoryId}:`, startError);
      return [];
    }
    
    // Set up tracking variables
    const visited = new Set([startMemoryId]);
    const paths = [];
    const queue = [{
      memory: startMemory,
      path: [startMemory],
      depth: 0
    }];
    
    // BFS traversal of the memory graph
    while (queue.length > 0 && paths.length < maxResults) {
      const { memory, path, depth } = queue.shift();
      
      // If we've reached max depth, add this path to results and continue
      if (depth >= maxDepth) {
        paths.push(path);
        continue;
      }
      
      // Get connected memories
      const connections = await getConnectedMemories(memory.id, null, minConfidence);
      
      // Process each connection
      for (const conn of connections) {
        // Skip already visited nodes
        if (visited.has(conn.memory_id)) {
          continue;
        }
        
        // Get the connected memory details
        const { data: connectedMemory, error: connError } = await supabase
          .from('unified_memories')
          .select('*')
          .eq('id', conn.memory_id)
          .single();
          
        if (connError || !connectedMemory) {
          continue;
        }
        
        // Mark as visited
        visited.add(conn.memory_id);
        
        // Add to queue for further exploration
        queue.push({
          memory: connectedMemory,
          path: [...path, connectedMemory],
          depth: depth + 1
        });
      }
    }
    
    return paths;
  } catch (error) {
    logger.error("Error traversing memory graph:", error);
    return [];
  }
}

/**
 * Formats memory paths into a readable text format for prompts
 * @param {Array} memoryPaths - Array of memory paths from traverseMemoryGraph
 * @returns {string} - Formatted text of connected memories
 */
export function formatMemoryPathsForPrompt(memoryPaths) {
  if (!memoryPaths || memoryPaths.length === 0) {
    return "";
  }
  
  let result = "CONNECTED MEMORIES:\n";
  
  // Process each path
  for (let i = 0; i < memoryPaths.length; i++) {
    const path = memoryPaths[i];
    
    result += `Memory Chain ${i+1}:\n`;
    
    // Add each memory in the path
    for (let j = 0; j < path.length; j++) {
      const memory = path[j];
      
      // Add arrow connectors between memories
      if (j > 0) {
        result += " → ";
      }
      
      // Add the memory text
      result += `"${memory.memory_text}"`;
    }
    
    result += "\n\n";
  }
  
  return result;
}

/**
 * Uses the memory graph to enhance memory retrieval
 * @param {string} userId - The user ID
 * @param {string} query - The query text
 * @param {string} guildId - The guild ID
 * @param {Array} directMemories - Direct vector-matched memories
 * @param {number} maxAdditional - Maximum additional memories to add
 * @returns {Promise<Array>} - Enhanced set of memories
 */
export async function enhanceMemoriesWithGraph(userId, query, guildId, directMemories, maxAdditional = 3) {
  try {
    if (!directMemories || directMemories.length === 0) {
      return [];
    }
    
    // Start with direct matches
    const enhancedMemories = [...directMemories];
    const memoryIds = new Set(directMemories.map(m => m.id));
    
    // For each direct match, find important connected memories
    for (const memory of directMemories) {
      // Only get strong connections
      const connections = await getConnectedMemories(memory.id, null, 0.75);
      
      // Sort by relevance and importance
      const sortedConnections = connections
        .filter(conn => !memoryIds.has(conn.memory_id)) // Skip already included
        .sort((a, b) => {
          // Prioritize elaborations, followed by causal relationships, then others
          const typeScore = (type) => {
            if (type === RELATIONSHIP_TYPES.ELABORATES) return 3;
            if (type === RELATIONSHIP_TYPES.CAUSES || type === RELATIONSHIP_TYPES.FOLLOWS) return 2;
            return 1;
          };
          
          // Calculate scores based on relationship type and confidence
          const scoreA = typeScore(a.relationship) * a.confidence;
          const scoreB = typeScore(b.relationship) * b.confidence;
          
          return scoreB - scoreA;
        })
        .slice(0, 2); // Take top 2 most relevant connections per memory
      
      // Add these connections to enhanced memories
      for (const conn of sortedConnections) {
        if (enhancedMemories.length >= directMemories.length + maxAdditional) {
          break; // Reached our additional memory limit
        }
        
        // Get the full memory details
        const { data: connectedMemory, error } = await supabase
          .from('unified_memories')
          .select('*')
          .eq('id', conn.memory_id)
          .single();
          
        if (!error && connectedMemory) {
          // Track that we've included this memory
          memoryIds.add(conn.memory_id);
          
          // Add relationship context to the memory
          const enhancedMemory = {
            ...connectedMemory,
            graph_relationship: conn.relationship,
            graph_confidence: conn.confidence
          };
          
          enhancedMemories.push(enhancedMemory);
        }
      }
      
      if (enhancedMemories.length >= directMemories.length + maxAdditional) {
        break; // Reached our additional memory limit
      }
    }
    
    return enhancedMemories;
  } catch (error) {
    logger.error("Error enhancing memories with graph:", error);
    return directMemories; // Fall back to direct memories
  }
}

/**
 * Formats enhanced memories with graph relationships for prompts
 * @param {Array} enhancedMemories - Memories with graph relationships
 * @returns {string} - Formatted memories text
 */
export function formatEnhancedMemoriesForPrompt(enhancedMemories) {
  if (!enhancedMemories || enhancedMemories.length === 0) {
    return "";
  }
  
  const lines = [];
  
  for (const memory of enhancedMemories) {
    let line = `- ${memory.memory_text}`;
    
    // Add relationship context if available
    if (memory.graph_relationship) {
      // Format the relationship in a human-readable way
      let relationshipText;
      switch (memory.graph_relationship) {
        case RELATIONSHIP_TYPES.ELABORATES:
          relationshipText = "which elaborates on another memory";
          break;
        case RELATIONSHIP_TYPES.CONTRADICTS:
          relationshipText = "which contradicts something else you remember";
          break;
        case RELATIONSHIP_TYPES.FOLLOWS:
          relationshipText = "which happened after something else";
          break;
        case RELATIONSHIP_TYPES.PRECEDES:
          relationshipText = "which happened before something else";
          break;
        case RELATIONSHIP_TYPES.CAUSES:
          relationshipText = "which led to something else";
          break;
        case RELATIONSHIP_TYPES.PART_OF:
          relationshipText = "which is part of a larger concept";
          break;
        default:
          relationshipText = "which relates to other memories";
      }
      
      line += ` (${relationshipText})`;
    }
    
    lines.push(line);
  }
  
  return lines.join("\n");
}

/**
 * Schedule regular memory graph building
 * @param {number} intervalHours - Hours between runs
 */
export function scheduleMemoryGraphBuilding(intervalHours = 24) {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  setInterval(async () => {
    try {
      logger.info(`Running scheduled memory graph building task`);
      
      // Get active user+guild combinations
      const { data: activeUsers, error } = await supabase
        .from('unified_memories')
        .select('user_id, guild_id')
        .eq('active', true)
        .gt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });
        
      if (error) {
        logger.error("Error fetching active users for graph building:", error);
        return;
      }
      
      // Create unique user+guild combinations
      const uniqueCombinations = [];
      const seenCombos = new Set();
      
      for (const user of activeUsers) {
        const combo = `${user.user_id}:${user.guild_id}`;
        if (!seenCombos.has(combo)) {
          seenCombos.add(combo);
          uniqueCombinations.push({
            userId: user.user_id,
            guildId: user.guild_id
          });
        }
      }
      
      // Process each user+guild combination (but limit to avoid overloading)
      const limit = Math.min(uniqueCombinations.length, 30);
      
      for (let i = 0; i < limit; i++) {
        const { userId, guildId } = uniqueCombinations[i];
        
        try {
          const result = await buildMemoryGraph(userId, guildId, null, 15);
          logger.info(`Built memory graph for user ${userId} in guild ${guildId}: ${JSON.stringify(result)}`);
          
          // Small delay between users to avoid overloading the database
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (buildError) {
          logger.error(`Error building memory graph for user ${userId}:`, buildError);
        }
      }
      
      logger.info(`Completed scheduled memory graph building for ${limit} user/guild combinations`);
    } catch (error) {
      logger.error("Error in scheduled memory graph building:", error);
    }
  }, intervalMs);
  
  logger.info(`Memory graph building scheduled to run every ${intervalHours} hours`);
}