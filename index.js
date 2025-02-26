// Main entry point for the Bri Discord bot
import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';
import { handleLegacyMessage } from './utils/messageHandler.js';
import { createMemory, MemoryTypes, MemoryCategories } from './utils/unifiedMemoryManager.js';
import { supabase } from './services/supabaseService.js';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Discord client with the required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Create a new collection for slash commands
client.commands = new Collection();

// Load all command files dynamically
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Create an array to store command data for registration
const commands = [];

// Load each command module
for (const file of commandFiles) {
  try {
    const filePath = path.join(commandsPath, file);
    const commandModule = await import(`file://${filePath}`);
    
    // Check if the module has both required properties
    if ('data' in commandModule && 'execute' in commandModule) {
      commands.push(commandModule.data.toJSON());
      client.commands.set(commandModule.data.name, commandModule);
      logger.info(`Loaded command: ${commandModule.data.name}`);
    } else {
      logger.warn(`Command at ${filePath} is missing required "data" or "execute" property`);
    }
  } catch (error) {
    logger.error(`Error loading command from ${file}:`, error);
  }
}

// ================ Memory Maintenance ================
// Set up periodic memory maintenance
const MEMORY_MAINTENANCE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Helper function to categorize memory text
 */
function categorizeMemory(text) {
  const lowered = text.toLowerCase();
  
  if (lowered.includes('name') || lowered.includes('age') || lowered.includes('birthday') || 
      lowered.includes('family') || lowered.includes('live') || lowered.includes('from')) {
    return MemoryCategories.PERSONAL;
  }
  
  if (lowered.includes('job') || lowered.includes('work') || lowered.includes('career') || 
      lowered.includes('study') || lowered.includes('school') || lowered.includes('college')) {
    return MemoryCategories.PROFESSIONAL;
  }
  
  if (lowered.includes('like') || lowered.includes('love') || lowered.includes('enjoy') || 
      lowered.includes('favorite') || lowered.includes('prefer') || lowered.includes('hate')) {
    return MemoryCategories.PREFERENCES;
  }
  
  if (lowered.includes('hobby') || lowered.includes('play') || lowered.includes('game') ||
      lowered.includes('sport') || lowered.includes('collect') || lowered.includes('activity')) {
    return MemoryCategories.HOBBIES;
  }
  
  if (lowered.includes('email') || lowered.includes('phone') || lowered.includes('contact') ||
      lowered.includes('address') || lowered.includes('reach')) {
    return MemoryCategories.CONTACT;
  }
  
  return MemoryCategories.OTHER;
}

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
        
        // Categorize the memory
        const category = categorizeMemory(memoryText);
        
        // Create the memory in the unified system
        const result = await createMemory(
          record.user_id,
          memoryText,
          MemoryTypes.EXPLICIT,  // These are explicit memories
          category,
          1.0,                   // Full confidence for explicit memories
          'memory_maintenance'   // Source of the memory
        );
        
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

// ================ Bot Setup and Event Handlers ================

// When the client is ready, run this code (only once)
client.once('ready', () => {
  logger.info(`Logged in as ${client.user.tag}!`);
  
  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  // Get the client ID from the bot if not in environment variables
  const clientId = process.env.CLIENT_ID || client.user.id;
  
  if (!clientId) {
    logger.error('Failed to register commands: CLIENT_ID is not defined in environment variables and could not be retrieved from the bot.');
    return;
  }
  
  logger.info(`Registering commands for application ID: ${clientId}`);
  
  (async () => {
    try {
      logger.info('Started refreshing application (/) commands.');
      
      // Use the client ID we verified above
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      
      logger.info('Successfully reloaded application (/) commands.');
    } catch (error) {
      logger.error('Error registering commands:', error);
    }
  })();
});

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  
  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}:`, error);
    const reply = { content: 'There was an error while executing this command!', ephemeral: true };
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Handle regular messages (non-slash commands)
client.on('messageCreate', async (message) => {
  try {
    await handleLegacyMessage(message);
  } catch (error) {
    logger.error('Error in legacy message handler:', error);
  }
});

// Log in to Discord with your token
client.login(process.env.DISCORD_TOKEN);

// Handle process termination gracefully
process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down...');
  client.destroy();
  process.exit(0);
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});