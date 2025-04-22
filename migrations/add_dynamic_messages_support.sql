-- Add dynamic messaging support to scheduled messages

-- Add new columns to bri_scheduled_messages
ALTER TABLE bri_scheduled_messages ADD COLUMN IF NOT EXISTS is_dynamic BOOLEAN DEFAULT FALSE;
ALTER TABLE bri_scheduled_messages ADD COLUMN IF NOT EXISTS using_collection BOOLEAN DEFAULT FALSE;

-- Create message collections table
CREATE TABLE IF NOT EXISTS bri_message_collections (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES bri_scheduled_messages(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add index for quick lookups
CREATE INDEX IF NOT EXISTS idx_message_collections_message_id ON bri_message_collections(message_id);

-- Update the message_content column to be nullable
ALTER TABLE bri_scheduled_messages ALTER COLUMN message_content DROP NOT NULL;

-- Add an index to guild_id in bri_scheduled_messages if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE tablename = 'bri_scheduled_messages' AND indexname = 'idx_scheduled_messages_guild_id'
  ) THEN
    -- Make sure guild_id column exists first
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bri_scheduled_messages' AND column_name = 'guild_id'
    ) THEN
      CREATE INDEX idx_scheduled_messages_guild_id ON bri_scheduled_messages(guild_id);
    ELSE
      -- Add guild_id column if it doesn't exist
      ALTER TABLE bri_scheduled_messages ADD COLUMN guild_id TEXT;
      CREATE INDEX idx_scheduled_messages_guild_id ON bri_scheduled_messages(guild_id);
    END IF;
  END IF;
END
$$;