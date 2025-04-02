// memoryVerification.js
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { verifyMemory, markMemoryContradicted } from './memoryConfidence.js';
import { getEmbedding } from './improvedEmbeddings.js';
import natural from 'natural';

/**
 * Gets memories that need verification for a user
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<Array>} - Memories due for verification
 */
export async function getMemoriesForVerification(userId, guildId) {
  try {
    // Get unverified memories with medium confidence
    const { data: memories, error } = await supabase
      .from('unified_memories')
      .select('id, memory_text, confidence, category, created_at')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .eq('verified', false)
      .eq('memory_type', 'intuited')
      .gte('confidence', 0.4)
      .lte('confidence', 0.8)
      .order('created_at', { ascending: false })
      .limit(3);
      
    if (error) {
      logger.error("Error fetching memories for verification:", error);
      return [];
    }
    
    return memories || [];
  } catch (error) {
    logger.error("Error in getMemoriesForVerification:", error);
    return [];
  }
}

/**
 * Generates a natural verification question for a memory
 * @param {Object} memory - Memory object
 * @returns {string} - A natural-sounding question to verify the memory
 */
export function generateVerificationQuestion(memory) {
  try {
    const text = memory.memory_text;
    
    // Remove "User" prefix if present
    const cleanedText = text.replace(/^User\s+/i, '');
    
    // Different question templates based on category
    switch (memory.category) {
      case 'personal':
        return `I think I remember that ${cleanedText}. Is that right?`;
      case 'preferences':
        if (cleanedText.includes('enjoys') || cleanedText.includes('likes')) {
          return `Do you really ${cleanedText.toLowerCase().replace('user enjoys', '').replace('user likes', 'like')}?`;
        }
        return `I remember you mentioned that ${cleanedText}. Is that accurate?`;
      case 'hobbies':
        return `I recall that ${cleanedText}. Do you still do that?`;
      case 'professional':
        return `I believe you mentioned that ${cleanedText}. Is that correct?`;
      default:
        return `I seem to remember that ${cleanedText}. Is that right?`;
    }
  } catch (error) {
    logger.error("Error generating verification question:", error);
    return `Is it true that ${memory.memory_text}?`;
  }
}

/**
 * Checks if a user's response confirms or contradicts a memory
 * @param {string} userResponse - The user's response text
 * @param {Object} memory - The memory being verified
 * @returns {Object} - Result with confirmation status and confidence
 */
export async function analyzeVerificationResponse(userResponse, memory) {
  try {
    // First, check for simple affirmative/negative responses
    const response = userResponse.toLowerCase();
    
    // Check for explicit confirmations
    const confirmPatterns = [
      /^yes/i, /^yeah/i, /^yep/i, /^correct/i, /^right/i, /^that's right/i,
      /^that is right/i, /^exactly/i, /^true/i, /^affirmative/i, /^indeed/i
    ];
    
    const isExplicitConfirm = confirmPatterns.some(pattern => pattern.test(response));
    
    if (isExplicitConfirm) {
      return {
        isConfirmed: true,
        confidence: 0.95,
        correctedText: null
      };
    }
    
    // Check for explicit contradictions
    const denyPatterns = [
      /^no/i, /^nope/i, /^nah/i, /^incorrect/i, /^wrong/i, /^that's wrong/i,
      /^that is wrong/i, /^not true/i, /^negative/i, /^never/i, /^not at all/i
    ];
    
    const isExplicitDeny = denyPatterns.some(pattern => pattern.test(response));
    
    if (isExplicitDeny) {
      // Try to extract corrected information
      const potentialCorrection = extractCorrectedInformation(userResponse, memory);
      
      return {
        isConfirmed: false,
        confidence: 0.9, // High confidence in contradiction
        correctedText: potentialCorrection
      };
    }
    
    // For more complex responses, calculate similarity
    const memory_embedding = await getEmbedding(memory.memory_text);
    const response_embedding = await getEmbedding(userResponse);
    
    // Calculate cosine similarity using dot product
    let similarity = 0;
    for (let i = 0; i < memory_embedding.length; i++) {
      similarity += memory_embedding[i] * response_embedding[i];
    }
    
    // Determine if it's a confirmation or contradiction
    if (similarity > 0.7) {
      return {
        isConfirmed: true,
        confidence: Math.min(0.9, similarity), // Cap at 0.9
        correctedText: null
      };
    } else if (similarity < 0.3) {
      // Try to extract corrected information
      const potentialCorrection = extractCorrectedInformation(userResponse, memory);
      
      return {
        isConfirmed: false,
        confidence: 0.7,
        correctedText: potentialCorrection
      };
    } else {
      // Ambiguous response
      return {
        isConfirmed: null, // Ambiguous
        confidence: 0.5,
        correctedText: null
      };
    }
  } catch (error) {
    logger.error("Error analyzing verification response:", error);
    return {
      isConfirmed: null,
      confidence: 0.5,
      correctedText: null
    };
  }
}

