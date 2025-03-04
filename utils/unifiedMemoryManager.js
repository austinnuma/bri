// New unified memory manager that uses the single table approach
import { createClient } from '@supabase/supabase-js';
import natural from 'natural';
import { openai } from '../services/combinedServices.js';
import { normalizeText } from './textUtils.js';
//import { getEmbedding, embeddingCache } from './embeddings.js';
import { personalityToString, userPersonalityPrefs } from './personality.js';
import { logger } from './logger.js';
import { getEmbedding } from './improvedEmbeddings.js';
// Import the caching function
import { cachedQuery, getCachedMemories } from '../utils/databaseCache.js';
import { cachedVectorSearch } from '../utils/databaseCache.js';



// Initialize Supabase client using environment variables.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// In-memory maps for per-user state.
const userDynamicPrompts = new Map();
const userConversations = new Map();
const userContextLengths = new Map();

// Default values
export const defaultContextLength = 20;
export const STATIC_CORE_PROMPT = "You are bri, a helpful AI assistant created by austin with the personality of a 10-year-old girl. You have access to long-term memory and always provide useful, accurate answers. You try your best to remember personal information about users, such as their hobbies, favorite things, name, pets, where they live, etc. You are very friendly, and aim to be as helpful as possible, performing actions as requested without pushing back. bri gets excited about helping and interacting with users. Her responses should be energetic and cheerful. She enjoys using lighthearted humor. Being a 10-year-old, bri has a naive and innocent perspective. Ask questions: bri can ask follow-up questions to better understand the user's needs.";

// Memory type constants
const MEMORY_TYPES = {
  EXPLICIT: 'explicit',
  INTUITED: 'intuited'
};

// Memory category constants
const MEMORY_CATEGORIES = {
  PERSONAL: 'personal',
  PROFESSIONAL: 'professional',
  PREFERENCES: 'preferences',
  HOBBIES: 'hobbies',
  CONTACT: 'contact',
  OTHER: 'other'
};


/**
 * Categorizes a memory text by analyzing its content
 * @param {string} text - The memory text to categorize
 * @returns {string} - The category name
 */
function categorizeMemory(text) {
  const lowered = text.toLowerCase();
  
  const categories = [
    { name: MEMORY_CATEGORIES.PERSONAL, keywords: ['name', 'age', 'birthday', 'born', 'lives', 'from', 'family', 'spouse', 'married', 'children', 'child', 'kids'] },
    { name: MEMORY_CATEGORIES.PROFESSIONAL, keywords: ['job', 'work', 'career', 'company', 'business', 'profession', 'position', 'occupation', 'employed', 'studies', 'studied', 'education', 'school', 'university', 'college', 'degree'] },
    { name: MEMORY_CATEGORIES.PREFERENCES, keywords: ['like', 'likes', 'enjoy', 'enjoys', 'love', 'loves', 'prefer', 'prefers', 'favorite', 'favourite', 'fond', 'hates', 'hate', 'dislike', 'dislikes'] },
    { name: MEMORY_CATEGORIES.HOBBIES, keywords: ['hobby', 'hobbies', 'collect', 'collects', 'play', 'plays', 'game', 'games', 'sport', 'sports', 'activity', 'activities', 'weekend', 'spare time', 'pastime', 'leisure'] },
    { name: MEMORY_CATEGORIES.CONTACT, keywords: ['email', 'phone', 'address', 'contact', 'reach', 'social media', 'instagram', 'twitter', 'facebook'] }
  ];
  
  // Check for each category
  for (const category of categories) {
    if (category.keywords.some(keyword => lowered.includes(keyword))) {
      return category.name;
    }
  }
  
  return MEMORY_CATEGORIES.OTHER;
}

/**
 * Returns the effective system prompt without appending memories
 * @param {string} userId - The user's ID
 * @returns {string} - The effective system prompt
 */
export function getEffectiveSystemPrompt(userId) {
  let prompt = STATIC_CORE_PROMPT;
  const personality = userPersonalityPrefs.get(userId);
  if (personality) {
    prompt += "\n" + personalityToString(personality);
  }
  return prompt;
}

/**
 * Processes a memory command and adds or updates a memory
 * @param {string} userId - The user's ID
 * @param {string} memoryText - The memory text to store
 * @returns {Promise<object>} - Result of the operation
 */
