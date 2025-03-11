// characterDevelopment.js - Character development and relationship evolution system
import { openai, supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { getEmbedding } from './improvedEmbeddings.js';
import { normalizeText } from './textUtils.js';
import { createStorylineJournalEntry, createInterestJournalEntry } from './journalSystem.js';


// Constants for relationship levels
export const RELATIONSHIP_LEVELS = {
  STRANGER: 0,     // Just met
  ACQUAINTANCE: 1, // Basic familiarity
  FRIENDLY: 2,     // Regular conversations
  FRIEND: 3,       // Comfortable sharing more personal details
  CLOSE_FRIEND: 4  // Deep relationship with inside jokes and shared history
};

// Initial interests - these are Bri's starting interests that fit her 14-year-old persona
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
    lastDiscussed: null,
    shareThreshold: 0.7  // Probability of sharing when context is appropriate 
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
    lastDiscussed: null,
    shareThreshold: 0.8
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
    lastDiscussed: null,
    shareThreshold: 0.6
  }
];

// Initial storyline goals/events
const INITIAL_STORYLINE = [
  {
    id: "science_fair_project",
    title: "Science Fair Project",
    description: "Working on a science fair project about how plants grow in different conditions",
    status: "in_progress",
    startDate: new Date("2025-02-01").toISOString(),
    endDate: new Date("2025-04-15").toISOString(),
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
    shareThreshold: 0.5
  },
  {
    id: "learning_chess",
    title: "Learning Chess",
    description: "Trying to learn how to play chess",
    status: "in_progress",
    startDate: new Date("2025-01-15").toISOString(),
    endDate: null,
    progress: 0.2,
    updates: [
      {
        date: new Date("2025-01-15").toISOString(),
        content: "My friend taught me how all the chess pieces move today! The knights are confusing."
      }
    ],
    shareThreshold: 0.4
  }
];

/**
 * Initialize Bri's character development system.
 * Creates necessary database tables if they don't exist.
 */
export async function initializeCharacterDevelopment() {
  try {
    logger.info("Initializing character development system...");
    
    // Check if the bri_interests table exists and has data
    const { data: interestsData, error: interestsCheckError } = await supabase
      .from('bri_interests')
      .select('name')
      .limit(1);
      
    // Check if the tables exist but are empty
    const tablesExistButEmpty = !interestsCheckError && (!interestsData || interestsData.length === 0);
    
    // Create tables if they don't exist
    if (interestsCheckError && interestsCheckError.code === '42P01') {
      logger.info("Creating character development tables...");
      
      try {
        // Try RPC method first
        logger.info("Attempting to create tables via RPC...");
        const createInterestsTable = await supabase.rpc('create_interests_table');
        const createStorylineTable = await supabase.rpc('create_storyline_table');
        const createRelationshipsTable = await supabase.rpc('create_relationships_table');
        
        // Check if tables were actually created
        const tablesCreated = await checkTablesExist();
        
        if (!tablesCreated) {
          logger.warn("RPC calls did not create tables. Falling back to manual creation...");
          await manuallyCreateTables();
        }
      } catch (rpcError) {
        logger.warn("RPC table creation failed:", rpcError);
        logger.info("Falling back to manual table creation...");
        await manuallyCreateTables();
      }
      
      // Now seed the data
      try {
        logger.info("Seeding initial character data...");
        await seedInitialCharacterData();
        logger.info("Seeding completed");
      } catch (seedError) {
        logger.error("Error seeding initial data:", seedError);
        logger.info("Please run the manualSeed.js script directly to seed data");
      }
      
      logger.info("Character development tables initialization complete");
    } else if (tablesExistButEmpty) {
      logger.info("Character development tables exist but are empty, seeding initial data...");
      
      try {
        await seedInitialCharacterData();
        logger.info("Character development tables seeded successfully");
      } catch (seedError) {
        logger.error("Error seeding initial data:", seedError);
        logger.info("Please run the manualSeed.js script directly to seed data");
      }
    } else {
      logger.info("Character development tables already exist and contain data");
    }
    
  } catch (error) {
    logger.error("Error initializing character development system:", error);
    logger.info("Please ensure tables exist and run the manualSeed.js script directly");
  }
}

/**
 * Checks if all required tables exist
 * @returns {Promise<boolean>} - Whether all tables exist
 */
