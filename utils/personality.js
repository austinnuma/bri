import { supabase } from '../services/supabaseService.js';

export const defaultPersonality = {
  responseLength: "normal", // Options: "short", "normal", "long"
  humor: "light",          // Options: "none", "light", "more humorous"
  tone: "friendly",        // Options: "friendly", "formal", "casual", etc.
};

// In-memory cache for personality preferences per user.
export const userPersonalityPrefs = new Map();

/**
 * Retrieves the personality preferences for a given user.
 * If not cached, attempts to load from Supabase.
 * @param {string} userId 
 * @returns {Promise<Object>} Personality object.
 */
export async function getPersonality(userId) {
  if (userPersonalityPrefs.has(userId)) {
    return userPersonalityPrefs.get(userId);
  }
  // Attempt to load from Supabase.
  const { data, error } = await supabase
    .from('user_conversations')
    .select('personality_preferences')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error("Error fetching personality preferences:", error);
    // Fall back to default if an error occurs.
    userPersonalityPrefs.set(userId, defaultPersonality);
    return defaultPersonality;
  }
  
  let personality = data?.personality_preferences;
  if (!personality) {
    personality = defaultPersonality;
  }
  userPersonalityPrefs.set(userId, personality);
  return personality;
}

/**
 * Updates a specific personality field for a user.
 * @param {string} userId 
 * @param {string} field - One of "responseLength", "humor", or "tone".
 * @param {string} value - The new value for the field.
 * @returns {Promise<Object>} The updated personality object.
 */
export async function setPersonalityPreference(userId, field, value) {
  let personality = await getPersonality(userId);
  personality = { ...personality, [field]: value };
  userPersonalityPrefs.set(userId, personality);

  // Upsert the personality preferences in the Supabase record.
  const { error } = await supabase.from('user_conversations').upsert({
    user_id: userId,
    personality_preferences: personality,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("Error updating personality preferences:", error);
    throw error;
  }
  return personality;
}

/**
 * Converts a personality object into a formatted string.
 * This string will be appended to the system prompt.
 * @param {Object} personality 
 * @returns {string} Formatted personality section.
 */
export function personalityToString(personality) {
  if (!personality) return "";
  const { responseLength, humor, tone } = personality;
  let personalityStr = "Personality Preferences:";
  if (responseLength) personalityStr += `\n- Response Length: ${responseLength}`;
  if (humor) personalityStr += `\n- Humor: ${humor}`;
  if (tone) personalityStr += `\n- Tone: ${tone}`;
  return personalityStr;
}
