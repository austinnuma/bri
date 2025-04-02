// Script to clear migrated memories from the plain text fields
// Run this AFTER confirming the migration worked properly
// Run with: node scripts/clearMigratedMemories.js

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import readline from 'readline';

// Load environment variables
config();

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Clears the memory field for users who have their memories in the vector table
 */
async function clearMigratedMemories() {
  console.log("Preparing to clear migrated memories...");
  
  // Get all users with non-empty memory
  const { data, error } = await supabase
    .from('user_conversations')
    .select('user_id, memory')
    .not('memory', 'is', null);
    
  if (error) {
    console.error(`Error fetching records: ${error.message}`);
    return;
  }
  
  console.log(`Found ${data.length} users with memories that might need clearing`);
  
  // Ask for confirmation
  rl.question('This will clear memories from the plain text field. Are you sure? (yes/no): ', async (answer) => {
    if (answer.toLowerCase() !== 'yes') {
      console.log("Operation cancelled.");
      rl.close();
      return;
    }
    
    console.log("Proceeding with memory clearing...");
    let clearedCount = 0;
    
    for (const record of data) {
      if (!record.memory || record.memory.trim() === '') continue;
      
      const memories = record.memory.split('\n').filter(m => m.trim() !== '');
      if (memories.length === 0) continue;
      
      console.log(`Checking ${memories.length} memories for user ${record.user_id}`);
      
      // For each memory, check if it exists in the vector table
      const memoriesToKeep = [];
      
      for (const memoryText of memories) {
        // Skip very short memories
        if (memoryText.length < 5) {
          memoriesToKeep.push(memoryText);
          continue;
        }
        
        // Check if this memory exists in the vector table
        const { data: existingMemory } = await supabase
          .from('user_memory_vectors')
          .select('id')
          .eq('user_id', record.user_id)
          .eq('memory_text', memoryText)
          .maybeSingle();
          
        // If not found in vector table, keep it in the plain text field
        if (!existingMemory) {
          memoriesToKeep.push(memoryText);
        }
      }
      
      // Update the record if we're removing any memories
      if (memoriesToKeep.length < memories.length) {
        const newMemory = memoriesToKeep.join('\n');
        const { error: updateError } = await supabase
          .from('user_conversations')
          .update({ memory: newMemory.length > 0 ? newMemory : null })
          .eq('user_id', record.user_id);
          
        if (updateError) {
          console.error(`Error updating user ${record.user_id}: ${updateError.message}`);
        } else {
          const cleared = memories.length - memoriesToKeep.length;
          console.log(`Cleared ${cleared} memories for user ${record.user_id}`);
          clearedCount += cleared;
        }
      } else {
        console.log(`No memories to clear for user ${record.user_id}`);
      }
    }
    
    console.log(`\nOperation complete. Cleared ${clearedCount} memories.`);
    rl.close();
  });
}

// Run the clearing process
clearMigratedMemories().catch(err => {
  console.error("Error during memory clearing:", err);
  rl.close();
});