async function checkTablesExist() {
  try {
    // Check interests table
    const { data: interests, error: interestsError } = await supabase
      .from('bri_interests')
      .select('id')
      .limit(1);
      
    if (interestsError && interestsError.code === '42P01') {
      return false;
    }
    
    // Check storyline table
    const { data: storylines, error: storylinesError } = await supabase
      .from('bri_storyline')
      .select('id')
      .limit(1);
      
    if (storylinesError && storylinesError.code === '42P01') {
      return false;
    }
    
    // Check relationships table
    const { data: relationships, error: relationshipsError } = await supabase
      .from('bri_relationships')
      .select('user_id')
      .limit(1);
      
    if (relationshipsError && relationshipsError.code === '42P01') {
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error("Error checking tables existence:", error);
    return false;
  }
}

/**
 * Manually creates tables if RPC method fails
 */
async function manuallyCreateTables() {
  // Create interests table
  const { error: interestsError } = await supabase.query(`
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
  `);
  
  if (interestsError) {
    logger.warn("Manual creation of interests table failed, but this is expected if using Supabase: ", interestsError);
  }
  
  // Create storyline table
  const { error: storylineError } = await supabase.query(`
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
  `);
  
  if (storylineError) {
    logger.warn("Manual creation of storyline table failed, but this is expected if using Supabase: ", storylineError);
  }
  
  // Create relationships table
  const { error: relationshipsError } = await supabase.query(`
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
  `);
  
  if (relationshipsError) {
    logger.warn("Manual creation of relationships table failed, but this is expected if using Supabase: ", relationshipsError);
  }
  
  // Seed initial data
  await seedInitialCharacterData();
}

/**
 * Seeds the database with initial character data
 */
async function seedInitialCharacterData() {
  try {
    logger.info("Starting to seed character development data...");
    
    // Check if data already exists
    const { data: existingInterests, error: checkError } = await supabase
      .from('bri_interests')
      .select('id')
      .limit(1);
      
    if (!checkError && existingInterests && existingInterests.length > 0) {
      logger.info("Data already exists in the tables. Skipping seeding.");
      return;
    }
    
    // Seed interests
    for (const interest of INITIAL_INTERESTS) {
      try {
        // Generate embedding for the interest
        let embedding = null;
        try {
          logger.info(`Generating embedding for interest: ${interest.name}`);
          const embeddingText = `${interest.name} ${interest.description} ${interest.tags.join(' ')}`;
          embedding = await getEmbedding(embeddingText);
        } catch (embeddingError) {
          logger.warn(`Error generating embedding for interest ${interest.name}:`, embeddingError);
          logger.info("Continuing with null embedding");
        }
        
        logger.info(`Inserting interest: ${interest.name}`);
        const { error: insertError } = await supabase.from('bri_interests').insert({
          name: interest.name,
          level: interest.level,
          description: interest.description,
          facts: interest.facts,
          tags: interest.tags,
          last_discussed: interest.lastDiscussed,
          share_threshold: interest.shareThreshold,
          embedding: embedding
        });
        
        if (insertError) {
          logger.error(`Error inserting interest ${interest.name}:`, insertError);
        } else {
          logger.info(`Successfully inserted interest: ${interest.name}`);
        }
      } catch (interestError) {
        logger.error(`Error processing interest ${interest.name}:`, interestError);
        // Continue with next interest
      }
    }
    
    // Seed storyline events
    for (const event of INITIAL_STORYLINE) {
      try {
        // Generate embedding for the storyline event
        let embedding = null;
        try {
          logger.info(`Generating embedding for storyline: ${event.id}`);
          const embeddingText = `${event.title} ${event.description} ${event.status}`;
          embedding = await getEmbedding(embeddingText);
        } catch (embeddingError) {
          logger.warn(`Error generating embedding for storyline ${event.id}:`, embeddingError);
          logger.info("Continuing with null embedding");
        }
        
        logger.info(`Inserting storyline: ${event.id}`);
        const { error: insertError } = await supabase.from('bri_storyline').insert({
          id: event.id,
          title: event.title,
          description: event.description,
          status: event.status,
          start_date: event.startDate,
          end_date: event.endDate,
          progress: event.progress,
          updates: event.updates,
          share_threshold: event.shareThreshold,
          embedding: embedding
        });
        
        if (insertError) {
          logger.error(`Error inserting storyline ${event.id}:`, insertError);
        } else {
          logger.info(`Successfully inserted storyline: ${event.id}`);
        }
      } catch (storylineError) {
        logger.error(`Error processing storyline ${event.id}:`, storylineError);
        // Continue with next storyline
      }
    }
    
    logger.info("Initial character data seeding completed");
  } catch (error) {
    logger.error("Error seeding initial character data:", error);
    throw error; // Rethrow to allow proper handling by caller
  }
}

/**
 * Analyzes conversation to potentially discover new interests for Bri
 * @param {string} userId - The user's ID
 * @param {Array} conversation - The conversation history
 * @returns {Promise<boolean>} - Whether any new interests were discovered
 */
export async function analyzeConversationForInterests(userId, conversation) {
  try {
    // Extract only user messages from recent conversation (last 5 messages)
    const userMessages = conversation
      .slice(-5)
      .filter(msg => msg.role === "user")
      .map(msg => msg.content)
      .join(" ");
      
    if (userMessages.length < 50) {
      return false; // Not enough content to analyze
    }
    
    // Use OpenAI to analyze the conversation for potential interests
    const prompt = `
Analyze this conversation snippet and identify if the user is expressing enthusiasm or deep knowledge about any specific interests or hobbies.
Look for topics that a 14-year-old girl like Bri might also find interesting.

Only identify clear interests with strong engagement (not passing mentions).
If you detect a genuine interest, extract: 
1. The name of the interest/topic
2. A brief description of what it involves
3. Any specific facts mentioned about it
4. Related keywords/tags

Conversation: ${userMessages}

Format your response as JSON:
{
  "interestDetected": true/false,
  "interest": {
    "name": "interest name",
    "description": "brief description",
    "facts": ["fact 1", "fact 2"],
    "tags": ["tag1", "tag2"]
  }
}

If no clear interest is detected, return {"interestDetected": false}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Use a simpler model for efficiency
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" }
    });
    
    const analysisResult = JSON.parse(completion.choices[0].message.content);
    
    if (analysisResult.interestDetected) {
      // Check if this interest already exists
      const interestName = analysisResult.interest.name.toLowerCase();
      await updateOrCreateInterest(interestName, analysisResult.interest);
      
      // Record this shared interest in the user's relationship
      await updateRelationshipWithSharedInterest(userId, interestName);
      
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error("Error analyzing conversation for interests:", error);
    return false;
  }
}

/**
 * Updates an existing interest or creates a new one
 * @param {string} interestName - Name of the interest
 * @param {Object} interestData - Interest data from analysis
 */
async function updateOrCreateInterest(interestName, interestData) {
  try {
    // Check if interest already exists
    const { data: existingInterest, error } = await supabase
      .from('bri_interests')
      .select('*')
      .ilike('name', interestName)
      .single();
      
    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      logger.error("Error checking for existing interest:", error);
      return;
    }
    
    // Generate embedding for search
    const embeddingText = `${interestData.name} ${interestData.description} ${interestData.tags.join(' ')}`;
    const embedding = await getEmbedding(embeddingText);
    
    if (existingInterest) {
      // Update existing interest
      const combinedFacts = [...new Set([...existingInterest.facts, ...interestData.facts])];
      const combinedTags = [...new Set([...existingInterest.tags, ...interestData.tags])];
      
      const newLevel = Math.min(existingInterest.level + 1, 5); // Increase interest level
      
      const { data, error: updateError } = await supabase
        .from('bri_interests')
        .update({
          level: newLevel,
          facts: combinedFacts,
          tags: combinedTags,
          last_discussed: new Date().toISOString(),
          embedding: embedding
        })
        .eq('id', existingInterest.id)
        .select()
        .single();
        
      if (updateError) {
        logger.error(`Error updating interest ${interestName}:`, updateError);
      } else {
        logger.info(`Updated existing interest: ${interestName} to level ${newLevel}`);
        updatedInterest = data;
        
        // Check if the level increased enough to warrant a journal entry
        // Create journal entry if level increased by at least 2 or reached level 4-5
        const levelIncreased = newLevel - existingInterest.level;
        if (levelIncreased >= 2 || newLevel >= 4) {
          try {
            await createInterestJournalEntry(updatedInterest, false);
          } catch (journalError) {
            logger.error(`Error creating journal entry for updated interest ${interestName}:`, journalError);
          }
        }
      }
    } else {
      // Create new interest
      const newInterest = {
        name: interestData.name.toLowerCase(),
        level: 1,
        description: interestData.description,
        facts: interestData.facts,
        tags: interestData.tags,
        last_discussed: new Date().toISOString(),
        share_threshold: 0.5, // Default
        embedding: embedding
      };
      
      const { data, error: insertError } = await supabase
      .from('bri_interests')
      .insert(newInterest)
      .select()
      .single();
      
    if (insertError) {
      logger.error(`Error creating interest ${interestName}:`, insertError);
    } else {
      logger.info(`Created new interest: ${interestName}`);
      updatedInterest = data;
      
      // Create journal entry for new interest
      try {
        await createInterestJournalEntry(updatedInterest, true);
      } catch (journalError) {
        logger.error(`Error creating journal entry for new interest ${interestName}:`, journalError);
      }
    }
  }
  
  return updatedInterest;
} catch (error) {
  logger.error(`Error updating/creating interest ${interestName}:`, error);
  return null;
}
}

/**
 * Updates a user relationship with a shared interest
 * @param {string} userId - The user's ID
 * @param {string} interestName - Name of the shared interest
 */
async function updateRelationshipWithSharedInterest(userId, interestName) {
  try {
    // Get current relationship
    const { data: relationship, error } = await supabase
      .from('bri_relationships')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    if (error && error.code !== 'PGRST116') {
      logger.error("Error fetching relationship:", error);
      return;
    }
    
    if (relationship) {
      // Update existing relationship
      const sharedInterests = relationship.shared_interests || [];
      
      // Add interest if not already present
      if (!sharedInterests.includes(interestName)) {
        sharedInterests.push(interestName);
      }
      
      await supabase
        .from('bri_relationships')
        .update({
          shared_interests: sharedInterests,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
    } else {
      // Create new relationship
      await supabase
        .from('bri_relationships')
        .insert({
          user_id: userId,
          level: RELATIONSHIP_LEVELS.ACQUAINTANCE,
          shared_interests: [interestName],
          interaction_count: 1,
          last_interaction: new Date().toISOString()
        });
    }
  } catch (error) {
    logger.error(`Error updating relationship for user ${userId}:`, error);
  }
}

/**
 * Finds a relevant interest or storyline to share based on conversation context
 * @param {string} userId - The user's ID
 * @param {string} messageContent - The message to find relevant content for
 * @returns {Promise<Object|null>} - Relevant interest or storyline to share, or null
 */
export async function findRelevantContentToShare(userId, messageContent) {
  try {
    // Get relationship level
    const relationshipLevel = await getRelationshipLevel(userId);
    
    // Don't share personal content with strangers
    if (relationshipLevel < RELATIONSHIP_LEVELS.ACQUAINTANCE) {
      return null;
    }
    
    // Check if this is a greeting or question about Bri
    const isPersonalQuestion = isAskingAboutBri(messageContent);
    
    // If not a personal question, only share if we have a relevant interest
    if (!isPersonalQuestion) {
      // Get embedding for message
      const messageEmbedding = await getEmbedding(messageContent);
      
      // Find relevant interest
      const relevantInterest = await findRelevantInterest(messageEmbedding);
      if (relevantInterest && Math.random() < relevantInterest.share_threshold) {
        return {
          type: 'interest',
          data: relevantInterest
        };
      }
      
      return null;
    }
    
    // For personal questions, we can share either interests or storyline updates
    const contentType = Math.random() < 0.7 ? 'interest' : 'storyline';
    
    if (contentType === 'interest') {
      // Get a random interest weighted by level
      const interest = await getRandomWeightedInterest();
      if (interest && Math.random() < interest.share_threshold) {
        return {
          type: 'interest',
          data: interest
        };
      }
    } else {
      // Get a recent storyline update
      const storyline = await getRecentStorylineUpdate();
      if (storyline && Math.random() < storyline.share_threshold) {
        return {
          type: 'storyline',
          data: storyline
        };
      }
    }
    
    return null;
  } catch (error) {
    logger.error("Error finding relevant content to share:", error);
    return null;
  }
}

/**
 * Checks if message is asking about Bri personally
 * @param {string} message - The message content
 * @returns {boolean} - Whether the message is asking about Bri
 */
function isAskingAboutBri(message) {
  const personalQuestions = [
    /how are you/i,
    /how('s| is) your day/i,
    /what('s| is) up/i,
    /what('s| have) you been (up to|doing)/i,
    /tell me about yourself/i,
    /what do you like/i,
    /what are you (doing|working on)/i,
    /what('s| is) new/i
  ];
  
  return personalQuestions.some(pattern => pattern.test(message));
}

/**
 * Finds a relevant interest based on message embedding
 * @param {Array} messageEmbedding - Embedding of the message
 * @returns {Promise<Object|null>} - Matching interest or null
 */
async function findRelevantInterest(messageEmbedding) {
  try {
    // Use vector similarity search
    const { data, error } = await supabase.rpc('match_interests', {
      query_embedding: messageEmbedding,
      match_threshold: 0.7,
      match_count: 1
    });
    
    if (error) {
      logger.error("Error in vector search for interests:", error);
      return null;
    }
    
    if (data && data.length > 0) {
      return data[0];
    }
    
    return null;
  } catch (error) {
    logger.error("Error finding relevant interest:", error);
    return null;
  }
}

/**
 * Gets a random interest weighted by level
 * @returns {Promise<Object|null>} - Random interest or null
 */
async function getRandomWeightedInterest() {
  try {
    const { data, error } = await supabase
      .from('bri_interests')
      .select('*');
      
    if (error) {
      logger.error("Error fetching interests:", error);
      return null;
    }
    
    if (!data || data.length === 0) {
      return null;
    }
    
    // Weight by level (higher level = more likely to be chosen)
    const totalWeight = data.reduce((sum, interest) => sum + interest.level, 0);
    let randomValue = Math.random() * totalWeight;
    
    for (const interest of data) {
      randomValue -= interest.level;
      if (randomValue <= 0) {
        return interest;
      }
    }
    
    // Fallback
    return data[0];
  } catch (error) {
    logger.error("Error getting random interest:", error);
    return null;
  }
}

/**
 * Gets a recent storyline update
 * @returns {Promise<Object|null>} - Recent storyline event or null
 */
async function getRecentStorylineUpdate() {
  try {
    const { data, error } = await supabase
      .from('bri_storyline')
      .select('*')
      .order('start_date', { ascending: false })
      .limit(3);
      
    if (error) {
      logger.error("Error fetching storyline events:", error);
      return null;
    }
    
    if (!data || data.length === 0) {
      return null;
    }
    
    // Choose a random one from the most recent 3
    return data[Math.floor(Math.random() * data.length)];
  } catch (error) {
    logger.error("Error getting storyline update:", error);
    return null;
  }
}

/**
 * Gets the current relationship level with a user
 * @param {string} userId - The user's ID
 * @returns {Promise<number>} - Relationship level (0-4)
 */
export async function getRelationshipLevel(userId) {
  try {
    const { data, error } = await supabase
      .from('bri_relationships')
      .select('level')
      .eq('user_id', userId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // "No rows returned"
        return RELATIONSHIP_LEVELS.STRANGER;
      }
      logger.error("Error fetching relationship level:", error);
      return RELATIONSHIP_LEVELS.STRANGER;
    }
    
    return data.level;
  } catch (error) {
    logger.error("Error in getRelationshipLevel:", error);
    return RELATIONSHIP_LEVELS.STRANGER;
  }
}

/**
 * Updates a user's relationship after an interaction
 * @param {string} userId - The user's ID
 * @param {string} messageContent - The message content
 * @returns {Promise<Object>} - Updated relationship data
 */
export async function updateRelationshipAfterInteraction(userId, messageContent) {
  try {
    // Get current relationship
    const { data: relationship, error } = await supabase
      .from('bri_relationships')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    const now = new Date().toISOString();
    
    if (error && error.code !== 'PGRST116') {
      logger.error("Error fetching relationship:", error);
      return null;
    }
    
    // Extract conversation topics
    const topics = await extractConversationTopics(messageContent);
    
    if (relationship) {
      // Calculate time since last interaction
      const lastInteraction = new Date(relationship.last_interaction);
      const daysSinceLastInteraction = 
        (new Date() - lastInteraction) / (1000 * 60 * 60 * 24);
      
      // Calculate new relationship level
      let newLevel = relationship.level;
      
      // Increase level based on interaction frequency and count
      if (relationship.interaction_count >= 10 && newLevel < RELATIONSHIP_LEVELS.FRIENDLY) {
        newLevel = RELATIONSHIP_LEVELS.FRIENDLY;
      } else if (relationship.interaction_count >= 30 && newLevel < RELATIONSHIP_LEVELS.FRIEND) {
        newLevel = RELATIONSHIP_LEVELS.FRIEND;
      } else if (relationship.interaction_count >= 100 && newLevel < RELATIONSHIP_LEVELS.CLOSE_FRIEND) {
        newLevel = RELATIONSHIP_LEVELS.CLOSE_FRIEND;
      }
      
      // If they interact regularly, level up faster
      if (daysSinceLastInteraction < 7 && 
          relationship.interaction_count % 5 === 0 && 
          newLevel < RELATIONSHIP_LEVELS.CLOSE_FRIEND) {
        newLevel++;
      }
      
      // Update relationship
      const updatedTopics = updateConversationTopics(relationship.conversation_topics || {}, topics);
      
      const { data: updatedRelationship, error: updateError } = await supabase
        .from('bri_relationships')
        .update({
          level: newLevel,
          interaction_count: relationship.interaction_count + 1,
          last_interaction: now,
          conversation_topics: updatedTopics,
          updated_at: now
        })
        .eq('user_id', userId)
        .select()
        .single();
        
      if (updateError) {
        logger.error("Error updating relationship:", updateError);
        return null;
      }
      
      return updatedRelationship;
    } else {
      // Create new relationship
      const { data: newRelationship, error: insertError } = await supabase
        .from('bri_relationships')
        .insert({
          user_id: userId,
          level: RELATIONSHIP_LEVELS.STRANGER,
          interaction_count: 1,
          last_interaction: now,
          conversation_topics: topics,
          created_at: now,
          updated_at: now
        })
        .select()
        .single();
        
      if (insertError) {
        logger.error("Error creating relationship:", insertError);
        return null;
      }
      
      return newRelationship;
    }
  } catch (error) {
    logger.error("Error in updateRelationshipAfterInteraction:", error);
    return null;
  }
}

/**
 * Extracts conversation topics from a message
 * @param {string} messageContent - The message content
 * @returns {Promise<Object>} - Topics and their frequencies
 */
async function extractConversationTopics(messageContent) {
  try {
    if (messageContent.length < 10) {
      return {};
    }
    
    // Use OpenAI to extract topics
    const prompt = `
Extract up to 3 main conversation topics from this message. Focus on general categories, not specific details.
For example: "cooking", "movies", "work", "family", "travel", "technology", etc.

Message: "${messageContent}"

Format your response as JSON: {"topics": ["topic1", "topic2"]}
If no clear topics are found, return {"topics": []}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Use simpler model for efficiency
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" }
    });
    
    const result = JSON.parse(completion.choices[0].message.content);
    
    // Convert to frequency map
    const topics = {};
    for (const topic of result.topics) {
      topics[topic.toLowerCase()] = 1;
    }
    
    return topics;
  } catch (error) {
    logger.error("Error extracting conversation topics:", error);
    return {};
  }
}

