import OpenAI from 'openai';
const summarizationModel = "gpt-3.5-turbo"; // model for summarization tasks

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Performs a direct summarization of a conversation.
 * Expects an array of message objects: { role: string, content: string }.
 * Returns a detailed summary.
 */
export async function directSummarization(conversation) {
  const numMessages = conversation.length;
  const conversationText = conversation
    .slice(1)
    .map(msg => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n");
  const metadata = `Conversation metadata: total messages: ${numMessages}.`;
  const summaryPrompt = `Please provide a detailed summary of the conversation below, including any personal details, interests, job information, preferences, and any other relevant information—even if some details seem trivial.\n\n${metadata}\n\n${conversationText}`;
  
  try {
    const summaryCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { role: "system", content: "You are a summarization assistant that produces very detailed summaries including all possible information." },
        { role: "user", content: summaryPrompt }
      ],
      max_tokens: 1500,
    });
    return summaryCompletion.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error in direct summarization:", error);
    return null;
  }
}

/**
 * Performs hierarchical (chunk-based) summarization.
 * Breaks the conversation into chunks, summarizes each, then combines them.
 */
export async function hierarchicalSummarization(conversation) {
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
    const chunkSummary = await directSummarization(chunk);
    if (chunkSummary) chunkSummaries.push(chunkSummary);
  }
  const combinedChunkSummary = chunkSummaries.join("\n");
  const finalPrompt = `Combine the following chunk summaries into an overall detailed summary that captures every detail from the conversation, including any personal information:\n\n${combinedChunkSummary}`;
  try {
    const finalSummaryCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { role: "system", content: "You are a summarization assistant that produces comprehensive and detailed summaries." },
        { role: "user", content: finalPrompt }
      ],
      max_tokens: 1500,
    });
    return finalSummaryCompletion.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error in hierarchical summarization:", error);
    return null;
  }
}

/**
 * Chooses the summarization method based on conversation length.
 * @param {Array} conversation - Array of message objects.
 * @returns {Promise<string>} - A detailed summary of the conversation.
 */
export async function summarizeConversation(conversation) {
  if (conversation.length <= 11) {
    return await directSummarization(conversation);
  } else {
    return await hierarchicalSummarization(conversation);
  }
}
