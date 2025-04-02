// One-time migration script to convert all plain text memories to vector format
// Run with: node scripts/migrateMemories.js

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

// Load environment variables
config();

// Initialize services
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Local cache to avoid redundant API calls
const embeddingCache = new Map();

/**
 * Normalizes text by removing extra whitespace, converting to lowercase
 * @param {string} text - The text to normalize
 * @returns {string} - Normalized text
 */
function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Gets an embedding for text, using cache when possible
 * @param {string} text - The text to embed
 * @returns {Promise<Array>} - The embedding vector
 */
async function getEmbedding(text) {
  const normalized = normalizeText(text);
  
  if (embeddingCache.has(normalized)) {
    return embeddingCache.get(normalized);
  }
  
  try {
    console.log(`Getting embedding for: "${text.substring(0, 30)}..."`);
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: normalized,
    });
    
    const embedding = response.data[0].embedding;
    embeddingCache.set(normalized, embedding);
    return embedding;
  } catch (error) {
    console.error(`Error getting embedding: ${error.message}`);
    throw error;
  }
}

/**
 * Creates a vector memory
 * @param {string} userId - User ID
 * @param {string} text - Memory text
 * @returns {Promise<boolean>} - Success status
 */
async function createVectorMemory(userId, text) {
  try {
    // Skip if already exists
    const { data: existing } = await supabase
      .from('user_memory_vectors')
      .select('id')
      .eq('user_id', userId)
      .eq('memory_text', text)
      .single();
      
    if (existing) {
      console.log(`Memory already exists: "${text.substring(0, 30)}..."`);
      return true;
    }
    
    // Get embedding
    const embedding = await getEmbedding(text);
    
    // Insert into vector table
    const { error } = await supabase
      .from('user_memory_vectors')
      .insert([{
        user_id: userId,
        memory_text: text,
        embedding
      }]);
      
    if (error) {
      console.error(`Error inserting memory: ${error.message}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error creating vector memory: ${error.message}`);
    return false;
  }
}

/**
 * Main migration function
 */
async function migrateMemories() {
  console.log("Starting memory migration...");
  
  // Track statistics
  const stats = {
    totalUsers: 0,
    totalMemories: 0,
    successfulMigrations: 0,
    failedMigrations: 0
  };
  
  // Get all users with non-empty memory
  const { data, error } = await supabase
    .from('user_conversations')
    .select('user_id, memory')
    .not('memory', 'is', null);
    
  if (error) {
    console.error(`Error fetching records: ${error.message}`);
    return;
  }
  
  stats.totalUsers = data.length;
  console.log(`Found ${data.length} users with memories to migrate`);
  
  // Create a log directory if it doesn't exist
  const logDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  
  // Log file for tracking migration
  const logFile = path.join(logDir, `memory_migration_${Date.now()}.log`);
  const migrationLog = fs.createWriteStream(logFile, { flags: 'a' });
  
  // Process each user
  for (const record of data) {
    if (!record.memory || record.memory.trim() === '') continue;
    
    const memories = record.memory.split('\n').filter(m => m.trim() !== '');
    stats.totalMemories += memories.length;
    
    console.log(`Processing ${memories.length} memories for user ${record.user_id}`);
    migrationLog.write(`User: ${record.user_id} - ${memories.length} memories\n`);
    
    // Process each memory
    for (const memoryText of memories) {
      if (memoryText.length < 5) continue;
      
      try {
        const success = await createVectorMemory(record.user_id, memoryText);
        
        if (success) {
          stats.successfulMigrations++;
          migrationLog.write(`  [SUCCESS] ${memoryText}\n`);
        } else {
          stats.failedMigrations++;
          migrationLog.write(`  [FAILED] ${memoryText}\n`);
        }
      } catch (error) {
        stats.failedMigrations++;
        migrationLog.write(`  [ERROR] ${memoryText} - ${error.message}\n`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`Completed processing for user ${record.user_id}`);
    migrationLog.write(`Completed user: ${record.user_id}\n\n`);
  }
  
  // Print summary statistics
  console.log("\nMigration Summary:");
  console.log(`Total Users: ${stats.totalUsers}`);
  console.log(`Total Memories: ${stats.totalMemories}`);
  console.log(`Successfully Migrated: ${stats.successfulMigrations}`);
  console.log(`Failed Migrations: ${stats.failedMigrations}`);
  console.log(`Migration Log: ${logFile}`);
  
  migrationLog.end();
  
  // Ask if user wants to clear the memory fields after successful migration
  if (stats.successfulMigrations > 0) {
    console.log("\nDo you want to clear successfully migrated memories from the plain text fields?");
    console.log("This is recommended to avoid duplication, but you may want to run this script again first");
    console.log("if there were any failed migrations.");
    console.log("\nTo clear memories, run: node scripts/clearMigratedMemories.js");
  }
}

// Run migration
migrateMemories()
  .then(() => console.log("Migration complete"))
  .catch(err => console.error("Migration failed:", err))
  .finally(() => {
    // Allow Node.js process to exit
    setTimeout(() => process.exit(), 1000);
  });