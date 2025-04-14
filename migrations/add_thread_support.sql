-- Migration script to add thread support to the user_conversations table

-- First, check if the thread_id column already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'user_conversations' 
        AND column_name = 'thread_id'
    ) THEN
        -- Add the thread_id column to the table
        ALTER TABLE user_conversations ADD COLUMN thread_id text;
        
        -- Create a new index that includes thread_id
        CREATE INDEX user_conversations_thread_idx ON user_conversations(user_id, guild_id, thread_id);

        -- Update the composite primary key to include thread_id (if not already done)
        ALTER TABLE user_conversations DROP CONSTRAINT IF EXISTS user_conversations_pkey;
        ALTER TABLE user_conversations ADD PRIMARY KEY (user_id, guild_id, thread_id);
    END IF;
END
$$;

-- Add comment to document the purpose of the thread_id column
COMMENT ON COLUMN user_conversations.thread_id IS 'Discord thread ID for thread-specific conversations. NULL for regular channel conversations.';