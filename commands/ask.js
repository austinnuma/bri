import { getEffectiveSystemPrompt, getCombinedSystemPromptWithMemories } from '../utils/unifiedMemoryManager.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { openai, defaultAskModel } from '../services/openaiService.js';
import { replaceEmoticons } from '../utils/textUtils.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask bri a question')
  .addStringOption(option =>
    option.setName('query')
      .setDescription('What would you like to ask?')
      .setRequired(true));

export async function execute(interaction) {
  try {
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
    const completion = await openai.chat.completions.create({
      model: defaultAskModel,
      messages: messages,
      max_tokens: 2000,
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
}