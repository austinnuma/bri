import { 
  getEffectiveSystemPrompt, 
  getCombinedSystemPromptWithMemories, 
  processMemoryCommand, 
  memoryManagerState, 
  defaultContextLength, 
  STATIC_CORE_PROMPT,
  insertIntuitedMemory 
} from './unifiedMemoryManager.js';
import { splitMessage, replaceEmoticons } from './textUtils.js';
import { openai, defaultAskModel } from '../services/openaiService.js';
import { supabase } from '../services/supabaseService.js';
import { logger } from './logger.js';
import { extractIntuitedMemories } from './extraction.js';
import { summarizeConversation } from './summarization.js';
import { detectUserQuery, handleUserInfoQuery } from './unifiedUserMemory.js';
import { analyzeImage } from '../services/visionService.js';

const { userConversations, userContextLengths, userDynamicPrompts } = memoryManagerState;

const SUMMARY_THRESHOLD = 3;
const INACTIVITY_THRESHOLD = 8 * 60 * 60 * 1000; // 8 hours

// We'll store the last summary timestamp per user in memory.
const lastSummaryTimestamps = new Map();
// Track new messages since last extraction
const userMessageCounters = new Map();

/**
 * Checks if an attachment is an image
 */
function isImageAttachment(attachment) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const url = attachment.url.toLowerCase();
  const isImage = imageExtensions.some(ext => url.endsWith(ext));
  
  // Check content type if available
  const hasImageContentType = attachment.contentType && 
                              attachment.contentType.startsWith('image/');
  
  return isImage || hasImageContentType;
}

/**
 * Handles legacy (non-slash) messages.
 * Processes images, memory commands, user queries, and normal chat.
 *
 * @param {Message} message - The Discord message object.
 */
