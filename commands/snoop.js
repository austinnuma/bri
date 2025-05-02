// commands/snoop.js
import { SlashCommandBuilder } from 'discord.js';
import { openai, defaultAskModel } from '../services/combinedServices.js';
import { retrieveRelevantMemories, MemoryCategories } from '../utils/unifiedMemoryManager.js';
import { supabase } from '../services/combinedServices.js';
import { logger } from '../utils/logger.js';
import { getEffectiveSystemPrompt } from '../utils/unifiedMemoryManager.js';
import { replaceEmoticons } from '../utils/textUtils.js';

export const data = new SlashCommandBuilder()
    .setName('snoop')
    .setDescription('Ask Bri what she knows about another user')
    .addStringOption(option =>
        option.setName('username')
            .setDescription('The username of the person to ask about')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('question')
            .setDescription('What you want to know about this person')
            .setRequired(true));

/**
 * Finds a Discord user ID from a username or nickname.
 * @param {string} username - The username to search for
 * @returns {Promise<string|null>} - User ID or null if not found
 */
async function findUserIdByName(username) {
    try {
        // Validate username is not empty
        if (!username || username.trim() === '') {
            return null;
        }
        
        // Try to find from our database mapping
        const { data, error } = await supabase
            .from('discord_users')
            .select('user_id')
            .or(`username.ilike.%${username}%,nickname.ilike.%${username}%`)
            .limit(1);
            
        if (error) {
            logger.error("Error querying user mapping", { error, username });
            return null;
        }
        
        if (data && data.length > 0) {
            return data[0].user_id;
        }
        
        // If we can't find in our mapping, check unified_memories for name mentions
        const { data: memoryData, error: memoryError } = await supabase
            .from('unified_memories')
            .select('user_id, memory_text')
            .or(`memory_text.ilike.%name is ${username}%,memory_text.ilike.%called ${username}%,memory_text.ilike.%named ${username}%`)
            .limit(5);
            
        if (memoryError) {
            logger.error("Error searching memories for username", { error: memoryError, username });
            return null;
        }
        
        if (!memoryData || memoryData.length === 0) {
            return null;
        }
        
        // Return the first user ID found
        return memoryData[0].user_id;
    } catch (error) {
        logger.error("Unexpected error finding user by name", { error, username });
        return null;
    }
}

/**
 * Detects a memory category from the query text
 * @param {string} query - The query text
 * @returns {string|null} - Category name or null
 */
function detectCategory(query) {
    const lowered = query.toLowerCase();
    
    const categoryPatterns = [
        { 
            category: MemoryCategories.PERSONAL, 
            terms: ['name', 'age', 'birthday', 'born', 'lives', 'from', 'where', 'family', 'married', 'children'] 
        },
        { 
            category: MemoryCategories.PROFESSIONAL, 
            terms: ['job', 'work', 'career', 'company', 'business', 'profession', 'school', 'study', 'degree'] 
        },
        { 
            category: MemoryCategories.PREFERENCES, 
            terms: ['like', 'love', 'enjoy', 'prefer', 'favorite', 'favourite', 'hate', 'dislike', 'opinion', 'think', 'feel'] 
        },
        { 
            category: MemoryCategories.HOBBIES, 
            terms: ['hobby', 'hobbies', 'collect', 'play', 'game', 'sport', 'activity', 'free time', 'interest', 'passion'] 
        },
        { 
            category: MemoryCategories.CONTACT, 
            terms: ['email', 'phone', 'address', 'contact', 'reach'] 
        }
    ];
  
    for (const pattern of categoryPatterns) {
        if (pattern.terms.some(term => lowered.includes(term))) {
            return pattern.category;
        }
    }
  
    return null;
}

/**
 * Expands a query to improve memory retrieval
 * @param {string} query - The original query
 * @param {string} username - The username being asked about
 * @returns {Promise<string>} - Expanded query
 */
async function expandQueryForBetterRetrieval(query, username) {
    try {
        // Use LLM to expand the query with synonyms and related terms
        const expandPrompt = `
I need to search for information about a user named ${username}. 
The original search query is: "${query}"

Rewrite this query to improve search results, by:
1. Including synonyms of key terms
2. Adding related concepts that might appear in the user's memories
3. Including alternative ways they might have expressed this information
4. Making it more general to catch partial matches

Output ONLY the expanded search query text with no explanation, quotes or other commentary.
`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Use a smaller, faster model for this task
            messages: [
                { role: "system", content: "You are a search query optimizer that helps expand search queries to improve retrieval results." },
                { role: "user", content: expandPrompt }
            ],
            max_tokens: 150,
            temperature: 0.7,
        });
        
        const expandedQuery = completion.choices[0].message.content.trim();
        return expandedQuery;
    } catch (error) {
        logger.error("Error expanding query:", error);
        // Fall back to original query
        return query;
    }
}

/**
 * Gets all memories for a user directly from the database
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<Array>} - Array of memories
 */