/**
 * Updates conversation topics tracking
 * @param {Object} existingTopics - Existing topics frequency map
 * @param {Object} newTopics - New topics frequency map
 * @returns {Object} - Updated topics frequency map
 */
function updateConversationTopics(existingTopics, newTopics) {
  const updatedTopics = { ...existingTopics };
  
  // Add new topics or increment existing ones
  for (const [topic, count] of Object.entries(newTopics)) {
    if (updatedTopics[topic]) {
      updatedTopics[topic] += count;
    } else {
      updatedTopics[topic] = count;
    }
  }
  
  return updatedTopics;
}

/**
 * Analyzes message for potential inside jokes
 * @param {string} userId - The user's ID
 * @param {string} messageContent - The message content
 * @returns {Promise<boolean>} - Whether an inside joke was detected
 */
export async function detectAndStoreInsideJoke(userId, messageContent) {
  try {
    // Only analyze for inside jokes with closer relationships
    const relationshipLevel = await getRelationshipLevel(userId);
    if (relationshipLevel < RELATIONSHIP_LEVELS.FRIENDLY) {
      return false;
    }
    
    // Check if message contains humor or references to shared experiences
    const humorIndicators = [
      /lol/i, /haha/i, /😂/, /🤣/, /lmao/i, /rofl/i, /funny/i, /joke/i,
      /remember when/i, /that time/i
    ];
    
    const containsHumor = humorIndicators.some(regex => regex.test(messageContent));
    if (!containsHumor) {
      return false;
    }
    
    // Analyze for inside joke potential
    const prompt = `
Analyze this message and determine if it contains or references an "inside joke" - 
a humorous reference that would only make sense to people who share a specific experience or context.

Look for:
1. References to past shared experiences 
2. Unusual phrases that seem to have special meaning
3. Callbacks to previous jokes

Message: "${messageContent}"

Format your response as JSON:
{
  "isInsideJoke": true/false,
  "joke": {
    "reference": "brief description of what's being referenced",
    "context": "explanation of why it's funny or meaningful"
  }
}

If no inside joke is detected, return {"isInsideJoke": false}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" }
    });
    
    const result = JSON.parse(completion.choices[0].message.content);
    
    if (result.isInsideJoke) {
      // Store inside joke in relationship
      await storeInsideJoke(userId, result.joke);
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error("Error detecting inside joke:", error);
    return false;
  }
}

/**
 * Stores an inside joke for a user relationship
 * @param {string} userId - The user's ID
 * @param {Object} joke - The joke data
 */
async function storeInsideJoke(userId, joke) {
  try {
    // Get current relationship
    const { data: relationship, error } = await supabase
      .from('bri_relationships')
      .select('inside_jokes')
      .eq('user_id', userId)
      .single();
      
    if (error) {
      logger.error("Error fetching relationship for inside joke:", error);
      return;
    }
    
    // Add joke to existing ones
    const insideJokes = relationship.inside_jokes || [];
    const newJoke = {
      ...joke,
      timestamp: new Date().toISOString()
    };
    
    insideJokes.push(newJoke);
    
    // Update the relationship
    await supabase
      .from('bri_relationships')
      .update({
        inside_jokes: insideJokes,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
      
    logger.info(`Stored inside joke for user ${userId}`);
  } catch (error) {
    logger.error("Error storing inside joke:", error);
  }
}

/**
 * Generates a personalized response based on relationship level and shared interests
 * @param {string} userId - The user's ID
 * @param {string} baseResponse - The base response from the AI
 * @returns {Promise<string>} - Personalized response
 */
export async function personalizeResponse(userId, baseResponse) {
  try {
    // Get relationship data
    const { data: relationship, error } = await supabase
      .from('bri_relationships')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    if (error && error.code !== 'PGRST116') {
      logger.error("Error fetching relationship for personalization:", error);
      return baseResponse;
    }
    
    // For strangers or new acquaintances, just return the base response
    if (!relationship || relationship.level < RELATIONSHIP_LEVELS.FRIENDLY) {
      return baseResponse;
    }
    
    // For friends, personalize based on relationship data
    const personalizations = [];
    
    // 1. Reference a shared interest (10% chance)
    if (relationship.shared_interests && 
        relationship.shared_interests.length > 0 && 
        Math.random() < 0.1) {
      const randomInterest = relationship.shared_interests[
        Math.floor(Math.random() * relationship.shared_interests.length)
      ];
      personalizations.push(`shared_interest:${randomInterest}`);
    }
    
    // 2. Reference an inside joke (15% chance for close friends)
    if (relationship.level >= RELATIONSHIP_LEVELS.FRIEND && 
        relationship.inside_jokes && 
        relationship.inside_jokes.length > 0 && 
        Math.random() < 0.15) {
      // Get one of the 3 most recent jokes
      const recentJokes = relationship.inside_jokes
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 3);
      const randomJoke = recentJokes[Math.floor(Math.random() * recentJokes.length)];
      personalizations.push(`inside_joke:${randomJoke.reference}`);
    }
    
    // 3. Reference conversation frequency for regular chatters
    if (relationship.interaction_count > 20 && Math.random() < 0.1) {
      personalizations.push("regular_chatter");
    }
    
    // If no personalizations, return the base response
    if (personalizations.length === 0) {
      return baseResponse;
    }
    
    // Apply personalizations
    return await applyPersonalizations(baseResponse, personalizations, relationship.level);
  } catch (error) {
    logger.error("Error in personalizeResponse:", error);
    return baseResponse;
  }
}

/**
 * Applies personalizations to a response
 * @param {string} baseResponse - The original response
 * @param {Array} personalizations - The personalizations to apply
 * @param {number} relationshipLevel - The relationship level
 * @returns {Promise<string>} - Personalized response
 */
async function applyPersonalizations(baseResponse, personalizations, relationshipLevel) {
  try {
    // Prepare personalization instructions
    const personalizationInstructions = personalizations.map(p => {
      const [type, value] = p.split(':');
      switch (type) {
        case 'shared_interest':
          return `Add a brief, natural reference to your shared interest in "${value}".`;
        case 'inside_joke':
          return `Add a subtle, natural callback to your inside joke about "${value}".`;
        case 'regular_chatter':
          return `Add a small acknowledgment that you chat with this person regularly.`;
        default:
          return '';
      }
    }).filter(i => i !== '');
    
    // If no valid instructions, return the base response
    if (personalizationInstructions.length === 0) {
      return baseResponse;
    }
    
    // Use OpenAI to apply the personalizations
    const prompt = `
You need to personalize this message for someone I've been chatting with regularly.

Original message: "${baseResponse}"

Please apply these personalizations naturally (don't make it obvious you're adding them):
${personalizationInstructions.join('\n')}

The relationship level is ${relationshipLevel}/4 (higher = closer friend).

Important guidelines:
- Maintain the same 14-year-old girl personality
- Keep the main information and content from the original message
- Don't make the personalizations feel forced or artificial
- Don't explicitly state "since we're friends" or similar phrases
- Keep approximately the same length as the original
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are Bri, a helpful AI assistant with the personality of a 14-year-old girl."
        },
        { role: "user", content: prompt }
      ],
      max_tokens: 1000,
    });
    
    return completion.choices[0].message.content;
  } catch (error) {
    logger.error("Error applying personalizations:", error);
    return baseResponse;
  }
}

