import OpenAI from 'openai';
import { stripCodeBlock } from './textUtils.js';

const summarizationModel = "gpt-3.5-turbo";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Extracts key details (such as name, job, interests, preferences, etc.) from a conversation summary.
 * The function performs a multi-pass extraction:
 *  - First it gets a rough list of details as a JSON array.
 *  - Then it refines that list to remove redundancy.
 * If no details are found, it returns an empty array.
 *
 * @param {string} summaryText - The conversation summary text.
 * @returns {Promise<Array<string>>} - A JSON array of extracted details.
 */
export async function extractIntuitedMemories(summaryText) {
  // Rough extraction prompt
  const roughPrompt = "From the conversation summary below, extract any details about the user—such as their name, job, interests, preferences, and other personal information. Output ONLY a JSON array of strings with no additional text. If there are no details, output []:\n\n" + summaryText;
  
  try {
    const roughCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { role: "system", content: "You are an assistant that extracts details. Your output must be only a JSON array of strings with no extra text." },
        { role: "user", content: roughPrompt }
      ],
      max_tokens: 1500,
    });
    
    let roughOutput = roughCompletion.choices[0].message.content.trim();
    roughOutput = stripCodeBlock(roughOutput);
    
    let roughFacts;
    try {
      roughFacts = JSON.parse(roughOutput);
      if (!Array.isArray(roughFacts)) roughFacts = [];
    } catch (e) {
      console.error("Error parsing rough extraction JSON:", e);
      roughFacts = [];
    }
    
    // Refinement pass to remove duplicates/noise.
    const refinePrompt = "Refine the following list of details to remove redundancies and noise while keeping as much information as possible. Output ONLY a JSON array of strings with no extra text. If there are no details, output []:\n\n" + JSON.stringify(roughFacts);
    const refineCompletion = await openai.chat.completions.create({
      model: summarizationModel,
      messages: [
        { role: "system", content: "You are an assistant that refines details into a concise JSON array with no extra formatting." },
        { role: "user", content: refinePrompt }
      ],
      max_tokens: 1500,
    });
    
    let refinedOutput = refineCompletion.choices[0].message.content.trim();
    refinedOutput = stripCodeBlock(refinedOutput);
    
    let refinedFacts;
    try {
      refinedFacts = JSON.parse(refinedOutput);
      if (!Array.isArray(refinedFacts)) refinedFacts = [];
    } catch (e) {
      console.error("Error parsing refined extraction JSON:", e);
      refinedFacts = roughFacts;
    }
    
    if (refinedFacts.length === 0) {
      console.warn("Warning: No details extracted from summary. Summary text:", summaryText);
    }
    
    return refinedFacts;
  } catch (error) {
    console.error("Error extracting intuited memories:", error);
    return [];
  }
}
