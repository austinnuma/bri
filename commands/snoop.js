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
            terms: ['like', 'love', 'enjoy', 'prefer', 'favorite', 'favourite', 'hate', 'dislike'] 
        },
        { 
            category: MemoryCategories.HOBBIES, 
            terms: ['hobby', 'hobbies', 'collect', 'play', 'game', 'sport', 'activity', 'free time'] 
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
        
        // Get relevant memories (limit to 6 for better context)
        const memories = await retrieveRelevantMemories(targetUserId, query, 6, null, category);
        
        if (!memories || memories.trim() === "") {
            if (category) {
                return interaction.editReply(`I know ${targetUsername}, but I don't remember anything specific about their ${query} in the ${category} category.`);
            } else {
                return interaction.editReply(`I know ${targetUsername}, but I don't remember anything specific about their ${query}.`);
            }
        }
        
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

For example, if asked "what's their favorite food" and I know it, I might say: "Oh! ${targetUsername} really likes pizza! They told me it's their favorite food!" - simple and direct.
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