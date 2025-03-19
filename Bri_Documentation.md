# Bri Discord Bot - Technical Analysis

## Overview
Bri is a sophisticated Discord bot designed with the personality of a 14-year-old girl. The bot combines advanced AI capabilities with persistent memory systems, scheduled interactions, and a character-driven experience. This document provides a technical analysis of Bri's features, architecture, and optimization techniques.

## Core Features

### Conversational AI
- **Personality System**: Maintains a consistent 14-year-old girl persona with defined interests, activities, and speech patterns
- **Memory Integration**: Incorporates relevant user memories into conversations
- **Multi-Model Support**: Uses various AI models (GPT-3.5, GPT-4o, Gemini) based on user preference
- **Context-Aware Responses**: Builds rich context from message history, memories, and character information

### Memory System
- **Unified Memory Storage**: Centralized system for storing and retrieving user information
- **Vector Search**: Uses embeddings for semantic search capabilities
- **Memory Categories**: Organizes memories into categories (personal, professional, preferences, hobbies)
- **Memory Types**: Distinguishes between explicit (user-declared) and intuited (AI-extracted) memories
- **Confidence Scoring**: Assigns confidence levels to intuitively extracted information

### Media Generation
- **Image Generation**: Creates images from text prompts using Google's Imagen API
- **Vision Analysis**: Processes images in user messages or media for contextual understanding
- **Audio Extraction**: Extracts audio from YouTube videos for analysis

### Scheduling System
- **Time-Based Events**: Manages reminders and scheduled messages
- **Recurring Messages**: Supports daily and weekly scheduled messages
- **Timezone Support**: Respects user-specific timezones for accurate scheduling
- **Natural Language Time Processing**: Interprets time specifications in natural language

### Journal System
- **Character-Driven Entries**: Creates diary-like entries from Bri's perspective
- **Multiple Entry Types**: Supports storyline updates, interest posts, daily thoughts
- **Guild-Specific Journals**: Maintains separate journal channels for different Discord servers
- **Vector-Based Search**: Uses embeddings to reference relevant past entries

### Credit & Subscription System
- **Tiered Subscriptions**: Multiple subscription levels with increasing benefits
- **Credit Management**: Tracks usage credits for various features
- **Monthly Rollover**: Handles monthly credit allocation and rollover
- **Feature Gating**: Controls access to premium features based on subscription level

## Technical Implementation

### Memory System Architecture

#### Storage & Retrieval
- **Database**: Uses Supabase with vector support for memory storage
- **Memory Schema**: Stores memories with user_id, guild_id, memory_text, embedding, type, category
- **Vector Search**: Implements cosine similarity for retrieving relevant memories
- **Relevance Ranking**: Combines vector similarity with confidence scores

#### Optimizations
- **Multi-Level Caching**:
  - User cache (30-minute TTL)
  - Memory cache (5-minute TTL)
  - Query cache (2-minute TTL)
- **LRU Eviction Policy**: Removes least recently used items when cache capacity is reached
- **Batched Embeddings**: Queues and batches embedding requests to reduce API calls
- **Deduplication**: Uses Jaro-Winkler similarity to prevent storing nearly identical memories

#### Memory Extraction
- **Two-Stage Process**:
  1. Conversation summarization to identify key points
  2. Fact extraction from summarized content
- **Categorization**: Uses keyword matching and semantic similarity for automatic categorization
- **Quality Filtering**: Removes low-quality or redundant information

### AI Integration

#### Context Building
- **System Prompt**: Defines core personality and behavioral guidelines
- **Memory Augmentation**: Retrieves and incorporates relevant memories
- **Conversation History**: Maintains and truncates conversation history for context
- **Character Context**: Includes information about Bri's current interests and activities

#### Response Generation
- **Personalization**: Adapts responses based on relationship level with user
- **Interest Tracking**: Identifies and integrates shared interests into responses
- **Inside Jokes**: Detects and references stored inside jokes with close users
- **Age-Appropriate Language**: Ensures responses match a 14-year-old's vocabulary and interests

#### Character Development
- **Dynamic Interests**: Discovers and evolves interests based on conversations
- **Relationship Progression**: Tracks relationship development with each user
- **Storyline Evolution**: Maintains and advances character storylines over time
- **Journal Integration**: Records thoughts and experiences in journal entries

