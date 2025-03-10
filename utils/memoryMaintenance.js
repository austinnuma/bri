// memoryMaintenance.js - Utilities for memory quality management
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { categorizeMemory, MemoryCategories } from './unifiedMemoryManager.js';
import { openai } from '../services/combinedServices.js';
import { getEmbedding } from './improvedEmbeddings.js';
import natural from 'natural';

// Patterns to identify problematic memories
const PROBLEMATIC_PATTERNS = [
  /not (provided|mentioned|specified|given|stated)/i,
  /unknown/i,
  /no (information|data|details)/i,
  /(didn't|did not|doesn't|does not|hasn't|has not) (provide|mention|specify|state)/i,
  /unclear/i,
  /uncertain/i,
  /unsure/i
];

/**
 * Runs maintenance on the memory database
 * - Removes problematic memories
 * - Merges similar memories
 * - Recategorizes miscategorized memories
 * @returns {Promise<Object>} Statistics about the maintenance run
 */
export async function runMemoryMaintenance() {
  logger.info("Starting memory maintenance...");
  
  const stats = {
    problematicRemoved: 0,
    merged: 0,
    recategorized: 0,
    improved: 0,
    errors: 0
  };
  
  try {
    // Step 1: Remove problematic memories
    const problematicRemoved = await removeProblematicMemories();
    stats.problematicRemoved = problematicRemoved;
    
    // Step 2: Find and merge similar memories
    const mergeResults = await mergeSimilarMemories();
    stats.merged = mergeResults.merged;
    
    // Step 3: Recategorize miscategorized memories
    const recatResults = await recategorizeMiscategorizedMemories();
    stats.recategorized = recatResults.recategorized;
    
    // Step 4: Improve memory quality
    const improveResults = await improveMemoryQuality();
    stats.improved = improveResults.improved;
    
    logger.info("Memory maintenance completed successfully", stats);
    return stats;
  } catch (error) {
    logger.error("Error in memory maintenance:", error);
    stats.errors++;
    return stats;
  }
}

/**
 * Removes memories that match problematic patterns
 * @returns {Promise<number>} Number of memories removed
 */
async function removeProblematicMemories() {
  try {
    // Create a combined regex pattern for efficiency
    const combinedPattern = new RegExp(
      PROBLEMATIC_PATTERNS.map(pattern => pattern.source).join('|'), 
      'i'
    );
    
    // Get all intuited memories
    const { data: memories, error } = await supabase
      .from('unified_memories')
      .select('id, memory_text, memory_type')
      .eq('memory_type', 'intuited');
      
    if (error) {
      logger.error("Error fetching memories for cleanup:", error);
      return 0;
    }
    
    if (!memories || memories.length === 0) {
      logger.info("No memories found for cleanup");
      return 0;
    }
    
    // Find problematic memories
    const problematicIds = memories
      .filter(mem => combinedPattern.test(mem.memory_text))
      .map(mem => mem.id);
      
    if (problematicIds.length === 0) {
      logger.info("No problematic memories found");
      return 0;
    }
    
    // Delete the problematic memories
    const { error: deleteError } = await supabase
      .from('unified_memories')
      .delete()
      .in('id', problematicIds);
      
    if (deleteError) {
      logger.error("Error deleting problematic memories:", deleteError);
      return 0;
    }
    
    logger.info(`Removed ${problematicIds.length} problematic memories`);
    return problematicIds.length;
  } catch (error) {
    logger.error("Error removing problematic memories:", error);
    return 0;
  }
}

/**
 * Finds and merges similar memories
 * @returns {Promise<Object>} Results of the merge operation
 */
async function mergeSimilarMemories() {
  const results = {
    merged: 0,
    errors: 0
  };
  
  try {
    // Get all memories grouped by user
    const { data: users, error: userError } = await supabase
      .from('unified_memories')
      .select('user_id')
      .order('user_id')
      .limit(1000);
      
    if (userError) {
      logger.error("Error fetching users for memory merging:", userError);
      return results;
    }
    
    // Get unique user IDs
    const userIds = [...new Set(users.map(u => u.user_id))];
    
    // Process each user's memories
    for (const userId of userIds) {
      try {
        // Get all memories for this user
        const { data: memories, error } = await supabase
          .from('unified_memories')
          .select('id, memory_text, category, confidence')
          .eq('user_id', userId)
          .order('confidence', { ascending: false });
          
        if (error || !memories || memories.length < 2) {
          continue; // Skip if error or not enough memories to merge
        }
        
        // Group by category for more efficient comparison
        const categorizedMemories = {};
        for (const memory of memories) {
          if (!categorizedMemories[memory.category]) {
            categorizedMemories[memory.category] = [];
          }
          categorizedMemories[memory.category].push(memory);
        }
        
        // Find similar memories within each category
        for (const category in categorizedMemories) {
          const categoryMemories = categorizedMemories[category];
          if (categoryMemories.length < 2) continue;
          
          const memoriesToMerge = [];
          
          // Compare each memory with others in the same category
          for (let i = 0; i < categoryMemories.length; i++) {
            for (let j = i + 1; j < categoryMemories.length; j++) {
              const mem1 = categoryMemories[i];
              const mem2 = categoryMemories[j];
              
              const similarity = natural.JaroWinklerDistance(
                mem1.memory_text.toLowerCase(),
                mem2.memory_text.toLowerCase()
              );
              
              // If very similar, mark for merging
              if (similarity > 0.85) {
                memoriesToMerge.push({
                  primary: mem1.confidence >= mem2.confidence ? mem1 : mem2,
                  secondary: mem1.confidence >= mem2.confidence ? mem2 : mem1,
                  similarity
                });
              }
            }
          }
          
          // Perform merges
          for (const merge of memoriesToMerge) {
            // Delete the secondary memory
            const { error: deleteError } = await supabase
              .from('unified_memories')
              .delete()
              .eq('id', merge.secondary.id);
              
            if (deleteError) {
              logger.error("Error deleting memory during merge:", deleteError);
              results.errors++;
              continue;
            }
            
            results.merged++;
          }
        }
      } catch (userError) {
        logger.error(`Error processing memories for user ${userId}:`, userError);
        results.errors++;
      }
    }
    
    logger.info(`Memory merging completed: ${results.merged} memories merged`);
    return results;
  } catch (error) {
    logger.error("Error in mergeSimilarMemories:", error);
    results.errors++;
    return results;
  }
}

/**
 * Recategorizes memories that might be in the wrong category
 * @returns {Promise<Object>} Results of the recategorization
 */
async function recategorizeMiscategorizedMemories() {
  const results = {
    recategorized: 0,
    errors: 0
  };
  
  try {
    // Get all intuited memories
    const { data: memories, error } = await supabase
      .from('unified_memories')
      .select('id, memory_text, category')
      .limit(500); // Process in batches
      
    if (error) {
      logger.error("Error fetching memories for recategorization:", error);
      return results;
    }
    
    // Check each memory's category
    for (const memory of memories) {
      try {
        const suggestedCategory = categorizeMemory(memory.memory_text);
        
        // If category differs, update it
        if (suggestedCategory !== memory.category) {
          const { error: updateError } = await supabase
            .from('unified_memories')
            .update({ category: suggestedCategory })
            .eq('id', memory.id);
            
          if (updateError) {
            logger.error(`Error updating category for memory ${memory.id}:`, updateError);
            results.errors++;
            continue;
          }
          
          results.recategorized++;
        }
      } catch (memError) {
        logger.error(`Error recategorizing memory ${memory.id}:`, memError);
        results.errors++;
      }
    }
    
    logger.info(`Recategorization completed: ${results.recategorized} memories recategorized`);
    return results;
  } catch (error) {
    logger.error("Error in recategorizeMiscategorizedMemories:", error);
    results.errors++;
    return results;
  }
}

/**
 * Improves the quality of vague or incomplete memories
 * @returns {Promise<Object>} Results of the improvement operation
 */
async function improveMemoryQuality() {
  const results = {
    improved: 0,
    errors: 0
  };
  
  try {
    // Get memories that might need improvement
    const { data: memories, error } = await supabase
      .from('unified_memories')
      .select('id, memory_text, category')
      .limit(100) // Process in batches
      .or('memory_text.ilike.%might%,memory_text.ilike.%maybe%,memory_text.ilike.%some%');
      
    if (error) {
      logger.error("Error fetching memories for improvement:", error);
      return results;
    }
    
    if (!memories || memories.length === 0) {
      logger.info("No memories found for improvement");
      return results;
    }
    
    // Process each memory
    for (const memory of memories) {
      try {
        // Check if memory needs improvement
        if (!shouldImproveMemory(memory.memory_text)) {
          continue;
        }
        
        // Improve the memory
        const improvedText = await improveMemoryText(memory.memory_text);
        if (!improvedText || improvedText === memory.memory_text) {
          continue;
        }
        
        // Generate new embedding
        const embedding = await getEmbedding(improvedText);
        
        // Update the memory
        const { error: updateError } = await supabase
          .from('unified_memories')
          .update({
            memory_text: improvedText,
            embedding: embedding
          })
          .eq('id', memory.id);
          
        if (updateError) {
          logger.error(`Error updating improved memory ${memory.id}:`, updateError);
          results.errors++;
          continue;
        }
        
        results.improved++;
      } catch (memError) {
        logger.error(`Error improving memory ${memory.id}:`, memError);
        results.errors++;
      }
    }
    
    logger.info(`Memory improvement completed: ${results.improved} memories improved`);
    return results;
  } catch (error) {
    logger.error("Error in improveMemoryQuality:", error);
    results.errors++;
    return results;
  }
}

/**
 * Determines if a memory needs improvement
 * @param {string} text - Memory text
 * @returns {boolean} Whether the memory should be improved
 */
function shouldImproveMemory(text) {
  const lowered = text.toLowerCase();
  
  // Check for uncertainty markers
  if (lowered.includes('might') || 
      lowered.includes('maybe') || 
      lowered.includes('possibly') ||
      lowered.includes('probably') ||
      lowered.includes('appears to') ||
      lowered.includes('seems to') ||
      lowered.includes('could be')) {
    return true;
  }
  
  // Check for vagueness
  if (lowered.includes('some ') || 
      lowered.includes('something') || 
      lowered.includes('several') ||
      lowered.includes('various') ||
      lowered.includes('a few')) {
    return true;
  }
  
  // Check for very short memories (likely incomplete)
  if (text.split(' ').length < 5) {
    return true;
  }
  
  return false;
}

/**
 * Improves a memory text using AI
 * @param {string} text - Original memory text
 * @returns {Promise<string>} Improved memory text
 */
async function improveMemoryText(text) {
  try {
    const prompt = `
Make this memory more precise and definite by:
1. Removing uncertainty words (might, maybe, possibly, probably, seems)
2. Making vague terms more specific where possible
3. Creating a clearer, more confident statement

ONLY make changes if you can maintain the core meaning - don't add facts or details.
If the statement is too uncertain to be made definite, return it unchanged.

Original memory: "${text}"

Improved memory:`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You improve the quality of memory statements about users by making them more precise and definite without changing their meaning."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 200,
    });
    
    return completion.choices[0].message.content.trim();
  } catch (error) {
    logger.error("Error improving memory text:", error);
    return text; // Return original if error
  }
}

