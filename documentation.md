# Bri Discord Bot - Comprehensive Documentation

## Overview

Bri is a Discord bot with the persona of a friendly, 14-year-old AI assistant. She features a sophisticated memory system, character development, natural conversation abilities, and various utility functions. This document provides a comprehensive overview of Bri's architecture, features, and technical implementation to guide a complete rewrite of the codebase.

## Core Personality & Character

Bri presents herself as a 14-year-old girl with the following personality traits:
- Friendly, energetic, and cheerful
- Helpful and keen to assist users
- Uses lighthearted humor
- Has a naive and innocent perspective
- Shows excitement when interacting with users
- Asks follow-up questions to better understand users

## System Architecture

The bot is structured around several key components:

1. **Message Handler** - The central entry point for processing user messages
2. **Memory System** - Stores and retrieves user information
3. **Character Development** - Manages Bri's persona and relationships with users
4. **Command System** - Processes slash commands and regular chat commands
5. **Time System** - Handles time-related queries and events
6. **Credit System** - Manages usage credits for server owners
7. **Journal System** - Manages Bri's personal journal entries
8. **Image Processing** - Handles image analysis

### Database Structure

Bri uses a PostgreSQL database via Supabase with the following main tables:

- `unified_memories` - Stores all user memories
- `bri_interests` - Stores Bri's interests
- `bri_relationships` - Tracks relationships with users
- `bri_storyline` - Stores Bri's ongoing storylines
- `bri_inside_jokes` - Records inside jokes with users
- `discord_users` - Maps Discord user IDs to usernames
- `user_timezones` - Stores user timezone preferences
- `bri_events` - Stores upcoming events and reminders
- `bri_scheduled_messages` - Stores scheduled messages
- `bri_quotes` - Stores memorable quotes from users

## Core Features

### 1. Memory System

Bri's memory system is a sophisticated framework designed to store, retrieve, and understand user information through:

#### Memory Types
- **Explicit Memories** - Directly stored via "remember" commands
- **Intuited Memories** - Automatically extracted from conversations

#### Memory Categories
- Personal (name, age, background)
- Professional (job, education)
- Preferences (likes, dislikes)
- Hobbies (activities, games, sports)
- Contact (communication methods)
- Other (miscellaneous information)

#### Memory Enhancement Systems
- **Vector Similarity** - Retrieves relevant memories using embeddings
- **Graph Relationships** - Connects related memories
- **Temporal Understanding** - Tracks when memories occurred
- **Confidence Scoring** - Prioritizes reliable information
- **Character Sheets** - Maintains comprehensive user profiles

#### Memory Workflow
1. **Creation**: 
   - User explicitly asks Bri to remember something
   - Automatic extraction after message processing
   - Categorization, embedding generation, confidence scoring

2. **Retrieval**:
   - Vector similarity search
   - Confidence-based reranking
   - Graph and temporal enhancement
   - Context awareness
   - Formatted into prompt

3. **Maintenance**:
   - Confidence decay over time
   - Memory graph building
   - Temporal analysis
   - Character sheet updates
   - Contradiction resolution

### 2. Message Processing

The message handler orchestrates the entire conversation flow:

#### Workflow
1. **Initial Filtering**:
   - Check if message is in designated channel
   - Check for prefix or reply to Bri
   - Clean message content

2. **Pre-Processing**:
   - Handle image attachments
   - Check for explicit memory commands
   - Update relationship data

3. **Credit Verification**:
   - Check if server has enough credits

4. **Context Building**:
   - Build system prompt with memories
   - Retrieve conversation history
   - Apply context limits

5. **Response Generation**:
   - Find relevant personal content
   - Generate AI response with OpenAI
   - Check for time-related information
   - Personalize response based on relationship

6. **Post-Processing**:
   - Update conversation in database
   - Deduct credits
   - Split and send long messages

7. **Background Processing**:
   - Extract memories from conversation
   - Update user information

### 3. Character Development

Bri has her own personality and develops relationships with users:

#### Relationship System
- Tracks interaction count with users
- Maintains relationship levels (stranger to close friend)
- Records shared interests
- Identifies conversation topics
- Detects and stores inside jokes

#### Persona Development
- Maintains personal interests and their importance levels
- Creates and advances "storylines" (ongoing projects/activities)
- Shares personal content based on relationship level
- Personalizes messages based on relationship

#### Personalization
- Adjusts response length based on user preference
- Customizes humor level
- Adapts tone (friendly, formal, casual)

### 4. Command System

Bri supports both slash commands and natural language commands:

#### Slash Commands
- `/aboutbri` - Information about Bri's interests and activities
- `/aboutme` - View what Bri knows about the user
- `/ask` - Ask Bri a question
- `/clearmemories` - Clear stored memories
- `/credits` - Check server credit balance
- `/draw` - Generate an image
- `/gemini` - Use Google's Gemini model
- `/gif` - Search for a GIF
- `/journalentry` - Create a journal entry
- `/manualjournalentry` - Manually create a journal entry
- `/model` - Change AI model
- `/personality` - Customize Bri's responses
- `/quote` - Save or recall quotes
- `/recall` - Search through memories
- `/remember` - Store a new memory
- `/remind` - Set a reminder
- `/resetprofile` - Reset user profile
- `/schedule` - Schedule a message
- `/serversettings` - Configure server settings
- `/setcontext` - Set conversation context length
- `/setprompt` - Set custom system prompt
- `/setupjournal` - Configure journal channel
- `/snoop` - Check Bri's perception of other users
- `/subscription` - Manage server subscription
- `/timezone` - Set user timezone
- `/viewprofile` - View user profile