/**
 * Returns Bri's personal content (interests, storylines) to include in a response
 * @param {string} userId - The user's ID
 * @param {Object|null} relevantContent - Optional content that was found relevant
 * @returns {Promise<string>} - Personal content to include
 */
export async function getPersonalContent(userId, relevantContent = null) {
  try {
    if (!relevantContent) {
      return '';
    }
    
    const { type, data } = relevantContent;
    
    if (type === 'interest') {
      // Format interest sharing based on relationship level
      const relationshipLevel = await getRelationshipLevel(userId);
      
      if (relationshipLevel <= RELATIONSHIP_LEVELS.ACQUAINTANCE) {
        // Basic interest mention
        return `I really like ${data.name}! ${getRandomFact(data.facts)}`;
      } else if (relationshipLevel <= RELATIONSHIP_LEVELS.FRIENDLY) {
        // More enthusiastic
        return `I'm super into ${data.name} right now! ${getRandomFact(data.facts)} I think it's so cool!`;
      } else {
        // Full enthusiasm with more detail
        return `I've been really excited about ${data.name} lately! ${getRandomFact(data.facts)} ${data.description}. I can talk about this all day!`;
      }
    } else if (type === 'storyline') {
      // Share a storyline update
      const update = getLatestUpdate(data);
      
      return `Guess what? ${update} It's part of my ${data.title.toLowerCase()}!`;
    }
    
    return '';
  } catch (error) {
    logger.error("Error getting personal content:", error);
    return '';
  }
}

