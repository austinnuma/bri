// Complete multi-server messageHandler.js

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
import {
  getUserConversation,
  getUserContextLength,
  setUserConversation,
  getUserDynamicPrompt,
  setUserDynamicPrompt,
  batchGetUserSettings, // Import the batch function
  warmupUserCache as warmupUserSettingsCache // Renamed for clarity
} from './db/userSettings.js';
import { splitMessage, replaceEmoticons } from './textUtils.js';
import { openai, getChatCompletion, defaultAskModel, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { enhancedMemoryExtraction } from './extractionAndMemory.js';
import { enhancedSummarizeConversation } from './summarization.js';
import { analyzeImage, analyzeImages } from '../services/visionService.js';
import { getBatchEmbeddings } from './improvedEmbeddings.js';
// Renamed to avoid function name conflicts
import { 
  getCachedUser, 
  invalidateUserCache as invalidateCacheManagerUserCache, 
  warmupUserCache as warmupCacheManagerUserCache, 
  cachedVectorSearch 
} from './cacheManager.js';
import { maybeAutoSaveQuote } from './quoteManager.js';
import { 
  analyzeConversationForInterests,
  updateRelationshipAfterInteraction,
  findRelevantContentToShare,
  getPersonalContent,
  personalizeResponse,
  detectAndStoreInsideJoke
} from './characterDevelopment.js';
import { getEmbedding } from './improvedEmbeddings.js';
import natural from 'natural';
import { getServerConfig, getServerPrefix, isFeatureEnabled } from './serverConfigManager.js';
import { 
  hasEnoughCredits, 
  useCredits, 
  CREDIT_COSTS, 
  getServerCredits 
} from './creditManager.js';
import { 
  getMemoriesForVerification, 
  generateVerificationQuestion,
  processVerificationResponse 
} from './memoryVerification.js';
import { 
  semanticDeduplication, 
  updateLastExtractedMessage,
  getLastExtractedMessage 
} from './memoryDeduplication.js';
import { 
  incrementalMemoryExtraction, 
  updateExtractionTracking 
} from './incrementalMemoryExtraction.js';
import { 
  getUserCharacterSheet, 
  getCharacterSheetForPrompt, 
  updateConversationStyle 
} from './userCharacterSheet.js';
import {
  createEvent, 
  EVENT_TYPES, 
  REMINDER_TIMES, 
  getUserTimezone,
  storeContextEventWithInstructions 
} from './timeSystem.js';
import { 
  extractTimeAndEvent, 
  parseTimeSpecification 
} from './timeParser.js';
import { integrateMemoryEnhancements } from './memoryGraphInitializer.js';



// No longer using in-memory Maps, using database functions instead
// const { userConversations, userContextLengths, userDynamicPrompts } = memoryManagerState;

const SUMMARY_THRESHOLD = 3;
const INACTIVITY_THRESHOLD = 8 * 60 * 60 * 1000; // 8 hours

// Track user activity times (now with guild context)
const userLastActive = new Map();

// We'll store the last summary timestamp per user (now with guild context)
const lastSummaryTimestamps = new Map();
// Track new messages since last extraction (now with guild context)
const userMessageCounters = new Map();

function normalizeForComparison(text) {
  return text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Track which users have pending memory verifications
const pendingVerifications = new Map();


/**
 * Combined function to warmup both caches for consistency
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID 
 * @param {string|null} threadId - Optional thread ID for thread-specific conversations
 */
async function warmupCombinedUserCache(userId, guildId, threadId = null) {
  try {
    // Warm up both caches in parallel for efficiency
    await Promise.all([
      warmupCacheManagerUserCache(userId, guildId),
      warmupUserSettingsCache(userId, guildId, threadId)
    ]);
    logger.debug(`Warmed up all caches for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}`);
  } catch (error) {
    logger.error(`Error warming up combined caches for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
  }
}

/**
 * Combined function to invalidate both caches for consistency
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {string|null} threadId - Optional thread ID for thread-specific conversations
 */
function invalidateCombinedUserCache(userId, guildId, threadId = null) {
  try {
    // Invalidate both caches for consistency
    invalidateCacheManagerUserCache(userId, guildId);
    // No explicit invalidation needed for userSettings cache due to write-through approach
    logger.debug(`Invalidated cache for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}`);
  } catch (error) {
    logger.error(`Error invalidating cache for user ${userId} in guild ${guildId}${threadId ? ` thread ${threadId}` : ''}:`, error);
  }
}


/**
 * Checks if a server has sufficient credits for a chat operation
 * @param {string} guildId - The Discord guild ID
 * @returns {Promise<{hasCredits: boolean, credits: Object|null, insufficientMessage: string|null}>}
 */
async function checkServerCreditsForChat(guildId) {
  try {
    // Check if this server has credits enabled
    const serverConfig = await getServerConfig(guildId);
    const creditsEnabled = serverConfig?.credits_enabled === true;
    
    // If credits are not enabled, always return true
    if (!creditsEnabled) {
      return { hasCredits: true, credits: null, insufficientMessage: null };
    }
    
    const operationType = 'CHAT_MESSAGE';
    
    // Check if server has enough credits
    const hasCredits = await hasEnoughCredits(guildId, operationType);
    
    if (!hasCredits) {
      // Get current credit information for a more helpful message
      const credits = await getServerCredits(guildId);
      
      // Create a user-friendly message
      const insufficientMessage = 
        "⚠️ **Not enough credits!** This server has run out of credits to use Bri. " +
        `Currently available: ${credits?.remaining_credits || 0} credits. ` +
        "Server administrators can purchase more credits on the Bri website or wait for your monthly refresh.";
      
      return { 
        hasCredits: false, 
        credits, 
        insufficientMessage 
      };
    }
    
    return { hasCredits: true, credits: null, insufficientMessage: null };
  } catch (error) {
    logger.error(`Error checking credits for chat in ${guildId}:`, error);
    // If there's an error, let the message through
    return { hasCredits: true, credits: null, insufficientMessage: null };
  }
}


/**
 * Checks if a memory text is similar to any existing memory for a user
 * @param {string} userId - User ID
 * @param {string} memoryText - Memory text to check
 * @param {string} guildId - Guild ID
 * @returns {Promise<boolean>} - Whether a similar memory exists
 */
async function isDuplicateMemory(userId, memoryText, guildId) {
  try {
    // First, extract the category to only compare within the same type of memory
    const category = categorizeMemory(memoryText);
    
    // Get existing memories in this category (now with guild filter)
    const { data, error } = await supabase
      .from('unified_memories')
      .select('memory_text')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .eq('category', category)
      .eq('active', true);
      
    if (error || !data || data.length === 0) {
      return false; // No memories found to compare against
    }
    
    // Normalize the input text for comparison
    const normalizedInput = normalizeForComparison(memoryText);
    
    // Check each memory for similarity using Jaro-Winkler (better for text similarity)
    for (const memory of data) {
      const normalizedMemory = normalizeForComparison(memory.memory_text);
      
      // Calculate text similarity
      const similarity = natural.JaroWinklerDistance(normalizedInput, normalizedMemory);
      
      // Use a higher threshold (0.92+) for true duplicates
      if (similarity > 0.92) {
        logger.info(`Found similar memory in guild ${guildId}: "${memory.memory_text}" vs "${memoryText}" (similarity: ${similarity.toFixed(3)})`);
        return true;
      }
    }
    
    // No similar memories found
    return false;
  } catch (error) {
    logger.error("Error checking for duplicate memory:", error);
    return false; // When in doubt, don't block the insertion
  }
}

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
 * Handle image attachments with guild context and write-through caching
 * @param {Message} message - The Discord message
 * @param {string} cleanedContent - The cleaned message content
 * @param {string} guildId - The guild ID
 * @param {string|null} threadId - The thread ID if the message is in a thread
 * @returns {Promise<boolean>} - Whether images were handled
 */
async function handleImageAttachments(message, cleanedContent, guildId, threadId = null) {
  // Extract all image attachments
  const imageAttachments = message.attachments.filter(isImageAttachment);
  
  if (imageAttachments.size === 0) {
    return false; // No images to process
  }
  
  logger.info(`Processing ${imageAttachments.size} images from user ${message.author.id} in guild ${guildId}`);
  await message.channel.sendTyping();
  
  try {
    // Get all image URLs
    const imageUrls = imageAttachments.map(attachment => attachment.url);
    
    // Get conversation history for this user using write-through cache
    let conversationHistory = await getUserConversation(message.author.id, guildId, threadId) || [];
    
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
      const contextLength = await getUserContextLength(message.author.id, guildId) || defaultContextLength;
      if (conversationHistory.length > contextLength) {
        conversationHistory = [conversationHistory[0], ...conversationHistory.slice(-(contextLength - 1))];
      }
      
      // Save the updated conversation using write-through caching
      // This will update both the database and the cache simultaneously
      await setUserConversation(message.author.id, guildId, conversationHistory, threadId);
      
      // No need to invalidate cache explicitly as setUserConversation uses write-through caching
      // Remove: invalidateUserCache(message.author.id, guildId);
    }
    
    logger.info(`Successfully processed images for user ${message.author.id} in guild ${guildId}`);
    return true; // Images were processed
  } catch (error) {
    logger.error("Error processing images:", error);
    await message.reply("I had trouble understanding those images. Can you try sending them again?");
    return true; // Error, but still handled the images
  }
}


export async function handleLegacyMessage(message) {
  // Skip bot messages
  if (message.author.bot) return;
  
  // Skip if no guild (DMs)
  if (!message.guild) return;
  
  // Get guild ID for multi-server support
  const guildId = message.guild.id;
  
  // Check if message is in a thread and get thread ID if it is
  const isThread = message.channel.isThread();
  const threadId = isThread ? message.channel.id : null;
  
  // If this is a thread, add some additional logging
  if (isThread) {
    logger.info(`Processing message in thread ${threadId} from user ${message.author.id} in guild ${guildId}`);
  }
  
  // Check if user is blocked
  const { isUserBlocked } = await import('./moderation/userBlocker.js');
  const { isBlocked, reason } = await isUserBlocked(message.author.id, guildId);
  
  // If user is blocked, silently ignore their message
  if (isBlocked) {
    logger.debug(`Blocked user ${message.author.id} attempted to interact in guild ${guildId}. Reason: ${reason}`);
    return;
  }
  
  // Get server configuration
  const serverConfig = await getServerConfig(guildId);
  const serverPrefix = serverConfig.prefix || 'bri';
  
  // Track user activity with guild context
  const userGuildKey = `${message.author.id}:${guildId}`;
  const lastInteraction = userLastActive.get(userGuildKey) || 0;
  const now = Date.now();

  // One-time integration of memory enhancements (will be a no-op on subsequent calls)
  let memoryEnhancementsIntegrated = false;
  if (!memoryEnhancementsIntegrated) {
    memoryEnhancementsIntegrated = true;
    integrateMemoryEnhancements(message.client);
  }
  
  // We'll only warm up the cache when Bri is explicitly invoked
  // This will be handled later after we check if the message is directed at Bri

  // Update last active timestamp
  userLastActive.set(userGuildKey, now);

  // Consider both designated channels and threads as places where Bri responds by default
  const isDesignated = serverConfig.designated_channels.includes(message.channel.id) || isThread;
  let cleanedContent = message.content;

  // Initialize reply context variable
  let repliedToMessageContext = null;

   // Check if this is a response to a verification question
   if (pendingVerifications.has(userGuildKey)) {
     const verification = pendingVerifications.get(userGuildKey);
     
     // Process the verification response
     const result = await processVerificationResponse(
       message.author.id, 
       verification.memoryId, 
       cleanedContent,
       guildId
     );
     
     if (result.success) {
       // Clear the pending verification
       pendingVerifications.delete(userGuildKey);
       
       // No need to respond here - continue with normal message processing
     }
   }
  
  // Check for attached images and store the result
  const imageAttachments = message.attachments.filter(isImageAttachment);
  
  // Build the prefix regex based on server configuration
  const prefixRegex = new RegExp(`^(hey\\s+)?${serverPrefix}+\\b`, 'i');
  
  // Check if this is a reply to the bot's message - moved outside the isDesignated check
  const isReplyToBot = message.reference && 
                        message.reference.messageId && 
                        (await message.channel.messages.fetch(message.reference.messageId))?.author.id === message.client.user.id;
  
  // Adding RepliedToMessageContext for better context in replies - moved outside the isDesignated check
  if (message.reference && message.reference.messageId) {
    try {
      // Fetch the message being replied to
      const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);
      
      // Skip if it's a reply to the bot (already handled by isReplyToBot)
      if (repliedToMessage.author.id !== message.client.user.id) {
        const repliedToAuthor = repliedToMessage.author.username;
        const repliedToContent = repliedToMessage.content;
        
        // Check for image attachments
        const imageAttachmentsInReply = repliedToMessage.attachments.filter(isImageAttachment);
        
        // Generate attachment description
        let attachmentInfo = '';
        // For image attachments, provide more detailed context
        if (imageAttachmentsInReply.size > 0) {
          // If there are image attachments AND we have vision capabilities, try to describe them
          if (await isFeatureEnabled(guildId, 'character')) {
            try {
              // Get all image URLs
              const imageUrls = imageAttachmentsInReply.map(attachment => attachment.url);
              
              // Use the vision service to analyze the image with minimal context
              const imageDescription = await analyzeImages(
                imageUrls,
                "Describe this image briefly",
                []
              );
              
              attachmentInfo = ` [Image description: ${imageDescription}]`;
            } catch (error) {
              logger.error("Error analyzing image in reply:", error);
              attachmentInfo = ` [Attached ${imageAttachmentsInReply.size} ${imageAttachmentsInReply.size === 1 ? 'image' : 'images'}]`;
            }
          } else {
            attachmentInfo = ` [Attached ${imageAttachmentsInReply.size} ${imageAttachmentsInReply.size === 1 ? 'image' : 'images'}]`;
          }
        } else if (repliedToMessage.attachments.size > 0) {
          attachmentInfo = ` [Attached ${repliedToMessage.attachments.size} ${repliedToMessage.attachments.size === 1 ? 'file' : 'files'}]`;
        }
        
        // Format the context information more clearly
        repliedToMessageContext = `CONTEXT_FROM_REPLIED_MESSAGE: This message is replying to content from user ${repliedToAuthor} who said: "${repliedToContent}${attachmentInfo}"`;
        
        logger.info(`Added reply context to message from ${message.author.id} in guild ${guildId}. Original message from ${repliedToAuthor}`);
      }
    } catch (error) {
      logger.error(`Error fetching replied-to message: ${error}`);
      // Continue processing even if we can't fetch the reply
    }
  }
  
  // Define prefix check for use in both designated and non-designated channels
  const hasPrefix = prefixRegex.test(message.content);
  const hasImageWithPrefix = imageAttachments.size > 0 && hasPrefix;
  
  // Check if this is a non-designated channel
  if (!isDesignated) {
    // Only proceed in three cases:
    // 1. Message has the server-specific prefix, or
    // 2. Message is a direct reply to the bot, or
    // 3. Message has BOTH an image AND the server-specific prefix
    
    if (!hasPrefix && !isReplyToBot && !hasImageWithPrefix) {
      return; // Skip this message
    }
    
    // Bri is being explicitly invoked, warm up the cache
    await warmupCombinedUserCache(message.author.id, guildId, threadId);
    
    // Clean the content if it has the prefix
    if (hasPrefix) {
      cleanedContent = message.content.replace(prefixRegex, '').trim();
    }
  } else {
    // Skip processing messages that start with :: in designated channels
    if (message.content.startsWith('::')) {
      return; // Silently ignore these messages
    }
    
    // This is a designated channel, so Bri is being explicitly invoked, warm up the cache
    await warmupCombinedUserCache(message.author.id, guildId, threadId);
  }
  
 // Handle image analysis if feature is enabled
 if (imageAttachments.size > 0 && await isFeatureEnabled(guildId, 'character')) {
  // First check if this server has credits enabled
  const serverConfig = await getServerConfig(guildId);
  const creditsEnabled = serverConfig?.credits_enabled === true;
  
  // Import the subscription check function
  const { isFeatureSubscribed, SUBSCRIPTION_FEATURES } = await import('./subscriptionManager.js');
  
  // Check if server has unlimited vision with subscription
  const hasUnlimitedVision = await isFeatureSubscribed(guildId, SUBSCRIPTION_FEATURES.UNLIMITED_VISION);
  
  // If credits are enabled and server doesn't have unlimited vision, check credits
  if (creditsEnabled && !hasUnlimitedVision) {
    const operationType = 'VISION_ANALYSIS';
    
    // Check if server has enough credits
    const hasCredits = await hasEnoughCredits(guildId, operationType);
    
    if (!hasCredits) {
      // Get current credit information for a more helpful message
      const credits = await getServerCredits(guildId);
      
      await message.reply(
        `⚠️ **Not enough credits!** This server doesn't have enough credits to analyze images.\n` +
        `💰 Available: ${credits?.remaining_credits || 0} credits\n` +
        `💸 Required: ${CREDIT_COSTS['VISION_ANALYSIS']} credits\n\n` +
        `You can purchase more credits or subscribe to our Enterprise plan for unlimited image analysis!`
      );
      return; // Exit without processing images
    }
  }
  
  // Process the images
  const imagesHandled = await handleImageAttachments(message, cleanedContent, guildId, threadId);
  
  // If images were handled successfully and credits are enabled, use credits
  if (imagesHandled && creditsEnabled && !hasUnlimitedVision) {
    await useCredits(guildId, 'VISION_ANALYSIS');
    logger.info(`Used ${CREDIT_COSTS['VISION_ANALYSIS']} credits for vision analysis in server ${guildId}`);
  } else if (imagesHandled && hasUnlimitedVision) {
    logger.info(`Processed image in server ${guildId} with Enterprise subscription (no credits used)`);
  }
  
  if (imagesHandled) {
    return; // Exit early if we handled images
  }
}

  // Memory command check - only if memory feature is enabled
  const memoryEnabled = await isFeatureEnabled(guildId, 'memory');
  const memoryRegex = /^(?:can you\s+)?remember\s+(.*)/i;
  const memoryMatch = cleanedContent.match(memoryRegex);
  
  if (memoryMatch && memoryEnabled) {
    const memoryText = memoryMatch[1].trim();
    try {
      const result = await processMemoryCommand(message.author.id, memoryText, guildId);
      await message.channel.send(result.success ? result.message : result.error);
    } catch (error) {
      logger.error("Legacy memory command error", { error, guildId });
      await message.channel.send("Sorry, an error occurred processing your memory command.");
    }
    return;
  } else if (memoryMatch && !memoryEnabled) {
    // Memory feature is disabled
    await message.reply("Memory features are currently disabled on this server.");
    return;
  }

  // Update relationship after each interaction - only if character feature is enabled
  if (await isFeatureEnabled(guildId, 'character')) {
    updateRelationshipAfterInteraction(message.author.id, cleanedContent, guildId).catch(error => {
      logger.error("Error updating relationship:", error);
      // Don't stop message processing for relationship errors
    });
  }

  // Try to auto-save this as a quote - only if quotes feature is enabled
  if (await isFeatureEnabled(guildId, 'quotes')) {
    maybeAutoSaveQuote(message, message.client.user.id, guildId).catch(error => {
      logger.error("Error in auto quote save:", error);
      // Don't stop message processing for quote errors
    });
  }

  // Check if the server has enough credits for a chat message
  const creditCheck = await checkServerCreditsForChat(guildId);
  if (!creditCheck.hasCredits) {
    // Send a message about insufficient credits
    await message.reply(creditCheck.insufficientMessage);
    return; // Stop processing
  }

  // Handle regular text messages
  const effectiveSystemPrompt = getEffectiveSystemPrompt(message.author.id, guildId);
  const combinedSystemPrompt = await getCombinedSystemPromptWithMemories(
    message.author.id, 
    effectiveSystemPrompt, 
    cleanedContent,
    guildId
  );

  // IMPROVED: Use the batch function to get all user settings at once
  // This reduces multiple database calls to a single call
  // When threadId is provided, we retrieve thread-specific conversation history
  // Each thread maintains its own separate conversation context
  const userSettings = await batchGetUserSettings(message.author.id, guildId, threadId);
  
  // Extract needed values from the batch result
  let conversation = userSettings.conversation;
  const contextLength = userSettings.contextLength || defaultContextLength;
  
  // If conversation doesn't have a system prompt, add it
  if (!conversation || !conversation.length) {
    conversation = [{ role: "system", content: combinedSystemPrompt }];
  } else {
    // Update the system prompt
    conversation[0] = { role: "system", content: combinedSystemPrompt };
  }
  
  // Add the user's message
  conversation.push({ role: "user", content: cleanedContent });

  // If we have context from a replied-to message, append it to the user's message
  if (repliedToMessageContext) {
    // Get the index of the message we just added
    const lastMessageIndex = conversation.length - 1;
  
    // Append the reply context to the user's message, putting it on a new line
    // and making it clear this is special context about what message is being replied to
    conversation[lastMessageIndex].content = 
    `${conversation[lastMessageIndex].content}\n\n${repliedToMessageContext}`;
    
    // Add instructions to the system prompt about how to handle replies
    if (conversation[0] && conversation[0].role === "system") {
      conversation[0].content += `\n\nWhen you see a line starting with "CONTEXT_FROM_REPLIED_MESSAGE:", this indicates the user is replying to another user's message. ` +
        `Pay special attention to this context, as the user is likely referring to or asking about the content of that message. ` +
        `You should ALWAYS reference the original message and its author in your response, even if not directly asked about them. ` +
        `For example, if Max posted "cats are nocturnal" and Austin asks you "is this true?", your response should include something ` +
        `like "No, Max's statement that cats are nocturnal is not entirely accurate because..." ` +
        `Remember that the user wants you to analyze, evaluate, or respond to the content of the original message they are replying to.`;
    }
  }

  // Apply context length limit
  if (conversation.length > contextLength) {
    conversation = [conversation[0], ...conversation.slice(-(contextLength - 1))];
  }
  
  // Save updated conversation to database with write-through caching
  await setUserConversation(message.author.id, guildId, conversation, threadId);

  await message.channel.sendTyping();


  try {
    // Find relevant content to potentially share with this user - only if character feature is enabled
    //const characterEnabled = await isFeatureEnabled(guildId, 'character');
    //const relevantContent = characterEnabled 
      //? await findRelevantContentToShare(message.author.id, cleanedContent, guildId) 
      //: null;
    
    //let personalContent = '';
    //if (relevantContent) {
      //personalContent = await getPersonalContent(message.author.id, relevantContent, guildId);
    //}
    
    // If there's personal content to share, add it to the system prompt
    //if (personalContent) {
      // Add Bri's personal content to the prompt
      //const updatedPrompt = conversation[0].content + 
      //`\n\nYou feel like sharing this personal information about yourself: ${personalContent}`;
          
      //conversation[0] = { role: "system", content: updatedPrompt };
    //}
    
    // Use our batched version instead of direct API call
    const completion = await getChatCompletion({
      model: defaultAskModel,
      messages: conversation,
      max_tokens: 3000,
    });

    let reply = completion.choices[0].message.content;

    // Check for potential time-sensitive information - only if reminders feature is enabled
    const remindersEnabled = await isFeatureEnabled(guildId, 'reminders');
    if (remindersEnabled) {
      const timeInfo = await checkForTimeRelatedContent(cleanedContent, message.author.id, message.channel.id, guildId);
      
      if (timeInfo && timeInfo.shouldAsk) {
        // If time-sensitive info was found, modify Bri's response to acknowledge it
        reply += `\n\n${timeInfo.followUpQuestion}`;
      }
    }

    // Check for potential inside jokes - only if character feature is enabled
    //if (characterEnabled) {
      //detectAndStoreInsideJoke(message.author.id, cleanedContent, guildId).catch(error => {
        //logger.error("Error detecting inside joke:", error);
      //});
      
      // Personalize response based on relationship
      //reply = await personalizeResponse(message.author.id, reply, guildId);
    //}

    // Apply emoticons
    //reply = replaceEmoticons(reply);

    // Update conversation with Bri's response 
    conversation.push({ role: "assistant", content: reply });
    
    // Save to database directly - overwrite in-memory approach
    await setUserConversation(message.author.id, guildId, conversation, threadId);

    // Update username mapping if needed
    updateUserMapping(message).catch(err => {
      logger.error("Error updating user mapping", { error: err });
    });

    // If the response was successful, use credits for this chat message
    if (serverConfig?.credits_enabled) {
      await useCredits(guildId, 'CHAT_MESSAGE');
      logger.debug(`Used ${CREDIT_COSTS['CHAT_MESSAGE']} credits for chat message in server ${guildId}`);
    }

    // Split and send the reply if needed
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

  // After successfully responding to the user, maybe insert a verification question
  // Only do this occasionally (e.g., 10% chance)
  //const memoryEnabled = await isFeatureEnabled(guildId, 'memory');
  //if (memoryEnabled && Math.random() < 0.1 && !pendingVerifications.has(userGuildKey)) {
    //try {
      // Get memories that need verification
      //const memoriesToVerify = await getMemoriesForVerification(message.author.id, guildId);
      
      //if (memoriesToVerify.length > 0) {
        // Select a random memory to verify
        //const memoryToVerify = memoriesToVerify[Math.floor(Math.random() * memoriesToVerify.length)];
        
        // Generate a natural verification question
        //const verificationQuestion = generateVerificationQuestion(memoryToVerify);
        
        // Send the question
        //await message.channel.send(verificationQuestion);
        
        // Store the pending verification
        //pendingVerifications.set(userGuildKey, {
          //memoryId: memoryToVerify.id,
          //timestamp: Date.now()
        //});
      //}
    //} catch (error) {
      //logger.error("Error generating verification question:", error);
      // Don't let verification errors disrupt normal flow
    //}
  //}

    // Collect the user's messages for style analysis
    const userMessages = conversation
    .filter(msg => msg.role === "user")
    .map(msg => msg.content);

    // Only update conversation style if we have a reasonable number of messages
    if (userMessages.length >= 5) {
    // Update the conversation style in the background (don't await)
    updateConversationStyle(message.author.id, guildId, userMessages)
      .catch(error => {
        logger.error("Error updating conversation style:", error);
      });
    }

    // Memory extraction if memory feature is enabled
    if (memoryEnabled) {
      // Increment message counter for this user - now with guild context
      const userGuildCounterKey = `${message.author.id}:${guildId}`;
      const currentCount = userMessageCounters.get(userGuildCounterKey) || 0;
      userMessageCounters.set(userGuildCounterKey, currentCount + 1);

      // Get timestamps - now with guild context
      const lastSummaryTime = lastSummaryTimestamps.get(userGuildCounterKey) || 0;
      const now = Date.now();

      // Only trigger extraction if we have enough NEW messages or enough time has passed
      if (userMessageCounters.get(userGuildCounterKey) >= SUMMARY_THRESHOLD || 
          (now - lastSummaryTime) > INACTIVITY_THRESHOLD) {
        
        logger.info(`Triggering summarization for user ${message.author.id} in guild ${guildId} after ${userMessageCounters.get(userGuildCounterKey)} messages`);
        
        // Don't extract memories from threads to avoid cross-contamination
        if (!threadId) {
          summarizeAndExtract(message.author.id, conversation, guildId).then(async result => {
          logger.info(`Memory extraction complete for user ${message.author.id} in guild ${guildId}`);
          
          // If we have the memory graph system available, build connections for the latest memories
          if (typeof buildMemoryGraph === 'function') {
            try {
              // This function is imported from memoryGraphInitializer.js
              const { buildMemoryGraph } = await import('./memoryGraphInitializer.js');
              
              // Build graph connections for this user's recent memories
              buildMemoryGraph(message.author.id, guildId, null, 5).then(graphResult => {
                logger.info(`Memory graph building complete for user ${message.author.id} in guild ${guildId}: ${JSON.stringify(graphResult)}`);
              }).catch(err => {
                logger.error(`Error in memory graph building: ${err}`);
              });
            } catch (importError) {
              logger.warn(`Could not import memory graph functions: ${importError}`);
            }
          }
        }).catch(err => {
          logger.error(`Error in memory extraction process: ${err}`);
        });
        }
        
        // Reset counter and update timestamp immediately
        userMessageCounters.set(userGuildCounterKey, 0);
        lastSummaryTimestamps.set(userGuildCounterKey, now);
      }
    }

  } catch (error) {
    logger.error("Error in message handler", { error, guildId });
    await message.channel.send("Sorry, an error occurred processing your message.");
  }

  // No code should be here that depends on variables defined within the try block
}

