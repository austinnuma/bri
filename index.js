import dotenv from 'dotenv';
dotenv.config();

import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { logger } from './utils/logger.js';
import { handleLegacyMessage } from './utils/messageHandler.js';

// Import command modules
import { askCommand } from './commands/ask.js';
import { clearmemoriesCommand } from './commands/clearmemories.js';
import { geminiCommand } from './commands/gemini.js';
import { modelCommand } from './commands/model.js';
import { recallCommand } from './commands/recall.js';
import { rememberCommand } from './commands/remember.js';
import { setcontextCommand } from './commands/setcontext.js';
import { setpromptCommand } from './commands/setprompt.js';
import { personalityCommand } from './commands/personality.js';

//Other imports as needed :)
import { splitMessage, replaceEmoticons } from './utils/textUtils.js';
import { openai, defaultAskModel } from './services/openaiService.js';
import { supabase } from './services/supabaseService.js';

// Import and initialize the memory manager (which holds in‑memory maps for dynamic prompts, conversations, etc.)
import { getEffectiveSystemPrompt, 
  getCombinedSystemPromptWithVectors, 
  processMemoryCommand, 
  memoryManagerState, 
  defaultContextLength, 
  STATIC_CORE_PROMPT,
  initializeMemoryManager } 
from './utils/memoryManager.js';
const { userConversations, userContextLengths, userDynamicPrompts } = memoryManagerState;
initializeMemoryManager();


// Create the Discord client with the required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Prepare an array of commands for slash command registration.
const commands = [
  askCommand,
  clearmemoriesCommand,
  geminiCommand,
  modelCommand,
  recallCommand,
  rememberCommand,
  setcontextCommand,
  setpromptCommand,
  personalityCommand,
];

// Create a REST instance for command registration.
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// When the client is ready, register slash commands.
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  
  try {
    console.log('Refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      {
        body: commands.map(cmd => ({
          name: cmd.name,
          description: cmd.description,
          options: cmd.options || [],
        })),
      }
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error("Error registering commands:", error);
  }
});

// Interaction handler: dispatch slash command interactions to the appropriate command module.
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const command = commands.find(cmd => cmd.name === interaction.commandName);
  if (command) {
    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error('Interaction error', { error, command: interaction.commandName });
      console.error("Error executing command:", error);
      await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true });
    }
  }
});

// Add this to index.js after bot initialization

import { insertNewMemory } from './utils/memoryManager.js';
import { logger } from './utils/logger.js';
import { supabase } from './services/supabaseService.js';

// Set up periodic memory maintenance
const MEMORY_MAINTENANCE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Moves memories from the plain text memory field to vector storage
 * Runs periodically to ensure all memories are properly vectorized
 */
async function runMemoryMaintenance() {
  try {
    logger.info("Starting scheduled memory maintenance...");
    
    // Get all user records with non-empty memory field
    const { data, error } = await supabase
      .from('user_conversations')
      .select('user_id, memory')
      .not('memory', 'is', null);
      
    if (error) {
      logger.error("Error fetching records for maintenance:", error);
      return;
    }
    
    let totalProcessed = 0;
    
    // Process each user's memories
    for (const record of data) {
      if (!record.memory || record.memory.trim() === '') continue;
      
      const memories = record.memory.split('\n').filter(m => m.trim() !== '');
      if (memories.length === 0) continue;
      
      logger.info(`Processing ${memories.length} memories for user ${record.user_id}`);
      
      // Vector store each memory
      const processedMemories = [];
      for (const memoryText of memories) {
        if (memoryText.length < 5) continue; // Skip very short entries
        
        const result = await insertNewMemory(record.user_id, memoryText);
        if (result) {
          processedMemories.push(memoryText);
          totalProcessed++;
        }
      }
      
      // If any memories were successfully processed, remove them from the plain text field
      if (processedMemories.length > 0) {
        // Create a new memories string without the processed ones
        const remainingMemories = memories
          .filter(mem => !processedMemories.includes(mem))
          .join('\n');
          
        // Update the record
        await supabase
          .from('user_conversations')
          .update({ memory: remainingMemories })
          .eq('user_id', record.user_id);
      }
    }
    
    logger.info(`Memory maintenance complete. Processed ${totalProcessed} memories.`);
  } catch (error) {
    logger.error("Error during memory maintenance:", error);
  }
}

// Run maintenance immediately on startup
runMemoryMaintenance().catch(err => {
  logger.error("Initial memory maintenance failed:", err);
});

// Set up periodic maintenance
setInterval(runMemoryMaintenance, MEMORY_MAINTENANCE_INTERVAL);

// Message handler: process messages that are not slash commands.
client.on('messageCreate', async (message) => {
  await handleLegacyMessage(message);
});


client.login(process.env.DISCORD_TOKEN);