/**
 * Gets a random fact from an array of facts
 * @param {Array} facts - Array of facts
 * @returns {string} - Random fact
 */
function getRandomFact(facts) {
  if (!facts || facts.length === 0) {
    return '';
  }
  
  return facts[Math.floor(Math.random() * facts.length)];
}

/**
 * Gets the latest update from a storyline event
 * @param {Object} storyline - Storyline event
 * @returns {string} - Latest update
 */
function getLatestUpdate(storyline) {
  if (!storyline.updates || storyline.updates.length === 0) {
    return `I'm working on ${storyline.description}.`;
  }
  
  // Get the latest update
  const latestUpdate = storyline.updates.sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  )[0];
  
  return latestUpdate.content;
}

/**
 * Advances Bri's storyline events periodically
 * This should be called on a schedule (e.g., daily)
 */
export async function advanceStorylinesPeriodicTask() {
  try {
    logger.info("Running storyline advancement task...");
    
    // Get all in-progress storylines
    const { data: storylines, error } = await supabase
      .from('bri_storyline')
      .select('*')
      .eq('status', 'in_progress');
      
    if (error) {
      logger.error("Error fetching storylines:", error);
      return;
    }
    
    if (!storylines || storylines.length === 0) {
      logger.info("No in-progress storylines to advance");
      return;
    }
    
    const now = new Date();
    
    for (const storyline of storylines) {
      // Check if storyline has an end date and it's passed
      if (storyline.end_date && new Date(storyline.end_date) < now) {
        // Storyline has ended, generate completion update
        await completeStoryline(storyline);
        continue;
      }
      
      // Otherwise, check if it's time for a progress update
      const lastUpdate = storyline.updates && storyline.updates.length > 0
        ? new Date(storyline.updates[storyline.updates.length - 1].date)
        : new Date(storyline.start_date);
        
      const daysSinceLastUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);
      
      // Generate a new update every 2-10 days
      if (daysSinceLastUpdate >= 2 && Math.random() < 0.3) {
        await generateStorylineUpdate(storyline);
      }
    }
    
    // Add a new storyline occasionally
    if (Math.random() < 0.1) { // 10% chance each time this runs
      await generateNewStoryline();
    }
    
    logger.info("Storyline advancement task completed");
  } catch (error) {
    logger.error("Error in storyline advancement task:", error);
  }
}

