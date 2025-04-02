// commands/debugdb.js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/combinedServices.js';

export const data = new SlashCommandBuilder()
    .setName('debugdb')
    .setDescription('Debug database connections for time features')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Only admins can use
    .addSubcommand(subcommand =>
        subcommand
            .setName('test')
            .setDescription('Test database connections for time features'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('create')
            .setDescription('Create missing time system tables'));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'test') {
            await testTimeSystemDatabase(interaction);
        } else if (subcommand === 'create') {
            await createTimeSystemTables(interaction);
        }
    } catch (error) {
        logger.error('Error in debugdb command:', error);
        return interaction.editReply({
            content: "An error occurred while debugging the database. Check the logs for details.",
            ephemeral: true
        });
    }
}

/**
 * Test time system database connections
 */
async function testTimeSystemDatabase(interaction) {
    try {
        const results = [];
        
        // Test 1: Basic connection
        results.push(`Testing basic database connection...`);
        try {
            const { data, error } = await supabase.from('unified_memories').select('count(*)', { count: 'exact', head: true });
            if (error) {
                results.push(`❌ Basic connection failed: ${error.message}`);
            } else {
                results.push(`✅ Basic connection successful`);
            }
        } catch (e) {
            results.push(`❌ Basic connection error: ${e.message}`);
        }
        
        // Test 2: Check each time system table
        const timeSystemTables = [
            'user_timezones', 
            'bri_events', 
            'bri_scheduled_messages'
        ];
        
        for (const table of timeSystemTables) {
            results.push(`\nTesting table '${table}'...`);
            try {
                const { data, error } = await supabase.from(table).select('count(*)', { count: 'exact', head: true });
                if (error) {
                    if (error.code === '42P01') {
                        results.push(`❌ Table '${table}' doesn't exist`);
                    } else {
                        results.push(`❌ Table '${table}' error: ${error.message}`);
                    }
                } else {
                    results.push(`✅ Table '${table}' exists and has ${data} rows`);
                }
            } catch (e) {
                results.push(`❌ Error testing '${table}': ${e.message}`);
            }
        }
        
        // Return results
        await interaction.editReply({
            content: `**Database Test Results:**\n\n${results.join('\n')}`,
            ephemeral: true
        });
    } catch (error) {
        logger.error('Error in testTimeSystemDatabase:', error);
        await interaction.editReply({
            content: "An error occurred during database testing: " + error.message,
            ephemeral: true
        });
    }
}

/**
 * Create missing time system tables
 */
async function createTimeSystemTables(interaction) {
    try {
        const results = [];
        
        // Try to create user_timezones table
        results.push(`Creating user_timezones table...`);
        try {
            const { error } = await supabase.query(`
                CREATE TABLE IF NOT EXISTS user_timezones (
                    user_id TEXT PRIMARY KEY,
                    timezone TEXT NOT NULL DEFAULT 'America/Chicago',
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `);
            
            if (error) {
                results.push(`❌ Failed: ${error.message}`);
            } else {
                results.push(`✅ Success!`);
            }
        } catch (e) {
            results.push(`❌ Error: ${e.message}`);
        }
        
        // Try to create bri_events table
        results.push(`\nCreating bri_events table...`);
        try {
            const { error } = await supabase.query(`
                CREATE TABLE IF NOT EXISTS bri_events (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    event_date TIMESTAMP WITH TIME ZONE NOT NULL,
                    end_date TIMESTAMP WITH TIME ZONE,
                    reminder_minutes INTEGER[] DEFAULT ARRAY[60],
                    recurrence TEXT,
                    recurrence_params JSONB,
                    channel_id TEXT,
                    last_reminded_at TIMESTAMP WITH TIME ZONE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `);
            
            if (error) {
                results.push(`❌ Failed: ${error.message}`);
            } else {
                results.push(`✅ Success!`);
            }
        } catch (e) {
            results.push(`❌ Error: ${e.message}`);
        }
        
        // Try to create bri_scheduled_messages table
        results.push(`\nCreating bri_scheduled_messages table...`);
        try {
            const { error } = await supabase.query(`
                CREATE TABLE IF NOT EXISTS bri_scheduled_messages (
                    id SERIAL PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    message_type TEXT NOT NULL,
                    message_content TEXT NOT NULL,
                    cron_schedule TEXT NOT NULL,
                    timezone TEXT DEFAULT 'America/Chicago',
                    last_sent_at TIMESTAMP WITH TIME ZONE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `);
            
            if (error) {
                results.push(`❌ Failed: ${error.message}`);
            } else {
                results.push(`✅ Success!`);
            }
        } catch (e) {
            results.push(`❌ Error: ${e.message}`);
        }
        
        // Return results
        await interaction.editReply({
            content: `**Table Creation Results:**\n\n${results.join('\n')}\n\nNote: You may need to restart the bot for changes to take effect.`,
            ephemeral: true
        });
    } catch (error) {
        logger.error('Error in createTimeSystemTables:', error);
        await interaction.editReply({
            content: "An error occurred during table creation: " + error.message,
            ephemeral: true
        });
    }
}