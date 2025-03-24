# Bri Memory System Documentation

## Overview

Bri's memory system is a sophisticated, multi-layered framework designed to store, retrieve, and understand information about users. It combines several advanced techniques:

1. **Vector similarity** for relevant memory retrieval
2. **Graph relationships** to understand how memories connect
3. **Temporal understanding** to track when memories happened
4. **Confidence scoring** to prioritize reliable information
5. **Character sheets** to maintain comprehensive user profiles

This document provides a detailed guide to all the components of Bri's memory system, including function relationships, control flow, and potential issues.

## Core Components

### 1. Memory Storage and Management

The central component of Bri's memory system is the **Unified Memory Manager** (`unifiedMemoryManager.js`), which handles storage, retrieval, and organization of memories.

#### Key Functions:

- **`getCombinedSystemPromptWithMemories`**: Main entry point for adding relevant memories to the prompt
- **`processMemoryCommand`**: Processes explicit "remember" commands from users
- **`insertIntuitedMemory`**: Stores automatically extracted memories
- **`createMemory`**: Creates new memories in the database
- **`categorizeMemory`**: Classifies memories into categories (personal, preferences, etc.)

Memories are stored in a PostgreSQL database with Supabase, using a unified table approach with the following schema:

```
unified_memories {
  id                  // Primary key
  user_id             // Discord user ID
  guild_id            // Discord server ID
  memory_text         // The actual memory content
  embedding           // Vector embedding for similarity search
  memory_type         // 'explicit' or 'intuited'
  category            // 'personal', 'professional', 'preferences', etc.
  confidence          // Confidence score (0.0-1.0)
  source              // Where the memory came from
  created_at          // Creation timestamp
  last_accessed       // When memory was last retrieved
  access_count        // How many times memory was accessed
  verified            // Whether memory is verified
  verification_date   // When memory was verified
  contradiction_count // How many times memory was contradicted
  temporal_analysis   // JSON of temporal analysis
  active              // Whether memory is active or archived
}
```

### 2. Memory Extraction

Memory extraction is handled by several components that work together to extract memories from conversations.

#### Primary Components:

- **`extractionAndMemory.js`**: Main memory extraction pipeline
- **`summarization.js`**: Summarizes conversations for better extraction
- **`memoryDeduplication.js`**: Prevents duplicate memories
- **`incrementalMemoryExtraction.js`**: Processes longer conversations incrementally

#### Key Functions:

- **`enhancedMemoryExtraction`**: Two-stage memory extraction process
  1. First extracts explicit facts from conversation summary
  2. Then extracts implied preferences and reactions
- **`enhancedSummarizeConversation`**: Summarizes conversations with preference focus
- **`semanticDeduplication`**: Prevents duplicates using semantic similarity
- **`incrementalMemoryExtraction`**: Breaks processing into stages for long conversations

### 3. Memory Retrieval

Memory retrieval is enhanced with confidence weighting, graph relationships, and temporal understanding.

#### Primary Components:

- **`enhancedMemoryRetrieval.js`**: Basic confidence-weighted retrieval
- **`enhancedGraphMemoryRetrieval.js`**: Graph-enhanced retrieval
- **`temporalMemoryUnderstanding.js`**: Adds time-based understanding

#### Key Functions:

- **`retrieveMemoriesWithGraphAndTemporal`**: Main retrieval function
  1. Gets vector-similar memories from database
  2. Reranks based on confidence and similarity
  3. Enhances with graph connections
  4. Adds temporal understanding
  5. Formats memories for prompt
- **`contextAwareMemoryRetrievalWithEnhancements`**: Incorporates conversation context
- **`identifyMemoryContext`**: Analyzes query for specific memory context

### 4. Memory Relationships (Graph)

The graph system builds connections between related memories to create a knowledge graph.

#### Primary Component:

- **`memoryGraphManager.js`**: Manages memory relationships

#### Key Functions:

- **`buildMemoryGraph`**: Creates connections between related memories
- **`enhanceMemoriesWithGraph`**: Enhances retrieval with graph connections
- **`createMemoryConnection`**: Creates a typed relationship between memories
- **`traverseMemoryGraph`**: Traverses the graph to find connected paths

### 5. Temporal Understanding

The temporal system helps understand when memories happened and their relevance over time.

#### Primary Component:

- **`temporalMemoryUnderstanding.js`**: Handles time-based analysis

#### Key Functions:

