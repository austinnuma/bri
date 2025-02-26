import { 
    getEffectiveSystemPrompt, 
    getCombinedSystemPromptWithVectors, 
    processMemoryCommand, 
    memoryManagerState, 
    defaultContextLength, 
    STATIC_CORE_PROMPT 
} from './memoryManager.js';
import { splitMessage, replaceEmoticons } from './textUtils.js';
import { openai, defaultAskModel } from '../services/openaiService.js';
import { supabase } from '../services/supabaseService.js';
import { logger } from './logger.js';
import { extractIntuitedMemories } from './extraction.js';
import { insertIntuitedMemory } from './memoryManager.js';

const { userConversations, userContextLengths, userDynamicPrompts } = memoryManagerState;

const SUMMARY_THRESHOLD = 3;
const INACTIVITY_THRESHOLD = 8 * 60 * 60 * 1000; // 8 hours

// We'll store the last summary timestamp per user in memory.
const lastSummaryTimestamps = new Map();

/**
 * Handles legacy (non-slash) messages.
 * - Checks for prefix in non-designated channels.
 * - Processes memory commands.
 * - Otherwise builds conversation context, generates a reply,
 *   saves the conversation to Supabase, and triggers summarization/extraction.
 *
 * @param {Message} message - The Discord message object.
 */
export async function handleLegacyMessage(message) {
  if (message.author.bot) return;

  const isDesignated = (message.channel.id === process.env.CHANNEL_ID);
  let cleanedContent = message.content;

  if (!isDesignated) {
    const prefixRegex = /^(hey\s+)?bri+i\b/i;
    if (!prefixRegex.test(message.content)) return;
    cleanedContent = message.content.replace(prefixRegex, '').trim();
  }

  const memoryRegex = /^(?:can you\s+)?remember\s+(.*)/i;
  const memoryMatch = cleanedContent.match(memoryRegex);
  if (memoryMatch) {
    const memoryText = memoryMatch[1].trim();
    try {
      const result = await processMemoryCommand(message.author.id, memoryText);
      await message.channel.send(result.success ? result.message : result.error);
    } catch (error) {
      logger.error("Legacy memory command error", { error });
      await message.channel.send("Sorry, an error occurred processing your memory command.");
    }
    return;
  }

  const effectiveSystemPrompt = getEffectiveSystemPrompt(message.author.id);
  const combinedSystemPrompt = await getCombinedSystemPromptWithVectors(message.author.id, effectiveSystemPrompt, cleanedContent);

  let conversation = userConversations.get(message.author.id) || [
    { role: "system", content: combinedSystemPrompt }
  ];
  conversation[0] = { role: "system", content: combinedSystemPrompt };
  conversation.push({ role: "user", content: cleanedContent });

  const contextLength = userContextLengths.get(message.author.id) || defaultContextLength;
  if (conversation.length > contextLength) {
    conversation = [conversation[0], ...conversation.slice(-(contextLength - 1))];
  }
  userConversations.set(message.author.id, conversation);

  await message.channel.sendTyping();

  try {
    const completion = await openai.chat.completions.create({
      model: defaultAskModel,
      messages: conversation,
      max_tokens: 3000,
    });
    let reply = completion.choices[0].message.content;
    reply = replaceEmoticons(reply);
    conversation.push({ role: "assistant", content: reply });
    userConversations.set(message.author.id, conversation);

    await supabase.from('user_conversations').upsert({
      user_id: message.author.id,
      conversation,
      system_prompt: STATIC_CORE_PROMPT + "\n" + (userDynamicPrompts.get(message.author.id) || ""),
      context_length: userContextLengths.get(message.author.id) || defaultContextLength,
      updated_at: new Date().toISOString(),
    });

    const userMsgCount = conversation.filter(msg => msg.role === "user").length;
    const lastSummaryTime = lastSummaryTimestamps.get(message.author.id) || 0;
    const now = Date.now();
    if (userMsgCount >= SUMMARY_THRESHOLD || (now - lastSummaryTime) > INACTIVITY_THRESHOLD) {
      const { summarizeConversation } = await import('../utils/summarization.js');
      const summary = await summarizeConversation(conversation);
      if (summary) {
        const extractedFacts = await extractIntuitedMemories(summary);
        for (const fact of extractedFacts) {
          await insertIntuitedMemory(message.author.id, fact);
        }
        logger.info(`Extracted and inserted intuited memories for user ${message.author.id}.`);
        lastSummaryTimestamps.set(message.author.id, now);
      }
    }

    if (reply.length > 2000) {
      const chunks = splitMessage(reply, 2000);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      if (isDesignated) {
        await message.reply(reply);
      } else {
        await message.channel.send(reply);
      }
    }
  } catch (error) {
    logger.error("Error in message handler", { error });
    console.error("Error from OpenAI API in message handler:", error);
    await message.channel.send("Sorry, an error occurred processing your message.");
  }
}
