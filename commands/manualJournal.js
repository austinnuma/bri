// commands/manualJournal.js - Command to manually trigger a contextual journal entry
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { manualTriggerJournalEntry } from '../utils/briCharacterSheet.js';

export const data = new SlashCommandBuilder()
  .setName('manual-journal')
  .setDescription('Manually triggers Bri to create a contextual journal entry')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const guildId = interaction.guild?.id;
    
    if (!guildId) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }
    
    logger.info(`Manual journal entry requested by ${interaction.user.tag} in guild ${guildId}`);
    
    const result = await manualTriggerJournalEntry(guildId);
    
    if (result === true) {
      await interaction.editReply('✅ Successfully triggered a contextual journal entry.');
    } else if (result?.error === 'subscription_required') {
      await interaction.editReply('⚠️ Journal feature requires a subscription for this server.');
    } else {
      await interaction.editReply('❌ There was an error creating the journal entry. Please check the logs.');
    }
  } catch (error) {
    logger.error('Error in manual journal command:', error);
    await interaction.editReply('❌ There was an error processing your request. Please check the logs.');
  }
}