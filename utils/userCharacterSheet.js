// userCharacterSheet.js - Character sheet tracking for users
import { openai, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getUserTimezone } from './timeSystem.js';
import { retrieveRelevantMemories, MemoryCategories } from './unifiedMemoryManager.js';

/**
 * Initialize user character sheet system
 * Creates necessary database table if it doesn't exist
 */
export async function initializeUserCharacterSheetSystem() {
  try {
    logger.info("Initializing user character sheet system...");
    
    // Check if the user_character_sheet table exists
    const { error: sheetCheckError } = await supabase
      .from('user_character_sheet')
      .select('id')
      .limit(1);
      
    // Create table if it doesn't exist
    if (sheetCheckError && sheetCheckError.code === '42P01') {
      logger.info("Creating user_character_sheet table...");
      
      try {
        // Try to create the table using plain SQL
        const { error } = await supabase.query(`
          CREATE TABLE IF NOT EXISTS user_character_sheet (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            sheet JSONB NOT NULL,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(user_id, guild_id)
          );
        `);
        
        if (error) {
          logger.warn("Manual creation of user character sheet table may have failed:", error);
        } else {
          logger.info("User character sheet table created successfully");
        }
      } catch (createError) {
        logger.error("Error creating user character sheet table:", createError);
      }
    } else {
      logger.info("User character sheet table already exists");
    }
    
    logger.info("User character sheet system initialization complete");
  } catch (error) {
    logger.error("Error initializing user character sheet system:", error);
  }
}

/**
 * Default schema for user character sheet
 */
export const USER_CHARACTER_SHEET_SCHEMA = {
  // Personal information
  name: null,
  nickname: null,
  age: null,
  location: null,
  timezone: null,
  
  // Relationships
  family: [], // Array of family members {name, relation, details, last_mentioned}
  friends: [], // Array of friends {name, details, last_mentioned}
  pets: [], // Array of pets {name, type, details, last_mentioned}
  significant_other: null, // {name, details, last_mentioned}
  
  // Professional/Educational
  occupation: null, // {job, company, position, details}
  education: null, // {level, field, school, details}
  
  // Top preferences (frequently mentioned)
  top_preferences: [], // Array of {category, item, sentiment, confidence, last_mentioned}
  
  // Conversation style
  conversation_style: {
    formality: "neutral", // formal, neutral, casual, very_casual
    verbosity: "medium", // terse, medium, verbose
    emoji_usage: "medium", // none, low, medium, high
    humor_level: "medium", // low, medium, high
    vocabulary_complexity: "medium", // simple, medium, complex
    greeting_style: null, // their typical greeting pattern
    common_phrases: [], // phrases they use frequently
    interests_to_reference: [] // topics they respond positively to
  },
  
  // Interaction patterns
  interaction_patterns: {
    typical_time: null, // when they typically interact
    average_response_length: null, // short, medium, long
    question_frequency: "medium", // how often they ask questions
    last_active: null
  }
};

/**
 * Gets the character sheet for a specific user in a specific guild
 * @param {string} userId - The user ID 
 * @param {string} guildId - The guild ID 
 * @returns {Promise<Object>} - The user character sheet
 */
