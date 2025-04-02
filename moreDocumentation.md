# Bri Discord Bot: Technical Documentation

## Overview
Bri is an advanced Discord bot with the persona of a 14-year-old girl. The bot provides personalized AI assistance with sophisticated memory systems, dynamic character development, relationship tracking, and journaling capabilities. It uses modern AI techniques including vector search for memory recall, LLM-based summarization, and batched API calls for efficiency.

## Table of Contents
- [Core Features](#core-features)
- [Architecture and Systems](#architecture-and-systems)
- [Advanced Technical Implementations](#advanced-technical-implementations)
- [Command Reference](#command-reference)
- [Multi-Server Support](#multi-server-support)

## Core Features

### Memory System
The bot's memory system allows it to remember information about users across conversations.

**Memory Types:**
- **Explicit Memories**: Directly stored via the `/remember` command
- **Intuited Memories**: Automatically extracted from conversations

**Memory Categories:**
- Personal: User's name, age, family, etc.
- Professional: Job, education, skills
- Preferences: Likes, dislikes, favorite things
- Hobbies: Activities, sports, collections
- Contact: Communication methods
- Other: Miscategorized information

**How It Works:**
- Memories are stored in a unified table in Supabase
- Each memory has an embedding vector for semantic search
- Memories include confidence scores (1.0 for explicit, lower for intuited)
- During conversations, relevant memories are retrieved using vector similarity
- Memory categorization uses both keyword matching and semantic analysis

### Character Development
Bri has a dynamic character that evolves through interactions.

**Key Components:**
- **Relationship Levels**: Tracks progression from Stranger → Acquaintance → Friendly → Friend → Close Friend
- **Interests System**: Bri has interests that develop over time
- **Storylines**: Ongoing narrative elements (science fair project, learning chess)
- **Inside Jokes**: Detected and remembered for closer relationships

**How It Works:**
- Interests are stored with levels, facts, and associated tags
- Storylines progress over time with automated updates
- Relationships evolve based on interaction frequency and shared interests
- Content shared with users is filtered based on relationship level

### Journaling System
Bri maintains a journal where she records thoughts, storyline updates, and new interests.

**Journal Entry Types:**
- Storyline updates
- New interest discoveries
- Interest progression
- Daily thoughts
- Future plans

**How It Works:**
- Entries are posted to a dedicated Discord channel
- Journal entries are AI-generated with appropriate teen vocabulary and style
- Scheduled entries create a sense of ongoing personality
- Entries are stored in a database with vector embeddings for searchability

## Architecture and Systems

### Database Design
- Supabase PostgreSQL database with vector extension
- Tables for memories, relationships, interests, storylines, and journal entries
- Vector embeddings for semantic search capabilities

### AI Integration
- Primary model: GPT-4o/GPT-4o-mini through OpenAI API
- Secondary model: Google's Gemini for search-enabled responses
- Embeddings: OpenAI's text-embedding-ada-002 for vector search

### API Optimization
- **Batched API Calls**: Groups embedding requests to reduce API calls
- **Request Queueing**: Collects and processes requests in batches
- **Embeddings Caching**: Stores frequently used embeddings to reduce costs

### Caching System
- **Multi-layer Caching**: Different caches for users, memories, and general queries
- **TTL (Time-To-Live) System**: Automatic expiration of cached data
- **LRU Eviction**: Least Recently Used items removed when cache reaches capacity
- **Vector Search Caching**: Optimizes expensive vector similarity searches

## Advanced Technical Implementations

### Memory Management
The unified memory system implements several sophisticated features:

**Memory Retrieval:**
```javascript
export async function retrieveRelevantMemories(userId, query, limit = 5, memoryType = null, category = null, guildId) {
  // Get embedding for query
  const embedding = await getEmbedding(query);
  
  // Use cached vector search function
  const matches = await cachedVectorSearch(userId, embedding, {
    threshold: 0.6,
    limit,
    memoryType,
    category,
    guildId
  });
  
  // Sort by confidence * distance
  const sortedData = [...matches].sort((a, b) => 
    (b.confidence * b.distance) - (a.confidence * a.distance)
  );
  
  // Format memories with confidence indicators
  return formattedMemories.join("\n");
}
```

**Memory Categorization:**
- Uses both keyword matching and semantic analysis
- Includes special handling for food preferences
- Employs fallback categorization using example-based matching

### Embedding Optimization
The embedding system implements several efficiency improvements:

**Batched Processing:**
```javascript
async function processEmbeddingQueue() {
  // Take all current items from the queue
  const batch = [...embeddingQueue];
  embeddingQueue = [];
  
  // Get unique texts (some might be duplicates)
  const uniqueTexts = [...new Set(batch.map(item => item.text))];
  
  // Generate embeddings for unique texts only
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: uniqueTexts,
  });
  
  // Cache and resolve all promises
  // ...
}
```

**Caching:**
- Uses LRU (Least Recently Used) algorithm for cache management
- Implements size limits to prevent memory overflow
- Tracks usage order for efficient eviction

### Character Development System
The character development system allows Bri to evolve through interactions:

**Interest Discovery:**
- Analyzes conversations to identify potential new interests
- Increases interest levels based on continued discussion
- Creates journal entries when interests reach significant levels

**Relationship Progression:**
```javascript
async function updateRelationshipAfterInteraction(userId, messageContent, guildId) {
  // Calculate new relationship level based on:
  // - Interaction frequency
  // - Interaction count
  // - Time between interactions
  
  // Update conversation topics using semantic extraction
  
  // Store changes in database for continuity
}
```

**Personalized Response Generation:**
- Adapts communication style based on relationship level
- References shared interests and inside jokes with closer relationships
- Shares more personal content with users at higher relationship levels

### Conversation Summarization
The summarization system extracts key information from conversations:

**Hierarchical Summarization:**
```javascript
export async function enhancedHierarchicalSummarization(conversation) {
  // Break conversation into manageable chunks
  const chunks = [];
  // ...
  
  // Summarize each chunk individually
  const chunkSummaries = [];
  for (const chunk of chunks) {
    const chunkSummary = await enhancedDirectSummarization(chunk);
    if (chunkSummary) chunkSummaries.push(chunkSummary);
  }
  
  // Combine chunk summaries into final detailed summary
  // ...
}
```

**Preference Detection:**
- Enhanced prompts focused on identifying both explicit and implicit preferences
- Detects emotional reactions to topics as indicators of interest
- Special attention to detail preservation during summarization

### Database Caching
The database caching system significantly improves performance:

**Cache Implementation:**
```javascript
class Cache {
  constructor(maxSize = 500, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.keys = []; // For LRU tracking
  }
  
  // Methods for get, set, has, delete with expiration and LRU management
  // ...
}
```

**Specialized Caches:**
- User data cache: 30-minute TTL
- Memory cache: 5-minute TTL
- General query cache: 2-minute TTL
- Vector search cache: Results for recent similar queries

## Command Reference

### Memory Commands
- `/remember <information>` - Explicitly store a memory
- `/recall <query>` - Retrieve relevant memories
- `/clearmemories` - Remove all stored memories for the user

### Conversation Commands
- `/ask <question>` - Ask Bri a question with memory context
- `/model <model_name>` - Change the underlying AI model
- `/gemini <query>` - Use Gemini model with search capability

### Personality Commands
- `/personality <setting> <value>` - Adjust Bri's personality traits
- `/setprompt <prompt>` - Set a custom system prompt
- `/setcontext <length>` - Change conversation context length

### Utility Commands
- `/timezone <zone>` - Set your timezone for scheduling
- `/remind <time> <message>` - Set a reminder
- `/schedule <time> <message>` - Schedule a message
- `/quote <text>` - Save a memorable quote
- `/diagnose` - Get system diagnostics

### Journal Commands
- `/setupjournal <channel>` - Set up journal channel
- `/journalentry` - Trigger a journal entry (testing)

## Multi-Server Support
Bri implements guild/server-specific operation for all key features:

- **Memory Partitioning**: Each server has isolated memory storage
- **Per-Server Relationships**: User relationship levels are tracked separately per server
- **Server Configuration**: Customizable settings for each Discord server
- **Guild-Specific Character**: Bri can develop different interests across servers

The multi-server architecture ensures user privacy and allows Bri to have distinct personalities and development paths on different servers.