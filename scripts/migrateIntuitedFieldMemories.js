// Migration script specifically for intuited_memories field in user_conversations
// Usage: node scripts/migrateIntuitedFieldMemories.js

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';

// Load environment variables
config();

// Initialize clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embeddingCache = new Map();

// Create log directory if it doesn't exist
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Log file
const logFile = path.join(logDir, `intuited_field_migration_${Date.now()}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Logging helper
function log(message) {
  console.log(message);
  logStream.write(message + '\n');
}

/**
 * Gets an embedding for text with caching
 */
async function getEmbedding(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  
  if (embeddingCache.has(normalized)) {
    return embeddingCache.get(normalized);
  }
  
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: normalized,
    });
    
    const embedding = response.data[0].embedding;
    embeddingCache.set(normalized, embedding);
    return embedding;
  } catch (error) {
    log(`Error getting embedding: ${error.message}`);
    throw error;
  }
}

/**
 * Categorizes memory by content
 */
function categorizeMemory(text) {
  const lowered = text.toLowerCase();
  
  const categories = [
    { name: 'personal', keywords: ['name', 'age', 'birthday', 'born', 'lives', 'from', 'family', 'spouse', 'married', 'children', 'child', 'kids'] },
    { name: 'professional', keywords: ['job', 'work', 'career', 'company', 'business', 'profession', 'position', 'occupation', 'employed', 'studies', 'studied', 'education', 'school', 'university', 'college', 'degree'] },
    { name: 'preferences', keywords: ['like', 'likes', 'enjoy', 'enjoys', 'love', 'loves', 'prefer', 'prefers', 'favorite', 'favourite', 'fond', 'hates', 'hate', 'dislike', 'dislikes'] },
    { name: 'hobbies', keywords: ['hobby', 'hobbies', 'collect', 'collects', 'play', 'plays', 'game', 'games', 'sport', 'sports', 'activity', 'activities', 'weekend', 'spare time', 'pastime', 'leisure'] },
    { name: 'contact', keywords: ['email', 'phone', 'address', 'contact', 'reach', 'social media', 'instagram', 'twitter', 'facebook'] }
  ];
  
  for (const category of categories) {
    if (category.keywords.some(keyword => lowered.includes(keyword))) {
      return category.name;
    }
  }
  
  return 'other';
}

/**
 * Main migration function
 */
async function migrateIntuitedFieldMemories() {
  log('Starting migration of intuited_memories field from user_conversations...');
  
  // Get all records with non-empty intuited_memories
  const { data, error } = await supabase
    .from('user_conversations')
    .select('user_id, intuited_memories')
    .not('intuited_memories', 'is', null);
    
  if (error) {
    log(`Error fetching records: ${error.message}`);
    return;
  }
  
  if (!data || data.length === 0) {
    log('No records with intuited_memories found.');
    return;
  }
  
  log(`Found ${data.length} users with intuited_memories to migrate`);
  
  let totalMemories = 0;
  let successCount = 0;
  
  // Process each user
  for (const record of data) {
    if (!record.intuited_memories) continue;
    
    let memories = [];
    
    // intuited_memories might be stored in different formats (string, array, JSON)
    // Try to handle all formats
    if (typeof record.intuited_memories === 'string') {
      try {
        // Try parsing as JSON
        memories = JSON.parse(record.intuited_memories);
      } catch (e) {
        // If not JSON, treat as comma or newline separated
        memories = record.intuited_memories
          .split(/[,\n]/)
          .map(m => m.trim())
          .filter(m => m.length > 0);
      }
    } else if (Array.isArray(record.intuited_memories)) {
      memories = record.intuited_memories;
    } else if (typeof record.intuited_memories === 'object') {
      // If it's an object, try to extract values
      memories = Object.values(record.intuited_memories)
        .filter(m => typeof m === 'string')
        .map(m => m.trim());
    }
    
    if (memories.length === 0) {
      log(`No valid memories found for user ${record.user_id}`);
      continue;
    }
    
    totalMemories += memories.length;
    log(`Processing ${memories.length} intuited memories for user ${record.user_id}`);
    
    // Process each memory
    for (const memoryText of memories) {
      if (typeof memoryText !== 'string' || memoryText.length < 5) continue;
      
      try {
        // Get embedding
        const embedding = await getEmbedding(memoryText);
        
        // Determine category
        const category = categorizeMemory(memoryText);
        
        // Insert into unified table
        const { error: insertError } = await supabase
          .from('unified_memories')
          .insert({
            user_id: record.user_id,
            memory_text: memoryText,
            embedding: embedding,
            memory_type: 'intuited',
            category: category,
            confidence: 0.8, // Default confidence for intuited memories
            source: 'legacy_intuited_field'
          });
          
        if (insertError) {
          log(`Error migrating intuited memory: ${insertError.message}`);
        } else {
          successCount++;
          if (successCount % 10 === 0) {
            log(`Migrated ${successCount} intuited memories so far...`);
          }
        }
      } catch (err) {
        log(`Error processing intuited memory: ${err.message}`);
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  log(`\nMigration complete!`);
  log(`Total users processed: ${data.length}`);
  log(`Total memories found: ${totalMemories}`);
  log(`Successfully migrated: ${successCount}`);
  log(`Log file: ${logFile}`);
}

// Run the migration
migrateIntuitedFieldMemories()
  .then(() => console.log('Migration complete!'))
  .catch(err => {
    console.error('Migration failed:', err);
    log(`Migration failed: ${err.message}`);
  })
  .finally(() => {
    // Ensure the program exits
    setTimeout(() => process.exit(), 1000);
  });