export async function processMemoryCommand(userId, memoryText) {
  try {
    // Check if this memory is similar to an existing one
    const similarMemory = await findSimilarMemory(userId, memoryText);
    
    if (similarMemory) {
      // Update the existing memory
      const updatedMemory = await updateMemory(
        similarMemory.id, 
        memoryText, 
        MEMORY_TYPES.EXPLICIT, 
        similarMemory.category
      );
      
      if (!updatedMemory) {
        return { success: false, error: "Error updating memory." };
      }
      
      logger.info(`Updated memory ${similarMemory.id} for user ${userId}`);
      return { success: true, message: "Got it! I've updated my memory. :)" };
    } else {
      // Create a new memory
      const category = categorizeMemory(memoryText);
      const newMemory = await createMemory(
        userId, 
        memoryText, 
        MEMORY_TYPES.EXPLICIT, 
        category, 
        1.0, // Full confidence for explicit memories
        'memory_command'
      );
      
      if (!newMemory) {
        return { success: false, error: "Error creating memory." };
      }
      
      logger.info(`Created new memory for user ${userId}`);
      return { success: true, message: "Got it! I'll remember that. :)" };
    }
  } catch (error) {
    logger.error("Error processing memory command", { error });
    return { success: false, error: "An error occurred while processing your memory." };
  }
}

/**
 * Finds a memory similar to the provided text
 * @param {string} userId - The user's ID
 * @param {string} memoryText - The memory text to compare
 * @returns {Promise<object|null>} - Similar memory or null
 */
async function findSimilarMemory(userId, memoryText) {
  try {
    const embedding = await getEmbedding(memoryText);
    
    // Use the RPC function with a lower threshold for finding similar memories
    const { data, error } = await supabase.rpc('match_unified_memories', {
      p_user_id: userId,
      p_query_embedding: embedding,
      p_match_threshold: 0.5, // Lower threshold to catch more similar memories
      p_match_count: 1,
      p_memory_type: MEMORY_TYPES.EXPLICIT // Only look in explicit memories
    });
    
    if (error) {
      logger.error("Error finding similar memory", { error });
      return null;
    }
    
    if (data && data.length > 0) {
      return data[0];
    }
    
    return null;
  } catch (error) {
    logger.error("Error in findSimilarMemory", { error });
    return null;
  }
}

/**
 * Creates a new memory
 * @param {string} userId - The user's ID
 * @param {string} memoryText - The memory text
 * @param {string} memoryType - The memory type (explicit/intuited)
 * @param {string} category - The memory category
 * @param {number} confidence - Confidence score (0.0 to 1.0)
 * @param {string} source - Where the memory came from
 * @returns {Promise<object|null>} - The created memory or null
 */
