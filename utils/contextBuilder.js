// utils/contextBuilder.js - Enhanced context building for Bri
import { logger } from './logger.js';
import { STATIC_CORE_PROMPT } from './unifiedMemoryManager.js';
import { getUserConversation } from './db/userSettings.js';

// Default context lengths - can be customized per server if desired
export const DEFAULT_DM_CONTEXT_LENGTH = 10;  // Direct messages between Bri and user
export const DEFAULT_CHANNEL_CONTEXT_LENGTH = 10;  // Messages from channel

/**
 * Fetches recent channel messages for additional context
 * @param {Object} channel - Discord channel object
 * @param {string} userId - User ID to exclude their own messages
 * @param {string} botId - Bot's user ID to exclude bot's messages
 * @param {number} limit - Max messages to fetch
 * @returns {Promise<Array>} - Formatted channel messages
 */
export async function fetchRecentChannelMessages(channel, userId, botId, limit = DEFAULT_CHANNEL_CONTEXT_LENGTH) {
  try {
    // Fetch most recent messages from the channel
    const messages = await channel.messages.fetch({ limit: limit + 10 }); // Fetch extra to account for filtering
    
    // Filter out the user's own messages and the bot's messages
    // Also convert to array and take only the most recent 'limit' messages
    const filteredMessages = messages
      .filter(msg => msg.author.id !== userId && msg.author.id !== botId)
      .first(limit);
    
    // Format messages for context
    return filteredMessages.map(msg => ({
      author: msg.author.username,
      content: msg.content,
      timestamp: msg.createdAt.toISOString()
    }));
  } catch (error) {
    logger.error(`Error fetching channel context: ${error}`);
    return [];
  }
}

/**
 * Processes channel messages into a format suitable for the system prompt
 * @param {Array} channelMessages - Array of channel messages
 * @returns {string} - Formatted channel context
 */
export function processChannelMessages(channelMessages) {
  if (!channelMessages || channelMessages.length === 0) {
    return "No recent channel messages available.";
  }
  
  // Format channel messages as a conversation
  return channelMessages
    .map(msg => `${msg.author}: ${msg.content}`)
    .join('\n');
}

/**
 * Formats the conversation history between Bri and the user
 * @param {Array} conversation - The conversation array with role/content
 * @returns {string} - Formatted direct message history
 */
export function formatDirectMessages(conversation) {
  if (!conversation || conversation.length <= 1) { // Skip system message
    return "No message history available.";
  }
  
  // Start from index 1 to skip the system message
  return conversation.slice(1).map(msg => {
    const role = msg.role === 'user' ? 'User' : 'Bri';
    return `${role}: ${msg.content}`;
  }).join('\n');
}

/**
 * Formats the system prompt with clearly labeled sections
 * @param {string} corePrompt - Core instructions for Bri
 * @param {string} userContextSheet - User character sheet
 * @param {string} memories - Relevant memories
 * @param {string} directMessages - Recent messages between Bri and user
 * @param {string} channelContext - Recent channel messages
 * @param {string} timeContext - Time-related context
 * @param {string} replyContext - Context about replies
 * @returns {string} - Formatted system prompt with sections
 */
