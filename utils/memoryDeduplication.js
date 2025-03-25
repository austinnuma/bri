// memoryDeduplication.js
import { supabase } from '../services/combinedServices.js';
import { getEmbedding } from './improvedEmbeddings.js';
import { logger } from './logger.js';

/**
 * Performs semantic deduplication of memories using embeddings
 * @param {string} userId - User ID
 * @param {Array<string>} newMemories - Array of new memory texts
 * @param {string} guildId - Guild ID
 * @returns {Promise<Array<string>>} - Deduplicated memories
 */
export async function semanticDeduplication(userId, newMemories, guildId) {
  try {
    if (!newMemories || newMemories.length === 0) {
      return [];
    }
    
    // Step 1: Get embeddings for all new memories
    const newMemoryEmbeddings = [];
    for (const memory of newMemories) {
      const embedding = await getEmbedding(memory);
      newMemoryEmbeddings.push({
        text: memory,
        embedding: embedding
      });
    }
    
    // Step 2: Deduplicate against existing memories in the database
    const uniqueMemories = [];

    for (const newMemory of newMemoryEmbeddings) {
      // Debug log inside the loop where newMemory is defined
      logger.debug('Processing memory for deduplication', {
        memory_text_snippet: newMemory.text.substring(0, 30),
        embedding_length: newMemory.embedding ? newMemory.embedding.length : 0
      });

      if (newMemory.embedding) {
        //console.log(`Embedding type: ${typeof newMemory.embedding}`);
        //console.log(`Is array: ${Array.isArray(newMemory.embedding)}`);
        //console.log(`First few values: ${newMemory.embedding.slice(0, 5)}`);
        //console.log(`Embedding length: ${newMemory.embedding.length}`);
      }
      
      // Log parameters before calling memory_similarity_check
      //console.log(`Calling memory_similarity_check RPC - userId: ${userId}, guildId: ${guildId}, threshold: 0.85, limit: 5`);
      //console.log(`Memory being checked: "${newMemory.text.substring(0, 50)}${newMemory.text.length > 50 ? '...' : ''}"`);
      
      logger.info('Calling Supabase RPC memory_similarity_check', {
        user_id: userId,
        guild_id: guildId,
        similarity_threshold: 0.85,
        limit: 5,
        embedding_length: newMemory.embedding ? newMemory.embedding.length : 0,
        memory_text_snippet: newMemory.text.substring(0, 50) + (newMemory.text.length > 50 ? '...' : '')
      });
      
      // Check if this memory is similar to any existing memory
      const { data: similarMemories, error } = await supabase.rpc('memory_similarity_check', {
        p_user_id: userId,
        p_guild_id: guildId,
        p_query_embedding: newMemory.embedding,
        p_similarity_threshold: 0.85,
        p_limit: 5
      });
      
      // Log the results of the RPC call
      if (error) {
        console.error("Error checking semantic similarity:", error);
        logger.error("Error checking semantic similarity from RPC call:", {
          error: error.message,
          error_code: error.code,
          user_id: userId,
          guild_id: guildId
        });
        continue;
      }
      
      console.log(`RPC memory_similarity_check results: Found ${similarMemories ? similarMemories.length : 0} similar memories`);
      logger.info('Similarity check RPC results', {
        user_id: userId,
        guild_id: guildId,
        similar_memories_count: similarMemories ? similarMemories.length : 0,
        highest_similarity: similarMemories && similarMemories.length > 0 ? 
          Math.max(...similarMemories.map(mem => mem.similarity)) : null,
        similar_memories_snippets: similarMemories && similarMemories.length > 0 ?
          similarMemories.map(mem => ({
            snippet: mem.memory_text ? mem.memory_text.substring(0, 30) + '...' : 'N/A',
            similarity: mem.similarity
          })) : []
      });
      
      // If no similar memories found, it's unique
      if (!similarMemories || similarMemories.length === 0) {
        uniqueMemories.push(newMemory.text);
        continue;
      }
      
      // Check if any existing memory is very similar
      const highSimilarity = similarMemories.some(mem => mem.similarity > 0.92);
      
      if (!highSimilarity) {
        // Not similar enough to any existing memory
        uniqueMemories.push(newMemory.text);
      }
    }
    
    // Step 3: Remove duplicates within the new batch itself
    return deduplicateWithinBatch(uniqueMemories);
  } catch (error) {
    logger.error("Error in semantic deduplication:", error);
    return []; // Return empty array on error
  }
}

/**
 * Deduplicates memories within a batch by detecting key concept overlaps
 * @param {Array<string>} memories - Array of memory texts
 * @returns {Array<string>} - Deduplicated memories
 */
