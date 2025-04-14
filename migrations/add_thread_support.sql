-- Migration script to add thread support to the user_conversations table

-- Add thread_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'user_conversations' 
        AND column_name = 'thread_id'
    ) THEN
        -- Add the thread_id column
        ALTER TABLE user_conversations ADD COLUMN thread_id text;
    END IF;
END
$$;

-- Drop existing unique constraint on (user_id, guild_id) if it exists
DO $$
BEGIN
    -- Try to drop constraint by name
    BEGIN
        ALTER TABLE user_conversations DROP CONSTRAINT IF EXISTS unique_user_guild;
    EXCEPTION
        WHEN undefined_object THEN
            -- Do nothing if constraint doesn't exist
    END;
    
    -- Try to drop constraint by name (primary key)
    BEGIN
        ALTER TABLE user_conversations DROP CONSTRAINT IF EXISTS user_conversations_pkey;
    EXCEPTION
        WHEN undefined_object THEN
            -- Do nothing if constraint doesn't exist
    END;
END
$$;

-- Create a function to generate a unique key for thread_id (NULL or value)
CREATE OR REPLACE FUNCTION thread_id_key(text) RETURNS text AS $$
BEGIN
    RETURN COALESCE($1, '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a new unique index that handles NULL thread_id properly
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'user_conversations' 
        AND indexname = 'idx_user_thread_unique'
    ) THEN
        CREATE UNIQUE INDEX idx_user_thread_unique 
        ON user_conversations(user_id, guild_id, thread_id_key(thread_id));
    END IF;
END
$$;

-- Create an index on the thread_id column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'user_conversations' 
        AND indexname = 'idx_thread_conversations'
    ) THEN
        CREATE INDEX idx_thread_conversations 
        ON user_conversations(user_id, guild_id, thread_id);
    END IF;
END
$$;

-- Add comment to document the purpose of the thread_id column
COMMENT ON COLUMN user_conversations.thread_id IS 'Discord thread ID for thread-specific conversations. NULL for regular channel conversations.';