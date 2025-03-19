// memoryConfidence.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { categorizeMemory, MemoryTypes } from './unifiedMemoryManager.js';

/**
 * Calculates the initial confidence score for a memory based on its source and type
 * @param {string} memoryType - 'explicit' or 'intuited'
 * @param {string} source - Where the memory came from
 * @param {string} category - The memory category
 * @param {string} memoryText - The memory text content
 * @returns {number} - Initial confidence score between 0.0 and 1.0
 */
export function calculateInitialConfidence(memoryType, source, category, memoryText) {
  try {
    // Base confidence by memory type
    let confidence = memoryType === MemoryTypes.EXPLICIT ? 0.95 : 0.75;
    
    // Adjust based on source
    switch (source) {
      case 'memory_command':
        confidence = 1.0; // User explicitly asked to remember this
        break;
      case 'conversation_extraction':
        // No adjustment needed, this is the default for intuited memories
        break;
      case 'merged':
        confidence += 0.05; // Slight boost for merged (deduplicated) memories
        break;
      case 'ai_curation':
        confidence += 0.05; // Memories that survived AI curation
        break;
      default:
        // No adjustment for unknown sources
        break;
    }
    
    // Adjust based on category
    switch (category) {
      case 'personal':
      case 'contact':
        // These are usually more reliable when detected
        confidence += 0.05;
        break;
      case 'preferences':
        // Preferences can be more ambiguous
        confidence -= 0.05;
        break;
      default:
        // No adjustment for other categories
        break;
    }
    
    // Adjust based on content indicators of uncertainty
    if (memoryText.includes('might') || 
        memoryText.includes('maybe') ||
        memoryText.includes('possibly') ||
        memoryText.includes('sometimes') ||
        memoryText.includes('occasionally')) {
      confidence -= 0.1; // Reduce confidence for uncertain language
    }
    
    // Enforce bounds (0.1 to 1.0)
    return Math.max(0.1, Math.min(1.0, confidence));
  } catch (error) {
    logger.error("Error calculating initial confidence:", error);
    return memoryType === MemoryTypes.EXPLICIT ? 1.0 : 0.8; // Fallback to default values
  }
}

/**
 * Updates confidence when a memory is accessed in a retrieval operation
 * @param {number} memoryId - The memory ID
 * @returns {Promise<boolean>} - Success status
 */
