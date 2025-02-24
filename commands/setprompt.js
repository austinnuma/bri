import { supabase } from '../services/supabaseService.js';
import { STATIC_CORE_PROMPT, memoryManagerState } from '../utils/memoryManager.js';
import { ApplicationCommandOptionType } from 'discord.js';

export const setpromptCommand = {
  name: 'setprompt',
  description: 'Set your dynamic prompt.',
  options: [
    {
      name: 'prompt',
      type: ApplicationCommandOptionType.String,
      description: 'Dynamic portion to append to core prompt',
      required: true,
    }
  ],
  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');
    // Update the in-memory dynamic prompt for this user.
    memoryManagerState.userDynamicPrompts.set(interaction.user.id, prompt);
    
    // Update the Supabase database with the new dynamic prompt.
    await supabase.from('user_conversations').upsert({
      user_id: interaction.user.id,
      system_prompt: STATIC_CORE_PROMPT + "\n" + prompt,
      context_length: memoryManagerState.userContextLengths.get(interaction.user.id) || 20,
      conversation: memoryManagerState.userConversations.get(interaction.user.id) || [{ role: "system", content: STATIC_CORE_PROMPT }],
      updated_at: new Date().toISOString(),
    });
    
    await interaction.reply({ content: "Dynamic prompt set.", ephemeral: true });
  },
};