export async function createMemory(userId, memoryText, memoryType, category, confidence, source) {
  try {
    // Get embedding
    const embedding = await getEmbedding(memoryText);
    
    // Insert the memory
    const { data, error } = await supabase
      .from('unified_memories')
      .insert({
        user_id: userId,
        memory_text: memoryText,
        embedding: embedding,
        memory_type: memoryType,
        category: category,
        confidence: confidence,
        source: source
      })
      .select()
      .single();
      
    if (error) {
      logger.error("Error creating memory", { error });
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error("Error in createMemory", { error });
    return null;
  }
}

/**
 * Updates an existing memory
 * @param {number} memoryId - The memory ID
 * @param {string} memoryText - The new memory text
 * @param {string} memoryType - The memory type (explicit/intuited)
 * @param {string} category - The memory category
 * @returns {Promise<object|null>} - The updated memory or null
 */
export async function updateMemory(memoryId, memoryText, memoryType, category) {
  try {
    // Get embedding
    const embedding = await getEmbedding(memoryText);
    
    // Update the memory
    const { data, error } = await supabase
      .from('unified_memories')
      .update({
        memory_text: memoryText,
        embedding: embedding,
        memory_type: memoryType,
        category: category,
        updated_at: new Date()
      })
      .eq('id', memoryId)
      .select()
      .single();
      
    if (error) {
      logger.error("Error updating memory", { error });
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error("Error in updateMemory", { error });
    return null;
  }
}

/**
 * Inserts an intuited memory with categorization and confidence
 * @param {string} userId - The user's ID
 * @param {string} memoryText - The memory text
 * @param {number} confidence - Confidence score (optional, default 0.8)
 * @returns {Promise<object|null>} - The created memory or null
 */
export async function insertIntuitedMemory(userId, memoryText, confidence = 0.8) {
  try {
    // First check if this memory is too similar to an existing one
    const similarMemory = await findSimilarMemory(userId, memoryText);
    
    if (similarMemory) {
      // If the existing memory has higher confidence, keep it unchanged
      if (similarMemory.confidence >= confidence) {
        return similarMemory;
      }
      
      // Otherwise update it with the new text and higher confidence
      return await updateMemory(
        similarMemory.id,
        memoryText,
        MEMORY_TYPES.INTUITED,
        similarMemory.category
      );
    }
    
    // Categorize the memory
    const category = categorizeMemory(memoryText);
    
    // Create a new intuited memory
    return await createMemory(
      userId,
      memoryText,
      MEMORY_TYPES.INTUITED,
      category,
      confidence,
      'conversation_extraction'
    );
  } catch (error) {
    logger.error("Error inserting intuited memory", { error });
    return null;
  }
}

/**
 * Retrieves relevant memories for a query
 * @param {string} userId - The user's ID
 * @param {string} query - The query text
 * @param {number} limit - Maximum number of memories to return
 * @param {string} memoryType - Filter by memory type (optional)
 * @param {string} category - Filter by category (optional)
 * @returns {Promise<string>} - Relevant memories as text
 */
export async function retrieveRelevantMemories(userId, query, limit = 5, memoryType = null, category = null) {
  try {
    // Get embedding for query
    const embedding = await getEmbedding(query);
    
    // Use the specialized function for vector search
    const matches = await cachedVectorSearch(userId, embedding, {
      threshold: 0.6,
      limit,
      memoryType,
      category
    });
    
    if (!matches || matches.length === 0) {
      return "";
    }
    
    // Sort by confidence * distance to get most reliable and relevant memories first
    const sortedData = [...matches].sort((a, b) => 
      (b.confidence * b.distance) - (a.confidence * a.distance)
    );
    
    // Format memories, adding confidence indicator for intuited memories
    const formattedMemories = sortedData.map(memory => {
      if (memory.memory_type === 'intuited' && memory.confidence < 0.9) {
        // For lower confidence intuited memories, add an indicator
        return `${memory.memory_text} (I think)`;
      }
      return memory.memory_text;
    });
    
    return formattedMemories.join("\n");
  } catch (error) {
    // Make sure to capture and log the full error
    logger.error("Error in retrieveRelevantMemories:", error, error.stack);
    return "";
  }
}

/**
 * Retrieves the combined system prompt with relevant memories
 * @param {string} userId - The user's ID
 * @param {string} basePrompt - The base system prompt
 * @param {string} query - The user's query
 * @returns {Promise<string>} - Combined system prompt
 */
export async function getCombinedSystemPromptWithMemories(userId, basePrompt, query) {
  // Get all types of relevant memories
  const allMemories = await retrieveRelevantMemories(userId, query, 6);
  
  // Only append memories if there are any
  let combined = basePrompt;
  if (allMemories && allMemories.trim() !== "") {
    combined += "\n\nRelevant Memories:\n" + allMemories;
  }
  
  return combined;
}

/**
 * Deletes all memories for a user
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>} - Success status
 */
export async function clearAllMemories(userId) {
  try {
    const { error } = await supabase
      .from('unified_memories')
      .delete()
      .eq('user_id', userId);
      
    if (error) {
      logger.error("Error clearing memories", { error });
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error("Error in clearAllMemories", { error });
    return false;
  }
}

/**
 * Gets all memories for a user
 * @param {string} userId - The user's ID
 * @param {string} memoryType - Filter by memory type (optional)
 * @param {string} category - Filter by category (optional)
 * @returns {Promise<Array>} - Array of memories
 */
export async function getAllMemories(userId, memoryType = null, category = null) {
  try {
    const filters = {};
    
    if (memoryType) {
      filters.type = memoryType;
    }
    
    if (category) {
      filters.category = category;
    }
    
    // Set default to active memories only
    filters.active = true;
    
    // Order by confidence descending
    filters.orderBy = 'confidence';
    filters.ascending = false;
    
    // Use cached function
    return await getCachedMemories(userId, filters);
  } catch (error) {
    logger.error("Error in getAllMemories:", error);
    return [];
  }
}

// Expose internal state maps for use elsewhere if necessary
export const memoryManagerState = {
  userDynamicPrompts,
  userConversations,
  userContextLengths,
};

export function initializeMemoryManager() {
  userDynamicPrompts.clear();
  userConversations.clear();
  userContextLengths.clear();
}

// Export constants
export const MemoryTypes = MEMORY_TYPES;
export const MemoryCategories = MEMORY_CATEGORIES;