// Clean up stale verification requests periodically
setInterval(() => {
  const now = Date.now();
    // Remove verification requests older than 2 minutes
    for (const [key, verification] of pendingVerifications.entries()) {
      if (now - verification.timestamp > 2 * 60 * 1000) {
        pendingVerifications.delete(key);
      }
    }
}, 60 * 1000); // Run every minute

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
 * Optimized to work with write-through caching.
 * 
 * @param {string} userId - The user's ID
 * @param {Array} conversation - The conversation history
 * @param {string} guildId - The guild ID
 */
async function summarizeAndExtract(userId, conversation, guildId) {
  try {
    // Skip if no conversation or too short
    if (!conversation || conversation.length < 3) {
      return;
    }
    
    const serverConfig = await getServerConfig(guildId);
    const botName = serverConfig.botName || "Bri";
    
    // Use the new incremental extraction system
    const result = await incrementalMemoryExtraction(
      userId, 
      guildId, 
      conversation,
      botName
    );
    
    if (result.success) {
      if (result.extracted > 0) {
        logger.info(`Successfully extracted ${result.extracted} new memories for user ${userId} in guild ${guildId}`);
        
        // If we have the memory graph system available, build connections for the latest memories
        if (typeof buildMemoryGraph === 'function') {
          try {
            // This function is imported from memoryGraphInitializer.js
            const { buildMemoryGraph } = await import('./memoryGraphInitializer.js');
            
            // Build graph connections for this user's recent memories
            buildMemoryGraph(userId, guildId, null, 5).then(graphResult => {
              logger.info(`Memory graph building complete for user ${userId} in guild ${guildId}: ${JSON.stringify(graphResult)}`);
            }).catch(err => {
              logger.error(`Error in memory graph building: ${err}`);
            });
          } catch (importError) {
            logger.warn(`Could not import memory graph functions: ${importError}`);
          }
        }
      } else {
        logger.info(`No new memories found for user ${userId} in guild ${guildId}`);
      }
    } else {
      logger.error(`Error in memory extraction for user ${userId} in guild ${guildId}: ${result.error}`);
    }
    
    // Also analyze the conversation for interests after extraction
    analyzeConversationForInterests(userId, conversation, guildId).catch(err => {
      logger.error("Error analyzing conversation for interests:", err);
    });
  } catch (error) {
    logger.error(`Error in summarization process: ${error}`);
  }
}