export async function handleLegacyMessage(message) {
  if (message.author.bot) return;

  ///logger.info(`Processing message: "${message.content}", attachments: ${message.attachments.size}`);

  const isDesignated = (message.channel.id === process.env.CHANNEL_ID);
  let cleanedContent = message.content;
  
  // Check for attached images
  const imageAttachments = message.attachments.filter(isImageAttachment);
  //logger.info(`Found ${imageAttachments.size} image attachments`);
  
  // Check if this is a non-designated channel
  if (!isDesignated) {
    const prefixRegex = /^(hey\s+)?bri+\b/i;
    
    // Check if this is a reply to the bot's message
    const isReplyToBot = message.reference && 
                         message.reference.messageId && 
                         (await message.channel.messages.fetch(message.reference.messageId))?.author.id === message.client.user.id;
    
    // Only proceed in three cases:
    // 1. Message has the "bri" prefix, or
    // 2. Message is a direct reply to the bot, or
    // 3. Message has BOTH an image AND the "bri" prefix
    const hasBriPrefix = prefixRegex.test(message.content);
    const hasImageWithBri = imageAttachments.size > 0 && hasBriPrefix;
    
    if (!hasBriPrefix && !isReplyToBot && !hasImageWithBri) {
      return; // Skip this message
    }
    
    // Clean the content if it has the prefix
    if (hasBriPrefix) {
      cleanedContent = message.content.replace(prefixRegex, '').trim();
    }
  }

  // Handle image analysis if there are image attachments
  if (imageAttachments.size > 0) {
    logger.info(`Processing ${imageAttachments.size} images`);
    await message.channel.sendTyping();
    
    try {
      // Get the first image for analysis
      const imageAttachment = imageAttachments.first();
      const imageUrl = imageAttachment.url;
      
      logger.info(`Analyzing image from user ${message.author.id}: ${imageUrl}`);
      
      // Use an empty string if no content was provided with the image
      const contextText = cleanedContent || "";
      logger.info(`Image context text: "${contextText}"`);
      
      // Analyze the image with any available context
      const imageDescription = await analyzeImage(imageUrl, contextText);
      
      // Reply with the image description
      await message.reply(imageDescription);
      
      // Log the successful image analysis
      logger.info(`Successfully analyzed image for user ${message.author.id}`);
      
      // Return early - we don't need to process this as a normal message
      return;
    } catch (error) {
      logger.error("Error processing image:", error);
      await message.reply("I had trouble understanding that image. Can you try a different one?");
      return;
    }
  }

  // Memory command check
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

  // Check if this is a query about another user
  const userQuery = detectUserQuery(cleanedContent);
  if (userQuery) {
    try {
      logger.info(`User ${message.author.id} asked about ${userQuery.username}'s ${userQuery.query}`);
      
      // Send typing indicator while processing
      await message.channel.sendTyping();
      
      const response = await handleUserInfoQuery(
        message.author.id, 
        userQuery.username, 
        userQuery.query,
        userQuery.category
      );
      
      if (response) {
        if (response.length > 2000) {
          const chunks = splitMessage(response, 2000);
          for (const chunk of chunks) {
            await message.channel.send(chunk);
          }
        } else {
          await message.reply(response);
        }
        return; // Exit early, we've handled the query
      }
      // If no response, continue with normal processing
    } catch (error) {
      logger.error("Error handling user info query", { error, query: userQuery });
      // Continue with normal processing
    }
  }

  // Handle regular text messages
  const effectiveSystemPrompt = getEffectiveSystemPrompt(message.author.id);
  const combinedSystemPrompt = await getCombinedSystemPromptWithMemories(message.author.id, effectiveSystemPrompt, cleanedContent);

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

    // Update username mapping if needed
    updateUserMapping(message).catch(err => {
      logger.error("Error updating user mapping", { error: err });
    });

    // Increment message counter for this user
    const currentCount = userMessageCounters.get(message.author.id) || 0;
    userMessageCounters.set(message.author.id, currentCount + 1);

    // Get timestamps
    const lastSummaryTime = lastSummaryTimestamps.get(message.author.id) || 0;
    const now = Date.now();

    // Only trigger extraction if we have enough NEW messages or enough time has passed
    if (userMessageCounters.get(message.author.id) >= SUMMARY_THRESHOLD || 
        (now - lastSummaryTime) > INACTIVITY_THRESHOLD) {
      
      logger.info(`Triggering summarization for user ${message.author.id} after ${userMessageCounters.get(message.author.id)} messages`);
      
      // Run summarization and extraction asynchronously to avoid blocking response
      summarizeAndExtract(message.author.id, conversation).catch(err => {
        logger.error(`Error in summarization/extraction process: ${err}`);
      });
      
      // Reset counter and update timestamp immediately
      userMessageCounters.set(message.author.id, 0);
      lastSummaryTimestamps.set(message.author.id, now);
    }

    if (reply.length > 2000) {
      const chunks = splitMessage(reply, 2000);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      // Always use reply() for replies to the bot's messages to maintain the thread
      const isReplyToBot = message.reference && message.reference.messageId;
      if (isDesignated || isReplyToBot) {
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

/**
 * Updates the user mapping table with the latest user information
 * @param {Message} message - The Discord message
 */
async function updateUserMapping(message) {
  try {
    // Skip if missing required information
    if (!message.author || !message.author.id || !message.author.username) return;
    
    await supabase.from('discord_users').upsert({
      user_id: message.author.id,
      username: message.author.username,
      nickname: message.member?.nickname || null,
      server_id: message.guild?.id || null,
      last_active: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error updating user mapping", { error });
  }
}

/**
 * Performs summarization and memory extraction in the background.
 * 
 * @param {string} userId - The user's ID
 * @param {Array} conversation - The conversation history
 */
async function summarizeAndExtract(userId, conversation) {
  try {
    // Create a copy of the conversation to avoid modification during processing
    const conversationCopy = [...conversation];
    
    // Summarize the conversation
    const summary = await summarizeConversation(conversationCopy);
    if (!summary) {
      logger.warn(`Failed to generate summary for user ${userId}`);
      return;
    }
    
    // Extract memories from the summary
    const extractedFacts = await extractIntuitedMemories(summary, userId);
    
    // Skip DB operations if no new facts were extracted
    if (extractedFacts.length === 0) {
      logger.info(`No new facts extracted for user ${userId}`);
      return;
    }
    
    // Insert memories with medium-high confidence
    logger.info(`Extracted ${extractedFacts.length} new memories for user ${userId}`);
    for (const fact of extractedFacts) {
      await insertIntuitedMemory(userId, fact, 0.8);
    }
  } catch (error) {
    logger.error(`Error in background summarization process: ${error}`);
  }
}