import { openai } from '../services/combinedServices.js';
const summarizationModel = "gpt-3.5-turbo"; // model for summarization tasks


/**
 * Performs a direct summarization of a conversation with enhanced preference detection.
 * Expects an array of message objects: { role: string, content: string }.
 * Returns a detailed summary that better captures preferences.
 */
export async function enhancedDirectSummarization(conversation) {
  const numMessages = conversation.length;
  const conversationText = conversation
    .slice(1)
    .map(msg => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n");
  const metadata = `Conversation metadata: total messages: ${numMessages}.`;
  
  // Enhanced prompt that better captures preferences and reactions
  const summaryPrompt = `
Please provide a detailed summary of the conversation below, focusing especially on personal information and preferences.

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

${metadata}

${conversationText}`;
  
  try {
    const summaryCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { 
          role: "system", 
          content: "You are a summarization assistant that produces very detailed summaries, with special focus on personal information and both explicit and implicit preferences. You're particularly skilled at noticing when people indicate preferences indirectly through their reactions." 
        },
        { role: "user", content: summaryPrompt }
      ],
      max_tokens: 1500,
    });
    return summaryCompletion.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error in enhanced direct summarization:", error);
    return null;
  }
}


/**
 * Performs hierarchical (chunk-based) summarization with enhanced preference detection.
 * Breaks the conversation into chunks, summarizes each with preference focus, then combines them.
 */
export async function enhancedHierarchicalSummarization(conversation) {
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
    const chunkSummary = await enhancedDirectSummarization(chunk);
    if (chunkSummary) chunkSummaries.push(chunkSummary);
  }
  const combinedChunkSummary = chunkSummaries.join("\n");
  
  const finalPrompt = `
Combine the following chunk summaries into an overall detailed summary that captures every detail from the conversation.

Focus especially on:
1. Personal information about the user
2. Both EXPLICIT preferences (directly stated likes/dislikes)
3. IMPLICIT preferences (revealed through reactions and engagement)
4. Any emotional responses to topics that might indicate interests or preferences

Ensure all preferences, both stated directly and implied through reactions, are clearly noted in your summary.

${combinedChunkSummary}`;

  try {
    const finalSummaryCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { 
          role: "system", 
          content: "You are a summarization assistant that produces comprehensive and detailed summaries, with special focus on both explicit and implicit user preferences." 
        },
        { role: "user", content: finalPrompt }
      ],
      max_tokens: 1500,
    });
    return finalSummaryCompletion.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error in enhanced hierarchical summarization:", error);
    return null;
  }
}


/**
 * Chooses the summarization method based on conversation length.
 * Uses the enhanced versions for better preference detection.
 * @param {Array} conversation - Array of message objects.
 * @returns {Promise<string>} - A detailed summary of the conversation.
 */
export async function enhancedSummarizeConversation(conversation) {
  if (conversation.length <= 11) {
    return await enhancedDirectSummarization(conversation);
  } else {
    return await enhancedHierarchicalSummarization(conversation);
  }
}
