import { openai } from '../services/combinedServices.js';
import { logger } from './logger.js';
const summarizationModel = "gpt-4o"; // using a more capable model for summarization to preserve detail


/**
 * Performs a direct summarization of a conversation with enhanced preference detection.
 * Expects an array of message objects: { role: string, content: string }.
 * Returns a detailed summary that better captures preferences.
 * @param {Array} conversation - Array of message objects
 * @param {string} botName - Name of the bot (default: "Bri")
 * @returns {Promise<string>} - A detailed summary
 */
export async function enhancedDirectSummarization(conversation, botName = "Bri") {
  const numMessages = conversation.length;
  const conversationText = conversation
    .slice(1)
    .map(msg => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n");
  const metadata = `Conversation metadata: total messages: ${numMessages}.`;
  
  // Enhanced prompt that better captures preferences, reactions, and ongoing projects
  // Added explicit bot name awareness
  const summaryPrompt = `
Please provide a highly detailed and specific summary of the conversation below, capturing as much information as possible about the user.

IMPORTANT CONTEXT: This is a conversation with a Discord bot named "${botName}". Users often address the bot as "${botName}" (e.g., "Hey ${botName}", "Hello ${botName}"). The name "${botName}" in these contexts refers to the bot, NOT to the user. DO NOT mistake references to the bot's name as indicating the user's name.

Pay special attention to:
1. Explicitly stated personal details (name, age, location, job, etc.)
2. Explicitly stated preferences (likes, dislikes, favorites)
3. IMPLICIT preferences revealed through:
   - Emotional reactions to topics (excitement, enthusiasm, disgust)
   - Positive/negative responses to suggestions or mentions
   - Level of engagement with different topics
4. ONGOING PROJECTS the user is working on:
   - Projects with persistent outcomes (setting up aquariums, building things, planning gardens, etc.)
   - Long-term activities the user is engaged in (learning languages, training for events, etc.)
   - Activities that involve multiple steps or continuing effort
   - Projects the user mentions specific details about
5. SPECIFIC DETAILS about user interests:
   - Particular brands, products, or creators they mention
   - Specific subgenres or niches they enjoy
   - Technical details or terminology they use
   - Unusual or unique interests they discuss
6. CONTEXT and CONNECTIONS between information:
   - How different interests or activities relate to each other
   - Why the user enjoys particular things (their reasoning)
   - Background information that explains their preferences or activities

EXTRACTION GUIDELINES:
- PRESERVE SPECIFICITY: Never generalize specific interests into broad categories
- EXTRACT MAXIMUM DETAIL: Include all named entities, specific terminology, and unique details 
- MAINTAIN SEPARATION: Don't combine unrelated interests or preferences
- CREATE COMPLETE STATEMENTS: Each extracted memory should be detailed and standalone

Examples of good memory extraction:
- POOR: "User likes video games"
- GOOD: "User enjoys strategy games like Civilization VI, particularly enjoying diplomatic victories and longer game sessions"

- POOR: "User is interested in science"
- GOOD: "User has a deep interest in astrophysics, particularly theoretical models of black hole formation and Stephen Hawking's radiation theories"

IMPORTANT: When users write messages like "Hey ${botName}" or "Hi ${botName}", they are addressing the bot, NOT stating their own name. DO NOT conclude that the user's name is "${botName}" based on these greetings.

${metadata}

${conversationText}`;
  
  try {
    const summaryCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { 
          role: "system", 
          content: `You are a highly precise summarization assistant that captures detailed, specific information about users from conversations. Your summaries maintain the full specificity of user interests, preferences, and activities without generalizing.

You excel at:
1. Capturing technical details, specific terminology, and named entities
2. Preserving the granularity of separate interests rather than combining them
3. Noting when people indicate preferences indirectly through their reactions
4. Identifying ongoing projects with all their specific components and technical aspects
5. Maintaining the exact context of why users like or engage with particular interests
6. Detecting expertise levels and jargon that suggest domain knowledge

When extracting information, you always preserve the full technical detail and never generalize specific interests into broader categories. You maintain distinct separation between unrelated topics rather than combining them.

Important: This is a conversation with a bot named "${botName}". DO NOT mistake references to "${botName}" (which is the bot's name) as being the user's name.` 
        },
        { role: "user", content: summaryPrompt }
      ],
      max_tokens: 1500,
    });
    
    const summary = summaryCompletion.choices[0].message.content.trim();
    
    // Log warning if summary contains potential name confusion
    if (summary.toLowerCase().includes(`name is ${botName.toLowerCase()}`) || 
        (summary.toLowerCase().includes('name') && summary.toLowerCase().includes(botName.toLowerCase()))) {
      //logger.warn(`Potential bot name misidentification in summary: ${summary.substring(0, 100)}...`);
    }
    
    return summary;
  } catch (error) {
    logger.error("Error in enhanced direct summarization:", error);
    return null;
  }
}