/**
 * Enhanced function to check message content for time-related information
 * @param {string} content - Message content
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} - Time-related context info or null
 */
/**
 * Enhanced function to check message content for time-related information
 * @param {string} content - Message content
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object|null>} - Time-related context info or null
 */
async function checkForTimeRelatedContent(content, userId, channelId, guildId) {
  try {
    // Don't process very short messages
    if (content.length < 10) return null;
    
    // Extract time and event information with userId for context awareness
    const eventInfo = await extractTimeAndEvent(content, userId, `msg-${Date.now()}`);
    
    // If no time info, exit early
    if (!eventInfo) return null;
    
    logger.info(`Extracted time event for user ${userId} in guild ${guildId}: ${JSON.stringify(eventInfo)}`);
    
    // Get the user's timezone
    const timezone = await getUserTimezone(userId, guildId);
    
    // Store this as a context event with conversation instructions
    const contextEvent = await storeContextEventWithInstructions(
      userId, 
      guildId, 
      eventInfo, 
      content
    );
    
    if (!contextEvent) {
      logger.error(`Failed to store context event for user ${userId} in guild ${guildId}`);
    }
    
    // Check if this is a significant event that we should offer to remember with formal reminders
    const isSignificantEvent = isEventSignificant(eventInfo);
    
    // For significant events, create follow-up reminders
    if (isSignificantEvent) {
      // Generate a custom follow-up question based on the event type
      const followUpQuestion = generateFollowUpQuestion(eventInfo);
      
      // Create a follow-up event
      await createFollowUpEvent(userId, eventInfo, channelId, guildId);
      
      // Create a reminder for the actual event
      await createReminderForEvent(userId, eventInfo, channelId, guildId);
      
      // Return a flag indicating we've handled this formally
      return {
        eventFound: true,
        eventType: eventInfo.type,
        shouldAsk: true,
        followUpQuestion
      };
    }
    
    // For non-significant events, we still want to note them but not formally remind
    return {
      eventFound: true,
      eventType: eventInfo.type,
      shouldAsk: false // Don't add follow-up to response for casual events
    };
  } catch (error) {
    logger.error("Error checking for time-related content:", error);
    return null;
  }
}

