// incrementalMemoryExtraction.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { enhancedSummarizeConversation } from './summarization.js';
import { categorizeMemory, MemoryTypes } from './unifiedMemoryManager.js';
import { getBatchEmbeddings } from './improvedEmbeddings.js';
import { calculateInitialConfidence } from './memoryConfidence.js';
import { semanticDeduplication } from './memoryDeduplication.js';
// Import with individual variables to avoid any potential import issues
import * as extractionFunctions from './extractionAndMemory.js';
const { enhancedMemoryExtraction, postProcessExtractedFacts, extractExplicitFacts, extractImpliedPreferences } = extractionFunctions;

/**
 * Tracks conversations to enable incremental processing
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Array} conversation - Full conversation array
 * @param {string} currentMessageId - Current message ID (optional)
 * @returns {Promise<Object>} - Information about what needs processing
 */
export async function trackConversationState(userId, guildId, conversation, currentMessageId = null) {
  try {
    if (!conversation || conversation.length <= 1) {
      return { needsProcessing: false };
    }
    
    // Get the last processed message tracking info
    const { data: trackingData, error } = await supabase
      .from('memory_extraction_tracking')
      .select('last_extraction_time, last_extracted_message_count, last_extracted_message_id')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    // If no record exists or there's an error, process the whole conversation
    if (error || !trackingData) {
      return { 
        needsProcessing: true,
        startIndex: 1, // Skip system prompt at index 0
        isInitial: true,
        currentMessageId
      };
    }
    
    // PRIORITY 1: Use message count if available
    if (trackingData.last_extracted_message_count > 0) {
      // If the conversation is shorter than what we've already processed, something odd happened
      // (like conversation history was cleared) - process from the beginning
      if (conversation.length <= trackingData.last_extracted_message_count) {
        return {
          needsProcessing: true,
          startIndex: 1, // Skip system prompt
          isInitial: true, // Consider this a fresh start
          currentMessageId
        };
      }
      
      // If we have more messages than last time, process only the new ones
      if (conversation.length > trackingData.last_extracted_message_count) {
        return {
          needsProcessing: true,
          startIndex: trackingData.last_extracted_message_count,
          isInitial: false,
          previousCount: trackingData.last_extracted_message_count,
          currentMessageId
        };
      }
      
      // No need to process if the conversation hasn't changed
      return { needsProcessing: false };
    }
    
    // FALLBACK: Use message ID if message count is not available
    if (trackingData.last_extracted_message_id) {
      // If we have a new message ID and it's different from the last one we processed
      if (currentMessageId && currentMessageId !== trackingData.last_extracted_message_id) {
        // We don't know exactly which messages are new, so we need a full processing
        // but we'll mark it as non-initial so the system knows to be careful about duplicates
        return {
          needsProcessing: true,
          startIndex: 1, // Process from beginning
          isInitial: false, // But not as initial processing
          previousMessageId: trackingData.last_extracted_message_id,
          currentMessageId
        };
      }
      
      // No message ID or same ID means no new processing needed
      return { needsProcessing: false };
    }
    
    // If we have neither message count nor message ID in our tracking data
    // we should process everything (conservative approach)
    return { 
      needsProcessing: true, 
      startIndex: 1,
      isInitial: true,
      currentMessageId
    };
  } catch (error) {
    logger.error("Error tracking conversation state:", error);
    // Default to processing everything for safety
    return { 
      needsProcessing: true, 
      startIndex: 1,
      isInitial: true,
      currentMessageId
    };
  }
}

/**
 * Updates the memory extraction tracking record
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {number} messageCount - Current message count
 * @returns {Promise<boolean>} - Success status
 */
