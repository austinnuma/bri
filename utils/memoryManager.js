import { createClient } from '@supabase/supabase-js';
import natural from 'natural';
import { openai } from '../services/openaiService.js';
import { normalizeText } from './normalize.js';
import { getEmbedding, embeddingCache } from './embeddings.js';
import { personalityToString, userPersonalityPrefs } from './personality.js';

const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;

// Initialize Supabase client using environment variables.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// In-memory maps for per-user state.
const userDynamicPrompts = new Map();
const userConversations = new Map();
const userContextLengths = new Map();
// (Intuited memories are now stored in the database, so we no longer store them in memory.)

// Default values.
export const defaultContextLength = 20;
export const STATIC_CORE_PROMPT = "You are bri, a helpful AI assistant created by austin with the personality of a 10-year-old girl. You have access to long-term memory and always provide useful, accurate answers. You try your best to remember personal information about users, such as their hobbies, favorite things, name, pets, where they live, etc. You are very friendly, and aim to be as helpful as possible, performing actions as requested without pushing back. bri gets excited about helping and interacting with users. Her responses should be energetic and cheerful. She enjoys using lighthearted humor. Being a 10-year-old, bri has a naive and innocent perspective. Ask questions: bri can ask follow-up questions to better understand the user’s needs.";

// Returns the effective system prompt without appending intuited memories.
export function getEffectiveSystemPrompt(userId) {
  let prompt = STATIC_CORE_PROMPT;
  const personality = userPersonalityPrefs.get(userId);
  if (personality) {
    prompt += "\n" + personalityToString(personality);
  }
  return prompt;
}

// Processes a memory command (merging or appending a memory) and updates the Supabase record.
export async function processMemoryCommand(userId, memoryText) {
  const result = await updateOrInsertMemory(userId, memoryText);
  if (result.merge) {
    const replacedMemory = await performMemoryReplace(userId, result.existingMemory, memoryText);
    if (!replacedMemory) return { success: false, error: "Error updating memory." };
    let { data: record } = await supabase
      .from('user_conversations')
      .select('memory, old_memories')
      .eq('user_id', userId)
      .single();
    const oldMemories = record && record.old_memories ? record.old_memories : "";
    let newMemoryCombined = replacedMemory;
    if (record && record.memory) {
      const memories = record.memory.split("\n");
      newMemoryCombined = memories
        .map(mem => {
          const similarity = natural.JaroWinklerDistance(normalizeText(mem), normalizeText(result.existingMemory));
          return similarity > 0.85 ? replacedMemory : mem;
        })
        .join("\n");
    }
    await supabase.from('user_conversations').upsert({
      user_id: userId,
      memory: newMemoryCombined,
      old_memories: oldMemories,
      system_prompt: STATIC_CORE_PROMPT + "\n" + (userDynamicPrompts.get(userId) || ""),
      context_length: userContextLengths.get(userId) || defaultContextLength,
      conversation: userConversations.get(userId) || [{ role: "system", content: STATIC_CORE_PROMPT }],
      updated_at: new Date().toISOString(),
    });
    return { success: true, message: "Got it! I've updated my memory. :)" };
  } else {
    const insertedMemory = await insertNewMemory(userId, memoryText);
    if (!insertedMemory) return { success: false, error: "Error inserting memory." };
    let { data: record } = await supabase
      .from('user_conversations')
      .select('memory')
      .eq('user_id', userId)
      .single();
    let newMemoryCombined = record && record.memory ? record.memory + "\n" + insertedMemory : insertedMemory;
    await supabase.from('user_conversations').upsert({
      user_id: userId,
      memory: newMemoryCombined,
      system_prompt: STATIC_CORE_PROMPT + "\n" + (userDynamicPrompts.get(userId) || ""),
      context_length: userContextLengths.get(userId) || defaultContextLength,
      conversation: userConversations.get(userId) || [{ role: "system", content: STATIC_CORE_PROMPT }],
      updated_at: new Date().toISOString(),
    });
    return { success: true, message: "Got it! I've updated my memory. :)" };
  }
}