/**
 * Determines if an event is significant enough for formal reminders
 * @param {Object} eventInfo - Event information
 * @returns {boolean} - Whether the event is significant
 */
function isEventSignificant(eventInfo) {
  // Consider significant if it has a specific date/time and is a formal event type
  if (!eventInfo.date) return false;
  
  // Check the event type - KEEP THE ORIGINAL LIST AS REQUESTED
  const significantTypes = ['appointment', 'interview', 'meeting', 'deadline', 'exam', 'test'];
  if (significantTypes.includes(eventInfo.type)) return true;
  
  // Check for important keywords in the title
  const importantKeywords = ['interview', 'appointment', 'meeting', 'deadline', 'exam', 'test', 'birthday', 'anniversary'];
  if (eventInfo.title && importantKeywords.some(keyword => eventInfo.title.toLowerCase().includes(keyword))) {
    return true;
  }
  
  // Default to false for other events
  return false;
}

/**
 * Generates a follow-up question based on event type
 * @param {Object} eventInfo - Event information
 * @returns {string} - Follow-up question
 */
function generateFollowUpQuestion(eventInfo) {
  const eventType = eventInfo.type || 'event';
  const eventTitle = eventInfo.title || eventType;
  
  switch (eventType.toLowerCase()) {
    case 'interview':
      return `I noticed you mentioned an interview${eventInfo.date ? ` on ${eventInfo.date}` : ''}. I'll remember to check in with you about this! Is there anything specific you'd like me to remind you about beforehand?`;
    case 'appointment':
      return `I see you have an appointment${eventInfo.date ? ` on ${eventInfo.date}` : ''}! I'll make a note to follow up with you on how it went.`;
    case 'meeting':
      return `I noticed you mentioned a meeting${eventInfo.date ? ` on ${eventInfo.date}` : ''}. I'll remember to ask you about it!`;
    case 'deadline':
      return `That deadline${eventInfo.date ? ` on ${eventInfo.date}` : ''} sounds important! I'll check in with you about it as it approaches.`;
    case 'birthday':
      return `I'll make sure to remember that birthday${eventInfo.date ? ` on ${eventInfo.date}` : ''}!`;
    default:
      return `I noticed you mentioned ${eventTitle}${eventInfo.date ? ` on ${eventInfo.date}` : ''}. I'll remember to follow up with you about it!`;
  }
}

