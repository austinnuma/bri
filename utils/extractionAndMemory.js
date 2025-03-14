
import { openai, defaultAskModel, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { replaceEmoticons, stripCodeBlock, normalizeText } from './textUtils.js';
import natural from 'natural';
import { retrieveRelevantMemories } from './unifiedMemoryManager.js';
import { enhancedSummarizeConversation } from './summarization.js';


/**
 * Post-processes extracted facts to remove invalid or low-quality memories
 * while preserving legitimate negative preferences
 * @param {Array<string>} facts - The extracted facts
 * @returns {Array<string>} - Filtered and improved facts
 */
function postProcessExtractedFacts(facts) {
  // Filter out problematic patterns
  const filteredFacts = facts.filter(fact => {
    const lowercaseFact = fact.toLowerCase();
    
    // Filter out "not provided" statements (meta-statements about missing info)
    if (lowercaseFact.includes('not provided') || 
        lowercaseFact.includes('unknown') || 
        lowercaseFact.includes('doesn\'t mention') ||
        lowercaseFact.includes('did not mention') ||
        lowercaseFact.includes('no information')) {
      return false;
    }
    
    // Filter out uncertain statements
    if (lowercaseFact.includes('might be') || 
        lowercaseFact.includes('possibly') ||
        lowercaseFact.includes('probably') ||
        lowercaseFact.includes('could be') ||
        lowercaseFact.includes('may have')) {
      return false;
    }
    
    // Special case for negative preferences vs meta-statements
    // Keep legitimate negative preferences while filtering meta-statements
    if (lowercaseFact.includes('didn\'t') || 
        lowercaseFact.includes('did not') ||
        lowercaseFact.includes('doesn\'t') ||
        lowercaseFact.includes('does not') ||
        lowercaseFact.includes('has not')) {
      
      // Preserve negative preferences about specific things
      const isNegativePreference = 
        (lowercaseFact.includes('like') || 
         lowercaseFact.includes('enjoy') ||
         lowercaseFact.includes('prefer') ||
         lowercaseFact.includes('want') ||
         lowercaseFact.includes('care for'));
         
      // Also preserve negative facts about allergies, dietary restrictions, etc.
      const isRelevantNegativeFact =
        (lowercaseFact.includes('allergic') ||
         lowercaseFact.includes('eat') ||
         lowercaseFact.includes('drink') ||
         lowercaseFact.includes('own') ||
         lowercaseFact.includes('have'));
      
      return isNegativePreference || isRelevantNegativeFact;
    }
    
    // Ensure fact has some substance (more than just "User is" or similar)
    if (lowercaseFact.length < 12) {
      return false;
    }
    
    return true;
  });
  
  // Normalize and improve the remaining facts
  return filteredFacts.map(fact => {
    // Ensure facts start with "User" for consistency
    if (!fact.toLowerCase().startsWith('user')) {
      fact = 'User ' + fact;
    }
    
    return fact;
  });
}


/**
 * Two-stage memory extraction that first summarizes then infers preferences
 * @param {string} userId - User ID
 * @param {Array} conversation - Conversation history
 * @returns {Promise<Array<string>>} - Extracted memories
 */
export async function enhancedMemoryExtraction(userId, conversation) {
  try {
    logger.info(`Running enhanced two-stage memory extraction for user ${userId}`);
    
    // Step 1: Generate conversation summary
    const summary = await enhancedSummarizeConversation(conversation);
    if (!summary) {
      logger.warn(`Failed to generate summary for user ${userId}`);
      return [];
    }
    
    // Step 2: Extract explicit facts from summary
    const explicitFacts = await extractExplicitFacts(summary);
    
    // Step 3: Extract implied preferences and reactions
    const impliedPreferences = await extractImpliedPreferences(summary, conversation);
    
    // Combine all extracted information
    const allExtractions = [...explicitFacts, ...impliedPreferences];
    
    // Post-process to filter, normalize, and deduplicate
    const filteredExtractions = postProcessExtractedFacts(allExtractions);
    const deduplicatedFacts = await deduplicateAgainstExisting(filteredExtractions, userId);
    
    logger.info(`Extracted ${deduplicatedFacts.length} memories for user ${userId}`);
    return deduplicatedFacts;
  } catch (error) {
    logger.error(`Error in enhanced memory extraction for user ${userId}:`, error);
    return [];
  }
}

/**
 * Extracts explicit facts from summary
 * @param {string} summary - Conversation summary
 * @returns {Promise<Array<string>>} - Extracted explicit facts
 */
async function extractExplicitFacts(summary) {
  const explicitPrompt = `
Extract ONLY clearly stated, explicit facts about the user from this conversation summary.
Focus on biographical information, concrete details, and directly stated preferences.

Include:
- Biographical information (name, age, location, etc.)
- Professional information (job, education, etc.)
- Clearly stated likes/dislikes ("I love pizza", "I hate horror movies")
- Family details, pets
- Concrete hobbies and activities they engage in

Exclude:
- Implied preferences without direct statements
- Uncertain information (might, maybe, possibly)
- Hypothetical statements
- Negative information (what they don't have/like)
- Meta-statements about missing information

Output ONLY a JSON array of facts:
["User's name is John", "User works as a software engineer"]

If no explicit facts are found, output an empty array: []
-----
SUMMARY: ${summary}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You extract only explicit, clearly stated facts about users. Be precise and factual."
        },
        { role: "user", content: explicitPrompt }
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
      logger.error("Error parsing explicit facts JSON:", e);
      extractedFacts = [];
    }
    
    return extractedFacts;
  } catch (error) {
    logger.error("Error extracting explicit facts:", error);
    return [];
  }
}

/**
 * Extracts implied preferences from conversation context
 * @param {string} summary - Conversation summary
 * @param {Array} conversation - Original conversation
 * @returns {Promise<Array<string>>} - Extracted implied preferences
 */
async function extractImpliedPreferences(summary, conversation) {
  // Extract user messages for context
  const userMessages = conversation
    .filter(msg => msg.role === "user")
    .map(msg => msg.content)
    .join("\n");
  
  const preferencePrompt = `
Analyze this conversation summary and user messages to identify IMPLIED preferences and interests.
Look for:

1. Emotional reactions to topics (positive or negative)
2. Engagement patterns (what topics the user engages with enthusiastically)
3. Subtle cues about likes/dislikes without direct statements
4. Food, entertainment, or activity preferences based on context
5. Values and priorities revealed through conversation

Examples of good inferences:
- If user responds positively to cookies → "User enjoys cookies"
- If user asks detailed questions about a topic → "User is interested in [topic]"
- If user mentions watching a show multiple times → "User enjoys [show]"

Do NOT include:
- Anything already covered in explicit facts
- General opinions unrelated to personal preferences
- Highly uncertain inferences
- "Not provided" statements

Output ONLY a JSON array of inferred preferences:
["User enjoys action movies", "User is interested in astronomy"]

If no preferences can be confidently inferred, output an empty array: []
-----
SUMMARY: ${summary}

USER MESSAGES: ${userMessages}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You extract implied preferences and interests from conversations. Be insightful but reasonably confident in your inferences."
        },
        { role: "user", content: preferencePrompt }
      ],
      max_tokens: 1000,
    });
    
    let output = completion.choices[0].message.content.trim();
    output = stripCodeBlock(output);
    
    let extractedPreferences;
    try {
      extractedPreferences = JSON.parse(output);
      if (!Array.isArray(extractedPreferences)) extractedPreferences = [];
    } catch (e) {
      logger.error("Error parsing implied preferences JSON:", e);
      extractedPreferences = [];
    }
    
    return extractedPreferences;
  } catch (error) {
    logger.error("Error extracting implied preferences:", error);
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
  // Fetch existing memories (both explicit and intuited)
  const existingMemories = await retrieveRelevantMemories(userId);
  
  if (!existingMemories || existingMemories.trim() === "") {
    return newFacts; // No existing memories to deduplicate against
  }
  
  // Convert existing memories to an array
  const existingTexts = existingMemories.split('\n');
  
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