import { createClient } from '@supabase/supabase-js';
import natural from 'natural';
import { openai } from '../services/openaiService.js';
import { normalizeText } from './normalize.js';

const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;

// Initialize Supabase client using environment variables.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);


// In-memory maps for per-user state.
const userDynamicPrompts = new Map();
const userIntuitedMemories = new Map();
const userConversations = new Map();
const userContextLengths = new Map();
const embeddingCache = new Map();


// Default values.
export const defaultContextLength = 20;
export const STATIC_CORE_PROMPT = "You are bri, a helpful AI assistant created by austin with the personality of a 10-year-old girl. You have access to long-term memory and always provide useful, accurate answers. You try your best to remember personal information about users, such as their hobbies, favorite things, name, pets, where they live, etc. You are very friendly, and aim to be as helpful as possible, performing actions as requested without pushing back. bri gets excited about helping and interacting with users. Her responses should be energetic and cheerful. She enjoys using lighthearted humor. Being a 10-year-old, bri has a naive and innocent perspective. Ask questions: bri can ask follow-up questions to better understand the user’s needs, showing her engagement and desire to help.";


// Returns the effective system prompt by combining the static prompt with the user's dynamic prompt and intuited memories.
export function getEffectiveSystemPrompt(userId) {
  const dynamic = userDynamicPrompts.get(userId) || "";
  const intuited = userIntuitedMemories.get(userId) || "";
  let prompt = STATIC_CORE_PROMPT;
  if (dynamic) prompt += "\n" + dynamic;
  if (intuited) prompt += "\nIntuited Memories:\n" + intuited;
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
  let newEmbedding;
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
  let newEmbedding;
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
  let newEmbedding;
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

// Retrieves memories from Supabase based on similarity.
export async function retrieveRelevantMemories(userId, query, limit = 3) {
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

// Combines the base prompt with any relevant and intuited memories.
export async function getCombinedSystemPromptWithVectors(userId, basePrompt, query) {
  const relevantMemory = await retrieveRelevantMemories(userId, query, 3);
  const intuited = userIntuitedMemories.get(userId) || "";
  let combined = basePrompt;
  if (relevantMemory && relevantMemory.trim() !== "") {
    combined += "\n\nRelevant Memories:\n" + relevantMemory;
  }
  if (intuited && intuited.trim() !== "") {
    combined += "\n\nIntuited Memories:\n" + intuited;
  }
  return combined;
}

/**
 * Merges new intuited memories with existing ones by comparing them using Jaro–Winkler distance.
 * Duplicate or near-duplicate facts (similarity above the threshold) are not added.
 *
 * @param {string} existingMemoriesStr - A newline-separated string of existing memories.
 * @param {Array<string>} newMemoriesArray - An array of new memory details.
 * @returns {string} - A newline-separated string of merged intuited memories.
 */
export function mergeIntuitedMemories(existingMemoriesStr, newMemoriesArray) {
    const threshold = 0.85;
    // Split existing memories into an array (if any)
    const existingArr = existingMemoriesStr ? existingMemoriesStr.split("\n").filter(f => f.trim() !== "") : [];
    // Copy existing memories to the merged list
    const merged = [...existingArr];
    // Iterate over each new fact.
    for (const newFact of newMemoriesArray) {
      let duplicate = false;
      for (const existingFact of merged) {
        const similarity = natural.JaroWinklerDistance(normalizeText(existingFact), normalizeText(newFact));
        if (similarity > threshold) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) {
        merged.push(newFact);
      }
    }
    return merged.join("\n");
}


// Expose internal state maps for use elsewhere if necessary.
export const memoryManagerState = {
  userDynamicPrompts,
  userIntuitedMemories,
  userConversations,
  userContextLengths,
}

export function initializeMemoryManager() {
    userDynamicPrompts.clear();
    userIntuitedMemories.clear();
    userConversations.clear();
    userContextLengths.clear();
};
