import { supabase } from '../services/supabaseService.js';
import { STATIC_CORE_PROMPT, memoryManagerState } from '../utils/memoryManager.js';

export const clearmemoriesCommand = {
  name: 'clearmemories',
  description: 'Clear all stored memories and intuited knowledge for a fresh start.',
  async execute(interaction) {
    // Clear in‑memory data for the user.
    memoryManagerState.userConversations.delete(interaction.user.id);
    memoryManagerState.userDynamicPrompts.delete(interaction.user.id);
    memoryManagerState.userIntuitedMemories.delete(interaction.user.id);
    
    // Clear the Supabase record.
    await supabase.from('user_conversations').upsert({
      user_id: interaction.user.id,
      memory: "",
      old_memories: "",
      intuited_memories: "",
      system_prompt: STATIC_CORE_PROMPT,
      conversation: [{ role: "system", content: STATIC_CORE_PROMPT }],
      updated_at: new Date().toISOString(),
    });
    
    await interaction.reply({ content: "All your memories have been cleared!", ephemeral: true });
  },
};
