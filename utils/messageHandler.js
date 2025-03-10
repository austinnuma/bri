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
import { extractIntuitedMemories, enhancedMemoryExtraction } from './extractionAndMemory.js';
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
import { extractTimeAndEvent, createEvent, EVENT_TYPES, REMINDER_TIMES, getUserTimezone } from './timeSystem.js';
import { getEmbedding } from './improvedEmbeddings.js';
import natural from 'natural';


const { userConversations, userContextLengths, userDynamicPrompts } = memoryManagerState;

const SUMMARY_THRESHOLD = 3;
const INACTIVITY_THRESHOLD = 8 * 60 * 60 * 1000; // 8 hours

// Track user activity times
const userLastActive = new Map();

// We'll store the last summary timestamp per user in memory.
const lastSummaryTimestamps = new Map();
// Track new messages since last extraction
const userMessageCounters = new Map();

function normalizeForComparison(text) {
  return text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}


/**
 * Checks if a memory text is similar to any existing memory for a user
 * @param {string} userId - User ID
 * @param {string} memoryText - Memory text to check
 * @returns {Promise<boolean>} - Whether a similar memory exists
 */
async function isDuplicateMemory(userId, memoryText) {
  try {
    // First, extract the category to only compare within the same type of memory
    const category = categorizeMemory(memoryText);
    
    // Get existing memories in this category
    const { data, error } = await supabase
      .from('unified_memories')
      .select('memory_text')
      .eq('user_id', userId)
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
        logger.info(`Found similar memory: "${memory.memory_text}" vs "${memoryText}" (similarity: ${similarity.toFixed(3)})`);
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

  // Update relationship after each interaction
  updateRelationshipAfterInteraction(message.author.id, cleanedContent).catch(error => {
    logger.error("Error updating relationship:", error);
    // Don't stop message processing for relationship errors
  });

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
    // Find relevant content to potentially share with this user
    const relevantContent = await findRelevantContentToShare(message.author.id, cleanedContent);
    let personalContent = '';
        
    if (relevantContent) {
      personalContent = await getPersonalContent(message.author.id, relevantContent);
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

    // Check for potential time-sensitive information in the user's message
    const timeInfo = await checkForTimeRelatedContent(cleanedContent, message.author.id, message.channel.id);
  
    if (timeInfo && timeInfo.shouldAsk) {
      // If time-sensitive info was found, modify Bri's response to acknowledge it
      reply += `\n\n${timeInfo.followUpQuestion}`;
    }

    // Check for potential inside jokes
    detectAndStoreInsideJoke(message.author.id, cleanedContent).catch(error => {
      logger.error("Error detecting inside joke:", error);
    });
    
    // Personalize response based on relationship
    reply = await personalizeResponse(message.author.id, reply);

     // Apply emoticons
    reply = replaceEmoticons(reply);

    // Update conversation with Bri's response
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
    const summary = await enhancedSummarizeConversation(conversationCopy);
    if (!summary) {
      logger.warn(`Failed to generate summary for user ${userId}`);
      return;
    }
    
     // Use the enhanced two-stage memory extraction
     const extractedFacts = await enhancedMemoryExtraction(userId, conversationCopy);
    
    // Also analyze the conversation for interests after summarization
    analyzeConversationForInterests(userId, conversation).catch(err => {
      logger.error("Error analyzing summarized conversation for interests:", err);
    });

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

    // Deduplicate memories before insertion
    const uniqueMemories = [];
    const duplicateIndices = new Set();

    // Check each memory against existing memories in the database
    for (let i = 0; i < memoryObjects.length; i++) {
      if (duplicateIndices.has(i)) continue; // Skip if already marked as duplicate
      
      const memory = memoryObjects[i];
      const isDuplicate = await isDuplicateMemory(userId, memory.memory_text);
      
      if (!isDuplicate) {
        uniqueMemories.push(memory);
        
        // Also check against other memories in this batch
        for (let j = i + 1; j < memoryObjects.length; j++) {
          if (duplicateIndices.has(j)) continue;
          
          const otherMemory = memoryObjects[j];
          const similarity = natural.JaroWinklerDistance(
            normalizeForComparison(memory.memory_text),
            normalizeForComparison(otherMemory.memory_text)
          );
          
          if (similarity > 0.92) {
            duplicateIndices.add(j); // Mark as duplicate
            logger.info(`Found duplicate in batch: "${memory.memory_text}" vs "${otherMemory.memory_text}"`);
          }
        }
      } else {
        duplicateIndices.add(i);
      }
    }

    logger.info(`Filtered out ${duplicateIndices.size} duplicate memories, inserting ${uniqueMemories.length} unique memories`);

    // Insert only unique memories
    if (uniqueMemories.length > 0) {
      try {
        // Use onConflict strategy (Solution 5)
        const { data, error } = await supabase
          .from('unified_memories')
          .insert(uniqueMemories, {
            onConflict: 'user_id,memory_text', // Add this if your DB schema has a unique constraint
            ignoreDuplicates: true
          });
          
        if (error) {
          logger.error("Error batch inserting memories:", error);
          // Fall back to individual inserts if batch fails
          for (const memory of uniqueMemories) {
            await insertIntuitedMemory(userId, memory.memory_text);
          }
        } else {
          logger.info(`Successfully inserted ${uniqueMemories.length} unique memories for user ${userId}`);
        }
      } catch (batchError) {
        logger.error("Error in batch memory insertion:", batchError);
        // Fall back to individual inserts
        for (const memory of uniqueMemories) {
          await insertIntuitedMemory(userId, memory.memory_text);
        }
      }
    } else {
      logger.info(`No unique memories to insert for user ${userId}`);
    }
  } catch (error) {
    logger.error(`Error in background summarization process: ${error}`);
  }
}

/**
 * Checks message content for time-related information and creates follow-up events
 * @param {string} content - Message content
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @returns {Promise<Object|null>} - Time-related context info or null
 */
async function checkForTimeRelatedContent(content, userId, channelId) {
  try {
    // Don't process very short messages
    if (content.length < 10) return null;
    
    // Extract time and event information
    const eventInfo = await extractTimeAndEvent(content);
    
    // If no time info, exit early
    if (!eventInfo) return null;
    
    // Get the user's timezone
    const timezone = await getUserTimezone(userId);
    
    // Check if this is a significant event that we should offer to remember
    const isSignificantEvent = isEventSignificant(eventInfo);
    
    if (!isSignificantEvent) return null;
    
    // Generate a custom follow-up question based on the event type
    const followUpQuestion = generateFollowUpQuestion(eventInfo);
    
    // For very clear, important events, automatically create a follow-up reminder
    if (eventInfo.type === 'appointment' || 
        eventInfo.type === 'interview' || 
        eventInfo.title?.toLowerCase().includes('interview')) {
      
      // Create a follow-up event
      await createFollowUpEvent(userId, eventInfo, channelId);
      
      // Create a reminder for the actual event
      await createReminderForEvent(userId, eventInfo, channelId);
      
      // Return a flag indicating we've handled this automatically
      return {
        eventFound: true,
        eventType: eventInfo.type,
        shouldAsk: true,
        followUpQuestion
      };
    }
    
    // For other events, just indicate we found something time-related
    return {
      eventFound: true,
      eventType: eventInfo.type,
      shouldAsk: true,
      followUpQuestion
    };
  } catch (error) {
    logger.error("Error checking for time-related content:", error);
    return null;
  }
}

/**
 * Determines if an event is significant enough to remember
 * @param {Object} eventInfo - Event information
 * @returns {boolean} - Whether the event is significant
 */
function isEventSignificant(eventInfo) {
  // Consider significant if it has a specific date/time
  if (!eventInfo.date) return false;
  
  // Check the event type
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
 */
async function createFollowUpEvent(userId, eventInfo, channelId) {
  try {
    // Schedule follow-up for 2 hours after the event
    const eventDate = new Date(`${eventInfo.date}T${eventInfo.time || '12:00'}`);
    const followUpDate = new Date(eventDate.getTime() + (2 * 60 * 60 * 1000));
    
    // Create follow-up event
    await createEvent({
      user_id: userId,
      event_type: EVENT_TYPES.FOLLOW_UP,
      title: `Follow-up about ${eventInfo.title || eventInfo.type}`,
      description: `Following up on ${eventInfo.type} that was scheduled for ${eventInfo.date} ${eventInfo.time || ''}`,
      event_date: followUpDate.toISOString(),
      reminder_minutes: [0], // Only remind at the exact time
      channel_id: channelId
    });
    
    logger.info(`Created follow-up event for user ${userId} about ${eventInfo.type}`);
  } catch (error) {
    logger.error("Error creating follow-up event:", error);
  }
}

/**
 * Creates a reminder for an event
 * @param {string} userId - User ID
 * @param {Object} eventInfo - Event information
 * @param {string} channelId - Channel ID
 */
async function createReminderForEvent(userId, eventInfo, channelId) {
  try {
    // Calculate event date
    const eventDate = new Date(`${eventInfo.date}T${eventInfo.time || '12:00'}`);
    
    // Create reminder event
    await createEvent({
      user_id: userId,
      event_type: EVENT_TYPES.REMINDER,
      title: eventInfo.title || `${eventInfo.type} reminder`,
      description: `Reminder for ${eventInfo.type} on ${eventInfo.date} ${eventInfo.time || ''}`,
      event_date: eventDate.toISOString(),
      reminder_minutes: [REMINDER_TIMES.DAY_BEFORE, REMINDER_TIMES.HOUR_BEFORE], // Remind 1 day and 1 hour before
      channel_id: channelId
    });
    
    logger.info(`Created reminder event for user ${userId} about ${eventInfo.type}`);
  } catch (error) {
    logger.error("Error creating reminder event:", error);
  }
}