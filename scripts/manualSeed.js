// manualSeed.js - Run this script to manually seed the character development tables
import 'dotenv/config'; // This loads environment variables from .env file
import { createClient } from '@supabase/supabase-js';
import winston from 'winston';

// Setup minimal logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: 'seed-log.log' })
    ]
});

// Create direct Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Mock the embedding function for seeding purposes
// This avoids OpenAI API calls which might not be available in this context
async function getEmbedding(text) {
    logger.info(`Mock embedding generated for: ${text.substring(0, 30)}...`);
    // Return null instead of trying to generate a real embedding
    return null;
}

// Initial interests
const INITIAL_INTERESTS = [
  {
    name: "space exploration",
    level: 2,
    description: "Fascinated by stars, planets, astronauts, and space missions",
    facts: [
      "The Sun is so big that about 1.3 million Earths could fit inside it!",
      "A day on Venus is longer than a year on Venus - it takes 243 Earth days to rotate once!",
      "The footprints left by astronauts on the Moon will stay there for millions of years because there's no wind to blow them away."
    ],
    tags: ["astronomy", "space", "planets", "stars", "NASA", "rockets"],
    share_threshold: 0.7
  },
  {
    name: "animals",
    level: 3,
    description: "Loves learning about different animals, especially unusual ones",
    facts: [
      "Octopuses have three hearts, nine brains, and blue blood!",
      "Sloths can hold their breath underwater for up to 40 minutes.",
      "A group of flamingos is called a flamboyance!"
    ],
    tags: ["animals", "wildlife", "pets", "zoo", "nature", "creatures"],
    share_threshold: 0.8
  },
  {
    name: "arts and crafts",
    level: 2,
    description: "Enjoys making things with her hands, especially colorful projects",
    facts: [
      "I made a really cool friendship bracelet with blue and purple threads yesterday!",
      "Origami was invented in Japan, and the word means 'folding paper'.",
      "I've been collecting pretty rocks to paint faces on them and make a rock family."
    ],
    tags: ["crafts", "art", "drawing", "painting", "making", "creating", "glitter", "colors"],
    share_threshold: 0.6
  }
];

// Initial storyline events
const INITIAL_STORYLINE = [
  {
    id: "science_fair_project",
    title: "Science Fair Project",
    description: "Working on a science fair project about how plants grow in different conditions",
    status: "in_progress",
    start_date: new Date("2025-02-01").toISOString(),
    end_date: new Date("2025-04-15").toISOString(),
    progress: 0.3,
    updates: [
      {
        date: new Date("2025-02-05").toISOString(),
        content: "Started my science fair project today! I'm growing bean plants in different types of soil."
      },
      {
        date: new Date("2025-02-20").toISOString(),
        content: "The plants in the sandy soil aren't growing very well, but the ones in the compost are huge!"
      }
    ],
    share_threshold: 0.5
  },
  {
    id: "learning_chess",
    title: "Learning Chess",
    description: "Trying to learn how to play chess",
    status: "in_progress",
    start_date: new Date("2025-01-15").toISOString(),
    end_date: null,
    progress: 0.2,
    updates: [
      {
        date: new Date("2025-01-15").toISOString(),
        content: "My friend taught me how all the chess pieces move today! The knights are confusing."
      }
    ],
    share_threshold: 0.4
  }
];

/**
 * Check if tables already have data
 */
async function checkForExistingData() {
  try {
    // Check interests table
    const { data: interests, error: interestsError } = await supabase
      .from('bri_interests')
      .select('id')
      .limit(1);
      
    if (interestsError && interestsError.code === '42P01') {
      // Table doesn't exist
      logger.info("Interests table doesn't exist yet.");
      await ensureTablesExist();
      return false;
    } else if (interestsError) {
      logger.error("Error checking interests table:", interestsError);
      return false;
    }
    
    // Check storyline table
    const { data: storylines, error: storylinesError } = await supabase
      .from('bri_storyline')
      .select('id')
      .limit(1);
      
    if (storylinesError && storylinesError.code === '42P01') {
      // Table doesn't exist
      logger.info("Storyline table doesn't exist yet.");
      await ensureTablesExist();
      return false;
    } else if (storylinesError) {
      logger.error("Error checking storyline table:", storylinesError);
      return false;
    }
    
    // Return true if either table has data
    return (interests && interests.length > 0) || (storylines && storylines.length > 0);
  } catch (error) {
    logger.error("Error checking for existing data:", error);
    return false;
  }
}

