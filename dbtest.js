// Save this as dbtest.js in your project root

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// List of tables to test
const tables = [
  'unified_memories',  // Known working table
  'user_timezone',     // Try singular
  'user_timezones',    // Try plural
  'bri_events',
  'bri_scheduled_messages'
];

async function testTables() {
  console.log('Testing Supabase database connection and tables...');
  
  // Test basic connection
  try {
    const { data, error } = await supabase.from('_tests').select('count(*)');
    if (error && error.code === '42P01') {
      console.log('✅ Basic connection works (table doesn\'t exist, but connection is good)');
    } else if (error) {
      console.error('❌ Basic connection error:', error);
    } else {
      console.log('✅ Basic connection works');
    }
  } catch (error) {
    console.error('❌ Basic connection exception:', error);
  }
  
  // Test each table
  for (const table of tables) {
    console.log(`\nTesting table: ${table}`);
    try {
      const { data, error } = await supabase
        .from(table)
        .select('count(*)', { count: 'exact', head: true });
        
      if (error) {
        if (error.code === '42P01') {
          console.error(`❌ Table '${table}' doesn't exist`);
        } else {
          console.error(`❌ Table '${table}' error:`, error);
        }
      } else {
        console.log(`✅ Table '${table}' exists and has ${data} rows`);
        
        // Try to get one row to validate structure
        try {
          const { data: rowData, error: rowError } = await supabase
            .from(table)
            .select('*')
            .limit(1);
            
          if (rowError) {
            console.error(`❌ Error fetching row from '${table}':`, rowError);
          } else if (rowData && rowData.length > 0) {
            console.log(`✅ Sample row from '${table}':`, rowData[0]);
          } else {
            console.log(`ℹ️ Table '${table}' is empty`);
          }
        } catch (rowError) {
          console.error(`❌ Exception fetching row from '${table}':`, rowError);
        }
      }
    } catch (error) {
      console.error(`❌ Exception testing table '${table}':`, error);
    }
  }
}

// Run tests
testTables()
  .then(() => console.log('\nTests completed.'))
  .catch(err => console.error('\nTest failed with error:', err))
  .finally(() => process.exit());