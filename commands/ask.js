import { getEffectiveSystemPrompt, getCombinedSystemPromptWithVectors} from '../utils/memoryManager.js';
import { splitMessage, replaceEmoticons } from '../utils/textUtils.js';
import { ApplicationCommandOptionType } from 'discord.js';
import OpenAI from 'openai';
import { defaultAskModel } from '../services/openaiService.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const askCommand = {
    name: 'ask',
    description: 'Ask the bot a question.',
    options: [
      {
        name: 'question',
        type: ApplicationCommandOptionType.String,
        description: 'Your question',
        required: true,
      }
    ],
  

async execute(interaction) {
    const question = interaction.options.getString('question');
    const effectiveSystemPrompt = getEffectiveSystemPrompt(interaction.user.id);
    const combinedSystemPrompt = await getCombinedSystemPromptWithVectors(interaction.user.id, effectiveSystemPrompt, question);
    const messages = [
      { role: "system", content: combinedSystemPrompt },
      { role: "user", content: question }
    ];
    await interaction.deferReply();
    try {
      const completion = await openai.chat.completions.create({
        model: defaultAskModel,
        messages: messages,
        max_tokens: 3000,
      });
      let answer = completion.choices[0].message.content;
      answer = replaceEmoticons(answer);
      if (answer.length > 2000) {
        const chunks = splitMessage(answer, 2000);
        await interaction.editReply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]);
        }
      } else {
        await interaction.editReply(answer);
      }
    } catch (error) {
      console.error("Error in /ask:", error);
      await interaction.editReply("Sorry, an error occurred.");
    }
  },
};