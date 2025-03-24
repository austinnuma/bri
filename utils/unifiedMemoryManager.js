// New unified memory manager that uses the single table approach
import { createClient } from '@supabase/supabase-js';
import natural from 'natural';
import { openai } from '../services/combinedServices.js';
import { normalizeText } from './textUtils.js';
//import { getEmbedding, embeddingCache } from './embeddings.js';
//import { personalityToString, userPersonalityPrefs } from './personality.js';
import { logger } from './logger.js';
import { getEmbedding } from './improvedEmbeddings.js';
// Import the caching function
import { cachedQuery, getCachedMemories } from './databaseCache.js';
import { cachedVectorSearch } from './databaseCache.js';
// Import database-backed user settings
import { 
  getUserPersonality, 
  setUserPersonality,
  getUserDynamicPrompt,
  setUserDynamicPrompt,
  getUserContextLength,
  setUserContextLength,
  getUserConversation,
  setUserConversation
} from './db/userSettings.js';
import { 
  calculateInitialConfidence, 
  processRetrievedMemories,
} from './memoryConfidence.js';

import {
  retrieveMemoriesWithConfidence,
  contextAwareMemoryRetrieval,
  updateMemoryAccessStats,
  updateOverlappingMemoriesConfidence
} from './enhancedMemoryRetrieval.js';
import { 
  getUserCharacterSheet, 
  getCharacterSheetForPrompt, 
  updateConversationStyle 
} from './userCharacterSheet.js';
import { getTimeEventsForContextEnhancement } from './timeSystem.js';
import { 
  retrieveMemoriesWithGraphAndTemporal, 
  contextAwareMemoryRetrievalWithEnhancements,
  identifyMemoryContext,
  enhancePromptWithMemoryContext
} from './enhancedGraphMemoryRetrieval.js';


// Initialize Supabase client using environment variables.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// In-memory cache for personality preferences per user.
export const userPersonalityPrefs = new Map();

// Database-based per-user state - in-memory caches removed
// These Map objects will be migrated to use database storage entirely
// The migration will preserve their key pattern but eliminate the need for these Maps
const userDynamicPrompts = new Map();
const userConversations = new Map();
const userContextLengths = new Map();

// Default values
export const defaultContextLength = 20;
export const STATIC_CORE_PROMPT = "You are bri, a helpful AI assistant created by austin with the personality of a 14-year-old girl. You have access to long-term memory and always provide useful, accurate answers. You try your best to remember personal information about users, such as their hobbies, favorite things, name, pets, where they live, etc. You are very friendly, and aim to be as helpful as possible. bri gets excited about helping and interacting with users. Her responses should be energetic and cheerful. She enjoys using lighthearted humor. Being a 14-year-old, bri has a naive and innocent perspective. Ask questions: bri can ask follow-up questions to better understand the user's needs. Prioritize responding to the most contextually relevant parts of messages. When a user signals conversation closure (like saying goodnight or mentioning they need to leave), prioritize acknowledging that closure and respond briefly to other content if appropriate. Not every part of a message requires equal attention - use conversational context to determine which elements deserve focus. Examples of priority assessment: - When users signal they're leaving/sleeping: Prioritize farewell responses over detailed topic discussions - When users ask a direct question alongside casual remarks: Prioritize answering the question - When users share multiple topics but emphasize one: Focus on their emphasized topic";

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
 * Categorizes a memory text more accurately using both keywords and semantic analysis
 * @param {string} text - The memory text to categorize
 * @returns {string} - The category name
 */