export function formatSystemPromptWithSections(
  corePrompt,
  userContextSheet = "",
  memories = "",
  directMessages = "",
  channelContext = "",
  timeContext = "",
  replyContext = ""
) {
  // Build the context structure explanation
  const contextStructure = `
# CONTEXT STRUCTURE
This system prompt contains several sections:
1. CORE INSTRUCTIONS: Your primary personality and behavior guidelines
2. USER CONTEXT: Specific information about the user you're talking to
3. RELEVANT MEMORIES: Facts and information you remember about this user
4. RECENT DIRECT MESSAGES: The last ${DEFAULT_DM_CONTEXT_LENGTH} messages between you and this specific user
5. CHANNEL CONTEXT: The last ${DEFAULT_CHANNEL_CONTEXT_LENGTH} messages from other users in the channel where this conversation is taking place
6. TIME CONTEXT: Any relevant time-related information

Focus on responding to the most recent message from the user while maintaining conversational context.
`;

  // Build the formatted system prompt with clear sections
  let formattedPrompt = `${corePrompt}\n`;
  
  // Add context structure explanation
  formattedPrompt += `\n${contextStructure}`;
  
  // Add user context sheet if available
  if (userContextSheet && userContextSheet.trim() !== "") {
    formattedPrompt += "\n# USER CONTEXT\n" + userContextSheet;
  }
  
  // Add memories if available
  if (memories && memories.trim() !== "") {
    formattedPrompt += "\n# RELEVANT MEMORIES\n" + memories;
  }
  
  // Add direct message history if available
  if (directMessages && directMessages.trim() !== "") {
    formattedPrompt += "\n# RECENT DIRECT MESSAGES\nThese are the most recent messages between you and this user:\n" + directMessages;
  }
  
  // Add channel context if available
  if (channelContext && channelContext.trim() !== "") {
    formattedPrompt += "\n# CHANNEL CONTEXT\nThese are recent messages from other users in the current channel. Use these to understand the broader conversation:\n" + channelContext;
  }
  
  // Add time context if available
  if (timeContext && timeContext.trim() !== "") {
    formattedPrompt += "\n# TIME CONTEXT\n" + timeContext + 
      "\n\nIf relevant and natural in conversation, you can reference these upcoming events. Don't force mentioning them if it wouldn't flow naturally in the conversation.";
  }
  
  // Add reply context if available
  if (replyContext && replyContext.trim() !== "") {
    formattedPrompt += "\n# REPLY CONTEXT\n" + replyContext + 
      `\nWhen you see a line starting with "CONTEXT_FROM_REPLIED_MESSAGE:", this indicates the user is replying to another user's message. ` +
      `Pay special attention to this context, as the user is likely referring to or asking about the content of that message. ` +
      `You should ALWAYS reference the original message and its author in your response, even if not directly asked about them.`;
  }
  
  return formattedPrompt;
}

/**
 * Builds enhanced context for Bri's responses
 * @param {string} userId - User ID
 * @param {string} guildId - Guild ID
 * @param {string} query - Current user message
 * @param {Object} message - Discord message object
 * @param {Array} conversation - Existing conversation history
 * @param {number} directMsgLimit - Max direct messages to include
 * @param {number} channelMsgLimit - Max channel messages to include
 * @returns {Promise<Object>} - Enhanced context with system prompt and conversation
 */
export async function buildEnhancedContext(
  userId, 
  guildId, 
  query, 
  message,
  basePrompt,
  characterSheetInfo = "",
  memories = "",
  timeContext = "",
  conversation = [],
  directMsgLimit = DEFAULT_DM_CONTEXT_LENGTH,
  channelMsgLimit = DEFAULT_CHANNEL_CONTEXT_LENGTH
) {
  try {
    // 1. Get channel context if available
    let channelContext = "";
    if (message && message.channel) {
      const channelMessages = await fetchRecentChannelMessages(
        message.channel, 
        userId, 
        message.client.user.id, 
        channelMsgLimit
      );
      channelContext = processChannelMessages(channelMessages);
    }
    
    // 2. Format direct message history
    const directMessages = formatDirectMessages(conversation);
    
    // 3. Check for reply context
    let replyContext = "";
    if (message && message.reference && message.reference.messageId) {
      // Logic to extract reply context is handled in messageHandler.js
      // We'll preserve the existing approach but format it better
      replyContext = message.replyContext || "";
    }
    
    // 4. Build the enhanced system prompt
    const enhancedSystemPrompt = formatSystemPromptWithSections(
      basePrompt,
      characterSheetInfo,
      memories,
      directMessages,
      channelContext,
      timeContext,
      replyContext
    );
    
    // 5. Create a new conversation array with the enhanced context
    // But only include the most recent X direct messages to avoid confusion
    const limitedDirectMessages = conversation.length > directMsgLimit + 1
      ? [conversation[0], ...conversation.slice(-(directMsgLimit))]
      : conversation;
    
    // 6. Update the system prompt in the conversation
    const enhancedConversation = [...limitedDirectMessages];
    if (enhancedConversation.length > 0 && enhancedConversation[0].role === "system") {
      enhancedConversation[0].content = enhancedSystemPrompt;
    } else {
      enhancedConversation.unshift({ role: "system", content: enhancedSystemPrompt });
    }
    
    return {
      systemPrompt: enhancedSystemPrompt,
      conversation: enhancedConversation
    };
  } catch (error) {
    logger.error(`Error building enhanced context: ${error}`);
    
    // Fallback to basic context
    return {
      systemPrompt: basePrompt,
      conversation: conversation.length > 0 
        ? conversation 
        : [{ role: "system", content: basePrompt }]
    };
  }
}