export async function getUserCharacterSheet(userId, guildId) {
  try {
    // Try to get existing character sheet for this user in this guild
    const { data, error } = await supabase
      .from('user_character_sheet')
      .select('sheet')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        // Create a new character sheet for this user in this guild
        const newSheet = { ...USER_CHARACTER_SHEET_SCHEMA };
        
        // Try to get user's timezone to pre-populate the sheet
        try {
          const timezone = await getUserTimezone(userId, guildId);
          if (timezone) {
            newSheet.timezone = timezone;
          }
        } catch (tzError) {
          logger.debug(`Could not get timezone for user ${userId}:`, tzError);
        }
        
        // Try to get user's Discord nickname
        try {
          const { data: userData } = await supabase
            .from('discord_users')
            .select('username, nickname')
            .eq('user_id', userId)
            .eq('server_id', guildId)
            .single();
            
          if (userData) {
            newSheet.nickname = userData.nickname || userData.username;
          }
        } catch (userError) {
          logger.debug(`Could not get Discord info for user ${userId}:`, userError);
        }
        
        const { data: createdData, error: createError } = await supabase
          .from('user_character_sheet')
          .insert({
            user_id: userId,
            guild_id: guildId,
            sheet: newSheet
          })
          .select('sheet')
          .single();
          
        if (createError) {
          logger.error(`Error creating character sheet for user ${userId} in guild ${guildId}:`, createError);
          return newSheet;
        }
        
        return createdData.sheet;
      }
      
      logger.error(`Error fetching character sheet for user ${userId} in guild ${guildId}:`, error);
      return { ...USER_CHARACTER_SHEET_SCHEMA };
    }
    
    return data.sheet;
  } catch (error) {
    logger.error(`Error in getUserCharacterSheet for user ${userId} in guild ${guildId}:`, error);
    return { ...USER_CHARACTER_SHEET_SCHEMA };
  }
}

/**
 * Updates the character sheet for a specific user in a specific guild
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {Object} sheet - Updated character sheet
 * @returns {Promise<boolean>} - Success status
 */