- **`analyzeTemporalAspects`**: Analyzes temporal markers in memory text
- **`getTemporalQueryContext`**: Determines time focus in user queries
- **`enhanceMemoriesWithTemporal`**: Enhances memories with time context
- **`findTemporalContradictions`**: Identifies contradictions based on time

### 6. Confidence and Maintenance

The confidence system manages memory reliability and performs maintenance tasks.

#### Primary Components:

- **`memoryConfidence.js`**: Handles confidence scoring
- **`memoryMaintenance.js`**: Performs maintenance tasks

#### Key Functions:

- **`calculateInitialConfidence`**: Determines starting confidence based on source and content
- **`applyMemoryDecay`**: Reduces confidence over time
- **`processRetrievedMemories`**: Reranks memories by effective relevance
- **`runMemoryMaintenance`**: Performs regular maintenance tasks
- **`curateMemoriesWithAI`**: Uses AI to improve memory quality

### 7. User Character Sheets

Character sheets maintain a structured profile of each user.

#### Primary Component:

- **`userCharacterSheet.js`**: Manages user profiles

#### Key Functions:

- **`updateCharacterSheetFromMemories`**: Updates profiles based on memories
- **`getCharacterSheetForPrompt`**: Formats profile for system prompt
- **`updateConversationStyle`**: Updates user's conversation style information

## Main Workflows

### Memory Creation Flow

1. **Entry Point**: User message in `messageHandler.js` → `handleLegacyMessage`
2. **Message Processing**:
   - Bot responds to the message
   - `summarizeAndExtract` is called asynchronously after response
3. **Memory Extraction**:
   - Conversation is summarized using `enhancedSummarizeConversation`
   - Facts are extracted using `enhancedMemoryExtraction`
   - Extracted facts are deduplicated with `semanticDeduplication`
   - New memories are stored with `createMemory` or `insertIntuitedMemory`
   - Memories are categorized with `categorizeMemory`
   - Initial confidence is calculated with `calculateInitialConfidence`

### Memory Retrieval Flow

1. **Entry Point**: Bot generating a response → `getCombinedSystemPromptWithMemories`
2. **Context Analysis**:
   - `identifyMemoryContext` analyzes the query
   - `enhancePromptWithMemoryContext` adds context to the prompt
3. **Memory Retrieval**:
   - `retrieveMemoriesWithGraphAndTemporal` gets relevant memories
   - Vector similarity search finds candidate memories
   - `processRetrievedMemories` reranks by confidence
   - `enhanceMemoriesWithGraph` adds graph connections
   - `enhanceMemoriesWithTemporal` adds temporal context
   - Memories are formatted for the prompt

### Memory Maintenance Flow

1. **Entry Points**: Scheduled maintenance tasks
   - `scheduleMemoryMaintenance` (confidence.js)
   - `scheduleMemoryGraphBuilding` (graphManager.js)
   - `scheduleTemporalAnalysis` (temporalUnderstanding.js)
   - `scheduleCharacterSheetUpdates` (userCharacterSheet.js)
2. **Maintenance Tasks**:
   - `applyMemoryDecay` reduces confidence based on age
   - `buildMemoryGraph` establishes relationships between memories
   - `batchProcessTemporalAnalysis` adds temporal understanding
   - `updateCharacterSheetFromMemories` updates user profiles
   - `curateMemoriesWithAI` performs AI-based curation

## Function Call Hierarchy

### Message Handler (Entry Point)

- **`handleLegacyMessage`** (messageHandler.js)
  - Calls `getCombinedSystemPromptWithMemories` for memory retrieval
  - Calls `processMemoryCommand` for explicit memories
  - Calls `summarizeAndExtract` asynchronously after response

- **`summarizeAndExtract`** (messageHandler.js)
  - Calls `enhancedSummarizeConversation` for summary
  - Calls `enhancedMemoryExtraction` for memory extraction
  - Calls `categorizeMemory` for classification
  - Calls `isDuplicateMemory` for simple duplication check
  - Calls `insertIntuitedMemory` for storage

### Memory Retrieval Chain

- **`getCombinedSystemPromptWithMemories`** (unifiedMemoryManager.js)
  - Calls `getCharacterSheetForPrompt` for user profile
  - Calls `identifyMemoryContext` for query analysis
  - Calls `enhancePromptWithMemoryContext` for context enhancement
  - Calls `contextAwareMemoryRetrievalWithEnhancements` or `retrieveMemoriesWithGraphAndTemporal`
  - Calls `getTimeEventsForContextEnhancement` for time events

