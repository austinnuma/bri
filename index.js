import dotenv from 'dotenv';
dotenv.config();

import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { logger } from './utils/logger.js';

// Import command modules
import { askCommand } from './commands/ask.js';
import { clearmemoriesCommand } from './commands/clearmemories.js';
import { geminiCommand } from './commands/gemini.js';
import { modelCommand } from './commands/model.js';
import { recallCommand } from './commands/recall.js';
import { rememberCommand } from './commands/remember.js';
import { setcontextCommand } from './commands/setcontext.js';
import { setpromptCommand } from './commands/setprompt.js';

//Other imports as needed :)
import { getEffectiveSystemPrompt } from './utils/memoryManager.js';
import { getCombinedSystemPromptWithVectors } from './utils/memoryManager.js';
import { processMemoryCommand } from './utils/memoryManager.js';
import { splitMessage } from './utils/textUtils.js';
import { replaceEmoticons } from './utils/textUtils.js';
import { openai } from './services/openaiService.js';
import { defaultAskModel } from './services/openaiService.js';


// Import and initialize the memory manager (which holds in‑memory maps for dynamic prompts, conversations, etc.)
import { initializeMemoryManager } from './utils/memoryManager.js';
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

// Legacy message handling for non-slash commands
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Determine if the channel is designated (no prefix needed) or not.
  const isDesignated = (message.channel.id === process.env.CHANNEL_ID);
  let cleanedContent = message.content;
  
  // For non-designated channels, require a prefix like "hey bri" or "bri"
  if (!isDesignated) {
    const prefixRegex = /^(hey\s+)?bri[\s,]+/i;
    if (!prefixRegex.test(message.content)) return;
    cleanedContent = message.content.replace(prefixRegex, '').trim();
  }
  
  // Example: If the message is a legacy memory command:
  const memoryRegex = /^(?:can you\s+)?remember\s+(.*)/i;
  const memoryMatch = cleanedContent.match(memoryRegex);
  if (memoryMatch) {
    const memoryText = memoryMatch[1].trim();
    // Import processMemoryCommand from your memoryManager module.
    const result = await processMemoryCommand(message.author.id, memoryText);
    await message.channel.send(result.success ? result.message : result.error);
    return;
  }
  
  // Example: Otherwise, treat the message as a general query (ask command).
  // You can import getEffectiveSystemPrompt and getCombinedSystemPromptWithVectors
  // from your memoryManager module.
  const effectiveSystemPrompt = getEffectiveSystemPrompt(message.author.id);
  const combinedSystemPrompt = await getCombinedSystemPromptWithVectors(message.author.id, effectiveSystemPrompt, cleanedContent);
  const messagesArray = [
    { role: "system", content: combinedSystemPrompt },
    { role: "user", content: cleanedContent }
  ];
  
  try {
    const completion = await openai.chat.completions.create({
      model: defaultAskModel,
      messages: messagesArray,
      max_tokens: 3000,
    });
    let reply = completion.choices[0].message.content;
    //reply = replaceEmoticons(reply, emojiMapping); // Ensure you pass the emoji mapping
    // Send reply (splitting if necessary)
    if (reply.length > 2000) {
      const chunks = splitMessage(reply, 2000);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      await message.channel.send(reply);
    }
  } catch (error) {
    console.error("Error from OpenAI API in legacy message handler:", error);
    await message.channel.send("Sorry, an error occurred processing your message.");
  }
});


client.login(process.env.DISCORD_TOKEN);