export function categorizeMemory(text) {
  const lowered = text.toLowerCase();
  
  // Enhanced categories with more specific subcategories and examples
  const categories = [
    { 
      name: MEMORY_CATEGORIES.PERSONAL, 
      keywords: ['name', 'age', 'birthday', 'born', 'lives', 'from', 'family', 'spouse', 'married', 
                'children', 'child', 'kids', 'parent', 'mother', 'father', 'sister', 'brother',
                'nationality', 'ethnicity', 'religion', 'belief', 'identity', 'grew up', 'raised',
                'hometown', 'background', 'history', 'personality', 'character', 'trait'],
      examples: ['User is 32 years old', 'User lives in Chicago', 'User has two brothers']
    },
    { 
      name: MEMORY_CATEGORIES.PROFESSIONAL, 
      keywords: ['job', 'work', 'career', 'company', 'business', 'profession', 'position', 'occupation', 
                'employed', 'studies', 'studied', 'education', 'school', 'university', 'college', 'degree', 
                'graduated', 'student', 'major', 'field', 'industry', 'salary', 'project', 'skill', 'expertise',
                'experience', 'trained', 'certified', 'qualification', 'resume', 'interview'],
      examples: ['User works as a graphic designer', 'User studied biology at UCLA', 'User is looking for a new job']
    },
    { 
      name: MEMORY_CATEGORIES.PREFERENCES, 
      keywords: ['like', 'likes', 'enjoy', 'enjoys', 'love', 'loves', 'prefer', 'prefers', 'favorite', 'favourite', 
                'fond', 'hates', 'hate', 'dislike', 'dislikes', 'interested in', 'excited by', 'appealing', 
                'tasty', 'delicious', 'good', 'great', 'amazing', 'wonderful', 'fantastic', 'terrible', 'awful',
                'bad', 'boring', 'interested in', 'fan of', 'doesn\'t like', 'can\'t stand', 'allergic to',
                'prefers', 'would rather', 'wish', 'crave', 'desire', 'want', 'appreciate', 'value'],
      examples: ['User enjoys chocolate ice cream', 'User doesn\'t like horror movies', 'User is a big fan of Taylor Swift']
    },
    { 
      name: MEMORY_CATEGORIES.HOBBIES, 
      keywords: ['hobby', 'hobbies', 'collect', 'collects', 'play', 'plays', 'game', 'games', 'sport', 'sports',
                'activity', 'activities', 'weekend', 'spare time', 'pastime', 'leisure', 'recreation', 'interest',
                'tournament', 'competition', 'league', 'team', 'club', 'group', 'exercise', 'workout', 'fitness',
                'practice', 'skill', 'craft', 'art', 'music', 'instrument', 'read', 'reading', 'book', 'movie',
                'show', 'series', 'travel', 'adventure', 'explore', 'create', 'build', 'make', 'cook', 'bake'],
      examples: ['User plays basketball on weekends', 'User collects vintage vinyl records', 'User enjoys hiking']
    },
    { 
      name: MEMORY_CATEGORIES.CONTACT, 
      keywords: ['email', 'phone', 'address', 'contact', 'reach', 'social media', 'instagram', 'twitter', 'facebook',
                'snapchat', 'tiktok', 'linkedin', 'profile', 'account', 'username', 'handle', 'website', 'blog',
                'channel', 'discord', 'steam', 'gamer tag', 'psn', 'xbox live', 'contact info', 'number', 'call'],
      examples: ['User can be reached at user@example.com', 'User\'s Instagram handle is @username']
    }
  ];
  
  // Special case for food preferences - create a separate subcategory
  const foodKeywords = ['food', 'eat', 'dish', 'meal', 'cuisine', 'cook', 'bake', 'recipe', 'restaurant', 'breakfast', 
                        'lunch', 'dinner', 'snack', 'dessert', 'fruit', 'vegetable', 'meat', 'drink', 'beverage'];
                      
  const foodTermPresent = foodKeywords.some(term => lowered.includes(term));
  const preferenceTermPresent = categories[2].keywords.some(term => lowered.includes(term));
  
  if (foodTermPresent && preferenceTermPresent) {
    // This is a food preference, prioritize it as preferences category
    return MEMORY_CATEGORIES.PREFERENCES;
  }
  
  // Look for semantic keywords matches
  for (const category of categories) {
    if (category.keywords.some(keyword => lowered.includes(keyword))) {
      return category.name;
    }
  }
  
  // Secondary analysis for preference statements that might not contain explicit keywords
  if (lowered.includes('would like') || 
      lowered.includes('thinks that') || 
      lowered.includes('feels that') ||
      lowered.includes('believes') ||
      lowered.includes('agrees with') ||
      lowered.includes('disagrees with')) {
    return MEMORY_CATEGORIES.PREFERENCES;
  }
  
  // Fallback: Use semantic analysis to find the best category match
  const bestCategory = findBestCategorySemanticMatch(text, categories);
  if (bestCategory) {
    return bestCategory;
  }
  
  return MEMORY_CATEGORIES.OTHER;
}