- **`retrieveMemoriesWithGraphAndTemporal`** (enhancedGraphMemoryRetrieval.js)
  - Calls `getEmbedding` for vector embedding
  - Calls `getTemporalQueryContext` for time context
  - Calls `processRetrievedMemories` for reranking
  - Calls `enhanceMemoriesWithGraph` for graph enhancement
  - Calls `enhanceMemoriesWithTemporal` for temporal enhancement
  - Calls appropriate formatter for prompt integration

### Memory Creation Chain

- **`processMemoryCommand`** (unifiedMemoryManager.js)
  - Calls `findSimilarMemory` to check for duplicates
  - Calls `updateMemory` or `createMemory` based on results
  - Calls `categorizeMemory` for classification

- **`createMemory`** (unifiedMemoryManager.js)
  - Calls `calculateInitialConfidence` for confidence
  - Calls `getEmbedding` for vector embedding
  - Calls `updateOverlappingMemoriesConfidence` to adjust similar memories

- **`enhancedMemoryExtraction`** (extractionAndMemory.js)
  - Calls `enhancedSummarizeConversation` for summarization
  - Calls `extractExplicitFacts` for explicit memories
  - Calls `extractImpliedPreferences` for implied preferences
  - Calls `postProcessExtractedFacts` for filtering
  - Calls `deduplicateAgainstExisting` for deduplication

## Potential Issues and Edge Cases

### Error Handling Inconsistencies

- Most database operations have try/catch blocks, but error recovery varies
- Some functions return default values when errors occur, others might log the error and continue
- This could lead to partial failures where some operations succeed and others fail

### Unused or Incomplete Functions

- `updateMemoryAccessStats` in enhancedMemoryRetrieval.js is defined but not called directly
- `resolveContradictions` in memoryConfidence.js contains placeholder comments only
- Some scheduler functions don't have clearly visible initialization calls

### Race Conditions

- Memory operations happen asynchronously in the background
- `summarizeAndExtract` runs after message response is sent
- Multiple memory operations could overlap without coordination

### Memory Leak Risks

- Several Maps are used for caching (`userPersonalityPrefs`, `userLastActive`, etc.)
- No clear bounds or cleanup strategies are implemented for these caches

### Database Access Patterns

- Some functions may perform many individual database operations
- Batch operations could improve performance
- High-frequency operations might cause database throughput issues

### Token Usage

- Heavy use of OpenAI API for various tasks
- AI-based curation, summarization, and extraction
- High API usage costs possible with many users

## Initialization Order

The memory system is initialized through several components:

1. **`unifiedMemoryManager.js`** - `initializeMemoryManager`
2. **`memoryGraphInitializer.js`** - `initializeMemoryEnhancements`
   - Calls `initializeMemoryGraphSystem`
   - Calls `initializeTemporalMemorySystem`
3. **`userCharacterSheet.js`** - `initializeUserCharacterSheetSystem`

The maintenance schedulers are initialized separately:

- `scheduleMemoryMaintenance` (memoryConfidence.js)
- `scheduleMemoryGraphBuilding` (memoryGraphManager.js)
- `scheduleTemporalAnalysis` (temporalMemoryUnderstanding.js)
- `scheduleCharacterSheetUpdates` (userCharacterSheet.js)

## Dead Code and Unused Functions

Several functions appear to be unused or have incomplete implementations:

- `resolveContradictions` in memoryConfidence.js is a placeholder
- Some temporal analysis functions may be called infrequently
- Reference error on line 358-359 in unifiedMemoryManager.js: `MemoryTypes.EXPLICIT` should be `MEMORY_TYPES.EXPLICIT`
- Line 600 in unifiedMemoryManager.js uses `interaction.guildId` which isn't defined previously
- Various console.log statements in memoryDeduplication.js that should be removed

## Credits and Integration

This memory system integrates with:

- **Credit system** - Checks if users have enough credits for operations
- **Personality system** - Customizes bot personality per user
- **Time system** - Captures and integrates time-based events
- **Reaction handler** - Captures user reactions to improve memories

## Conclusion

Bri's memory system is a sophisticated, multi-layered approach to creating and maintaining a knowledge graph of user information. The combination of vector similarity, graph relationships, temporal understanding, confidence scoring, and character sheets allows for personalized and context-aware interactions.

The system handles memory creation through multiple paths, retrieves relevant memories with multiple enhancements, and performs maintenance to ensure memory quality over time. While there are some areas for potential improvement in coordination and error handling, the overall design is robust and feature-rich.