// This file demonstrates how to integrate the new contextBuilder.js module
// with the existing messageHandler.js

// Import the new context builder functions
import {
  buildEnhancedContext,
  DEFAULT_DM_CONTEXT_LENGTH,
  DEFAULT_CHANNEL_CONTEXT_LENGTH
} from './contextBuilder.js';

// Example of how to modify the handleLegacyMessage function to use the new context builder
// This is just a sample - you would need to integrate this with your full message handler

// Simplified example of the changes needed to messageHandler.js - handleLegacyMessage function
export async function handleLegacyMessageWithEnhancedContext(message) {
  // Skip bot messages
  if (message.author.bot) return;
  
  // Skip if no guild (DMs)
  if (!message.guild) return;
  
  // Get guild ID for multi-server support
  const guildId = message.guild.id;
  
  // Check if message is in a thread and get thread ID if it is
  const isThread = message.channel.isThread();
  const threadId = isThread ? message.channel.id : null;
  
  // ... [other existing code from handleLegacyMessage] ...
  
  // MODIFIED SECTION: Context Building
  // Previously this used something like:
  // const effectiveSystemPrompt = getEffectiveSystemPrompt(message.author.id, guildId);
  // const combinedSystemPrompt = await getCombinedSystemPromptWithMemories(
  //   message.author.id, 
  //   effectiveSystemPrompt, 
  //   cleanedContent,
  //   guildId
  // );
  
  // First get the base elements just like before
  const effectiveSystemPrompt = getEffectiveSystemPrompt(message.author.id, guildId);
  
  // Get user settings including conversation
  const userSettings = await batchGetUserSettings(message.author.id, guildId, threadId);
  let conversation = userSettings.conversation;
  
  // If conversation doesn't have a system prompt, add it
  if (!conversation || !conversation.length) {
    conversation = [{ role: "system", content: effectiveSystemPrompt }];
  } else {
    // Update the system prompt
    conversation[0] = { role: "system", content: effectiveSystemPrompt };
  }
  
  // Add the user's message
  conversation.push({ role: "user", content: cleanedContent });
  
  // If we have context from a replied-to message, store it for the context builder
  if (repliedToMessageContext) {
    message.replyContext = repliedToMessageContext;
  }
  
  // Get relevant memory information
  const memories = await retrieveMemoriesWithGraphAndTemporal(
    message.author.id, 
    cleanedContent, 
    6, 
    null, 
    null, 
    guildId
  );
  
  // Get character sheet information
  const characterSheetInfo = await getCharacterSheetForPrompt(message.author.id, guildId);
  
  // Get time-related context
  const timeContext = await getTimeEventsForContextEnhancement(message.author.id, guildId);
  
  // Build the enhanced context
  const enhancedContext = await buildEnhancedContext(
    message.author.id,
    guildId,
    cleanedContent,
    message,
    effectiveSystemPrompt,
    characterSheetInfo,
    memories,
    timeContext,
    conversation,
    DEFAULT_DM_CONTEXT_LENGTH,
    DEFAULT_CHANNEL_CONTEXT_LENGTH
  );
  
  // Use the enhanced conversation for the AI completion
  conversation = enhancedContext.conversation;
  
  // Save to database, but only keep the direct conversation for storage efficiency
  // This is the same conversation but with a reduced context length
  // The channel messages are fetched each time and don't need to be stored
  // This prevents the conversation history from getting too bloated
  await setUserConversation(message.author.id, guildId, conversation, threadId);
  
  // ... [rest of the handler, getting completion from AI, etc.] ...
  
  // Get completion from AI using the enhanced context
  const completion = await getChatCompletion({
    model: defaultAskModel,
    messages: conversation,
    max_tokens: 3000,
  });
  
  let reply = completion.choices[0].message.content;
  
  // Add Bri's response to the conversation
  conversation.push({ role: "assistant", content: reply });
  
  // Save to database again with Bri's response included
  await setUserConversation(message.author.id, guildId, conversation, threadId);
  
  // ... [rest of the handler, sending reply, etc.] ...
}

// The key changes are:
// 1. Using buildEnhancedContext to create a more structured system prompt
// 2. Including channel context in the system prompt
// 3. Limiting direct messages to DEFAULT_DM_CONTEXT_LENGTH (10)
// 4. Adding clear section labels to the system prompt
// 5. Still saving the conversation array to the database for future use