/**
 * Finds the best category match based on semantic similarity to examples
 * @param {string} text - The memory text
 * @param {Array} categories - Categories with examples
 * @returns {string|null} - Best matching category or null
 */
function findBestCategorySemanticMatch(text, categories) {
  // Simple implementation without requiring embeddings
  // Count word overlap with example statements for each category
  
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  let bestMatch = null;
  let highestScore = 0;
  
  for (const category of categories) {
    if (!category.examples || category.examples.length === 0) continue;
    
    let categoryScore = 0;
    for (const example of category.examples) {
      const exampleWords = example.toLowerCase().split(/\W+/).filter(w => w.length > 2);
      
      // Count overlapping words
      const overlap = words.filter(word => exampleWords.includes(word)).length;
      categoryScore += overlap;
    }
    
    // Normalize by number of examples
    categoryScore /= category.examples.length;
    
    if (categoryScore > highestScore) {
      highestScore = categoryScore;
      bestMatch = category.name;
    }
  }
  
  // Only return if we have a meaningful match
  return highestScore > 0.5 ? bestMatch : null;
}


/**
 * Returns the effective system prompt without appending memories
 * @param {string} userId - The user's ID
 * @param {string} guildId - The guild ID
 * @returns {string} - The effective system prompt
 */
export function getEffectiveSystemPrompt(userId, guildId) {
  let prompt = STATIC_CORE_PROMPT;

  // Use combined user+guild key
  const personalityKey = `${userId}:${guildId}`;
  const personality = userPersonalityPrefs.get(personalityKey);
    
  if (personality) {
    prompt += "\n" + personalityToString(personality);
  }
  return prompt;
}

/**
 * Processes a memory command and adds or updates a memory
 * @param {string} userId - The user's ID
 * @param {string} memoryText - The memory text to store
 * @param {string} guildId - The guild ID
 * @returns {Promise<object>} - Result of the operation
 */