export async function updateExtractionTracking(userId, guildId, messageCount, messageId = null) {
  try {
    const { error } = await supabase
      .from('memory_extraction_tracking')
      .upsert({
        user_id: userId,
        guild_id: guildId,
        last_extraction_time: new Date().toISOString(),
        last_extracted_message_count: messageCount,
        last_extracted_message_id: messageId || null
      }, {
        onConflict: 'user_id, guild_id'
      });
      
    if (error) {
      logger.error("Error updating extraction tracking:", error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error("Error in updateExtractionTracking:", error);
    return false;
  }
}

/**
 * Performs incremental memory extraction on only new messages
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Array} conversation - Full conversation array
 * @param {string} botName - Name of the bot
 * @returns {Promise<Object>} - Results of extraction
 */
export async function incrementalMemoryExtraction(userId, guildId, conversation, botName = "Bri") {
  try {
    // Track the conversation state to determine what needs processing
    const trackingInfo = await trackConversationState(userId, guildId, conversation);
    
    // If nothing needs processing, exit early
    if (!trackingInfo.needsProcessing) {
      logger.info(`No new messages to process for user ${userId} in guild ${guildId}`);
      return { extracted: 0, success: true };
    }
    
    // For initial processing, use the standard approach
    if (trackingInfo.isInitial) {
      return await performInitialExtraction(userId, guildId, conversation, botName);
    }
    
    // For incremental processing, only analyze new messages
    return await performIncrementalExtraction(
      userId, 
      guildId, 
      conversation, 
      trackingInfo.startIndex,
      botName
    );
  } catch (error) {
    logger.error(`Error in incrementalMemoryExtraction: ${error}`, error);
    return { extracted: 0, success: false, error: error.message };
  }
}

/**
 * Performs initial memory extraction on a full conversation
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Array} conversation - Full conversation array
 * @param {string} botName - Name of the bot
 * @returns {Promise<Object>} - Results of extraction
 */
async function performInitialExtraction(userId, guildId, conversation, botName) {
  try {
    // Create a working copy of the conversation
    const conversationCopy = [...conversation];
    
    // Summarize the full conversation
    const summary = await enhancedSummarizeConversation(conversationCopy, botName);
    if (!summary) {
      logger.warn(`Failed to generate summary for user ${userId} in guild ${guildId}`);
      return { extracted: 0, success: false };
    }
    
    // Extract facts using your existing extraction method
    // Note: We're assuming enhancedMemoryExtraction exists and works similarly
    const extractedFacts = await enhancedMemoryExtraction(userId, conversationCopy, guildId, botName);
    
    // Skip DB operations if no new facts were extracted
    if (!extractedFacts || extractedFacts.length === 0) {
      logger.info(`No facts extracted for user ${userId} in guild ${guildId}`);
      // Still update tracking
      await updateExtractionTracking(userId, guildId, conversation.length);
      return { extracted: 0, success: true };
    }
    
    // Process and store the extracted facts
    const memoryResult = await processAndStoreMemories(userId, guildId, extractedFacts);
    
    // Update tracking information
    await updateExtractionTracking(userId, guildId, conversation.length);
    
    return { 
      extracted: memoryResult.stored,
      total: extractedFacts.length,
      duplicates: extractedFacts.length - memoryResult.stored,
      success: true
    };
  } catch (error) {
    logger.error(`Error in performInitialExtraction: ${error}`, error);
    return { extracted: 0, success: false, error: error.message };
  }
}

/**
 * Performs incremental memory extraction on only new messages
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Array} conversation - Full conversation array
 * @param {number} startIndex - Index to start processing from
 * @param {string} botName - Name of the bot
 * @returns {Promise<Object>} - Results of extraction
 */
async function performIncrementalExtraction(userId, guildId, conversation, startIndex, botName) {
  try {
    // Extract only the new portion of the conversation
    const newMessages = conversation.slice(startIndex);
    
    // Need enough context for the extraction to make sense
    // Get a few messages before the new ones for context
    const contextSize = Math.min(3, startIndex - 1);
    const contextMessages = contextSize > 0 ? conversation.slice(startIndex - contextSize, startIndex) : [];
    
    // Combine context and new messages
    const processSegment = [...contextMessages, ...newMessages];
    
    // Only include system prompt if needed
    if (!processSegment.some(msg => msg.role === 'system')) {
      processSegment.unshift(conversation[0]); // Add system prompt
    }
    
    // Skip if too few meaningful messages
    if (newMessages.filter(msg => msg.role === 'user').length < 1) {
      logger.info(`Skipping extraction - too few new user messages for user ${userId} in guild ${guildId}`);
      await updateExtractionTracking(userId, guildId, conversation.length);
      return { extracted: 0, success: true };
    }
    
    // Process this segment to extract facts
    // Get a targeted summary just for the new messages
    const summary = await enhancedSummarizeConversation(processSegment, botName);
if (!summary) {
  logger.warn(`Failed to generate incremental summary for user ${userId} in guild ${guildId}`);
  return { extracted: 0, success: false };
}

// Extract facts from this segment
const extractedFacts = await extractFactsFromSegment(userId, processSegment, guildId, botName, summary);
    
    // Skip DB operations if no new facts were extracted
    if (!extractedFacts || extractedFacts.length === 0) {
      logger.info(`No facts extracted from incremental segment for user ${userId} in guild ${guildId}`);
      // Still update tracking
      await updateExtractionTracking(userId, guildId, conversation.length);
      return { extracted: 0, success: true };
    }
    
    // Process and store the extracted facts
    const memoryResult = await processAndStoreMemories(userId, guildId, extractedFacts);
    
    // Update tracking information
    await updateExtractionTracking(userId, guildId, conversation.length);
    
    return { 
      extracted: memoryResult.stored,
      total: extractedFacts.length,
      duplicates: extractedFacts.length - memoryResult.stored,
      success: true
    };
  } catch (error) {
    logger.error(`Error in performIncrementalExtraction: ${error}`, error);
    return { extracted: 0, success: false, error: error.message };
  }
}

/**
 * Extracts facts from a conversation segment without re-summarizing
 * @param {string} userId - User ID
 * @param {Array} segment - Conversation segment
 * @param {string} guildId - Guild ID
 * @param {string} botName - Name of the bot
 * @param {string} summary - Pre-generated summary
 * @returns {Promise<Array<string>>} - Extracted facts
 */
async function extractFactsFromSegment(userId, segment, guildId, botName, summary) {
    try {
      // Check that required functions are properly imported
      if (typeof extractExplicitFacts !== 'function') {
        logger.error(`extractExplicitFacts is not a function, value: ${extractExplicitFacts}`);
        throw new Error('extractExplicitFacts is not properly imported');
      }
      
      if (typeof extractImpliedPreferences !== 'function') {
        logger.error(`extractImpliedPreferences is not a function, value: ${extractImpliedPreferences}`);
        throw new Error('extractImpliedPreferences is not properly imported');
      }
      
      if (typeof postProcessExtractedFacts !== 'function') {
        logger.error(`postProcessExtractedFacts is not a function, value: ${postProcessExtractedFacts}`);
        throw new Error('postProcessExtractedFacts is not properly imported');
      }
      
      // Use the summary we already generated to extract facts
      // This avoids calling enhancedMemoryExtraction which would summarize again
      
      // Extract explicit facts from summary
      const explicitFacts = await extractExplicitFacts(summary, botName);
      
      // Extract implied preferences with context from both summary and segment
      const impliedPreferences = await extractImpliedPreferences(summary, segment, botName);
      
      // Combine and filter extracted information
      const allExtractions = [...explicitFacts, ...impliedPreferences];
      const filteredExtractions = postProcessExtractedFacts(allExtractions, botName);
      
      return filteredExtractions;
    } catch (error) {
      logger.error(`Error extracting facts from segment: ${error}`, error);
      return [];
    }
  }

/**
 * Processes and stores extracted memories
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {Array<string>} facts - Extracted facts
 * @returns {Promise<Object>} - Results of storage operation
 */
export async function processAndStoreMemories(userId, guildId, facts) {
  try {
    // Skip if no facts
    if (!facts || facts.length === 0) {
      return { stored: 0, success: true };
    }
    
    // Apply semantic deduplication
    const uniqueFacts = await semanticDeduplication(userId, facts, guildId);
    
    if (uniqueFacts.length === 0) {
      logger.info(`All ${facts.length} extracted facts were duplicates for user ${userId} in guild ${guildId}`);
      return { stored: 0, success: true };
    }
    
    // Create memory objects
    const memoryObjects = [];
    
    for (const fact of uniqueFacts) {
      const category = categorizeMemory(fact);
      const confidence = calculateInitialConfidence(
        MemoryTypes.INTUITED,
        'conversation_extraction',
        category,
        fact
      );
      
      memoryObjects.push({
        user_id: userId,
        guild_id: guildId,
        memory_text: fact,
        memory_type: MemoryTypes.INTUITED,
        category: category,
        confidence: confidence,
        source: 'conversation_extraction',
        created_at: new Date().toISOString()
      });
    }
    
    // Get embeddings in batch
    const embeddings = await getBatchEmbeddings(uniqueFacts);
    
    // Add embeddings to memory objects
    for (let i = 0; i < memoryObjects.length; i++) {
      memoryObjects[i].embedding = embeddings[i];
    }
    
    // Insert memories
    const { data, error } = await supabase
      .from('unified_memories')
      .insert(memoryObjects)
      .select('id');
      
    if (error) {
      logger.error("Error inserting memories:", error);
      return { stored: 0, success: false, error: error.message };
    }
    
    logger.info(`Stored ${memoryObjects.length} new memories for user ${userId} in guild ${guildId}`);
    
    return {
      stored: memoryObjects.length,
      success: true
    };
  } catch (error) {
    logger.error("Error processing and storing memories:", error);
    return { stored: 0, success: false, error: error.message };
  }
}

/**
 * SQL for creating the tracking table:
 * 
 * CREATE TABLE IF NOT EXISTS memory_extraction_tracking (
 *   user_id TEXT NOT NULL,
 *   guild_id TEXT NOT NULL,
 *   last_extracted_time TIMESTAMPTZ NOT NULL,
 *   last_extracted_message_count INTEGER NOT NULL DEFAULT 0,
 *   PRIMARY KEY (user_id, guild_id)
 * );
 */