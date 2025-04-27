// Updated ask.js command that uses the enhanced context builder
import { getEffectiveSystemPrompt } from '../utils/unifiedMemoryManager.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { openai, defaultAskModel } from '../services/combinedServices.js';
import { replaceEmoticons } from '../utils/textUtils.js';
import { logger } from '../utils/logger.js';
import { getCachedUser, invalidateUserCache } from '../utils/cacheManager.js';
import { getUserConversation, setUserConversation } from '../utils/db/userSettings.js';
import { buildEnhancedContext } from '../utils/contextBuilder.js';
import { retrieveMemoriesWithGraphAndTemporal } from '../utils/enhancedGraphMemoryRetrieval.js';
import { getCharacterSheetForPrompt } from '../utils/userCharacterSheet.js';
import { getTimeEventsForContextEnhancement } from '../utils/timeSystem.js';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask bri a question')
  .addStringOption(option =>
    option.setName('query')
      .setDescription('What would you like to ask?')
      .setRequired(true));

export async function execute(interaction) {
  try {
    // Defer the reply to buy time for processing
    await interaction.deferReply();
    
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const query = interaction.options.getString('query');
    
    // Get the base system prompt
    const basePrompt = getEffectiveSystemPrompt(userId, guildId);
    
    // Get conversation history
    const conversation = await getUserConversation(userId, guildId) || 
      [{ role: "system", content: basePrompt }];
    
    // Create a temporary message object with channel info for context building
    const messageInfo = {
      channel: interaction.channel,
      author: { id: userId },
      client: { user: { id: interaction.client.user.id } }
    };
    
    // Get character sheet info
    const characterSheetInfo = await getCharacterSheetForPrompt(userId, guildId);
    
    // Get relevant memories
    const memories = await retrieveMemoriesWithGraphAndTemporal(
      userId, 
      query, 
      6, 
      null, 
      null, 
      guildId
    );
    
    // Get time-related context
    const timeContext = await getTimeEventsForContextEnhancement(userId, guildId);
    
    // Add user's query to conversation (temporary for context building)
    const tempConversation = [...conversation, { role: "user", content: query }];
    
    // Build the enhanced context
    const enhancedContext = await buildEnhancedContext(
      userId,
      guildId,
      query,
      messageInfo,
      basePrompt,
      characterSheetInfo,
      memories,
      timeContext,
      tempConversation
    );
    
    // Use the enhanced messages for OpenAI
    const messages = enhancedContext.conversation;
    
    // Get completion from OpenAI
    const completion = await getChatCompletion({
      model: defaultAskModel,
      messages: messages,
      max_tokens: 3000,
    });
    
    // Process and send the response
    let reply = completion.choices[0].message.content;
    reply = replaceEmoticons(reply);
    
    // Update the conversation with Bri's response
    messages.push({ role: "assistant", content: reply });
    
    // Save the updated conversation
    await setUserConversation(userId, guildId, messages);
    
    // Send the reply
    await interaction.editReply(reply);
    logger.info(`Handled /ask command for user ${userId} in guild ${guildId} with enhanced context`);
  } catch (error) {
    logger.error('Error executing ask command:', error);
    await interaction.editReply('Sorry, there was an error processing your question.');
  }
}