async function getDirectMemories(userId, guildId) {
    try {
        // Try to get up to 10 recent memories with highest confidence
        const { data, error } = await supabase
            .from('unified_memories')
            .select('memory_text, confidence, created_at')
            .eq('user_id', userId)
            .eq('guild_id', guildId)
            .order('confidence', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(10);
            
        if (error) {
            logger.error("Error fetching direct memories:", error);
            return [];
        }
        
        return data || [];
    } catch (error) {
        logger.error("Error in getDirectMemories:", error);
        return [];
    }
}

export async function execute(interaction) {
    await interaction.deferReply();
    
    try {
        const targetUsername = interaction.options.getString('username');
        const query = interaction.options.getString('question');
        
        logger.info(`User ${interaction.user.id} used snoop command to ask about ${targetUsername}'s ${query}`);
        
        // Find the target user ID
        const targetUserId = await findUserIdByName(targetUsername);
        if (!targetUserId) {
            return interaction.editReply(`I don't think I've met ${targetUsername} before! Or maybe they go by a different name?`);
        }
        
        // Optional: detect a category based on the question
        const category = detectCategory(query);
        logger.info(`Detected category: ${category || 'none'} for query: "${query}"`);
        
        // Try to expand the query for better memory retrieval
        const expandedQuery = await expandQueryForBetterRetrieval(query, targetUsername);
        logger.info(`Expanded query: "${expandedQuery}"`);
        
        // Get a higher number of memories first for better context
        const memories = await retrieveRelevantMemories(targetUserId, expandedQuery, 8, null, category, interaction.guildId);
        
        // Fallback: If no memories were found, try a more direct approach with raw database query
        if (!memories || memories.trim() === "") {
            logger.info(`No memories found using expanded query. Trying direct database query.`);
            const rawMemories = await getDirectMemories(targetUserId, interaction.guildId);
            
            if (!rawMemories || rawMemories.length === 0) {
                return interaction.editReply(`I know ${targetUsername}, but I don't remember anything specific about their ${query}.`);
            }
            
            // Format the raw memories
            const formattedRawMemories = rawMemories.map(m => `- ${m.memory_text}`).join('\n');
            
            // Generate a response based on raw memories
            const promptText = `
I need to answer a question about ${targetUsername}. The question is: "${query}"

Even though these memories might not be directly related to the question, here's what I know about ${targetUsername}:
${formattedRawMemories}

Guidelines:
1. Focus ONLY on answering the specific question about ${targetUsername}
2. Only mention information that's directly relevant to the question
3. If none of these memories have information specifically about the question, just say I don't know that specific detail about ${targetUsername}
4. Use third person (they/them/their) when referring to ${targetUsername}
5. Be brief and direct - answer just what was asked
6. Don't explain that you're distinguishing between users or mention mechanics of how you're answering
7. Maintain my cheerful 14-year-old personality, but stay focused on the actual question

For example, if asked "what's their favorite food" and I see they mentioned "I love pizza", I might say: "Oh! ${targetUsername} really likes pizza! They told me it's their favorite food!" - simple and direct.
`;

            const completion = await openai.chat.completions.create({
                model: defaultAskModel,
                messages: [
                    { role: "system", content: getEffectiveSystemPrompt(interaction.user.id) },
                    { role: "user", content: promptText }
                ],
                max_tokens: 1500,
            });
            
            const response = replaceEmoticons(completion.choices[0].message.content);
            return interaction.editReply(response);
        }
        
        logger.info(`Retrieved memories for ${targetUsername}: \n${memories}`);
        
        // Generate a response based on the memories
        const promptText = `
I need to answer a question about ${targetUsername}. The question is: "${query}"

Relevant information I know about ${targetUsername}:
${memories}

Guidelines:
1. Focus ONLY on answering the specific question about ${targetUsername}
2. Only mention information that's directly relevant to the question
3. If I don't have information specifically about the question, just say I don't know that specific detail about ${targetUsername}
4. Use third person (they/them/their) when referring to ${targetUsername}
5. Be brief and direct - answer just what was asked
6. Don't explain that you're distinguishing between users or mention mechanics of how you're answering
7. Maintain my cheerful 14-year-old personality, but stay focused on the actual question
8. IMPORTANT: Read the memories carefully and identify information that answers the question, even if it's not an exact match. Use your understanding to infer information when appropriate.

For example, if asked "what's their favorite food" and they once said "I love pizza", I might say: "Oh! ${targetUsername} really likes pizza! They told me it's their favorite food!" - simple and direct.
`;

        const completion = await openai.chat.completions.create({
            model: defaultAskModel,
            messages: [
                { role: "system", content: getEffectiveSystemPrompt(interaction.user.id) },
                { role: "user", content: promptText }
            ],
            max_tokens: 1500,
        });
        
        const response = replaceEmoticons(completion.choices[0].message.content);
        
        await interaction.editReply(response);
        
    } catch (error) {
        logger.error('Error executing snoop command:', error);
        await interaction.editReply('Sorry, I had trouble looking up that information. Can you try again?');
    }
}