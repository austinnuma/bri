// commands/setupJournal.js - Command to set up Bri's journal channel
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { initializeJournalSystem, createRandomJournalEntry } from '../utils/journalSystem.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('setup-journal')
  .setDescription('Sets up Bri\'s personal journal channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
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
  
  try {
    let journalChannel;
    
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
      
      logger.info(`Created new journal channel: ${journalChannel.name} (${journalChannel.id})`);
    }
    
    // Initialize the journal system with the channel
    await initializeJournalSystem(interaction.client, journalChannel.id);
    
    // Store the channel ID in the database
    try {
      const { error } = await interaction.client.supabase
        .from('bot_settings')
        .upsert({
          key: 'journal_channel_id',
          value: journalChannel.id,
          updated_at: new Date().toISOString()
        });
        
      if (error) {
        logger.error("Error storing journal channel ID:", error);
      }
    } catch (dbError) {
      logger.error("Error accessing database for journal setup:", dbError);
    }
    
    // Create an example post if requested
    if (postExample) {
      await createRandomJournalEntry();
    }
    
    await interaction.editReply(
      `Successfully ${specifiedChannel ? 'setup' : 'created'} Bri's journal channel: <#${journalChannel.id}>\n` +
      `She will now post to this channel when she has updates about her interests and activities.`
    );
  } catch (error) {
    logger.error('Error setting up journal channel:', error);
    await interaction.editReply('There was an error setting up Bri\'s journal channel. Please check the logs.');
  }
}