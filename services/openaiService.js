import OpenAI from 'openai';
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const defaultAskModel = "gpt-4o-mini";

/**
 * Creates a chat completion using OpenAI's Chat Completion API.
 *
 * @param {Object} options - Options for the chat completion.
 * @param {string} [options.model="gpt-3.5-turbo"] - The model to use.
 * @param {Array<Object>} options.messages - Array of message objects { role, content }.
 * @param {number} [options.max_tokens=1500] - Maximum tokens to generate.
 * @returns {Promise<Object>} - The API response.
 */
export async function getChatCompletion({ model = "gpt-3.5-turbo", messages, max_tokens = 1500 }) {
  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      max_tokens,
    });
    return response;
  } catch (error) {
    console.error("Error creating chat completion:", error);
    throw error;
  }
}

/**
 * Retrieves an embedding vector for the given text.
 *
 * @param {Object} options - Options for the embedding request.
 * @param {string} options.text - The text to embed.
 * @param {string} [options.model="text-embedding-ada-002"] - The embedding model to use.
 * @returns {Promise<any>} - The embedding vector.
 */
export async function getEmbedding({ text, model = "text-embedding-ada-002" }) {
  try {
    const response = await openai.embeddings.create({
      model,
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error creating embedding:", error);
    throw error;
  }
}