export async function updateUserCharacterSheet(userId, guildId, sheet) {
  try {
    const { error } = await supabase
      .from('user_character_sheet')
      .update({
        sheet: sheet,
        last_updated: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('guild_id', guildId);
      
    if (error) {
      logger.error(`Error updating character sheet for user ${userId} in guild ${guildId}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in updateUserCharacterSheet for user ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Integrates new memories into the user's character sheet
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<boolean>} - Success status
 */
export async function updateCharacterSheetFromMemories(userId, guildId) {
  try {
    // Get the current character sheet
    const currentSheet = await getUserCharacterSheet(userId, guildId);
    
    // Retrieve key memories for each category
    const personalMemories = await retrieveRelevantMemories(
      userId, 
      "personal information", 
      10, 
      null, 
      MemoryCategories.PERSONAL,
      guildId
    );
    
    const professionalMemories = await retrieveRelevantMemories(
      userId, 
      "job career education", 
      5, 
      null, 
      MemoryCategories.PROFESSIONAL,
      guildId
    );
    
    const preferenceMemories = await retrieveRelevantMemories(
      userId, 
      "preferences likes dislikes favorite", 
      15, 
      null, 
      MemoryCategories.PREFERENCES,
      guildId
    );
    
    const hobbyMemories = await retrieveRelevantMemories(
      userId, 
      "hobbies activities", 
      5, 
      null, 
      MemoryCategories.HOBBIES,
      guildId
    );
    
    // Combine all memories for analysis
    const allMemories = `
PERSONAL MEMORIES:
${personalMemories}

PROFESSIONAL/EDUCATIONAL MEMORIES:
${professionalMemories}

PREFERENCE MEMORIES:
${preferenceMemories}

HOBBY MEMORIES:
${hobbyMemories}
    `;
    
    // If we have no significant memories, just return the current sheet
    if (allMemories.trim().length < 50) {
      return false;
    }
    
    // Use GPT to extract and structure the information
    const currentSheetJson = JSON.stringify(currentSheet, null, 2);
    
    const prompt = `
You are analyzing memories about a user to update their character sheet.

CURRENT CHARACTER SHEET:
${currentSheetJson}

USER MEMORIES:
${allMemories}

Extract information from these memories to update the character sheet. Keep existing information unless you have higher confidence new information. For the top_preferences array, include only the strongest and most consistent preferences.

Format your response as a valid JSON object matching the structure of the current character sheet. Include ALL fields from the original sheet, updating only what's necessary based on the memories.

In the conversation_style section, try to infer characteristics based on reported preferences and behaviors. For any field where you don't have information, keep the existing value or null.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are an expert at analyzing personal information and creating structured profiles from unstructured data. You always respond with valid JSON."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    });
    
    // Parse the updated sheet
    const updatedSheet = JSON.parse(completion.choices[0].message.content);
    
    // Update the timestamp for when the sheet was last analyzed
    updatedSheet.last_updated = new Date().toISOString();
    
    // Save the updated sheet to the database
    await updateUserCharacterSheet(userId, guildId, updatedSheet);
    
    logger.info(`Updated character sheet for user ${userId} in guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error updating character sheet from memories for user ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Updates conversation style information based on recent messages
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @param {Array} recentMessages - Array of the user's recent messages
 * @returns {Promise<boolean>} - Success status
 */
export async function updateConversationStyle(userId, guildId, recentMessages) {
  try {
    if (!recentMessages || recentMessages.length === 0) {
      return false;
    }
    
    // Get the current character sheet
    const currentSheet = await getUserCharacterSheet(userId, guildId);
    
    // Extract just the messages content as text
    const messagesText = recentMessages.join("\n\n");
    
    // Use GPT to analyze conversation style
    const currentStyleJson = JSON.stringify(currentSheet.conversation_style, null, 2);
    
    const prompt = `
Analyze these recent messages from a user to update their conversation style profile.

CURRENT CONVERSATION STYLE:
${currentStyleJson}

RECENT MESSAGES:
${messagesText}

Based on these messages, update the conversation style profile. Pay attention to:
1. Formality level
2. Verbosity (how much they write)
3. Emoji usage
4. Humor level
5. Vocabulary complexity
6. Greeting patterns
7. Common phrases they use
8. Topics they show interest in

Your response should be a valid JSON object matching the structure of the current conversation_style object. Include ALL existing fields, updating only what's necessary based on the messages.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are an expert at analyzing conversation styles and linguistic patterns. You always respond with valid JSON."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 3000,
    });
    
    // Parse the updated conversation style
    const updatedStyle = JSON.parse(completion.choices[0].message.content);
    
    // Update the character sheet with the new conversation style
    currentSheet.conversation_style = updatedStyle;
    
    // Also update the last_active timestamp
    if (!currentSheet.interaction_patterns) {
      currentSheet.interaction_patterns = {};
    }
    currentSheet.interaction_patterns.last_active = new Date().toISOString();
    
    // Save the updated sheet to the database
    await updateUserCharacterSheet(userId, guildId, currentSheet);
    
    logger.info(`Updated conversation style for user ${userId} in guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error updating conversation style for user ${userId} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Retrieves character sheet information to use in system prompt
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID 
 * @returns {Promise<string>} - Character sheet information formatted for the system prompt
 */
export async function getCharacterSheetForPrompt(userId, guildId) {
  try {
    const sheet = await getUserCharacterSheet(userId, guildId);
    
    // Skip if sheet is empty or minimal
    const hasName = sheet.name;
    const hasPreferences = sheet.top_preferences && sheet.top_preferences.length > 0;
    const hasOccupation = sheet.occupation && sheet.occupation.job;
    
    if (!hasName && !hasPreferences && !hasOccupation) {
      return ""; // Not enough meaningful information to include
    }
    
    // Format the most important information for the system prompt
    let result = "USER PROFILE:\n";
    
    // Personal info
    if (sheet.name) {
      result += `- Name: ${sheet.name}`;
      if (sheet.nickname && sheet.nickname !== sheet.name) {
        result += ` (goes by ${sheet.nickname})`;
      }
      result += "\n";
    }
    
    if (sheet.age) {
      result += `- Age: ${sheet.age}\n`;
    }
    
    if (sheet.location) {
      result += `- Location: ${sheet.location}\n`;
    }
    
    // Occupation/Education
    if (sheet.occupation && sheet.occupation.job) {
      result += `- Job: ${sheet.occupation.job}`;
      if (sheet.occupation.company) {
        result += ` at ${sheet.occupation.company}`;
      }
      result += "\n";
    }
    
    if (sheet.education && sheet.education.level) {
      result += `- Education: ${sheet.education.level}`;
      if (sheet.education.field) {
        result += ` in ${sheet.education.field}`;
      }
      if (sheet.education.school) {
        result += ` at ${sheet.education.school}`;
      }
      result += "\n";
    }
    
    // Relationships
    if (sheet.family && sheet.family.length > 0) {
      result += "- Family: ";
      result += sheet.family.map(f => `${f.name} (${f.relation})`).join(", ");
      result += "\n";
    }
    
    if (sheet.pets && sheet.pets.length > 0) {
      result += "- Pets: ";
      result += sheet.pets.map(p => `${p.name} (${p.type})`).join(", ");
      result += "\n";
    }
    
    // Top preferences
    if (sheet.top_preferences && sheet.top_preferences.length > 0) {
      result += "- Key preferences:\n";
      for (const pref of sheet.top_preferences.slice(0, 5)) { // Limit to top 5
        const sentiment = pref.sentiment === "positive" ? "likes" : "dislikes";
        result += `  * ${sentiment} ${pref.item}`;
        if (pref.category) {
          result += ` (${pref.category})`;
        }
        result += "\n";
      }
    }
    
    // Conversation style guidance
    if (sheet.conversation_style) {
      result += "\nCONVERSATION STYLE:\n";
      if (sheet.conversation_style.formality !== "neutral") {
        result += `- Formality: ${sheet.conversation_style.formality}\n`;
      }
      if (sheet.conversation_style.verbosity !== "medium") {
        result += `- Verbosity: ${sheet.conversation_style.verbosity}\n`;
      }
      if (sheet.conversation_style.emoji_usage !== "medium") {
        result += `- Emoji usage: ${sheet.conversation_style.emoji_usage}\n`;
      }
      if (sheet.conversation_style.humor_level !== "medium") {
        result += `- Humor level: ${sheet.conversation_style.humor_level}\n`;
      }
      if (sheet.conversation_style.greeting_style) {
        result += `- Typical greeting: ${sheet.conversation_style.greeting_style}\n`;
      }
    }
    
    return result;
  } catch (error) {
    logger.error(`Error getting character sheet for prompt for user ${userId} in guild ${guildId}:`, error);
    return ""; // Return empty string on error
  }
}

/**
 * Schedule periodic updates to user character sheets
 * @param {number} intervalHours - How often to run updates (in hours)
 */
export function scheduleCharacterSheetUpdates(intervalHours = 24) {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  setInterval(async () => {
    try {
      logger.info(`Running scheduled user character sheet updates`);
      
      // Get recently active users
      const { data: activeUsers, error } = await supabase
        .from('discord_users')
        .select('user_id, server_id')
        .gt('last_active', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Active in last week
        .order('last_active', { ascending: false })
        .limit(100); // Process most recent 100 users
        
      if (error) {
        logger.error("Error fetching active users for character sheet updates:", error);
        return;
      }
      
      // Update character sheets for each active user
      for (const user of activeUsers) {
        // Skip if we don't have both user_id and server_id
        if (!user.user_id || !user.server_id) continue;
        
        try {
          await updateCharacterSheetFromMemories(user.user_id, user.server_id);
          // Small delay between users to avoid overloading the database
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (userError) {
          logger.error(`Error updating character sheet for user ${user.user_id}:`, userError);
          // Continue to next user
        }
      }
      
      logger.info(`Completed scheduled user character sheet updates for ${activeUsers.length} users`);
    } catch (error) {
      logger.error("Error in scheduled character sheet updates:", error);
    }
  }, intervalMs);
  
  logger.info(`User character sheet updates scheduled to run every ${intervalHours} hours`);
}