/**
 * Performs hierarchical (chunk-based) summarization with enhanced preference detection.
 * Breaks the conversation into chunks, summarizes each with preference focus, then combines them.
 * @param {Array} conversation - Array of message objects
 * @param {string} botName - Name of the bot (default: "Bri")
 * @returns {Promise<string>} - A detailed summary
 */
export async function enhancedHierarchicalSummarization(conversation, botName = "Bri") {
  const chunkSize = 10;
  const systemPrompt = conversation[0];
  const chunks = [];
  let currentChunk = [];
  for (let i = 1; i < conversation.length; i++) {
    currentChunk.push(conversation[i]);
    if (currentChunk.length === chunkSize || i === conversation.length - 1) {
      chunks.push([systemPrompt, ...currentChunk]);
      currentChunk = [];
    }
  }
  const chunkSummaries = [];
  for (const chunk of chunks) {
    const chunkSummary = await enhancedDirectSummarization(chunk, botName);
    if (chunkSummary) chunkSummaries.push(chunkSummary);
  }
  const combinedChunkSummary = chunkSummaries.join("\n");
  
  const finalPrompt = `
Combine the following chunk summaries into a comprehensive, highly detailed summary that preserves all specific information about the user.

IMPORTANT CONTEXT: This is a conversation with a Discord bot named "${botName}". Users often address the bot as "${botName}" (e.g., "Hey ${botName}", "Hello ${botName}"). The name "${botName}" in these contexts refers to the bot, NOT to the user. DO NOT mistake references to the bot's name as indicating the user's name.

Focus especially on:
1. Personal information about the user (with all specific details)
2. EXPLICIT preferences (directly stated likes/dislikes with their exact descriptions)
3. IMPLICIT preferences (revealed through reactions and engagement)
4. Any emotional responses to topics that might indicate interests or preferences
5. ONGOING PROJECTS the user is working on (with all technical details and specifics)
6. Long-term activities or goals the user is pursuing (with timeline and progress information)
7. Projects that involve multiple steps or continuing effort
8. Specific details about what the user is working on or planning
9. Particular brands, products, or creators they mention
10. Specific subgenres or niches they enjoy
11. Technical terminology, jargon, or specialized vocabulary they use
12. Unusual or unique interests they discuss
13. Connections between different interests or activities
14. Reasoning behind preferences or choices when mentioned

CRITICAL GUIDELINES:
- MAINTAIN GRANULARITY: Don't merge separate topics/interests into generic categories
- PRESERVE ALL SPECIFICS: Include named entities, technical terms, and unique details
- AVOID GENERALIZATIONS: Never convert specific interests into general statements
- KEEP ACCURATE CONTEXT: Preserve why/how the user engages with their interests
- MAINTAIN NUANCE: Include user's opinions and the degree of their interests

IMPORTANT: When users write messages like "Hey ${botName}" or "Hi ${botName}", they are addressing the bot, NOT stating their own name. DO NOT conclude that the user's name is "${botName}" based on these greetings.

${combinedChunkSummary}`;

  try {
    const finalSummaryCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { 
          role: "system", 
          content: `You are a highly precise summarization assistant that creates detailed, specific summaries of conversations. You excel at combining information from multiple sources while preserving all granular details and specific information.

Your strengths include:
1. Maintaining the full technical specificity and terminology used by the user
2. Keeping separate topics and interests distinct rather than merging them
3. Preserving exact details about brands, creators, products, and named entities
4. Capturing the specific aspects of projects including technical components and methods
5. Retaining information about why users like certain things, not just what they like
6. Identifying patterns of interest across different topics without over-generalizing them
7. Recognizing specialized vocabulary that indicates expertise in particular domains

When combining information, you NEVER sacrifice specificity for brevity. You preserve the full technical detail and contextual information of each interest or project mentioned. 

Important: This is a conversation with a bot named "${botName}". DO NOT mistake references to "${botName}" (which is the bot's name) as being the user's name.` 
        },
        { role: "user", content: finalPrompt }
      ],
      max_tokens: 1500,
    });
    
    const summary = finalSummaryCompletion.choices[0].message.content.trim();
    
    // Log warning if summary contains potential name confusion
    if (summary.toLowerCase().includes(`name is ${botName.toLowerCase()}`) || 
        (summary.toLowerCase().includes('name') && summary.toLowerCase().includes(botName.toLowerCase()))) {
      //logger.warn(`Potential bot name misidentification in hierarchical summary: ${summary.substring(0, 100)}...`);
    }
    
    return summary;
  } catch (error) {
    logger.error("Error in enhanced hierarchical summarization:", error);
    return null;
  }
}


/**
 * Chooses the summarization method based on conversation length.
 * Uses the enhanced versions for better preference detection.
 * @param {Array} conversation - Array of message objects.
 * @param {string} botName - Name of the bot (default: "Bri")
 * @returns {Promise<string>} - A detailed summary of the conversation.
 */
export async function enhancedSummarizeConversation(conversation, botName = "Bri") {
  if (conversation.length <= 11) {
    return await enhancedDirectSummarization(conversation, botName);
  } else {
    return await enhancedHierarchicalSummarization(conversation, botName);
  }
}