#### Natural Language Commands
- `bri remember [fact]` - Store a memory
- `hey bri [question]` - General conversation

### 5. Time System

Bri understands and manages time-related information:

#### Features
- Extracts time and event information from messages
- Tracks user timezones
- Creates reminders and follow-ups
- Sends notifications for upcoming events
- Understands temporal context in memories

#### Event Types
- Appointments
- Deadlines
- Birthdays
- Meetings
- General reminders

### 6. Credit System

Bri uses a credit system to manage usage:

#### Features
- Tracks credits per server
- Different costs for different operations
- Credits refresh monthly
- Premium subscriptions for unlimited usage
- Credit checking before resource-intensive operations

#### Credit Usage
- Chat messages
- Image analysis
- Image generation
- Advanced memory operations

### 7. Journal System

Bri maintains a personal journal where she shares thoughts:

#### Features
- Configurable journal channel per server
- Automatic and manual journal entries
- Entry generation based on Bri's interests and activities
- Random entries on interesting topics

### 8. Image Processing

Bri can analyze and understand images:

#### Features
- Processes image attachments
- Describes image content
- Understands context between text and images
- Generates images via `/draw` command

## Optimization Areas

### Current Limitations

1. **Memory Management**:
   - Some Maps used for caching without clear expiration policy
   - Risk of memory leaks with unbounded caches

2. **Database Access**:
   - Many individual database operations
   - Opportunities for batch operations

3. **API Usage**:
   - Heavy reliance on OpenAI API
   - Opportunity for more local processing

4. **Error Handling**:
   - Inconsistent error recovery strategies
   - Some functions continue despite errors; others exit early

5. **Modularity**:
   - Code spread across many files
   - Some overlapping functionality

### Targets for Improvement

1. **Caching Strategy**:
   - Implement LRU caching with size limits
   - Add time-based expiration for cached data
   - Cache database queries

2. **Database Optimization**:
   - Batch database operations
   - Implement connection pooling
   - Use transactions for related operations

3. **Modular Architecture**:
   - Clearer separation of concerns
   - Standardized interfaces between components
   - Common patterns for similar operations

4. **Robust Error Handling**:
   - Standardized error handling across features
   - Retry mechanisms for transient failures
   - Graceful degradation when services are unavailable

5. **Improved Logging**:
   - Structured logging with context
   - Log rotation and management
   - Different log levels for different environments

6. **Enhanced Documentation**:
   - Inline documentation for all functions
   - Architecture diagrams
   - System interaction maps

## Technical Stack

- **Runtime**: Node.js
- **Framework**: discord.js
- **Database**: PostgreSQL via Supabase
- **AI Models**: OpenAI API (GPT models)
- **Image Processing**: OpenAI DALL-E/Vision
- **Embeddings**: OpenAI Embeddings API
- **Natural Language**: OpenAI/natural.js

## Configuration

Bri uses the following environment variables:

- `DISCORD_TOKEN` - Discord bot token
- `CLIENT_ID` - Discord client ID
- `TEST_GUILD_ID` - Optional guild ID for testing
- `OPENAI_API_KEY` - OpenAI API key
- `SUPABASE_URL` - Supabase URL
- `SUPABASE_KEY` - Supabase API key

## Best Practices for Rewrite

1. **Standardized Code Style**:
   - Consistent naming conventions
   - Standard error handling patterns
   - Common patterns for similar operations

2. **Performance First**:
   - Batch operations where possible
   - Optimize database queries
   - Implement efficient caching

3. **Maintainability**:
   - Clear separation of concerns
   - Comprehensive documentation
   - Testable code structure

4. **Security**:
   - Validate all user inputs
   - Secure handling of credentials
   - Rate limiting for all operations

5. **Scalability**:
   - Design for multi-server operation
   - Consider horizontal scaling
   - Efficient resource usage

## Conclusion

Bri is a sophisticated Discord bot with a unique personality and advanced memory capabilities. The rewrite should focus on maintaining these key features while improving code organization, performance, and maintainability. The goal is to create a more robust, efficient, and extensible bot that preserves Bri's friendly character and helpful nature.


## IMPORTANT: Notes from Creator
- Bri is designed to primarily function in a "dedicated channel" where she will respond to every message in the channel (only from users, not bots). However, messages beginning with "hey bri" will elicit a response from her regardless of the channel. 
- For the /draw and /gemini commands specifically, you will want to reference my current code as Claude's API knowledge is outdated for these Google services. 
- My intent is to allow Bri to be used in a large number of servers by a large number of users at some point in the future, and her current responses already have a very large latency, so optimization is key. If this means using a technique or method to achieve something contrary to what I've been using or is outlined in this document, feel free to do so. 
- If possible, it would be especially helpful for all variable settings to be located in one central place, or at the least clearly outlined at the beginning of the file they're used in for easy modification. 
- When creating your code, make sure to include clear and thorough commenting explaining not only what, but why. Also make sure to include consistent logging throughout to make debugging and error solving simpler. 