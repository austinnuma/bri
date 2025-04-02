// scripts/deployCommands.js
// Run this script to force-redeploy all slash commands
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commandsPath = path.join(__dirname, '..', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

const commands = [];

for (const file of commandFiles) {
  try {
    const filePath = path.join(commandsPath, file);
    const commandModule = await import(`file://${filePath}`);
    
    if ('data' in commandModule && 'execute' in commandModule) {
      commands.push(commandModule.data.toJSON());
      console.log(`Loaded command: ${commandModule.data.name}`);
    } else {
      console.warn(`Command at ${filePath} is missing required "data" or "execute" property`);
    }
  } catch (error) {
    console.error(`Error loading command from ${file}:`, error);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);
    
    const CLIENT_ID = process.env.CLIENT_ID || '';
    const GUILD_ID = process.env.GUILD_ID || '';
    
    if (!CLIENT_ID) {
      throw new Error('CLIENT_ID is not defined in environment variables');
    }

    // For guild-specific commands (faster for development)
    if (GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands },
      );
      console.log(`Successfully reloaded commands for guild ${GUILD_ID}.`);
    } else {
      // For global commands (takes up to an hour to update)
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands },
      );
      console.log('Successfully reloaded global application commands.');
    }
  } catch (error) {
    console.error('Error redeploying commands:', error);
  }
})();