export async function trackMemoryAccess(memoryId) {
  try {
    // First get the current memory data
    const { data: memory, error: fetchError } = await supabase
      .from('unified_memories')
      .select('access_count, confidence')
      .eq('id', memoryId)
      .single();
      
    if (fetchError) {
      logger.error("Error fetching memory for access tracking:", fetchError);
      return false;
    }
    
    // Calculate new values
    const newAccessCount = (memory.access_count || 0) + 1;
    
    // Small confidence boost for frequently accessed memories (diminishing returns)
    const confidenceBoost = Math.min(0.05, 0.01 * Math.log(newAccessCount + 1));
    const newConfidence = Math.min(1.0, memory.confidence + confidenceBoost);
    
    // Update the memory
    const { error: updateError } = await supabase
      .from('unified_memories')
      .update({
        last_accessed: new Date().toISOString(),
        access_count: newAccessCount,
        confidence: newConfidence
      })
      .eq('id', memoryId);
      
    if (updateError) {
      logger.error("Error updating memory access data:", updateError);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error("Error in trackMemoryAccess:", error);
    return false;
  }
}

/**
 * Applies memory decay based on age
 * @param {string} userId - The user's ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<object>} - Results of decay operation
 */
export async function applyMemoryDecay(userId, guildId) {
  try {
    const results = {
      processed: 0,
      decayed: 0,
      errors: 0
    };
    
    // Get all active memories for this user/guild
    const { data: memories, error } = await supabase
      .from('unified_memories')
      .select('id, created_at, memory_type, confidence, last_accessed, access_count, verified')
      .eq('user_id', userId)
      .eq('guild_id', guildId);
      
    if (error) {
      logger.error("Error fetching memories for decay:", error);
      return { ...results, errors: 1 };
    }
    
    if (!memories || memories.length === 0) {
      return results;
    }
    
    const now = new Date();
    let decayedCount = 0;
    
    // Process each memory
    for (const memory of memories) {
      try {
        results.processed++;
        
        // Skip explicitly verified memories - they don't decay
        if (memory.verified) continue;
        
        // Calculate age in days
        const createdDate = new Date(memory.created_at);
        const ageInDays = (now - createdDate) / (1000 * 60 * 60 * 24);
        
        // Calculate time since last access (if available)
        let daysSinceAccess = ageInDays;
        if (memory.last_accessed) {
          const lastAccessDate = new Date(memory.last_accessed);
          daysSinceAccess = (now - lastAccessDate) / (1000 * 60 * 60 * 24);
        }
        
        // Different decay rates based on memory type
        const isExplicit = memory.memory_type === MemoryTypes.EXPLICIT;
        
        // Base decay calculation
        // - Explicit memories decay very slowly
        // - Intuited memories decay faster
        // - Logarithmic decay to slow down over time
        
        // No decay for first 7 days
        if (ageInDays <= 7) continue;
        
        // Calculate decay amount
        let decayAmount = 0;
        
        // After 7 days, calculate decay
        if (isExplicit) {
          // Explicit memories: very slow decay
          decayAmount = Math.log10(ageInDays - 6) * 0.001;
        } else {
          // Intuited memories: moderate decay
          decayAmount = Math.log10(ageInDays - 6) * 0.01;
        }
        
        // Access frequency adjustment
        const accessCount = memory.access_count || 0;
        const accessBonus = Math.min(0.05, accessCount * 0.005); // Max 0.05 reduction
        decayAmount = Math.max(0, decayAmount - accessBonus);
        
        // Apply decay
        let newConfidence = memory.confidence - decayAmount;
        
        // Enforce minimum confidence (don't let memories go below 0.1)
        newConfidence = Math.max(0.1, newConfidence);
        
        // Only update if there's a meaningful change
        if (Math.abs(memory.confidence - newConfidence) > 0.01) {
          const { error: updateError } = await supabase
            .from('unified_memories')
            .update({ confidence: newConfidence })
            .eq('id', memory.id);
            
          if (updateError) {
            logger.error("Error updating memory confidence during decay:", updateError);
            results.errors++;
          } else {
            decayedCount++;
          }
        }
      } catch (memoryError) {
        logger.error(`Error processing memory ${memory.id} for decay:`, memoryError);
        results.errors++;
      }
    }
    
    results.decayed = decayedCount;
    return results;
  } catch (error) {
    logger.error("Error in applyMemoryDecay:", error);
    return { processed: 0, decayed: 0, errors: 1 };
  }
}

/**
 * Verifies a memory as correct, boosting its confidence
 * @param {number} memoryId - The memory ID
 * @param {string} verificationSource - How it was verified (e.g., 'explicit_confirmation')
 * @returns {Promise<boolean>} - Success status
 */
export async function verifyMemory(memoryId, verificationSource) {
  try {
    const { error } = await supabase
      .from('unified_memories')
      .update({
        verified: true,
        verification_date: new Date().toISOString(),
        verification_source: verificationSource,
        confidence: 1.0 // Verified memories get max confidence
      })
      .eq('id', memoryId);
      
    if (error) {
      logger.error("Error verifying memory:", error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error("Error in verifyMemory:", error);
    return false;
  }
}

/**
 * Marks a memory as contradicted, reducing its confidence
 * @param {number} memoryId - The memory ID
 * @returns {Promise<boolean>} - Success status
 */
export async function markMemoryContradicted(memoryId) {
  try {
    // First get current contradiction count
    const { data: memory, error: fetchError } = await supabase
      .from('unified_memories')
      .select('contradiction_count, confidence')
      .eq('id', memoryId)
      .single();
      
    if (fetchError) {
      logger.error("Error fetching memory for contradiction:", fetchError);
      return false;
    }
    
    // Calculate new values
    const newCount = (memory.contradiction_count || 0) + 1;
    
    // Reduce confidence based on contradiction count
    let newConfidence = memory.confidence;
    if (newCount === 1) {
      newConfidence *= 0.7; // First contradiction: 30% reduction
    } else {
      newConfidence *= 0.5; // Subsequent contradictions: 50% reduction
    }
    
    // Update the memory
    const { error: updateError } = await supabase
      .from('unified_memories')
      .update({
        contradiction_count: newCount,
        confidence: Math.max(0.1, newConfidence), // Don't go below 0.1
        verified: false // No longer verified if contradicted
      })
      .eq('id', memoryId);
      
    if (updateError) {
      logger.error("Error updating memory contradiction:", updateError);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error("Error in markMemoryContradicted:", error);
    return false;
  }
}

/**
 * Updates memory retrieval function to track access and use confidence-weighted results
 * @param {Array} memories - Array of memory objects from database
 * @returns {Array} - Processed memories sorted by effective relevance
 */
export function processRetrievedMemories(memories) {
  if (!memories || memories.length === 0) {
    return [];
  }
  
  try {
    // Track access for each memory (don't await to avoid slowdown)
    for (const memory of memories) {
      trackMemoryAccess(memory.id).catch(err => {
        logger.error(`Error tracking memory access for ${memory.id}:`, err);
      });
    }
    
    // Calculate effective relevance score for each memory
    // This combines the similarity score with the confidence score
    const weightedMemories = memories.map(memory => {
      // Default to 0.6 similarity if not provided
      const similarity = memory.distance || 0.6;
      
      // Combine similarity and confidence
      // - similarity: how relevant the memory is to the query (0-1)
      // - confidence: how reliable the memory is (0-1)
      const effectiveRelevance = (similarity * 0.7) + (memory.confidence * 0.3);
      
      return {
        ...memory,
        effectiveRelevance
      };
    });
    
    // Sort by effective relevance, highest first
    return weightedMemories.sort((a, b) => b.effectiveRelevance - a.effectiveRelevance);
  } catch (error) {
    logger.error("Error processing retrieved memories:", error);
    return memories; // Return original if there's an error
  }
}

/**
 * Runs periodic memory maintenance tasks
 * @param {string} userId - The user's ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<object>} - Results of maintenance operations
 */
export async function runMemoryMaintenance(userId, guildId) {
  try {
    const results = {
      decayed: 0,
      contradictions: 0,
      errors: 0
    };
    
    // Apply time-based memory decay
    const decayResults = await applyMemoryDecay(userId, guildId);
    results.decayed = decayResults.decayed;
    results.errors += decayResults.errors;
    
    // Check for and resolve contradictions
    const contradictionResults = await resolveContradictions(userId, guildId);
    results.contradictions = contradictionResults.resolved;
    results.errors += contradictionResults.errors;
    
    logger.info(`Memory maintenance for user ${userId} in guild ${guildId} complete`, results);
    return results;
  } catch (error) {
    logger.error(`Error in memory maintenance for user ${userId}:`, error);
    return { decayed: 0, contradictions: 0, errors: 1 };
  }
}

/**
 * Identifies and resolves contradictory memories
 * @param {string} userId - The user's ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<object>} - Results of resolution operations
 */
export async function resolveContradictions(userId, guildId) {
  try {
    const results = {
      identified: 0,
      resolved: 0,
      errors: 0
    };
    
    // -- Code for contradiction resolution would go here --
    // This is a placeholder for the actual contradiction resolution logic
    // which would identify and resolve conflicts between memories
    
    // For now, we'll just report that no contradictions were found
    return results;
  } catch (error) {
    logger.error(`Error resolving contradictions for user ${userId}:`, error);
    return { identified: 0, resolved: 0, errors: 1 };
  }
}

/**
 * Schedules regular memory maintenance for all users
 * @param {number} intervalHours - Hours between maintenance runs
 */
export function scheduleMemoryMaintenance(intervalHours = 24) {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  setInterval(async () => {
    try {
      logger.info(`Running scheduled memory maintenance (${intervalHours} hour interval)`);
      
      // Get all unique user+guild combinations
      const { data: userGuilds, error } = await supabase
        .from('unified_memories')
        .select('user_id, guild_id')
        .order('user_id, guild_id');
        
      if (error) {
        logger.error("Error fetching users for maintenance:", error);
        return;
      }
      
      // Create a Set of unique user+guild combinations
      const uniqueCombinations = new Set();
      for (const record of userGuilds) {
        uniqueCombinations.add(`${record.user_id}:${record.guild_id}`);
      }
      
      // Process each unique combination
      for (const combo of uniqueCombinations) {
        const [userId, guildId] = combo.split(':');
        
        // Run maintenance for this user+guild
        await runMemoryMaintenance(userId, guildId);
        
        // Small delay between users to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      logger.info("Scheduled memory maintenance completed");
    } catch (error) {
      logger.error("Error in scheduled memory maintenance:", error);
    }
  }, intervalMs);
  
  logger.info(`Memory maintenance scheduled to run every ${intervalHours} hours`);
}