/**
 * Completes a storyline event
 * @param {Object} storyline - The storyline event
 */
async function completeStoryline(storyline) {
  try {
    // Generate a completion update using OpenAI
    const prompt = `
You are Bri, a 14-year-old girl who has been working on this project/goal:
${storyline.title}: ${storyline.description}

You started this on ${new Date(storyline.start_date).toLocaleDateString()} and today is the end date.
Your progress so far is ${Math.round(storyline.progress * 100)}%.

Previous updates:
${storyline.updates.map(u => `- ${u.content}`).join('\n')}

Write a VERY BRIEF, excited update about finishing this project/goal. 
Write in first person as a 14-year-old girl would talk.
Keep it under 2 sentences.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You write brief, excited updates in the voice of a 14-year-old girl." },
        { role: "user", content: prompt }
      ],
      max_tokens: 200,
    });
    
    const completionUpdate = completion.choices[0].message.content;
    
    // Update the storyline
    const updates = [...(storyline.updates || []), {
      date: new Date().toISOString(),
      content: completionUpdate
    }];
    
    const { data: updatedStoryline, error } = await supabase
      .from('bri_storyline')
      .update({
        status: 'completed',
        progress: 1.0,
        updates: updates
      })
      .eq('id', storyline.id)
      .select()
      .single();
      
    if (error) {
      logger.error(`Error updating completed storyline ${storyline.id}:`, error);
    } else {
      logger.info(`Completed storyline: ${storyline.title}`);
      
      // Create journal entry for completed storyline
      try {
        await createStorylineJournalEntry(updatedStoryline);
      } catch (journalError) {
        logger.error(`Error creating journal entry for completed storyline ${storyline.title}:`, journalError);
      }
    }
  } catch (error) {
    logger.error(`Error completing storyline ${storyline.id}:`, error);
  }
}

/**
 * Generates a new update for a storyline
 * @param {Object} storyline - The storyline event
 */
async function generateStorylineUpdate(storyline) {
  try {
    // Calculate new progress
    const progressIncrement = Math.random() * 0.2; // 0-20% progress
    const newProgress = Math.min(storyline.progress + progressIncrement, 0.95);
    
    // Generate an update using OpenAI
    const prompt = `
You are Bri, a 14-year-old girl who has been working on this project/goal:
${storyline.title}: ${storyline.description}

You started this on ${new Date(storyline.start_date).toLocaleDateString()}.
Your progress so far is ${Math.round(storyline.progress * 100)}% and you're now at ${Math.round(newProgress * 100)}%.

Previous updates:
${storyline.updates.map(u => `- ${u.content}`).join('\n')}

Write a VERY BRIEF, excited update about your progress on this project/goal.
Write in first person as a 14-year-old girl would talk.
Keep it under 2 sentences.
Don't repeat previous updates.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You write brief, excited updates in the voice of a 14-year-old girl." },
        { role: "user", content: prompt }
      ],
      max_tokens: 200,
    });
    
    const update = completion.choices[0].message.content;
    
    // Update the storyline
    const updates = [...(storyline.updates || []), {
      date: new Date().toISOString(),
      content: update
    }];
    
    const { data: updatedStoryline, error } = await supabase
      .from('bri_storyline')
      .update({
        progress: newProgress,
        updates: updates
      })
      .eq('id', storyline.id)
      .select()
      .single();
      
    if (error) {
      logger.error(`Error updating storyline ${storyline.id}:`, error);
    } else {
      logger.info(`Generated update for storyline: ${storyline.title}`);
      
      // Only create journal entries for significant progress (>10% increase or milestone reached)
      const progressChange = newProgress - storyline.progress;
      const isSignificantProgress = progressChange > 0.1 || 
                                   Math.floor(newProgress * 10) > Math.floor(storyline.progress * 10);
      
      if (isSignificantProgress) {
        try {
          await createStorylineJournalEntry(updatedStoryline);
        } catch (journalError) {
          logger.error(`Error creating journal entry for storyline update ${storyline.title}:`, journalError);
        }
      }
    }
  } catch (error) {
    logger.error(`Error generating storyline update for ${storyline.id}:`, error);
  }
}

