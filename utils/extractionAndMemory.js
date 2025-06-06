
import { openai, defaultAskModel, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { replaceEmoticons, stripCodeBlock, normalizeText } from './textUtils.js';
import natural from 'natural';
import { retrieveRelevantMemories } from './unifiedMemoryManager.js';
import { enhancedSummarizeConversation } from './summarization.js';
import { semanticDeduplication } from './memoryDeduplication.js';


/**
 * Post-processes extracted facts to remove invalid or low-quality memories
 * while preserving legitimate negative preferences
 * @param {Array<string>} facts - The extracted facts
 * @param {string} botName - The name of the bot (e.g., "Bri")
 * @returns {Array<string>} - Filtered and improved facts
 */
export function postProcessExtractedFacts(facts, botName = "Bri") {
  // Convert bot name to lowercase for case-insensitive comparison
  const botNameLower = botName.toLowerCase();
  
  // Filter out problematic patterns
  const filteredFacts = facts.filter(fact => {
    const lowercaseFact = fact.toLowerCase();
    
    // Filter out potential bot name misidentification
    // Only keep "User's name is Bri" if it contains strong evidence markers
    if (lowercaseFact.includes(`name is ${botNameLower}`) || 
        lowercaseFact.includes(`named ${botNameLower}`) ||
        (lowercaseFact.includes('name') && lowercaseFact.includes(botNameLower))) {
      
      // Check if there's strong evidence this is correct (e.g., direct quotation)
      const hasStrongEvidence = 
        lowercaseFact.includes('explicitly stated') || 
        lowercaseFact.includes(`"my name is ${botNameLower}"`) ||
        lowercaseFact.includes(`'my name is ${botNameLower}'`);
      
      if (!hasStrongEvidence) {
        logger.warn(`Filtered out likely incorrect name identification: "${fact}"`);
        return false;
      }
    }
    
    // Filter out "not provided" statements (meta-statements about missing info)
    if (lowercaseFact.includes('not provided') || 
        lowercaseFact.includes('unknown') || 
        lowercaseFact.includes('doesn\'t mention') ||
        lowercaseFact.includes('did not mention') ||
        lowercaseFact.includes('no information')) {
      return false;
    }
    
    // Filter out uncertain statements (but be more permissive for ongoing projects)
    const isProjectRelated = 
      lowercaseFact.includes('working on') || 
      lowercaseFact.includes('setting up') ||
      lowercaseFact.includes('building') ||
      lowercaseFact.includes('creating') ||
      lowercaseFact.includes('developing') ||
      lowercaseFact.includes('planning') ||
      lowercaseFact.includes('installing') ||
      lowercaseFact.includes('starting') ||
      lowercaseFact.includes('aquarium') ||
      lowercaseFact.includes('garden') ||
      lowercaseFact.includes('learning') ||
      lowercaseFact.includes('studying');
      
    // If it's project-related, be more lenient with uncertainties
    if (!isProjectRelated && (
        lowercaseFact.includes('might be') || 
        lowercaseFact.includes('possibly') ||
        lowercaseFact.includes('probably') ||
        lowercaseFact.includes('could be') ||
        lowercaseFact.includes('may have'))) {
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
 * @param {string} guildId - Guild ID for multi-server support
 * @param {string} botName - Name of the bot (default: "Bri")
 * @returns {Promise<Array<string>>} - Extracted memories
 */
export async function enhancedMemoryExtraction(userId, conversation, guildId, botName = "Bri") {
  try {
    logger.info(`Running enhanced two-stage memory extraction for user ${userId} in guild ${guildId}`);
    
    // Step 1: Generate conversation summary
    // Pass bot name to summarization function if it supports it
    const summary = await enhancedSummarizeConversation(conversation, botName);
    if (!summary) {
      logger.warn(`Failed to generate summary for user ${userId} in guild ${guildId}`);
      return [];
    }
    
    // Step 2: Extract explicit facts from summary with bot name awareness
    const explicitFacts = await extractExplicitFacts(summary, botName);
    
    // Step 3: Extract implied preferences and reactions with bot name awareness
    const impliedPreferences = await extractImpliedPreferences(summary, conversation, botName);
    
    // Combine all extracted information
    const allExtractions = [...explicitFacts, ...impliedPreferences];
    
    // Post-process to filter, normalize, and deduplicate
    // Make sure to pass the botName parameter here
    const filteredExtractions = postProcessExtractedFacts(allExtractions, botName);
    const deduplicatedFacts = await deduplicateAgainstExisting(filteredExtractions, userId, guildId);
    
    logger.info(`Extracted ${deduplicatedFacts.length} memories for user ${userId} in guild ${guildId}`);
    return deduplicatedFacts;
  } catch (error) {
    logger.error(`Error in enhanced memory extraction for user ${userId}: ${error}`, error);
    return [];
  }
}

/**
 * Extracts explicit facts from summary
 * @param {string} summary - Conversation summary
 * @param {string} botName - Name of the bot (default: "Bri")
 * @returns {Promise<Array<string>>} - Extracted explicit facts
 */
export async function extractExplicitFacts(summary, botName = "Bri") {
  const explicitPrompt = `
Extract ONLY clearly stated, explicit facts about the user from this conversation summary.
Focus on biographical information, concrete details, directly stated preferences, and ONGOING PROJECTS OR ACTIVITIES.

IMPORTANT: This conversation is with a Discord bot named "${botName}". The name "${botName}" often appears when users are addressing the bot (e.g., "Hey ${botName}", "Hello ${botName}"). DO NOT extract "${botName}" as the user's name unless there is explicit evidence that the user has directly stated "My name is ${botName}" or similar unambiguous declaration.

Include:
- Biographical information (name, age, location, etc.)
- Professional information (job, education, etc.)
- Clearly stated likes/dislikes ("I love pizza", "I hate horror movies")
- Family details, pets
- Concrete hobbies and activities they engage in
- ONGOING PROJECTS the user is working on (examples: setting up an aquarium, renovating a home, building a PC, learning a language, creating a garden)
- LONG-TERM ACTIVITIES or GOALS the user is pursuing (examples: training for a marathon, working on a certification, developing an app)
- SPECIFIC PLANS the user has made or is making (examples: planning a trip, organizing an event)

Especially focus on identifying activities where:
- The user is actively working on something that will persist (not temporary activities like "eating dinner")
- The user might refer back to this project/activity in future conversations
- The project/activity involves multiple steps or ongoing effort
- The user has mentioned specific details about what they're working on

Exclude:
- Implied preferences without direct statements
- Uncertain information (might, maybe, possibly)
- Hypothetical statements
- Meta-statements about missing information
- References to "${botName}" when users are addressing the bot
- Temporary activities with no lasting outcome (like "User is watching TV" or "User had coffee")

Output ONLY a JSON array of facts:
["User's name is John", "User works as a software engineer", "User is setting up a 20-gallon planted aquarium"]

If no explicit facts are found, output an empty array: []
-----
SUMMARY: ${summary}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Using more capable model for critical memory extraction
      messages: [
        { 
          role: "system", 
          content: `You extract explicit, clearly stated facts about users, with special attention to ongoing projects and activities. Be precise and factual but don't miss details about what the user is currently working on (like setting up an aquarium, building a garden, learning a skill, etc.). This conversation is with a bot named "${botName}". Be careful not to extract "${botName}" as the user's name when it appears in greetings to the bot.`
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
 * @param {string} botName - Name of the bot (default: "Bri")
 * @returns {Promise<Array<string>>} - Extracted implied preferences
 */
export async function extractImpliedPreferences(summary, conversation, botName = "Bri") {
  // Extract user messages for context
  const userMessages = conversation
    .filter(msg => msg.role === "user")
    .map(msg => msg.content)
    .join("\n");
  
  const preferencePrompt = `
Analyze this conversation summary and user messages to identify IMPLIED preferences, interests, AND ONGOING PROJECTS OR ACTIVITIES.

IMPORTANT: This conversation is with a Discord bot named "${botName}". Many messages will start with phrases like "Hey ${botName}" or "Hi ${botName}" which are addressing the bot, not referring to the user. DO NOT infer that the user's name is ${botName} based on these greetings.

Look for:
1. Emotional reactions to topics (positive or negative)
2. Engagement patterns (what topics the user engages with enthusiastically)
3. Subtle cues about likes/dislikes without direct statements
4. Food, entertainment, or activity preferences based on context
5. Values and priorities revealed through conversation
6. ONGOING PROJECTS the user mentions or discusses (even if mentioned in passing)
7. LONG-TERM ACTIVITIES the user seems committed to
8. Specific details about projects that indicate the user is actively working on them

Examples of good inferences:
- If user responds positively to cookies → "User enjoys cookies"
- If user asks detailed questions about a topic → "User is interested in [topic]"
- If user mentions watching a show multiple times → "User enjoys [show]"
- If user mentions researching fish for an aquarium → "User is setting up an aquarium"
- If user asks about different types of plants → "User is working on a garden project"
- If user discusses progress on a task → "User is working on [project]"

Especially focus on identifying activities where:
- The user is actively working on something that will persist over time
- The user might refer back to this project/activity in future conversations
- The project/activity involves multiple steps or ongoing effort
- The user has mentioned specific details about what they're working on

Do NOT include:
- Anything already covered in explicit facts
- General opinions unrelated to personal preferences
- Highly uncertain inferences
- "Not provided" statements
- Any inference that the user's name is "${botName}" based on greetings to the bot
- Temporary activities with no lasting outcome (like "User is watching TV" or "User had coffee")

Output ONLY a JSON array of inferred preferences and projects:
["User enjoys action movies", "User is interested in astronomy", "User is setting up a freshwater aquarium"]

If no preferences or projects can be confidently inferred, output an empty array: []
-----
SUMMARY: ${summary}

USER MESSAGES: ${userMessages}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Using more capable model for extracting implied preferences
      messages: [
        { 
          role: "system", 
          content: `You extract implied preferences, interests, and ongoing projects/activities from conversations. Look for any signs that the user is working on something (like setting up an aquarium, building a garden, renovating, etc.) or engaged in a long-term activity (learning a skill, training for something, etc.). Be insightful but reasonably confident in your inferences. This conversation is with a bot named "${botName}". Be careful not to extract "${botName}" as the user's name when it appears in greetings to the bot.`
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
 * Uses semantic deduplication instead of string similarity
 * @param {Array<string>} newFacts - Newly extracted facts
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<Array<string>>} - Deduplicated facts
 */
async function deduplicateAgainstExisting(newFacts, userId, guildId) {
  return await semanticDeduplication(userId, newFacts, guildId);
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