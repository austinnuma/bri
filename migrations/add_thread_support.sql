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
        
        -- Create an index for better query performance
        CREATE INDEX idx_user_conversations_thread ON user_conversations(user_id, guild_id, thread_id);
        
        -- Create a unique constraint instead of altering primary key
        -- This allows NULL values in thread_id while ensuring uniqueness
        ALTER TABLE user_conversations DROP CONSTRAINT IF EXISTS user_conversations_pkey;
        ALTER TABLE user_conversations ADD CONSTRAINT user_conversations_pkey 
            PRIMARY KEY (user_id, guild_id);
            
        -- Add a unique constraint for when thread_id is not null
        CREATE UNIQUE INDEX idx_user_conversations_with_thread 
            ON user_conversations(user_id, guild_id, thread_id) 
            WHERE thread_id IS NOT NULL;
    END IF;
END
$$;

-- Add comment to document the purpose of the thread_id column
COMMENT ON COLUMN user_conversations.thread_id IS 'Discord thread ID for thread-specific conversations. NULL for regular channel conversations.';