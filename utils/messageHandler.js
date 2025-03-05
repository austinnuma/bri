import { 
  getEffectiveSystemPrompt, 
  getCombinedSystemPromptWithMemories, 
  processMemoryCommand, 
  memoryManagerState, 
  defaultContextLength, 
  STATIC_CORE_PROMPT,
  insertIntuitedMemory,
  categorizeMemory 
} from './unifiedMemoryManager.js';
import { splitMessage, replaceEmoticons } from './textUtils.js';
import { openai, getChatCompletion, defaultAskModel, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { extractIntuitedMemories } from './extractionAndMemory.js';
import { summarizeConversation } from './summarization.js';
import { analyzeImage, analyzeImages } from '../services/visionService.js';
import { getBatchEmbeddings } from './improvedEmbeddings.js';
import { getCachedUser, invalidateUserCache, warmupUserCache } from '../utils/databaseCache.js';
import { maybeAutoSaveQuote } from './quoteManager.js';

const { userConversations, userContextLengths, userDynamicPrompts } = memoryManagerState;

const SUMMARY_THRESHOLD = 3;
const INACTIVITY_THRESHOLD = 8 * 60 * 60 * 1000; // 8 hours

// Track user activity times
const userLastActive = new Map();

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


async function handleImageAttachments(message, cleanedContent) {
  // Extract all image attachments
  const imageAttachments = message.attachments.filter(isImageAttachment);
  
  if (imageAttachments.size === 0) {
    return false; // No images to process
  }
  
  logger.info(`Processing ${imageAttachments.size} images from user ${message.author.id}`);
  await message.channel.sendTyping();
  
  try {
    // Get all image URLs
    const imageUrls = imageAttachments.map(attachment => attachment.url);
    
    // Get conversation history for this user to provide context
    const conversationHistory = userConversations.get(message.author.id) || [];
    
    // Use the enhanced analyzeImages function with conversation context
    const imageDescription = await analyzeImages(
      imageUrls,
      cleanedContent || "",
      conversationHistory
    );
    
    // Send the response
    const response = await message.reply(imageDescription);
    
    // Update conversation history with this interaction
    if (conversationHistory.length > 0) {
      // First add the user's message with images
      conversationHistory.push({ 
        role: "user", 
        content: cleanedContent 
          ? `${cleanedContent} [Attached ${imageUrls.length} image(s)]` 
          : `[Attached ${imageUrls.length} image(s)]` 
      });
      
      // Then add Bri's response
      conversationHistory.push({ 
        role: "assistant", 
        content: imageDescription 
      });
      
      // Apply context length limits if needed
      const contextLength = userContextLengths.get(message.author.id) || defaultContextLength;
      if (conversationHistory.length > contextLength) {
        conversationHistory = [conversationHistory[0], ...conversationHistory.slice(-(contextLength - 1))];
      }
      
      // Save the updated conversation
      userConversations.set(message.author.id, conversationHistory);
      
      // Save to database
      await supabase.from('user_conversations').upsert({
        user_id: message.author.id,
        conversation: conversationHistory,
        system_prompt: STATIC_CORE_PROMPT + "\n" + (userDynamicPrompts.get(message.author.id) || ""),
        context_length: userContextLengths.get(message.author.id) || defaultContextLength,
        updated_at: new Date().toISOString(),
      });
      
      invalidateUserCache(message.author.id);
    }
    
    logger.info(`Successfully processed images for user ${message.author.id}`);
    return true; // Images were processed
  } catch (error) {
    logger.error("Error processing images:", error);
    await message.reply("I had trouble understanding those images. Can you try sending them again?");
    return true; // Error, but still handled the images
  }
}


/**
 * Handles legacy (non-slash) messages.
 * Processes images, memory commands, user queries, and normal chat.
 *
 * @param {Message} message - The Discord message object.
 */
export async function handleLegacyMessage(message) {
  if (message.author.bot) return;
  const lastInteraction = userLastActive.get(message.author.id) || 0;
  const now = Date.now();
  // If user was inactive for more than 10 minutes, refresh their cache
  if (now - lastInteraction > 10 * 60 * 1000) {
    await warmupUserCache(message.author.id);
  }

  // Update last active timestamp
  userLastActive.set(message.author.id, now);

  ///logger.info(`Processing message: "${message.content}", attachments: ${message.attachments.size}`);

  const isDesignated = (message.channel.id === process.env.CHANNEL_ID);
  let cleanedContent = message.content;
  
    // Check for attached images and store the result
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
  
    // Handle image analysis using our new function
    const imagesHandled = await handleImageAttachments(message, cleanedContent);
    if (imagesHandled) {
      return; // Exit early if we handled images
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

    // Try to auto-save this as a quote (has a low random chance of actually saving)
  maybeAutoSaveQuote(message, message.client.user.id).catch(error => {
    logger.error("Error in auto quote save:", error);
    // Don't stop message processing for quote errors
  });

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
    // Use our batched version instead of direct API call
    const completion = await getChatCompletion({
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
    invalidateUserCache(message.author.id);

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
    // Process all facts as a batch
    const memoryObjects = extractedFacts.map(fact => ({
      user_id: userId,
      memory_text: fact,
      memory_type: 'intuited',
      category: categorizeMemory(fact),
      confidence: 0.8,
      source: 'conversation_extraction'
    }));
    
    // Get all embeddings in a single batch
    const texts = extractedFacts;
    const embeddings = await getBatchEmbeddings(texts);
    
    // Add embeddings to memory objects
    for (let i = 0; i < memoryObjects.length; i++) {
      memoryObjects[i].embedding = embeddings[i];
    }
    // Insert all memories in a single database operation if possible
    try {
      const { data, error } = await supabase
        .from('unified_memories')
        .insert(memoryObjects);
        
      if (error) {
        logger.error("Error batch inserting memories:", error);
        // Fall back to individual inserts if batch fails
        for (const fact of extractedFacts) {
          await insertIntuitedMemory(userId, fact);
        }
      }
    } catch (batchError) {
      logger.error("Error in batch memory insertion:", batchError);
      // Fall back to individual inserts
      for (const fact of extractedFacts) {
        await insertIntuitedMemory(userId, fact);
      }
    }
  } catch (error) {
    logger.error(`Error in background summarization process: ${error}`);
  }
}