function deduplicateWithinBatch(memories) {
  if (!memories || memories.length <= 1) {
    return memories;
  }
  
  // Extract key concepts from each memory
  const memoryConcepts = memories.map(extractKeyConcepts);
  
  // Track which memories to keep
  const uniqueMemories = [];
  const skipIndices = new Set();
  
  // Compare each memory with others
  for (let i = 0; i < memories.length; i++) {
    if (skipIndices.has(i)) continue;
    
    // Compare with all subsequent memories
    for (let j = i + 1; j < memories.length; j++) {
      if (skipIndices.has(j)) continue;
      
      // Calculate concept overlap
      const overlapScore = calculateConceptOverlap(memoryConcepts[i], memoryConcepts[j]);
      
      // If high concept overlap, mark the second memory as duplicate
      if (overlapScore > 0.7) {
        skipIndices.add(j);
      }
    }
    
    // Keep this memory
    uniqueMemories.push(memories[i]);
  }
  
  return uniqueMemories;
}

/**
 * Extracts key concepts from a memory text
 * @param {string} memoryText - The memory text
 * @returns {Object} - Object with extracted concepts
 */
function extractKeyConcepts(memoryText) {
  // Remove "User" prefix if present
  const text = memoryText.replace(/^User\s+/i, '').toLowerCase();
  
  // Extract predicates (verbs + objects)
  const predicates = [];
  
  // Simple pattern matching for common predicates
  const predicatePatterns = [
    { pattern: /(likes|loves|enjoys|prefers)\s+(\w+)/g, type: 'preference' },
    { pattern: /(lives|resides)\s+in\s+(\w+)/g, type: 'location' },
    { pattern: /(works|employed)\s+as\s+(\w+)/g, type: 'occupation' },
    { pattern: /(has|owns)\s+(\w+)/g, type: 'possession' },
    { pattern: /(is|was)\s+(\w+)/g, type: 'state' }
  ];
  
  for (const { pattern, type } of predicatePatterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      predicates.push({
        verb: match[1],
        object: match[2],
        type
      });
    }
  }
  
  // Extract topics/entities (nouns)
  const topics = new Set();
  
  // Simple noun extraction based on context
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    // Skip very short words and common articles/prepositions
    if (words[i].length <= 2 || ['the', 'and', 'but', 'or', 'a', 'an'].includes(words[i])) {
      continue;
    }
    
    // Check for nouns based on context
    const isPossibleNoun = i > 0 && 
      ['the', 'a', 'an', 'their', 'his', 'her', 'its'].includes(words[i-1]);
      
    if (isPossibleNoun) {
      topics.add(words[i]);
    }
  }
  
  // Also add objects from predicates as topics
  for (const predicate of predicates) {
    topics.add(predicate.object);
  }
  
  return {
    predicates,
    topics: Array.from(topics)
  };
}

/**
 * Calculates concept overlap between two memory concepts
 * @param {Object} concepts1 - First memory concepts
 * @param {Object} concepts2 - Second memory concepts
 * @returns {number} - Overlap score (0-1)
 */
function calculateConceptOverlap(concepts1, concepts2) {
  // Check predicate similarity
  let predicateScore = 0;
  
  // Group predicates by type
  const predicatesByType1 = {};
  const predicatesByType2 = {};
  
  for (const pred of concepts1.predicates) {
    predicatesByType1[pred.type] = predicatesByType1[pred.type] || [];
    predicatesByType1[pred.type].push(pred);
  }
  
  for (const pred of concepts2.predicates) {
    predicatesByType2[pred.type] = predicatesByType2[pred.type] || [];
    predicatesByType2[pred.type].push(pred);
  }
  
  // Compare predicates of the same type
  const allTypes = new Set([...Object.keys(predicatesByType1), ...Object.keys(predicatesByType2)]);
  
  for (const type of allTypes) {
    const preds1 = predicatesByType1[type] || [];
    const preds2 = predicatesByType2[type] || [];
    
    // Skip if either has no predicates of this type
    if (preds1.length === 0 || preds2.length === 0) continue;
    
    // Check for verb similarity
    const verbs1 = new Set(preds1.map(p => p.verb));
    const verbs2 = new Set(preds2.map(p => p.verb));
    
    // Check for semantic similarity between verbs
    const verbSimilarity = areVerbsSimilar(verbs1, verbs2);
    
    // Check for object similarity
    const objects1 = new Set(preds1.map(p => p.object));
    const objects2 = new Set(preds2.map(p => p.object));
    
    // Count overlapping objects
    let objectOverlap = 0;
    for (const obj1 of objects1) {
      if (objects2.has(obj1)) {
        objectOverlap++;
      }
    }
    
    const objectSimilarity = objectOverlap / Math.max(1, Math.min(objects1.size, objects2.size));
    
    // Combine verb and object similarity
    const typeSimilarity = (verbSimilarity * 0.4) + (objectSimilarity * 0.6);
    predicateScore += typeSimilarity;
  }
  
  // Normalize predicate score
  predicateScore = allTypes.size > 0 ? predicateScore / allTypes.size : 0;
  
  // Calculate topic overlap
  const topics1 = new Set(concepts1.topics);
  const topics2 = new Set(concepts2.topics);
  
  let topicOverlap = 0;
  for (const topic of topics1) {
    if (topics2.has(topic)) {
      topicOverlap++;
    }
  }
  
  const topicScore = topics1.size > 0 && topics2.size > 0 
    ? topicOverlap / Math.max(1, Math.min(topics1.size, topics2.size)) 
    : 0;
  
  // Combined score (predicates matter more)
  return (predicateScore * 0.7) + (topicScore * 0.3);
}