/**
 * Schedules regular memory maintenance
 * @param {number} intervalHours - Hours between maintenance runs
 */
export function scheduleMemoryMaintenance(intervalHours = 24) {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  // Run maintenance periodically
  setInterval(async () => {
    try {
      logger.info(`Running scheduled memory maintenance (${intervalHours} hour interval)`);
      const stats = await runMemoryMaintenance();
      logger.info("Scheduled maintenance completed", stats);
    } catch (error) {
      logger.error("Error in scheduled memory maintenance:", error);
    }
  }, intervalMs);
  
  logger.info(`Memory maintenance scheduled to run every ${intervalHours} hours`);
}


/**
 * AI-based memory curation for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Results of the curation
 */
export async function curateMemoriesWithAI(userId) {
    try {
      logger.info(`Starting AI-based memory curation for user ${userId}`);
      
      // Get all memories for this user (by category to avoid context limits)
      const categories = Object.values(MemoryCategories);
      let totalProcessed = 0;
      let totalKept = 0;
      let totalRemoved = 0;
      let totalMerged = 0;
      let reasons = []; // Create an array to store reasoning from each category
      
      // Process each category separately to avoid context limits
      for (const category of categories) {
        const { data: memories, error } = await supabase
          .from('unified_memories')
          .select('id, memory_text, confidence, category')
          .eq('user_id', userId)
          .eq('category', category)
          
        if (error || !memories || memories.length < 3) {
          // Skip if error or not enough memories to curate
          continue;
        }
        
        totalProcessed += memories.length;
        
        // Create a prompt for the AI
        const prompt = `
  As a memory management expert, your task is to analyze and curate this list of memories about a user.
  The goal is to keep only the most useful, accurate, and non-redundant memories.
  
  Current memories in the "${category}" category:
  ${memories.map((mem, i) => `${i+1}. "${mem.memory_text}" (confidence: ${mem.confidence})`).join('\n')}
  
  Please analyze these memories and:
  1. Identify duplicates or highly similar memories
  2. Identify low-quality or uninformative memories
  3. Identify memories that could be merged or combined
  4. Keep only the most important, high-quality memories
  
  Return your analysis as a JSON object with these properties:
  {
    "keep": [1, 4, 7],  // Array of indices (1-based) of memories to keep as-is
    "remove": [2, 3, 5], // Array of indices of memories to remove completely
    "merge": [  // Array of merge operations
      {
        "indices": [6, 8, 9],  // Indices of memories to merge
        "new_text": "Improved combined memory text"  // The merged memory text
      }
    ],
    "reasoning": "Brief explanation of your decisions"
  }
  `;
  
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo", // Can use a cheaper model for this task
          messages: [
            { 
              role: "system", 
              content: "You are an expert system for memory management and curation. Your task is to analyze user memories and determine which to keep, remove, or merge." 
            },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        });
        
        // Parse the AI's response
        const result = JSON.parse(response.choices[0].message.content);
      
        // Store the reasoning in our array
        if (result.reasoning) {
        reasons.push(`${category}: ${result.reasoning}`);
        }
        
        // Process the curation recommendations
        
        // 1. Handle memories to remove
        const idsToRemove = result.remove.map(idx => memories[idx-1].id);
        const { error: removeError } = await supabase
          .from('unified_memories')
          .delete()  // Actually delete instead of marking inactive
          .in('id', idsToRemove);
            
          if (!removeError) {
            totalRemoved += idsToRemove.length;
            logger.info(`Removed ${idsToRemove.length} memories in category ${category}`);
          }
        
        // 2. Handle memories to merge
        if (result.merge && result.merge.length > 0) {
          for (const merge of result.merge) {
            // Get the highest confidence from merged memories
            const mergedMemories = merge.indices.map(idx => memories[idx-1]);
            const highestConfidence = Math.max(...mergedMemories.map(m => m.confidence));
            
            // Create the new merged memory
            const { data: newMemory, error: createError } = await supabase
              .from('unified_memories')
              .insert({
                user_id: userId,
                memory_text: merge.new_text,
                memory_type: 'merged',
                category: category,
                confidence: highestConfidence,
                source: 'ai_curation'
              })
              .select()
              .single();
              
            if (!createError && newMemory) {
              // Deactivate the original memories
              const idsToDeactivate = merge.indices.map(idx => memories[idx-1].id);
              await supabase
                .from('unified_memories')
                .update({ active: false })
                .in('id', idsToDeactivate);
                
              totalMerged += idsToDeactivate.length;
            }
          }
        }
        
        // Calculate kept memories
        if (result.keep && result.keep.length > 0) {
          totalKept += result.keep.length;
        }
        
        logger.info(`AI curation for category ${category}: processed ${memories.length}, kept ${result.keep?.length || 0}, removed ${result.remove?.length || 0}, merged ${result.merge?.length || 0} groups`);
      }
      
    // Now return with the combined reasoning outside the loop
    return {
        processed: totalProcessed,
        kept: totalKept,
        removed: totalRemoved,
        merged: totalMerged,
        reasoning: reasons.join(' | ') // Join all reasoning strings
      };
    } catch (error) {
      logger.error(`Error in AI memory curation for user ${userId}:`, error);
      return {
        processed: 0,
        kept: 0,
        removed: 0,
        merged: 0,
        error: error.message
      };
    }
  }

  // Make this less frequent than normal maintenance
  export async function runAIMemoryCuration() {
    try {
      // First, get all unique user_ids that have memories
      const { data: users, error: userError } = await supabase
        .from('unified_memories')
        .select('user_id')
        .limit(1000);
        
      if (userError || !users) {
        logger.error("Error getting users for AI curation:", userError);
        return;
      }
      
      // Get unique user IDs
      const uniqueUserIds = [...new Set(users.map(u => u.user_id))];
      
      // For each user, count their memories
      const userMemoryCounts = [];
      for (const userId of uniqueUserIds) {
        const { count, error: countError } = await supabase
          .from('unified_memories')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
          
        if (!countError && count) {
          userMemoryCounts.push({ user_id: userId, count });
        }
      }
      
      // Sort by count descending
      userMemoryCounts.sort((a, b) => b.count - a.count);
      
      // Take top 5 users with at least 20 memories
      const usersToProcess = userMemoryCounts
        .filter(u => u.count >= 20)
        .slice(0, 5);
      
      logger.info(`Found ${usersToProcess.length} users for AI memory curation`);
      
      // Process each user
      for (const user of usersToProcess) {
        await curateMemoriesWithAI(user.user_id);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      logger.info("AI memory curation completed successfully");
    } catch (error) {
      logger.error("Error in AI memory curation:", error);
    }
  }
  
  // Schedule it weekly
  const WEEKLY = 7 * 24 * 60 * 60 * 1000;
  setInterval(runAIMemoryCuration, WEEKLY);
  
  // Run it once manually for testing
   setTimeout(runAIMemoryCuration, 60000); // Run after 1 minute for testing