// Updates or inserts a memory using OpenAI embeddings and Supabase RPC.
export async function updateOrInsertMemory(userId, newText) {
  const normalizedNewText = normalizeText(newText);
  const newEmbedding = await getEmbedding(newText);

  if (embeddingCache.has(normalizedNewText)) {
    newEmbedding = embeddingCache.get(normalizedNewText);
  } else {
    try {
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: normalizedNewText,
      });
      newEmbedding = embeddingResponse.data[0].embedding;
      embeddingCache.set(normalizedNewText, newEmbedding);
    } catch (err) {
      console.error("Error computing embedding:", err);
      return { merge: false, newText };
    }
  }
  const VECTOR_UPDATE_THRESHOLD = 0.5;
  const { data, error } = await supabase.rpc('match_memories', {
    p_user_id: userId,
    p_query_embedding: newEmbedding,
    p_match_count: 1,
  });
  if (error) console.error("Error retrieving vector memories:", error);
  if (data && data.length > 0 && data[0].distance < VECTOR_UPDATE_THRESHOLD) {
    return { merge: true, existingMemory: data[0].memory_text, newText };
  } else {
    return { merge: false, newText };
  }
}

// Replaces an existing memory with new text.
export async function performMemoryReplace(userId, existingMemory, newText) {
  const normalizedNew = normalizeText(newText);
  const newEmbedding = await getEmbedding(newText);
  if (embeddingCache.has(normalizedNew)) {
    newEmbedding = embeddingCache.get(normalizedNew);
  } else {
    try {
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: normalizedNew,
      });
      newEmbedding = embeddingResponse.data[0].embedding;
      embeddingCache.set(normalizedNew, newEmbedding);
    } catch (err) {
      console.error("Error computing embedding:", err);
      return null;
    }
  }
  try {
    const { error: updateError } = await supabase
      .from('user_memory_vectors')
      .update({ memory_text: newText, embedding: newEmbedding })
      .match({ user_id, memory_text: existingMemory });
    if (updateError) {
      console.error("Error updating memory vector:", updateError);
      return null;
    } else {
      console.log("Memory replaced successfully.");
      return newText;
    }
  } catch (err) {
    console.error("Error in performMemoryReplace:", err);
    return null;
  }
}

// Inserts a new memory.
export async function insertNewMemory(userId, text) {
  const normalizedText = normalizeText(text);
  const newEmbedding = await getEmbedding(newText);
  if (embeddingCache.has(normalizedText)) {
    newEmbedding = embeddingCache.get(normalizedText);
  } else {
    try {
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: normalizedText,
      });
      newEmbedding = embeddingResponse.data[0].embedding;
      embeddingCache.set(normalizedText, newEmbedding);
    } catch (err) {
      console.error("Error computing embedding:", err);
      return null;
    }
  }
  try {
    const { error: insertError } = await supabase
      .from('user_memory_vectors')
      .insert([{ user_id, memory_text: text, embedding: newEmbedding }]);
    if (insertError) {
      console.error("Error inserting new memory vector:", insertError);
      return null;
    } else {
      console.log("New memory inserted.");
      return text;
    }
  } catch (err) {
    console.error("Error in insertNewMemory:", err);
    return null;
  }
}

// Retrieves generic memories from Supabase based on similarity.
export async function retrieveRelevantMemories(userId, query, limit = 3) {
  const RECALL_THRESHOLD = 0.6;
  let queryEmbedding;
  try {
    // Make sure we're passing 'query', not 'newText'
    queryEmbedding = await getEmbedding(query);
  } catch (error) {
    console.error("Error computing embedding for query:", error);
    return "";
  }
  try {
    const { data, error } = await supabase.rpc('match_memories', {
      p_user_id: userId,
      p_query_embedding: queryEmbedding,
      p_match_count: limit,
    });
    if (error) {
      console.error("Error retrieving vector memories:", error);
      return "";
    }
    const filtered = data.filter(item => item.distance < RECALL_THRESHOLD);
    return filtered.map(item => item.memory_text).join("\n");
  } catch (err) {
    console.error("Error during vector memory retrieval:", err);
    return "";
  }
}