/**
 * Attempts to extract corrected information from a user's denial
 * @param {string} userResponse - The user's response text
 * @param {Object} memory - The memory being verified
 * @returns {string|null} - The corrected information or null
 */
function extractCorrectedInformation(userResponse, memory) {
  try {
    // Common correction patterns
    const correctionPatterns = [
      /actually,?\s+(.*)/i,
      /no,?\s+(.*)/i,
      /it\'s\s+(.*)/i,
      /it is\s+(.*)/i,
      /i\s+(.*)/i
    ];
    
    for (const pattern of correctionPatterns) {
      const match = userResponse.match(pattern);
      if (match && match[1]) {
        // Construct a proper memory text from the correction
        const correctedPart = match[1].trim();
        
        // If the memory was about preferences
        if (memory.category === 'preferences') {
          if (memory.memory_text.includes('likes')) {
            return `User likes ${correctedPart}`;
          } else if (memory.memory_text.includes('enjoys')) {
            return `User enjoys ${correctedPart}`;
          } else if (memory.memory_text.includes('prefers')) {
            return `User prefers ${correctedPart}`;
          }
        }
        
        // If the memory was about a job
        if (memory.category === 'professional' && memory.memory_text.includes('works')) {
          return `User works as ${correctedPart}`;
        }
        
        // General case - get the verb from the original memory if possible
        const originalVerbs = ['is', 'has', 'lives', 'works', 'studies', 'likes', 'loves', 'hates', 'prefers'];
        for (const verb of originalVerbs) {
          if (memory.memory_text.includes(` ${verb} `)) {
            return `User ${verb} ${correctedPart}`;
          }
        }
        
        // Fallback
        return `User ${correctedPart}`;
      }
    }
    
    return null;
  } catch (error) {
    logger.error("Error extracting corrected information:", error);
    return null;
  }
}

/**
 * Processes a user's response to a verification question
 * @param {string} userId - The user ID
 * @param {number} memoryId - The memory ID
 * @param {string} userResponse - The user's response
 * @param {string} guildId - The guild ID
 * @returns {Promise<Object>} - Result of the verification
 */
export async function processVerificationResponse(userId, memoryId, userResponse, guildId) {
  try {
    // Get the memory being verified
    const { data: memory, error } = await supabase
      .from('unified_memories')
      .select('*')
      .eq('id', memoryId)
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error || !memory) {
      logger.error("Error fetching memory for verification:", error);
      return { success: false, error: "Memory not found" };
    }
    
    // Analyze the user's response
    const analysis = await analyzeVerificationResponse(userResponse, memory);
    
    if (analysis.isConfirmed === true) {
      // User confirmed the memory
      await verifyMemory(memoryId, 'explicit_confirmation');
      
      return {
        success: true,
        action: 'verified',
        memory: memory.memory_text
      };
    } else if (analysis.isConfirmed === false) {
      // User contradicted the memory
      await markMemoryContradicted(memoryId);
      
      // If there's a correction, create a new memory
      if (analysis.correctedText) {
        // Create a new memory with the corrected information
        const newMemory = await createCorrectedMemory(
          userId,
          analysis.correctedText,
          memory.category,
          guildId
        );
        
        return {
          success: true,
          action: 'corrected',
          oldMemory: memory.memory_text,
          newMemory: analysis.correctedText
        };
      }
      
      return {
        success: true,
        action: 'contradicted',
        memory: memory.memory_text
      };
    } else {
      // Ambiguous response, no action taken
      return {
        success: true,
        action: 'ambiguous',
        memory: memory.memory_text
      };
    }
  } catch (error) {
    logger.error("Error processing verification response:", error);
    return { success: false, error: "Error processing verification" };
  }
}

/**
 * Creates a new memory with corrected information
 * @param {string} userId - User ID
 * @param {string} memoryText - Corrected memory text
 * @param {string} category - Memory category
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - The created memory
 */
async function createCorrectedMemory(userId, memoryText, category, guildId) {
  try {
    // Get embedding for the new memory
    const embedding = await getEmbedding(memoryText);
    
    // Insert the corrected memory
    const { data, error } = await supabase
      .from('unified_memories')
      .insert({
        user_id: userId,
        guild_id: guildId,
        memory_text: memoryText,
        memory_type: 'explicit', // Corrected memories are explicit
        category: category,
        confidence: 0.95, // High confidence for corrections
        verified: true,
        verification_date: new Date().toISOString(),
        verification_source: 'user_correction',
        embedding: embedding
      })
      .select()
      .single();
      
    if (error) {
      logger.error("Error creating corrected memory:", error);
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error("Error in createCorrectedMemory:", error);
    return null;
  }
}

/**
 * Schedules memory verification by adding verification opportunities to conversation
 * @param {Object} personality - The bot's personality traits
 * @param {number} maxQuestionsPerDay - Maximum questions to ask per day
 */
export function scheduleVerificationQuestions(personality = {}, maxQuestionsPerDay = 2) {
  // Implementation for scheduling verification questions
  // This would be integrated with the main conversation system
  // to occasionally insert verification questions
}