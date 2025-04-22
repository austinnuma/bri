# Dynamic Scheduled Messages Feature

This document outlines the implementation of dynamic scheduled messages in Bri.

## Overview

Previously, Bri's scheduled messages were static - the exact same message would be sent each time. With this update, we've added two new features:

1. **Dynamic Messages**: Bri can generate a fresh message each time a scheduled message is triggered.
2. **Message Collections**: Instead of a single message, Bri can randomly choose from a collection of predefined messages.

## Database Changes

The following database changes were made:

1. Added new columns to `bri_scheduled_messages`:
   - `is_dynamic` (BOOLEAN) - Indicates if the message should be regenerated each time
   - `using_collection` (BOOLEAN) - Indicates if the message uses a collection

2. Created a new table `bri_message_collections` to store message collections:
   - `id` (SERIAL PRIMARY KEY)
   - `message_id` (INTEGER) - References the scheduled message
   - `content` (TEXT) - The message content
   - `created_at` (TIMESTAMP)
   - `updated_at` (TIMESTAMP)

3. Made `message_content` nullable in `bri_scheduled_messages` to support dynamic messages

## Command Changes

The `/schedule` command was enhanced with the following:

1. Added a `dynamic` option to `/schedule daily` and `/schedule weekly`
2. Added a new subcommand `/schedule collection` for creating message collections

## Implementation Details

### Dynamic Messages
When a message is set to dynamic, a new message is generated each time it's scheduled to be sent. This uses the existing `generateGreeting` function.

### Message Collections
For collections, we store multiple messages in the `bri_message_collections` table and randomly select one when it's time to send the message.

## Usage Examples

### Dynamic Daily Message
```
/schedule daily type:Good Morning time:8:00 dynamic:true
```

### Message Collection
```
/schedule collection name:"Daily Quotes" time:9:00 messages:"Quote 1|Quote 2|Quote 3"
```

## Migration

A migration script `add_dynamic_messages_support.sql` was created to add the necessary database changes.