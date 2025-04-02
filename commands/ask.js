import { getEffectiveSystemPrompt, getCombinedSystemPromptWithMemories } from '../utils/unifiedMemoryManager.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { openai, defaultAskModel } from '../services/combinedServices.js';
import { replaceEmoticons } from '../utils/textUtils.js';
import { logger } from '../utils/logger.js';
import { getCachedUser, invalidateUserCache } from '../utils/cacheManager.js';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask bri a question')
  .addStringOption(option =>
    option.setName('query')
      .setDescription('What would you like to ask?')
      .setRequired(true));

export async function execute(interaction) {
  try {
    // Warm up cache for this user
    await warmupUserCache(interaction.user.id);
    await interaction.deferReply();
    
    const userId = interaction.user.id;
    const query = interaction.options.getString('query');
    
    // Get the system prompt and enrich it with relevant memories
    const systemPrompt = getEffectiveSystemPrompt(userId);
    const combinedPrompt = await getCombinedSystemPromptWithMemories(userId, systemPrompt, query);
    
    // Simple message context with just the query
    const messages = [
      { role: "system", content: combinedPrompt },
      { role: "user", content: query },
    ];
    
    // Get completion from OpenAI
    const completion = await getChatCompletion({
      model: defaultAskModel,
      messages: messages,
      max_tokens: 3000,
    });
    
    // Process and send the response
    let reply = completion.choices[0].message.content;
    reply = replaceEmoticons(reply);
    
    await interaction.editReply(reply);
    logger.info(`Handled /ask command for user ${userId}`);
  } catch (error) {
    logger.error('Error executing ask command:', error);
    await interaction.editReply('Sorry, there was an error processing your question.');
  }

  await supabase.from('user_conversations').upsert({
    user_id: message.author.id,
    conversation,
    system_prompt: STATIC_CORE_PROMPT + "\n" + (userDynamicPrompts.get(message.author.id) || ""),
    context_length: userContextLengths.get(message.author.id) || defaultContextLength,
    updated_at: new Date().toISOString(),
  });
  // Add cache invalidation:
  invalidateUserCache(interaction.user.id);
}