/**
 * Checks if two sets of verbs are semantically similar
 * @param {Set<string>} verbs1 - First set of verbs
 * @param {Set<string>} verbs2 - Second set of verbs
 * @returns {number} - Similarity score (0-1)
 */
function areVerbsSimilar(verbs1, verbs2) {
  // Define semantic verb groups for common memory predicates
  const verbGroups = [
    ['like', 'love', 'enjoy', 'prefer', 'adore', 'appreciate'],
    ['dislike', 'hate', 'despise', 'detest'],
    ['have', 'own', 'possess'],
    ['work', 'employed', 'job'],
    ['live', 'reside', 'stay', 'dwell']
  ];
  
  let matchCount = 0;
  let totalChecks = 0;
  
  // Check each verb in first set
  for (const verb1 of verbs1) {
    for (const verb2 of verbs2) {
      totalChecks++;
      
      // Exact match
      if (verb1 === verb2) {
        matchCount++;
        continue;
      }
      
      // Check if they belong to the same semantic group
      for (const group of verbGroups) {
        if (group.includes(verb1) && group.includes(verb2)) {
          matchCount++;
          break;
        }
      }
    }
  }
  
  return totalChecks > 0 ? matchCount / totalChecks : 0;
}

/**
 * SQL function to create in Supabase for semantic memory search
 * 
 * CREATE OR REPLACE FUNCTION semantic_memory_search(
 *   p_user_id TEXT,
 *   p_guild_id TEXT,
 *   p_query_embedding VECTOR,
 *   p_similarity_threshold FLOAT DEFAULT 0.75,
 *   p_limit INT DEFAULT 5
 * )
 * RETURNS TABLE (
 *   id BIGINT,
 *   memory_text TEXT,
 *   memory_type TEXT,
 *   category TEXT,
 *   confidence FLOAT,
 *   similarity FLOAT
 * )
 * LANGUAGE plpgsql
 * AS $$
 * BEGIN
 *   RETURN QUERY
 *   SELECT
 *     um.id,
 *     um.memory_text,
 *     um.memory_type,
 *     um.category,
 *     um.confidence,
 *     1 - (um.embedding <=> p_query_embedding) AS similarity
 *   FROM
 *     unified_memories um
 *   WHERE
 *     um.user_id = p_user_id
 *     AND um.guild_id = p_guild_id
 *     AND (1 - (um.embedding <=> p_query_embedding)) > p_similarity_threshold
 *     AND (um.active IS NULL OR um.active = true)
 *   ORDER BY
 *     um.embedding <=> p_query_embedding
 *   LIMIT
 *     p_limit;
 * END;
 * $$;
 */

/**
 * Tracks the latest conversation that was processed for memory extraction
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {number} messageId - Latest message ID that was processed
 * @returns {Promise<boolean>} - Success status
 */
export async function updateLastExtractedMessage(userId, guildId, messageId) {
  try {
    const { error } = await supabase
      .from('memory_extraction_tracking')
      .upsert({
        user_id: userId,
        guild_id: guildId,
        last_extracted_message_id: messageId,
        last_extraction_time: new Date().toISOString()
      }, {
        onConflict: 'user_id, guild_id'
      });
      
    if (error) {
      logger.error("Error updating last extracted message:", error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error("Error in updateLastExtractedMessage:", error);
    return false;
  }
}

/**
 * Gets the ID of the last message that was processed for memory extraction
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<number|null>} - Last extracted message ID or null
 */
export async function getLastExtractedMessage(userId, guildId) {
  try {
    const { data, error } = await supabase
      .from('memory_extraction_tracking')
      .select('last_extracted_message_id')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      // If no record found, that's ok - it means no extraction has happened yet
      if (error.code === 'PGRST116') {
        return null;
      }
      
      logger.error("Error getting last extracted message:", error);
      return null;
    }
    
    return data?.last_extracted_message_id || null;
  } catch (error) {
    logger.error("Error in getLastExtractedMessage:", error);
    return null;
  }
}

/**
 * Table creation SQL for tracking extraction progress:
 * 
 * CREATE TABLE IF NOT EXISTS memory_extraction_tracking (
 *   user_id TEXT NOT NULL,
 *   guild_id TEXT NOT NULL,
 *   last_extracted_message_id TEXT,
 *   last_extraction_time TIMESTAMPTZ NOT NULL,
 *   PRIMARY KEY (user_id, guild_id)
 * );
 */