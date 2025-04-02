// commands/diagnose.js - A comprehensive diagnostic command
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Create an isolated database client just for diagnostics
const diagnosticDb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const data = new SlashCommandBuilder()
    .setName('diagnose')
    .setDescription('Run diagnostics on bot systems')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Admin only
    .addSubcommandGroup(group =>
        group
            .setName('database')
            .setDescription('Database diagnostics')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('test')
                    .setDescription('Test database connections'))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('read')
                    .setDescription('Test read operations'))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('write')
                    .setDescription('Test write operations')))
    .addSubcommandGroup(group =>
        group
            .setName('discord')
            .setDescription('Discord client diagnostics')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('test')
                    .setDescription('Test client functionality')));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const group = interaction.options.getSubcommandGroup();
        const subcommand = interaction.options.getSubcommand();
        
        logger.info(`Running diagnostics: ${group}/${subcommand}`);
        
        if (group === 'database') {
            if (subcommand === 'test') {
                await testDatabaseConnection(interaction);
            } else if (subcommand === 'read') {
                await testDatabaseRead(interaction);
            } else if (subcommand === 'write') {
                await testDatabaseWrite(interaction);
            }
        } else if (group === 'discord') {
            if (subcommand === 'test') {
                await testDiscordClient(interaction);
            }
        } else {
            await interaction.editReply({
                content: "Unknown diagnostic command.",
                ephemeral: true
            });
        }
    } catch (error) {
        logger.error('Error in diagnostic command:', error);
        return interaction.editReply({
            content: "An error occurred during diagnostics: " + error.message,
            ephemeral: true
        });
    }
}

/**
 * Test basic database connection
 */
async function testDatabaseConnection(interaction) {
    const results = [];
    
    results.push("**Database Connection Test**");
    results.push("Testing connection with dedicated client...");
    
    try {
        // Very simple query
        const { data, error } = await diagnosticDb
            .from('_unknown_table')
            .select('*')
            .limit(1);
            
        if (error) {
            if (error.code === '42P01') { // Table doesn't exist error (expected)
                results.push("✅ Connection successful (expected table not found error)");
            } else {
                results.push(`❌ Connection error: ${JSON.stringify(error)}`);
            }
        } else {
            results.push("✅ Connection successful");
        }
    } catch (e) {
        results.push(`❌ Connection exception: ${e.message}`);
    }
    
    results.push("\nTesting with environment variables:");
    results.push(`SUPABASE_URL: ${process.env.SUPABASE_URL ? "✅ Present" : "❌ Missing"}`);
    results.push(`SUPABASE_KEY: ${process.env.SUPABASE_KEY ? "✅ Present" : "❌ Missing"}`);
    
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        results.push(`SUPABASE_URL starts with: ${process.env.SUPABASE_URL.substring(0, 12)}...`);
        results.push(`SUPABASE_KEY length: ${process.env.SUPABASE_KEY.length} characters`);
    }
    
    await interaction.editReply({
        content: results.join('\n'),
        ephemeral: true
    });
}

/**
 * Test database read operations on specific tables
 */
async function testDatabaseRead(interaction) {
    const results = [];
    
    results.push("**Database Read Test**");
    
    const tables = [
        'unified_memories',
        'user_timezones',
        'bri_events',
        'bri_scheduled_messages'
    ];
    
    for (const table of tables) {
        results.push(`\nTesting read from table '${table}'...`);
        
        try {
            const { data, error } = await diagnosticDb
                .from(table)
                .select('*')
                .limit(1);
                
            if (error) {
                results.push(`❌ Read error: ${JSON.stringify(error)}`);
            } else if (!data || data.length === 0) {
                results.push("✅ Table exists but is empty");
            } else {
                results.push("✅ Successfully read data");
                results.push(`Sample keys: ${Object.keys(data[0]).join(', ')}`);
            }
        } catch (e) {
            results.push(`❌ Read exception: ${e.message}`);
        }
    }
    
    await interaction.editReply({
        content: results.join('\n'),
        ephemeral: true
    });
}

/**
 * Test database write operations
 */
async function testDatabaseWrite(interaction) {
    const results = [];
    
    results.push("**Database Write Test**");
    
    // Test in user_timezones table
    results.push("\nTesting write to user_timezones...");
    
    try {
        const testData = {
            user_id: `test_${interaction.user.id}`,
            timezone: 'America/Chicago',
            updated_at: new Date().toISOString()
        };
        
        // Insert test record
        const { data, error } = await diagnosticDb
            .from('user_timezones')
            .upsert(testData)
            .select();
            
        if (error) {
            results.push(`❌ Write error: ${JSON.stringify(error)}`);
        } else {
            results.push("✅ Write successful");
            
            // Clean up
            try {
                await diagnosticDb
                    .from('user_timezones')
                    .delete()
                    .eq('user_id', testData.user_id);
                    
                results.push("✅ Cleanup successful");
            } catch (cleanupError) {
                results.push(`⚠️ Cleanup warning: ${cleanupError.message}`);
            }
        }
    } catch (e) {
        results.push(`❌ Write exception: ${e.message}`);
    }
    
    await interaction.editReply({
        content: results.join('\n'),
        ephemeral: true
    });
}

/**
 * Test Discord client functionality
 */
async function testDiscordClient(interaction) {
    const results = [];
    
    results.push("**Discord Client Test**");
    
    // Test client reference
    results.push("\nChecking client reference...");
    
    if (!interaction.client) {
        results.push("❌ Client reference is null or undefined");
    } else {
        results.push("✅ Client reference exists");
        
        // Test basic properties
        results.push(`Client user: ${interaction.client.user ? interaction.client.user.tag : "undefined"}`);
        results.push(`Client readyAt: ${interaction.client.readyAt ? interaction.client.readyAt.toISOString() : "undefined"}`);
        results.push(`Client uptime: ${interaction.client.uptime ? Math.floor(interaction.client.uptime / 1000) + " seconds" : "undefined"}`);
        
        // Test channel fetch
        results.push("\nTesting channel fetch...");
        try {
            const channel = await interaction.client.channels.fetch(interaction.channelId);
            if (channel) {
                results.push(`✅ Successfully fetched channel ${channel.name}`);
            } else {
                results.push("❌ Channel fetch returned null");
            }
        } catch (channelError) {
            results.push(`❌ Channel fetch error: ${channelError.message}`);
        }
        
        // Test user fetch
        results.push("\nTesting user fetch...");
        try {
            const user = await interaction.client.users.fetch(interaction.user.id);
            if (user) {
                results.push(`✅ Successfully fetched user ${user.tag}`);
            } else {
                results.push("❌ User fetch returned null");
            }
        } catch (userError) {
            results.push(`❌ User fetch error: ${userError.message}`);
        }
    }
    
    await interaction.editReply({
        content: results.join('\n'),
        ephemeral: true
    });
}