# Bri - AI Discord Assistant

Bri is a sophisticated Discord bot with the persona of a friendly, 14-year-old AI assistant. She provides personalized assistance with advanced memory capabilities, dynamic character development, and a variety of utility functions.

## Features

### Advanced Memory System
- **Multi-layered Architecture**: Combines vector similarity, graph relationships, temporal understanding, and confidence scoring
- **Memory Types**: Stores explicit (user-directed) and intuited (automatically extracted) memories
- **Contextual Retrieval**: Pulls relevant memories based on conversation context
- **Memory Maintenance**: Automatic confidence decay, verification, and contradiction resolution

### Dynamic Character Development
- **Relationship Tracking**: Evolves from stranger to close friend based on interactions
- **Personal Interests**: Develops Bri's own interests and hobbies over time
- **Storyline Development**: Creates ongoing narrative elements about Bri's activities
- **Inside Jokes**: Detects and remembers shared jokes with users

### Smart Conversation
- **Context-Aware Responses**: Incorporates memories, relationship levels, and temporal context
- **Multi-Server Support**: Maintains separate configurations per Discord server
- **Designated Channels**: Can operate in specific channels where it responds to all messages
- **Image Analysis**: Processes and describes attached images

### Time & Event Management
- **Event Detection**: Extracts time-related information from conversations
- **Reminder System**: Sets and manages reminders for important events
- **Follow-up System**: Creates automatic follow-ups for significant events
- **Timezone Support**: Tracks user-specific timezones for accurate scheduling

### Journaling System
- **Personal Journals**: Maintains a journal where Bri shares thoughts and updates
- **Automated Entries**: Creates entries based on interests and experiences
- **Dedicated Channels**: Posts journal entries to configured Discord channels

### Resource Management
- **Credit System**: Tracks and limits resource usage per server
- **Monthly Refreshes**: Credits refresh on a monthly basis
- **Subscription Options**: Premium tiers for enhanced usage limits

## Commands

### Memory & Profile
- `/remember`, `/recall` - Store and retrieve memories
- `/clearmemories` - Clear stored memories
- `/aboutme` - View what Bri knows about you
- `/viewprofile`, `/resetprofile` - Manage your profile

### Conversation
- `/ask` - Ask Bri a question
- `/gemini` - Use Google's Gemini model
- `/model` - Change AI model
- `/setprompt` - Set custom system prompt
- `/setcontext` - Set conversation context length
- `/personality` - Customize Bri's responses

### Time Management
- `/timezone` - Set user timezone
- `/remind` - Set a reminder
- `/schedule` - Schedule a message

### Media & Creativity
- `/draw` - Generate an image
- `/gif` - Search for a GIF
- `/quote` - Save or recall quotes

### Journal System
- `/setupjournal` - Configure journal channel
- `/journalentry`, `/manualjournal` - Create journal entries

### Server Management
- `/credits` - Check server credit balance
- `/subscription` - Manage server subscription
- `/serverSettings` - Configure server settings

### Character Development
- `/aboutBri` - Learn about Bri's interests and activities
- `/snoop` - Check Bri's perception of other users

## Technical Implementation
- PostgreSQL database with vector extensions
- OpenAI GPT models with Gemini fallback
- Vector embeddings for semantic memory retrieval
- Multi-level caching for performance optimization
- Sophisticated error handling and recovery

## Getting Started
[Setup instructions would go here]