// commands/setupJournal.js - Command to set up Bri's journal channel
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { initializeJournalSystem, createRandomJournalEntry } from '../utils/journalSystem.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/combinedServices.js';


export const data = new SlashCommandBuilder()
  .setName('setup-journal')
  .setDescription('Sets up Bri\'s personal journal channel')
  .addChannelOption(option =>
    option.setName('channel')
      .setDescription('The channel to use for Bri\'s journal (leave empty to create a new one)')
      .setRequired(false))
  .addBooleanOption(option =>
    option.setName('post-example')
      .setDescription('Post an example journal entry immediately')
      .setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  // Manually check if the user has the ManageChannels permission
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply({ content: 'You do not have permission to use this command. (Requires Manage Channels)', ephemeral: true });
  }
  
  try {
    let journalChannel;
    const guildId = interaction.guild.id;
    
    // Check if a channel was specified
    const specifiedChannel = interaction.options.getChannel('channel');
    const postExample = interaction.options.getBoolean('post-example') || false;
    
    if (specifiedChannel) {
      // Use the specified channel
      journalChannel = specifiedChannel;
      
      // Verify it's a text channel
      if (journalChannel.type !== ChannelType.GuildText) {
        await interaction.editReply('The specified channel must be a text channel.');
        return;
      }
    } else {
      // Create a new channel
      const guild = interaction.guild;
      
      // Try to find the "bot-stuff" category
      const botCategory = guild.channels.cache.find(
        channel => channel.type === ChannelType.GuildCategory && 
                   channel.name.toLowerCase().includes('bot')
      );
      
      // Create the channel
      journalChannel = await guild.channels.create({
        name: 'bri-journal',
        type: ChannelType.GuildText,
        parent: botCategory?.id, // Use the bot category if found
        topic: "Bri's personal journal. She'll post about her interests, projects, and daily thoughts here!",
        reason: 'Setting up Bri\'s journal channel'
      });
      
      logger.info(`Created new journal channel: ${journalChannel.name} (${journalChannel.id}) in guild ${guildId}`);
    }
    
    // Store the channel ID in the database using guild_id as part of the key
    try {
      // Check if the guild_journal_channels table exists
      const { error: tableCheckError } = await supabase
        .from('guild_journal_channels')
        .select('guild_id')
        .limit(1);
        
      // Create the table if it doesn't exist
      if (tableCheckError && tableCheckError.code === '42P01') {
        logger.info("Creating guild_journal_channels table...");
        
        // Create SQL for the table - for reference only
        // This would be executed via RPC in production
        const createTableSQL = `
          CREATE TABLE IF NOT EXISTS guild_journal_channels (
            id SERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(guild_id)
          );
        `;
        
        // Try to use RPC for table creation
        try {
          const createTableRPC = await supabase.rpc('create_guild_journal_channels_table');
          logger.info("Created guild_journal_channels table via RPC");
        } catch (rpcError) {
          logger.warn("RPC table creation failed:", rpcError);
          logger.info("Falling back to legacy method...");
          
          // Fall back to the older method of storing in bot_settings
          const { error } = await supabase
            .from('bot_settings')
            .upsert({
              key: `journal_channel_id:${guildId}`,
              value: journalChannel.id,
              updated_at: new Date().toISOString()
            });
            
          if (error) {
            logger.error("Error storing journal channel ID in bot_settings:", error);
            throw error;
          } else {
            logger.info(`Stored journal channel ID for guild ${guildId} in bot_settings`);
          }
        }
      }
      
      // Try to use the guild_journal_channels table first
      try {
        const { error: upsertError } = await supabase
          .from('guild_journal_channels')
          .upsert({
            guild_id: guildId,
            channel_id: journalChannel.id,
            updated_at: new Date().toISOString()
          });
          
        if (upsertError) {
          logger.warn("Could not upsert to guild_journal_channels:", upsertError);
          throw upsertError;
        } else {
          logger.info(`Stored journal channel ID for guild ${guildId} in guild_journal_channels`);
        }
      } catch (upsertError) {
        // Fall back to bot_settings if the table doesn't exist or upsert fails
        logger.info("Falling back to bot_settings for journal channel storage");
        
        const { error } = await supabase
          .from('bot_settings')
          .upsert({
            key: `journal_channel_id:${guildId}`,
            value: journalChannel.id,
            updated_at: new Date().toISOString()
          });
          
        if (error) {
          logger.error("Error storing journal channel ID in bot_settings:", error);
          throw error;
        } else {
          logger.info(`Stored journal channel ID for guild ${guildId} in bot_settings as fallback`);
        }
      }
    } catch (dbError) {
      logger.error("Error accessing database for journal setup:", dbError);
      throw dbError;
    }
    
    // Initialize the journal system with the channel for this guild
    await initializeJournalSystem(interaction.client, journalChannel.id, guildId);
    
    // Create an example post if requested
    if (postExample) {
      await createRandomJournalEntry(guildId);
    }
    
    await interaction.editReply(
      `Successfully ${specifiedChannel ? 'setup' : 'created'} Bri's journal channel: <#${journalChannel.id}>\n` +
      `She will now post to this channel when she has updates about her interests and activities in this server.`
    );
  } catch (error) {
    logger.error('Error setting up journal channel:', error);
    await interaction.editReply('There was an error setting up Bri\'s journal channel. Please check the logs.');
  }
}