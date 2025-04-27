# Bri Context Enhancement Implementation

This document explains the changes made to enhance Bri's context handling system, focusing on:

1. Reducing the number of direct messages stored between Bri and a user
2. Adding channel messages for context
3. Formatting the system prompt more clearly
4. Adding explanations of the different context sections

## Files Added or Modified

1. **New: `/utils/contextBuilder.js`**
   - Contains all the logic for the new context building system
   - Provides functions to fetch, format, and combine different types of context

2. **Example: `/utils/messageHandlerUpdate.js`**
   - Shows how to integrate the context builder into the existing message handler
   - This is an example file - you'll need to apply these changes to your actual messageHandler.js

3. **Example: `/commands/askUpdate.js`**
   - Shows how to update the /ask command to use the new context builder
   - This is an example file - you'll need to apply these changes to your actual ask.js

## Key Features

### 1. Reduced Direct Message Context
- Reduced from 20 to 10 messages between Bri and the user
- Configurable via `DEFAULT_DM_CONTEXT_LENGTH`
- Saves database space and reduces token usage

### 2. Channel Context
- Adds the 10 most recent messages from the current channel
- Configurable via `DEFAULT_CHANNEL_CONTEXT_LENGTH`
- Gives Bri awareness of ongoing conversations in the channel
- Filters out messages from the current user and Bri herself

### 3. Structured System Prompt
- Clear section headers (USER CONTEXT, CHANNEL CONTEXT, etc.)
- Organized, readable format for both humans and AI
- Explanations of each section at the beginning

### 4. Context Explanations
- Explains to Bri what each section contains
- Helps Bri understand how to use the different context types
- Includes instructions for handling replied-to messages

## How to Implement

### Step 1: Add the new files
- Copy `contextBuilder.js` to your `/utils/` directory

### Step 2: Update your message handler
- Use the example in `messageHandlerUpdate.js` to update your actual message handler
- Key changes involve replacing the old context building with calls to the new one
- Make sure to import necessary functions and handle the response properly

### Step 3: Update your ask command
- Use the example in `askUpdate.js` to update your `/ask` command
- Similar changes as with the message handler, but adapted for slash commands

### Step 4: Test thoroughly
- Test both regular messaging and slash commands
- Verify that channel context is being included correctly
- Check that the reduced message history is working as expected

## Configuration Options

You can adjust these values in `contextBuilder.js`:

```javascript
// Default context lengths - can be customized per server if desired
export const DEFAULT_DM_CONTEXT_LENGTH = 10;  // Direct messages between Bri and user
export const DEFAULT_CHANNEL_CONTEXT_LENGTH = 10;  // Messages from channel
```

## Impact on Performance

- **Token Usage**: Should remain similar or decrease slightly (fewer direct messages, but added channel context)
- **Database Usage**: Should decrease due to storing fewer messages per user
- **API Calls**: One additional API call to fetch channel messages, but this should be negligible
- **Context Quality**: Should improve with the addition of channel context and better formatting

## Future Enhancements

Potential future improvements:

1. Server-specific configuration of context lengths
2. Role-specific context (e.g., moderator messages weighted differently)
3. Topic modeling to identify relevant channel messages rather than just recent ones
4. Channel-specific memory storage

## Supporting Files

This implementation builds on your existing:
- `unifiedMemoryManager.js` for memory retrieval
- `userCharacterSheet.js` for user context
- `timeSystem.js` for time-related context

Let me know if you need any clarification or have questions about the implementation!