/**
 * Ensures all required tables exist
 */
async function ensureTablesExist() {
  try {
    logger.info("Creating tables if they don't exist...");
    
    // Create interests table
    const interestsResult = await supabase.rpc('create_interests_table').catch(async (error) => {
      logger.warn("RPC method failed for interests table, trying SQL:", error);
      
      // Fall back to direct SQL (this assumes you have the necessary permissions)
      return await supabase.from('storage').select('*').limit(1);
    });
    
    // Create bri_interests table using raw SQL if needed
    try {
      const { data: interestsCheck, error: interestsCheckError } = await supabase
        .from('bri_interests')
        .select('id')
        .limit(1);
        
      if (interestsCheckError && interestsCheckError.code === '42P01') {
        logger.info("Creating bri_interests table using SQL...");
        await supabase.from('__raw_tables').insert({
          sql: `
            CREATE TABLE IF NOT EXISTS bri_interests (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              level INTEGER NOT NULL DEFAULT 1,
              description TEXT,
              facts JSONB,
              tags JSONB,
              last_discussed TIMESTAMP WITH TIME ZONE,
              share_threshold FLOAT DEFAULT 0.5,
              embedding VECTOR(1536)
            );
          `
        });
      }
    } catch (error) {
      logger.warn("Error creating interests table with SQL:", error);
      logger.info("You may need to create the table manually in the Supabase interface");
    }
    
    // Create storyline table
    const storylineResult = await supabase.rpc('create_storyline_table').catch(async (error) => {
      logger.warn("RPC method failed for storyline table, trying SQL:", error);
      
      // Try to create bri_storyline table using raw SQL
      try {
        const { data: storylineCheck, error: storylineCheckError } = await supabase
          .from('bri_storyline')
          .select('id')
          .limit(1);
          
        if (storylineCheckError && storylineCheckError.code === '42P01') {
          logger.info("Creating bri_storyline table using SQL...");
          await supabase.from('__raw_tables').insert({
            sql: `
              CREATE TABLE IF NOT EXISTS bri_storyline (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL,
                start_date TIMESTAMP WITH TIME ZONE,
                end_date TIMESTAMP WITH TIME ZONE,
                progress FLOAT DEFAULT 0,
                updates JSONB,
                share_threshold FLOAT DEFAULT 0.5,
                embedding VECTOR(1536)
              );
            `
          });
        }
      } catch (error) {
        logger.warn("Error creating storyline table with SQL:", error);
        logger.info("You may need to create the table manually in the Supabase interface");
      }
    });
    
    // Create relationships table
    const relationshipsResult = await supabase.rpc('create_relationships_table').catch(async (error) => {
      logger.warn("RPC method failed for relationships table, trying SQL:", error);
      
      // Try to create bri_relationships table using raw SQL
      try {
        const { data: relationshipsCheck, error: relationshipsCheckError } = await supabase
          .from('bri_relationships')
          .select('user_id')
          .limit(1);
          
        if (relationshipsCheckError && relationshipsCheckError.code === '42P01') {
          logger.info("Creating bri_relationships table using SQL...");
          await supabase.from('__raw_tables').insert({
            sql: `
              CREATE TABLE IF NOT EXISTS bri_relationships (
                user_id TEXT PRIMARY KEY,
                level INTEGER NOT NULL DEFAULT 0,
                interaction_count INTEGER DEFAULT 0,
                last_interaction TIMESTAMP WITH TIME ZONE,
                shared_interests JSONB,
                conversation_topics JSONB,
                inside_jokes JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
              );
            `
          });
        }
      } catch (error) {
        logger.warn("Error creating relationships table with SQL:", error);
        logger.info("You may need to create the table manually in the Supabase interface");
      }
    });
    
    logger.info("Table creation attempts completed");
  } catch (error) {
    logger.error("Error ensuring tables exist:", error);
  }
}

/**
 * Seeds the database with initial character data
 */
