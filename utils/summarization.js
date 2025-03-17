import { openai } from '../services/combinedServices.js';
import { logger } from './logger.js';
const summarizationModel = "gpt-3.5-turbo"; // model for summarization tasks


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
  
  // Enhanced prompt that better captures preferences and reactions
  // Added explicit bot name awareness
  const summaryPrompt = `
Please provide a detailed summary of the conversation below, focusing especially on personal information and preferences.

IMPORTANT CONTEXT: This is a conversation with a Discord bot named "${botName}". Users often address the bot as "${botName}" (e.g., "Hey ${botName}", "Hello ${botName}"). The name "${botName}" in these contexts refers to the bot, NOT to the user. DO NOT mistake references to the bot's name as indicating the user's name.

Pay special attention to:
1. Explicitly stated personal details (name, age, location, job, etc.)
2. Explicitly stated preferences (likes, dislikes, favorites)
3. IMPLICIT preferences revealed through:
   - Emotional reactions to topics (excitement, enthusiasm, disgust)
   - Positive/negative responses to suggestions or mentions
   - Level of engagement with different topics

For example:
- If user responds "that sounds delicious!" to cookies → note "User enjoys cookies"
- If user shows enthusiasm when discussing a topic → note their interest
- If user responds negatively to a suggestion → note their dislike

IMPORTANT: When users write messages like "Hey ${botName}" or "Hi ${botName}", they are addressing the bot, NOT stating their own name. DO NOT conclude that the user's name is "${botName}" based on these greetings.

${metadata}

${conversationText}`;
  
  try {
    const summaryCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { 
          role: "system", 
          content: `You are a summarization assistant that produces very detailed summaries, with special focus on personal information and both explicit and implicit preferences. You're particularly skilled at noticing when people indicate preferences indirectly through their reactions. Important: This is a conversation with a bot named "${botName}". DO NOT mistake references to "${botName}" (which is the bot's name) as being the user's name.` 
        },
        { role: "user", content: summaryPrompt }
      ],
      max_tokens: 1500,
    });
    
    const summary = summaryCompletion.choices[0].message.content.trim();
    
    // Log warning if summary contains potential name confusion
    if (summary.toLowerCase().includes(`name is ${botName.toLowerCase()}`) || 
        (summary.toLowerCase().includes('name') && summary.toLowerCase().includes(botName.toLowerCase()))) {
      logger.warn(`Potential bot name misidentification in summary: ${summary.substring(0, 100)}...`);
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
Combine the following chunk summaries into an overall detailed summary that captures every detail from the conversation.

IMPORTANT CONTEXT: This is a conversation with a Discord bot named "${botName}". Users often address the bot as "${botName}" (e.g., "Hey ${botName}", "Hello ${botName}"). The name "${botName}" in these contexts refers to the bot, NOT to the user. DO NOT mistake references to the bot's name as indicating the user's name.

Focus especially on:
1. Personal information about the user
2. Both EXPLICIT preferences (directly stated likes/dislikes)
3. IMPLICIT preferences (revealed through reactions and engagement)
4. Any emotional responses to topics that might indicate interests or preferences

Ensure all preferences, both stated directly and implied through reactions, are clearly noted in your summary.

IMPORTANT: When users write messages like "Hey ${botName}" or "Hi ${botName}", they are addressing the bot, NOT stating their own name. DO NOT conclude that the user's name is "${botName}" based on these greetings.

${combinedChunkSummary}`;

  try {
    const finalSummaryCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { 
          role: "system", 
          content: `You are a summarization assistant that produces comprehensive and detailed summaries, with special focus on both explicit and implicit user preferences. Important: This is a conversation with a bot named "${botName}". DO NOT mistake references to "${botName}" (which is the bot's name) as being the user's name.` 
        },
        { role: "user", content: finalPrompt }
      ],
      max_tokens: 1500,
    });
    
    const summary = finalSummaryCompletion.choices[0].message.content.trim();
    
    // Log warning if summary contains potential name confusion
    if (summary.toLowerCase().includes(`name is ${botName.toLowerCase()}`) || 
        (summary.toLowerCase().includes('name') && summary.toLowerCase().includes(botName.toLowerCase()))) {
      logger.warn(`Potential bot name misidentification in hierarchical summary: ${summary.substring(0, 100)}...`);
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