/**
 * Creates a follow-up event for after an event occurs
 * @param {string} userId - User ID
 * @param {Object} eventInfo - Event information
 * @param {string} channelId - Channel ID
 * @param {string} guildId - Guild ID
 */
async function createFollowUpEvent(userId, eventInfo, channelId, guildId) {
  try {
    // Schedule follow-up for 2 hours after the event
    const eventDate = new Date(`${eventInfo.date}T${eventInfo.time || '12:00'}`);
    const followUpDate = new Date(eventDate.getTime() + (2 * 60 * 60 * 1000));
    
    // Create follow-up event with guild ID
    await createEvent({
      user_id: userId,
      guild_id: guildId,
      event_type: EVENT_TYPES.FOLLOW_UP,
      title: `Follow-up about ${eventInfo.title || eventInfo.type}`,
      description: `Following up on ${eventInfo.type} that was scheduled for ${eventInfo.date} ${eventInfo.time || ''}`,
      event_date: followUpDate.toISOString(),
      reminder_minutes: [0], // Only remind at the exact time
      channel_id: channelId
    });
    
    logger.info(`Created follow-up event for user ${userId} in guild ${guildId} about ${eventInfo.type}`);
  } catch (error) {
    logger.error("Error creating follow-up event:", error);
  }
}

/**
 * Creates a reminder for an event
 * @param {string} userId - User ID
 * @param {Object} eventInfo - Event information
 * @param {string} channelId - Channel ID
 * @param {string} guildId - Guild ID
 */
async function createReminderForEvent(userId, eventInfo, channelId, guildId) {
  try {
    // Calculate event date
    const eventDate = new Date(`${eventInfo.date}T${eventInfo.time || '12:00'}`);
    
    // Create reminder event with guild ID
    await createEvent({
      user_id: userId,
      guild_id: guildId,
      event_type: EVENT_TYPES.REMINDER,
      title: eventInfo.title || `${eventInfo.type} reminder`,
      description: `Reminder for ${eventInfo.type} on ${eventInfo.date} ${eventInfo.time || ''}`,
      event_date: eventDate.toISOString(),
      reminder_minutes: [REMINDER_TIMES.DAY_BEFORE, REMINDER_TIMES.HOUR_BEFORE], // Remind 1 day and 1 hour before
      channel_id: channelId
    });
    
    logger.info(`Created reminder event for user ${userId} in guild ${guildId} about ${eventInfo.type}`);
  } catch (error) {
    logger.error("Error creating reminder event:", error);
  }
}