async function seedInitialCharacterData() {
  try {
    logger.info("Starting manual seeding of character development data...");
    console.log("Starting to seed character development data...");
    
    // Check if tables already have data
    const hasData = await checkForExistingData();
    if (hasData) {
      logger.info("Tables already contain data. Skipping seeding.");
      console.log("Tables already contain data. Skipping seeding.");
      return;
    }

    // Double-check that tables exist (in case checkForExistingData didn't create them)
    await ensureTablesExist();
    
    // Seed interests
    console.log("Seeding interests...");
    let interestsSuccessCount = 0;
    for (const interest of INITIAL_INTERESTS) {
      try {
        console.log(`Processing interest: ${interest.name}`);
        // No need to generate embedding in this simplified version
        const embedding = null;
        
        const { error } = await supabase.from('bri_interests').insert({
          name: interest.name,
          level: interest.level,
          description: interest.description,
          facts: interest.facts,
          tags: interest.tags,
          last_discussed: null,
          share_threshold: interest.share_threshold,
          embedding: embedding
        });
        
        if (error) {
          logger.error(`Error inserting interest ${interest.name}:`, error);
          console.error(`Error inserting interest ${interest.name}:`, error);
        } else {
          logger.info(`Successfully inserted interest: ${interest.name}`);
          console.log(`Successfully inserted interest: ${interest.name}`);
          interestsSuccessCount++;
        }
      } catch (interestError) {
        logger.error(`Error processing interest ${interest.name}:`, interestError);
        console.error(`Error processing interest ${interest.name}:`, interestError);
        // Continue with next interest
      }
    }
    
    // Seed storyline events
    console.log("Seeding storylines...");
    let storylinesSuccessCount = 0;
    for (const event of INITIAL_STORYLINE) {
      try {
        console.log(`Processing storyline: ${event.id}`);
        // No need to generate embedding in this simplified version
        const embedding = null;
        
        const { error } = await supabase.from('bri_storyline').insert({
          id: event.id,
          title: event.title,
          description: event.description,
          status: event.status,
          start_date: event.start_date,
          end_date: event.end_date,
          progress: event.progress,
          updates: event.updates,
          share_threshold: event.share_threshold,
          embedding: embedding
        });
        
        if (error) {
          logger.error(`Error inserting storyline ${event.id}:`, error);
          console.error(`Error inserting storyline ${event.id}:`, error);
        } else {
          logger.info(`Successfully inserted storyline: ${event.id}`);
          console.log(`Successfully inserted storyline: ${event.id}`);
          storylinesSuccessCount++;
        }
      } catch (storylineError) {
        logger.error(`Error processing storyline ${event.id}:`, storylineError);
        console.error(`Error processing storyline ${event.id}:`, storylineError);
        // Continue with next storyline
      }
    }
    
    const summary = `Seeding completed: ${interestsSuccessCount}/${INITIAL_INTERESTS.length} interests and ${storylinesSuccessCount}/${INITIAL_STORYLINE.length} storylines inserted successfully.`;
    logger.info(summary);
    console.log(summary);
  } catch (error) {
    logger.error("Error in seedInitialCharacterData:", error);
    console.error("Error in seedInitialCharacterData:", error);
    throw error;
  }
}

// Check if Supabase connection is working
async function checkSupabaseConnection() {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      console.error("ERROR: SUPABASE_URL or SUPABASE_KEY environment variables are missing!");
      console.error("Please make sure your .env file contains these variables.");
      return false;
    }
    
    console.log("Testing Supabase connection...");
    // Try a simple query
    const { data, error } = await supabase.from('bri_interests').select('id').limit(1);
    
    if (error && error.code === '42P01') {
      // Table doesn't exist yet, but connection works
      console.log("Supabase connection successful, but tables don't exist yet.");
      return true;
    } else if (error) {
      console.error("Supabase connection error:", error);
      return false;
    }
    
    console.log("Supabase connection successful!");
    return true;
  } catch (error) {
    console.error("Error testing Supabase connection:", error);
    return false;
  }
}

// Execute the seed function
checkSupabaseConnection()
  .then(connectionOk => {
    if (!connectionOk) {
      console.error("Cannot proceed with seeding due to connection issues.");
      process.exit(1);
    }
    
    return seedInitialCharacterData();
  })
  .then(() => {
    console.log("Seeding complete!");
    process.exit(0);
  })
  .catch(error => {
    console.error("Error running seed script:", error);
    process.exit(1);
  });