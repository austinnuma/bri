import { openai } from '../services/openaiService.js';
import { stripCodeBlock } from './textUtils.js';
import natural from 'natural';
import { getAllMemories, MemoryTypes, insertIntuitedMemory } from './unifiedMemoryManager.js';
import { normalizeText } from './normalize.js';
import { logger } from './logger.js';

const summarizationModel = "gpt-3.5-turbo";

/**
 * Extracts key personal details from a conversation summary.
 * Uses a focused extraction approach with better categorization
 * and improved deduplication.
 *
 * @param {string} summaryText - The conversation summary text.
 * @param {string} userId - The user's ID for deduplication purposes.
 * @returns {Promise<Array<string>>} - An array of extracted details.
 */
export async function extractIntuitedMemories(summaryText, userId) {
  // More specific extraction prompt with examples of what to look for
  const extractionPrompt = `
Extract ONLY concrete facts about the user from the conversation summary below.
Focus specifically on:
- Name, age, location (city, country)
- Job title, workplace, industry
- Hobbies, interests, skills
- Preferences (foods, colors, music, movies, books)
- Family members, pets
- Important dates (birthdays, anniversaries)

DO NOT extract:
- Opinions about general topics
- Temporary states (feeling tired today)
- Bot responses or actions
- Questions the user asked
- Things the user is planning to do in the future
- Any information that isn't a clear fact about the user

Output ONLY a JSON array of simple, clear statements in the format:
["User's name is John", "User lives in Seattle", "User works as a software engineer"]

If no concrete personal facts are found, output an empty array: []
-----
SUMMARY: ${summaryText}`;
  
  try {
    // Extract facts from the summary
    const completion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { 
          role: "system", 
          content: "You extract specific personal facts about users. Be precise and factual."
        },
        { role: "user", content: extractionPrompt }
      ],
      max_tokens: 1000,
    });
    
    let output = completion.choices[0].message.content.trim();
    output = stripCodeBlock(output);
    
    let extractedFacts;
    try {
      extractedFacts = JSON.parse(output);
      if (!Array.isArray(extractedFacts)) extractedFacts = [];
    } catch (e) {
      logger.error("Error parsing extraction JSON:", e);
      extractedFacts = [];
    }
    
    // If nothing was extracted, return empty array
    if (extractedFacts.length === 0) {
      return [];
    }
    
    if (extractedFacts.length > 0) {
      await batchCreateMemories(userId, extractedFacts.map(fact => ({
        text: fact,
        type: MemoryTypes.INTUITED,
        confidence: 0.8,
        source: 'extraction'
      })));
    }

    // Deduplicate against existing memories
    const deduplicatedFacts = await deduplicateAgainstExisting(extractedFacts, userId);
    
    return deduplicatedFacts;
  } catch (error) {
    logger.error("Error extracting intuited memories:", error);
    return [];
  }
}

/**
 * Deduplicates newly extracted facts against existing memory database.
 * Uses Jaro-Winkler distance for fuzzy matching to prevent near-duplicates.
 * 
 * @param {Array<string>} newFacts - Newly extracted facts
 * @param {string} userId - User ID to fetch existing memories
 * @returns {Promise<Array<string>>} - Deduplicated facts
 */
async function deduplicateAgainstExisting(newFacts, userId) {
  // Get existing intuited memories from the unified memory table
  const existingMemories = await getAllMemories(userId, MemoryTypes.INTUITED);
  
  if (!existingMemories || existingMemories.length === 0) {
    return newFacts; // No existing memories to deduplicate against
  }
  
  // Extract just the text from existing memories
  const existingTexts = existingMemories.map(mem => mem.memory_text);
  
  // Filter out duplicates
  const SIMILARITY_THRESHOLD = 0.85;
  const uniqueFacts = newFacts.filter(newFact => {
    // Check if this fact is too similar to any existing memory
    return !existingTexts.some(existingText => {
      const similarity = natural.JaroWinklerDistance(
        normalizeForComparison(newFact),
        normalizeForComparison(existingText)
      );
      return similarity > SIMILARITY_THRESHOLD;
    });
  });
  
  return uniqueFacts;
}

/**
 * Normalizes text for better comparison by removing stopwords,
 * converting to lowercase, and removing punctuation.
 * 
 * @param {string} text - Text to normalize
 * @returns {string} - Normalized text
 */
function normalizeForComparison(text) {
  return text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}