/**
 * Generates a new storyline event
 */
async function generateNewStoryline() {
  try {
    // Get Bri's current interests to inform the new storyline
    const { data: interests, error } = await supabase
      .from('bri_interests')
      .select('name, level')
      .order('level', { ascending: false })
      .limit(5);
      
    if (error) {
      logger.error("Error fetching interests for new storyline:", error);
      return;
    }
    
    const interestNames = interests?.map(i => i.name) || [];
    
    // Generate storyline idea using OpenAI
    const prompt = `
Create a new mini-project, goal, or activity for Bri, a 14-year-old girl.
${interestNames.length > 0 ? `She's interested in: ${interestNames.join(', ')}` : ''}

Generate a small, age-appropriate activity that:
1. Would take 2-4 weeks to complete
2. Is realistic for a 14-year-old
3. Is educational, creative, or wholesome
4. Feels meaningful and character-building

Format the response as JSON:
{
  "id": "short_id_no_spaces",
  "title": "Activity Title",
  "description": "Brief description of what Bri is trying to do",
  "startDate": "today",
  "endDate": "2-4 weeks from now",
  "initialUpdate": "Bri's excited first message about starting this"
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" }
    });
    
    const storylineData = JSON.parse(completion.choices[0].message.content);
    
    // Set dates
    const now = new Date();
    const endDate = new Date();
    // Random duration between 14-28 days
    endDate.setDate(now.getDate() + Math.floor(Math.random() * 14) + 14);
    
    // Create embedding for search
    const embeddingText = `${storylineData.title} ${storylineData.description}`;
    const embedding = await getEmbedding(embeddingText);
    
    // Create the new storyline
    const { data: newStoryline, error: insertError } = await supabase
      .from('bri_storyline')
      .insert({
        id: storylineData.id,
        title: storylineData.title,
        description: storylineData.description,
        status: 'in_progress',
        start_date: now.toISOString(),
        end_date: endDate.toISOString(),
        progress: 0.1,
        updates: [{
          date: now.toISOString(),
          content: storylineData.initialUpdate
        }],
        share_threshold: 0.6,
        embedding: embedding
      })
      .select()
      .single();
      
    if (insertError) {
      logger.error("Error creating new storyline:", insertError);
    } else {
      logger.info(`Created new storyline: ${storylineData.title}`);
      
      // Create journal entry for new storyline
      try {
        await createStorylineJournalEntry(newStoryline);
      } catch (journalError) {
        logger.error(`Error creating journal entry for new storyline ${storylineData.title}:`, journalError);
      }
    }
  } catch (error) {
    logger.error("Error generating new storyline:", error);
  }
}

// Export constants for use elsewhere
export const MemoryTypes = {
  INTEREST: 'interest',
  STORYLINE: 'storyline'
};