// commands/journalEntry.js - Command to trigger journal entries for testing
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createRandomJournalEntry, createStorylineJournalEntry, createInterestJournalEntry, JOURNAL_ENTRY_TYPES } from '../utils/journalSystem.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/combinedServices.js';
import { manualTriggerJournalEntry } from '../utils/briCharacterSheet.js';
//import { manual } from 'openai/src/_shims/manual-types.mjs';

export const data = new SlashCommandBuilder()
  .setName('journal-entry')
  .setDescription('Triggers Bri to create a journal entry')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption(option =>
    option.setName('type')
      .setDescription('The type of journal entry to create')
      .setRequired(true)
      .addChoices(
        { name: 'Random Thought/Activity', value: 'random' },
        { name: 'Storyline Update', value: 'storyline' },
        { name: 'Interest Update', value: 'interest' }
      ));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const entryType = interaction.options.getString('type');
    // Extract the guild ID from the interaction
    const guildId = interaction.guild?.id;
    
    // Check if we have a valid guild ID
    if (!guildId) {
      logger.error("No guild ID found in interaction");
      await interaction.editReply('This command can only be used in a server.');
      return;
    }
    
    switch (entryType) {
      case 'random':
        // Create a random journal entry
        await manualTriggerJournalEntry(guildId);
        await interaction.editReply('Created a random journal entry');
        break;
        
      case 'storyline':
        // Get a random storyline and create an entry
        const { data: storylines, error: storylineError } = await supabase
          .from('bri_storyline')
          .select('*')
          .eq('status', 'in_progress')
          .limit(10);
          
        if (storylineError) {
          logger.error("Error fetching storylines:", storylineError);
          await interaction.editReply('Error fetching storylines');
          return;
        }
        
        if (!storylines || storylines.length === 0) {
          await interaction.editReply('No active storylines found');
          return;
        }
        
        const randomStoryline = storylines[Math.floor(Math.random() * storylines.length)];
        await createStorylineJournalEntry(randomStoryline, guildId);
        await interaction.editReply(`Created a journal entry for storyline: ${randomStoryline.title}`);
        break;
        
      case 'interest':
        // Get a random interest and create an entry
        const { data: interests, error: interestError } = await supabase
          .from('bri_interests')
          .select('*')
          .limit(10);
          
        if (interestError) {
          logger.error("Error fetching interests:", interestError);
          await interaction.editReply('Error fetching interests');
          return;
        }
        
        if (!interests || interests.length === 0) {
          await interaction.editReply('No interests found');
          return;
        }
        
        const randomInterest = interests[Math.floor(Math.random() * interests.length)];
        const isNew = Math.random() < 0.3; // 30% chance to treat as a new interest
        await createInterestJournalEntry(randomInterest, isNew, guildId);
        await interaction.editReply(`Created a journal entry for interest: ${randomInterest.name}`);
        break;
        
      default:
        await interaction.editReply('Invalid entry type');
    }
  } catch (error) {
    logger.error('Error creating journal entry:', error);
    await interaction.editReply('There was an error creating the journal entry. Please check the logs.');
  }
}