### Image & Vision Services

#### Image Generation
- **Imagen Integration**: Uses Google's Imagen API for image creation
- **Safety Filtering**: Implements content moderation with configurable safety levels
- **Multi-Image Support**: Generates 1-4 images per request based on user preference
- **Credit Integration**: Charges appropriate credits for generation

#### Vision Analysis
- **Image Understanding**: Uses GPT-4o for analyzing image content
- **Multi-Image Support**: Processes single or multiple images in one request
- **Context Integration**: Incorporates conversation history and memories
- **Personality Alignment**: Ensures image descriptions match Bri's persona

### Time & Scheduling System

#### Event Management
- **Event Types**: Supports various event types (reminders, recurring messages, follows-ups)
- **Cron-Style Scheduling**: Uses cron syntax for flexible scheduling patterns
- **Time-Processing Interval**: Runs time-aware event processing on configurable intervals
- **Fallback Mechanisms**: Implements channel fallbacks when direct messages fail

#### Time Processing
- **User Timezones**: Stores and respects user-specific timezone settings
- **Natural Language Parsing**: Uses AI to interpret time specifications in natural language
- **Multiple Reminders**: Configurable reminder times (immediate, hour before, day before)
- **Multi-Guild Support**: Handles time-based events across multiple Discord servers

### Journal System

#### Entry Generation
- **AI-Generated Content**: Uses OpenAI to create authentic teen-like journal entries
- **Character Consistency**: Ties into character sheet for personality consistency
- **Entry Categorization**: Supports different types of entries for varied content
- **Contextual Generation**: Uses character history for consistent storytelling

#### Optimizations
- **Vector-Based Search**: Embeds journal entries for semantic retrievability
- **Content Consolidation**: Groups similar updates to avoid repetitive entries
- **Queuing System**: Queues entries when channels are unavailable
- **Fallback Mechanisms**: Multiple fallbacks if primary posting methods fail

### Credit & Subscription Management

#### Credit System
- **Credit Sources**: Free monthly credits, subscription credits, purchased credits
- **Usage Tracking**: Different costs for various operations (chat, images, reminders)
- **Prioritization**: Uses free credits first, then subscription, then purchased
- **Monthly Processing**: Only purchased credits carry over month-to-month

#### Subscription System
- **Tiered Model**: Standard, Premium, and Enterprise subscription levels
- **Feature Entitlement**: Different tiers unlock different features
- **Payment Processing**: Stripe integration for handling payments
- **Webhook Handling**: Captures and processes Stripe events

## Discord Integration

### Command Structure
- **Slash Commands**: Implements Discord's slash command system
- **Command Organization**: Modular command files with standard structure
- **Autocomplete Support**: Implements autocomplete for applicable commands
- **Permission Handling**: Respects Discord's permission system

### Message Processing
- **Prefix Detection**: Server-configurable prefix for non-slash interactions
- **Direct Replies**: Responds to direct mentions and replies
- **Multi-Server Support**: Guild-specific configurations and processing
- **Media Handling**: Processes text, images, and other media types

### Event Handling
- **Reaction Processing**: Handles emoji reactions for features like quote saving
- **Guild Management**: Handles server join/leave events appropriately
- **Error Recovery**: Implements robust error handling for Discord API issues

## Technical Stack
- Node.js with ES Modules
- Discord.js for Discord API integration
- OpenAI API for core AI functionality
- Google's Generative AI for Gemini integration
- Supabase for database with vector support
- Winston for logging
- Node-cron for scheduled tasks
- Natural.js for text processing

## Performance Optimizations
- Multi-level caching for database operations
- Batched API requests to reduce rate limits
- Vector search for efficient memory retrieval
- Queuing system for handling rate limits
- Periodic maintenance tasks for system health
- Credit system to prevent abuse of resources

## Security & Privacy
- Confidence scoring to differentiate between explicit and inferred information
- Guild separation to isolate data between Discord servers
- Credit system to prevent abuse of premium features
- Safety filtering for generated content
- Comprehensive logging for audit purposes

## Conclusion
Bri represents a sophisticated implementation of a character-driven AI assistant, combining advanced natural language processing, memory systems, and Discord integration. The systems work together to create a consistent, engaging personality that builds relationships with users while providing utility through various commands and features.