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
  setUserDynamicPrompt
} from './db/userSettings.js';
import { splitMessage, replaceEmoticons } from './textUtils.js';
import { openai, getChatCompletion, defaultAskModel, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { enhancedMemoryExtraction } from './extractionAndMemory.js';
import { enhancedSummarizeConversation } from './summarization.js';
import { analyzeImage, analyzeImages } from '../services/visionService.js';
import { getBatchEmbeddings } from './improvedEmbeddings.js';
import { getCachedUser, invalidateUserCache, warmupUserCache, cachedVectorSearch } from '../utils/databaseCache.js';
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
 * Handle image attachments with guild context
 * @param {Message} message - The Discord message
 * @param {string} cleanedContent - The cleaned message content
 * @param {string} guildId - The guild ID
 * @returns {Promise<boolean>} - Whether images were handled
 */
async function handleImageAttachments(message, cleanedContent, guildId) {
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
    
    // Get conversation history for this user from database
    let conversationHistory = await getUserConversation(message.author.id, guildId) || [];
    
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
      
      // Save the updated conversation to database
      await setUserConversation(message.author.id, guildId, conversationHistory);
      
      invalidateUserCache(message.author.id, guildId);
    }
    
    logger.info(`Successfully processed images for user ${message.author.id} in guild ${guildId}`);
    return true; // Images were processed
  } catch (error) {
    logger.error("Error processing images:", error);
    await message.reply("I had trouble understanding those images. Can you try sending them again?");
    return true; // Error, but still handled the images
  }
}

// The handleLegacyMessage function should be restructured as follows:

export async function handleLegacyMessage(message) {
  // Skip bot messages
  if (message.author.bot) return;
  
  // Skip if no guild (DMs)
  if (!message.guild) return;
  
  // Get guild ID for multi-server support
  const guildId = message.guild.id;
  
  // Get server configuration
  const serverConfig = await getServerConfig(guildId);
  const serverPrefix = serverConfig.prefix || 'bri';
  
  // Track user activity with guild context
  const userGuildKey = `${message.author.id}:${guildId}`;
  const lastInteraction = userLastActive.get(userGuildKey) || 0;
  const now = Date.now();
  
  // If user was inactive for more than 10 minutes, refresh their cache
  if (now - lastInteraction > 10 * 60 * 1000) {
    await warmupUserCache(message.author.id, guildId);
  }

  // Update last active timestamp
  userLastActive.set(userGuildKey, now);

  const isDesignated = serverConfig.designated_channels.includes(message.channel.id);
  let cleanedContent = message.content;

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
  
  // Check if this is a non-designated channel
  if (!isDesignated) {
    // Build the prefix regex based on server configuration
    const prefixRegex = new RegExp(`^(hey\\s+)?${serverPrefix}+\\b`, 'i');
    
    // Check if this is a reply to the bot's message
    const isReplyToBot = message.reference && 
                          message.reference.messageId && 
                          (await message.channel.messages.fetch(message.reference.messageId))?.author.id === message.client.user.id;
    
    // Only proceed in three cases:
    // 1. Message has the server-specific prefix, or
    // 2. Message is a direct reply to the bot, or
    // 3. Message has BOTH an image AND the server-specific prefix
    const hasPrefix = prefixRegex.test(message.content);
    const hasImageWithPrefix = imageAttachments.size > 0 && hasPrefix;
    
    if (!hasPrefix && !isReplyToBot && !hasImageWithPrefix) {
      return; // Skip this message
    }
    
    // Clean the content if it has the prefix
    if (hasPrefix) {
      cleanedContent = message.content.replace(prefixRegex, '').trim();
    }
  } else {
    // Skip processing messages that start with :: in designated channels
    if (message.content.startsWith('::')) {
      return; // Silently ignore these messages
    }
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
  const imagesHandled = await handleImageAttachments(message, cleanedContent, guildId);
  
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

    // Using DB functions now instead of in-memory Map objects
  
  // Get conversation from database
  let conversation = await getUserConversation(message.author.id, guildId) || [
    { role: "system", content: combinedSystemPrompt }
  ];
  
  // Update the system prompt and add the user's message
  conversation[0] = { role: "system", content: combinedSystemPrompt };
  conversation.push({ role: "user", content: cleanedContent });

  // Apply context length limit
  const contextLength = await getUserContextLength(message.author.id, guildId) || defaultContextLength;
  if (conversation.length > contextLength) {
    conversation = [conversation[0], ...conversation.slice(-(contextLength - 1))];
  }
  
  // Save updated conversation to database instead of in-memory Map
  await setUserConversation(message.author.id, guildId, conversation);

  await message.channel.sendTyping();

  try {
    // Find relevant content to potentially share with this user - only if character feature is enabled
    const characterEnabled = await isFeatureEnabled(guildId, 'character');
    const relevantContent = characterEnabled 
      ? await findRelevantContentToShare(message.author.id, cleanedContent, guildId) 
      : null;
    
    let personalContent = '';
    if (relevantContent) {
      personalContent = await getPersonalContent(message.author.id, relevantContent, guildId);
    }
    
    // If there's personal content to share, add it to the system prompt
    if (personalContent) {
      // Add Bri's personal content to the prompt
      const updatedPrompt = conversation[0].content + 
      `\n\nYou feel like sharing this personal information about yourself: ${personalContent}`;
          
      conversation[0] = { role: "system", content: updatedPrompt };
    }
    
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
    if (characterEnabled) {
      detectAndStoreInsideJoke(message.author.id, cleanedContent, guildId).catch(error => {
        logger.error("Error detecting inside joke:", error);
      });
      
      // Personalize response based on relationship
      reply = await personalizeResponse(message.author.id, reply, guildId);
    }

    // Apply emoticons
    reply = replaceEmoticons(reply);

    // Update conversation with Bri's response 
    conversation.push({ role: "assistant", content: reply });
    
    // Get dynamic prompt directly from database
    const dynamicPrompt = await getUserDynamicPrompt(message.author.id, guildId);
    
    // Save to database directly - overwrite in-memory approach
    await setUserConversation(message.author.id, guildId, conversation);
    
    invalidateUserCache(message.author.id, guildId);

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
        
      // Use incremental extraction - no need to pass message ID anymore
      summarizeAndExtract(message.author.id, conversation, guildId).catch(err => {
        logger.error(`Error in memory extraction process: ${err}`);
      });
        
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
      } else {
        logger.info(`No new memories found for user ${userId} in guild ${guildId}`);
      }
    } else {
      logger.error(`Error in memory extraction for user ${userId}: ${result.error}`);
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