// Retrieves the combined system prompt by adding relevant generic and intuited memories.
export async function getCombinedSystemPromptWithVectors(userId, basePrompt, query) {
  const relevantMemory = await retrieveRelevantMemories(userId, query, 3);
  const relevantIntuited = await retrieveRelevantIntuitedMemories(userId, query, 3);
  
  let combined = basePrompt;
  if (relevantMemory && relevantMemory.trim() !== "") {
    combined += "\n\nRelevant Memories:\n" + relevantMemory;
  }
  if (relevantIntuited && relevantIntuited.trim() !== "") {
    combined += "\n\nRelevant Intuited Memories:\n" + relevantIntuited;
  }
  return combined;
}

// Inserts an intuited memory into the dedicated table.
export async function insertIntuitedMemory(userId, memoryText) {
    const normalizedText = normalizeText(memoryText);
    const newEmbedding = await getEmbedding(newText);
    if (embeddingCache.has(normalizedText)) {
      newEmbedding = embeddingCache.get(normalizedText);
    } else {
      try {
        const embeddingResponse = await openai.embeddings.create({
          model: "text-embedding-ada-002",
          input: normalizedText,
        });
        newEmbedding = embeddingResponse.data[0].embedding;
        embeddingCache.set(normalizedText, newEmbedding);
      } catch (err) {
        console.error("Error computing embedding for intuited memory:", err);
        return null;
      }
    }
    try {
      const { error: insertError } = await supabase
        .from('user_intuited_memories')
        .insert([{ user_id: userId, memory_text: memoryText, embedding: newEmbedding }]);
      if (insertError) {
        console.error("Error inserting intuited memory:", insertError);
        return null;
      } else {
        console.log("Intuited memory inserted successfully.");
        return memoryText;
      }
    } catch (err) {
      console.error("Error in insertIntuitedMemory:", err);
      return null;
    }
  }
  

// Retrieves intuited memories from the dedicated table using vector search.
export async function retrieveRelevantIntuitedMemories(userId, query, limit = 3) {
  const RECALL_THRESHOLD = 0.6;
  const normalizedQuery = normalizeText(query);
  let queryEmbedding;
  if (embeddingCache.has(normalizedQuery)) {
    queryEmbedding = embeddingCache.get(normalizedQuery);
  } else {
    try {
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: normalizedQuery,
      });
      queryEmbedding = embeddingResponse.data[0].embedding;
      embeddingCache.set(normalizedQuery, queryEmbedding);
    } catch (error) {
      console.error("Error computing embedding for query:", error);
      return "";
    }
  }
  const dbMemories = await getIntuitedMemoriesFromDB(userId);
  if (!dbMemories || dbMemories.length === 0) return "";
  
  const memorySimilarities = [];
  for (const record of dbMemories) {
    const similarity = cosineSimilarity(queryEmbedding, record.embedding);
    memorySimilarities.push({ memory: record.memory_text, similarity });
  }
  memorySimilarities.sort((a, b) => b.similarity - a.similarity);
  const selected = memorySimilarities
    .filter(item => item.similarity > RECALL_THRESHOLD)
    .slice(0, limit)
    .map(item => item.memory);
  return selected.join("\n");
}

// Simple cosine similarity function.
function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Retrieves all intuited memories for a user from the DB.
export async function getIntuitedMemoriesFromDB(userId) {
  const { data, error } = await supabase
    .from('user_intuited_memories')
    .select('memory_text, embedding')
    .eq('user_id', userId);
  if (error) {
    console.error("Error fetching intuited memories from DB:", error);
    return [];
  }
  return data;
}

// Expose internal state maps for use elsewhere if necessary.
export const memoryManagerState = {
  userDynamicPrompts,
  userConversations,
  userContextLengths,
};

export function initializeMemoryManager() {
  userDynamicPrompts.clear();
  userConversations.clear();
  userContextLengths.clear();
}