export async function processMemoryCommand(userId, memoryText, guildId) {
  try {
    // Check if this memory is similar to an existing one
    const similarMemory = await findSimilarMemory(userId, memoryText, guildId);
    
    if (similarMemory) {
      // Update the existing memory
      const updatedMemory = await updateMemory(
        similarMemory.id, 
        memoryText, 
        MEMORY_TYPES.EXPLICIT, 
        similarMemory.category,
        guildId
      );
      
      if (!updatedMemory) {
        return { success: false, error: "Error updating memory." };
      }
      
      logger.info(`Updated memory ${similarMemory.id} for user ${userId} in guild ${guildId}`);
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
        'memory_command', 
        guildId
      );
      
      if (!newMemory) {
        return { success: false, error: "Error creating memory." };
      }
      
      logger.info(`Created new memory for user ${userId} in guild ${guildId}`);
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
 * @param {string} guildId - The guild ID
 * @returns {Promise<object|null>} - Similar memory or null
 */
async function findSimilarMemory(userId, memoryText, guildId) {
  try {
    const embedding = await getEmbedding(memoryText);
    
    // Use the RPC function with a lower threshold for finding similar memories
    const { data, error } = await supabase.rpc('match_unified_memories', {
      p_user_id: userId,
      p_guild_id: guildId,
      p_query_embedding: embedding,
      p_match_threshold: 0.5, // Lower threshold to catch more similar memories
      p_match_count: 1,
      p_memory_type: MEMORY_TYPES.EXPLICIT // Only look in explicit memories
    });
    
    if (error) {
      logger.error("Error finding similar memory", { error, userId, guildId });
      return null;
    }
    
    if (data && data.length > 0) {
      return data[0];
    }
    
    return null;
  } catch (error) {
    logger.error("Error in findSimilarMemory", { error, userId, guildId });
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
 * @param {string} guildId - The guild ID
 * @returns {Promise<object|null>} - The created memory or null
 */
export async function createMemory(userId, memoryText, memoryType, category, confidence, source, guildId) {
  try {
    // Calculate initial confidence based on multiple factors
    const initialConfidence = calculateInitialConfidence(memoryType, source, category, memoryText);
    // Get embedding
    const embedding = await getEmbedding(memoryText);
    
    // Insert the memory
    const { data, error } = await supabase
    .from('unified_memories')
    .insert({
      user_id: userId,
      guild_id: guildId,
      memory_text: memoryText,
      embedding: embedding,
      memory_type: memoryType,
      category: category,
      confidence: initialConfidence, // Use calculated confidence
      source: source,
      created_at: new Date().toISOString(),
      last_accessed: null,
      access_count: 0,
      verified: memoryType === MEMORY_TYPES.EXPLICIT, // Explicit memories start verified
      verification_date: memoryType === MEMORY_TYPES.EXPLICIT ? new Date().toISOString() : null,
      contradiction_count: 0
      })
        .select()
        .single();
        
    if (error) {
      logger.error("Error creating memory", { error, userId, guildId });
      return null;
    }

    // Update confidence of overlapping memories
    updateOverlappingMemoriesConfidence(userId, memoryText, data.id, guildId)
      .catch(err => logger.error("Error updating overlapping memories:", err));
    
    return data;
  } catch (error) {
    logger.error("Error in createMemory", { error, userId, guildId });
    return null;
  }
}

/**
 * Updates an existing memory
 * @param {number} memoryId - The memory ID
 * @param {string} memoryText - The new memory text
 * @param {string} memoryType - The memory type (explicit/intuited)
 * @param {string} category - The memory category
 * @param {string} guildId - The guild ID
 * @returns {Promise<object|null>} - The updated memory or null
 */
export async function updateMemory(memoryId, memoryText, memoryType, category, guildId) {
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
        guild_id: guildId,
        updated_at: new Date()
      })
      .eq('id', memoryId)
      .select()
      .single();
      
    if (error) {
      logger.error("Error updating memory", { error, memoryId, guildId });
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error("Error in updateMemory", { error, memoryId, guildId });
    return null;
  }
}

/**
 * Inserts an intuited memory with categorization and confidence
 * @param {string} userId - The user's ID
 * @param {string} memoryText - The memory text
 * @param {number} confidence - Confidence score (optional, default 0.8)
 * @param {string} guildId - The guild ID
 * @returns {Promise<object|null>} - The created memory or null
 */
export async function insertIntuitedMemory(userId, memoryText, confidence = 0.8, guildId) {
  try {
    // First check if this memory is too similar to an existing one
    const similarMemory = await findSimilarMemory(userId, memoryText, guildId);
    
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
        similarMemory.category,
        guildId
      );
    }
    
    // Categorize the memory
    const category = categorizeMemory(memoryText);
    
    // Use the enhanced initial confidence calculation
    const calculatedConfidence = calculateInitialConfidence(
      MEMORY_TYPES.INTUITED,
      'conversation_extraction',
      category,
      memoryText
    );
    
    // Create a new intuited memory with the calculated confidence
    return await createMemory(
      userId,
      memoryText,
      MEMORY_TYPES.INTUITED,
      category,
      calculatedConfidence, // Use calculated confidence instead of fixed 0.8
      'conversation_extraction',
      guildId
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
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - Relevant memories as text
 */
export async function retrieveRelevantMemories(userId, query, limit = 5, memoryType = null, category = null, guildId) {
  // Use the enhanced retrieval with graph and temporal understanding
  return await retrieveMemoriesWithGraphAndTemporal(userId, query, limit, memoryType, category, guildId);
}

/**
 * Retrieves the combined system prompt with relevant memories
 * @param {string} userId - The user's ID
 * @param {string} basePrompt - The base system prompt
 * @param {string} query - The user's query
 * @param {string} guildId - The guild ID
 * @returns {Promise<string>} - Combined system prompt
 */
export async function getCombinedSystemPromptWithMemories(userId, basePrompt, query, guildId, conversation = null) {
  // First get the user character sheet formatted for the prompt
  const characterSheetInfo = await getCharacterSheetForPrompt(userId, guildId);
  
  // Identify memory context
  const memoryContext = await identifyMemoryContext(userId, query, guildId);
  
  // Enhance base prompt with memory context
  let enhancedBasePrompt = basePrompt;
  if (memoryContext && memoryContext.has_context) {
    enhancedBasePrompt = enhancePromptWithMemoryContext(basePrompt, memoryContext);
  }
  
  // If conversation context is provided, use enhanced context-aware retrieval
  let allMemories;
  
  if (conversation && conversation.length > 0) {
    allMemories = await contextAwareMemoryRetrievalWithEnhancements(userId, query, conversation, guildId);
  } else {
    // Otherwise fall back to standard graph+temporal retrieval
    allMemories = await retrieveMemoriesWithGraphAndTemporal(userId, query, 6, null, null, guildId);
  }
  
  // Get time-related events for context enhancement
  const timeContext = await getTimeEventsForContextEnhancement(userId, guildId);
  
  // Combine the prompt with character sheet and memories
  let combined = enhancedBasePrompt;

  // Add character sheet info if available
  if (characterSheetInfo && characterSheetInfo.trim() !== "") {
    combined += "\n\n" + characterSheetInfo;
  }
  
  // Add relevant memories if available
  if (allMemories && allMemories.trim() !== "") {
    combined += "\n\nRelevant Memories:\n" + allMemories;
  }
  
  // Add time context if available
  if (timeContext && timeContext.trim() !== "") {
    combined += "\n\nTime-Related Context:\n" + timeContext;
    combined += "\n\nIf relevant and natural in conversation, you can reference these upcoming events. Don't force mentioning them if it wouldn't flow naturally in the conversation.";
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
    return await getCachedMemories(userId, interaction.guildId, filters);
  } catch (error) {
    logger.error("Error in getAllMemories:", error);
    return [];
  }
}


/**
 * ---------------------------------------------------------------  
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 *                 Personality Section
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 * ---------------------------------------------------------------
 */

export const defaultPersonality = {
  responseLength: "normal", // Options: "short", "normal", "long"
  humor: "light",          // Options: "none", "light", "more humorous"
  tone: "friendly",        // Options: "friendly", "formal", "casual", etc.
};



/**
 * Retrieves the personality preferences for a given user.
 * Using database-backed access through userSettings.js
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} Personality object.
 */
export async function getPersonality(userId, guildId) {
  try {
    // Import at the top of the file
    // import { getUserPersonality } from './db/userSettings.js';
    
    // Use the new database helper
    return await getUserPersonality(userId, guildId);
  } catch (error) {
    logger.error(`Error fetching personality preferences for user ${userId} in guild ${guildId}:`, error);
    // Fall back to default if an error occurs
    return defaultPersonality;
  }
}

/**
 * Updates a specific personality field for a user.
 * @param {string} userId - User ID
 * @param {string} field - One of "responseLength", "humor", or "tone".
 * @param {string} value - The new value for the field.
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} The updated personality object.
 */
export async function setPersonalityPreference(userId, field, value, guildId) {
  try {
    // Import at the top of the file
    // import { getUserPersonality, setUserPersonality } from './db/userSettings.js';
    
    // Get current personality
    let personality = await getUserPersonality(userId, guildId);
    
    // Update the specific field
    personality = { ...personality, [field]: value };
    
    // Save to database
    await setUserPersonality(userId, guildId, personality);
    
    return personality;
  } catch (error) {
    logger.error(`Error updating personality preferences for user ${userId} in guild ${guildId}:`, error);
    throw error;
  }
}

/**
 * Converts a personality object into a formatted string.
 * This string will be appended to the system prompt.
 * @param {Object} personality 
 * @returns {string} Formatted personality section.
 */
export function personalityToString(personality) {
  if (!personality) return "";
  const { responseLength, humor, tone } = personality;
  let personalityStr = "Personality Preferences:";
  if (responseLength) personalityStr += `\n- Response Length: ${responseLength}`;
  if (humor) personalityStr += `\n- Humor: ${humor}`;
  if (tone) personalityStr += `\n- Tone: ${tone}`;
  return personalityStr;
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