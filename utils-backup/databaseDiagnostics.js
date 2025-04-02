// Add this to a new file utils/databaseDiagnostic.js

import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';

/**
 * Tests database connections using different methods to isolate the issue
 */
export async function testDatabaseInDepth() {
  logger.info("======== DETAILED DATABASE CONNECTION TEST ========");
  
  // Test 1: Direct supabase instance
  logger.info("Test 1: Testing direct Supabase instance...");
  try {
    const { data: direct, error: directError } = await supabase
      .from('unified_memories')
      .select('count(*)', { count: 'exact', head: true });
      
    if (directError) {
      logger.error("Direct Supabase instance error:", directError);
    } else {
      logger.info("✅ Direct Supabase instance works");
    }
  } catch (error) {
    logger.error("Direct Supabase instance exception:", error);
  }
  
  // Test 2: Create a new Supabase instance
  logger.info("Test 2: Testing fresh Supabase instance...");
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const freshSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    
    const { data: fresh, error: freshError } = await freshSupabase
      .from('unified_memories')
      .select('count(*)', { count: 'exact', head: true });
      
    if (freshError) {
      logger.error("Fresh Supabase instance error:", freshError);
    } else {
      logger.info("✅ Fresh Supabase instance works");
    }
  } catch (error) {
    logger.error("Fresh Supabase instance exception:", error);
  }
  
  // Test 3: Test time system tables specifically
  logger.info("Test 3: Testing time system tables with both instances...");
  try {
    // Try with direct instance
    const tables = ['user_timezones', 'bri_events', 'bri_scheduled_messages'];
    
    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('count(*)', { count: 'exact', head: true });
          
        if (error) {
          logger.error(`Direct instance - Table '${table}' error:`, error);
        } else {
          logger.info(`✅ Direct instance - Table '${table}' works`);
        }
      } catch (tableError) {
        logger.error(`Direct instance - Table '${table}' exception:`, tableError);
      }
    }
    
    // Try with fresh instance
    const { createClient } = await import('@supabase/supabase-js');
    const freshSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
    
    for (const table of tables) {
      try {
        const { data, error } = await freshSupabase
          .from(table)
          .select('count(*)', { count: 'exact', head: true });
          
        if (error) {
          logger.error(`Fresh instance - Table '${table}' error:`, error);
        } else {
          logger.info(`✅ Fresh instance - Table '${table}' works`);
        }
      } catch (tableError) {
        logger.error(`Fresh instance - Table '${table}' exception:`, tableError);
      }
    }
  } catch (error) {
    logger.error("Time system tables test exception:", error);
  }
  
  // Test 4: Check if there's a typo in table names
  logger.info("Test 4: Checking for table name typos...");
  
  const possibleNames = {
    'user_timezones': ['user_timezone', 'user_time_zones', 'user_time_zone', 'user_timezones'],
    'bri_events': ['bri_event', 'bri_events', 'events', 'bot_events'],
    'bri_scheduled_messages': ['bri_scheduled_message', 'bri_scheduled_messages', 'scheduled_messages', 'bot_scheduled_messages']
  };
  
  for (const [correctName, variations] of Object.entries(possibleNames)) {
    for (const tableName of variations) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('count(*)', { count: 'exact', head: true });
          
        if (!error) {
          logger.info(`✅ Table '${tableName}' exists (Expected: '${correctName}')`);
        }
      } catch (error) {
        // Just skip errors
      }
    }
  }
  
  // Test 5: Check for environment variable issues
  logger.info("Test 5: Checking environment variables...");
  try {
    // Just check first few characters to avoid logging sensitive info
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_KEY || '';
    
    logger.info(`SUPABASE_URL starts with: ${supabaseUrl.substring(0, 8)}...`);
    logger.info(`SUPABASE_KEY length: ${supabaseKey.length}`);
    
    if (!supabaseUrl || !supabaseKey) {
      logger.error("Missing Supabase environment variables!");
    }
  } catch (error) {
    logger.error("Environment variable check error:", error);
  }
  
  logger.info("======== DATABASE CONNECTION TEST COMPLETE ========");
}