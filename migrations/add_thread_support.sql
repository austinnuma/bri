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
        
        -- First, drop the primary key
        ALTER TABLE user_conversations DROP CONSTRAINT IF EXISTS user_conversations_pkey;
        
        -- Now we need to create a proper composite primary key
        -- But first, ensure it's not already a constraint name
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'user_conversations_composite_pkey'
            ) THEN
                ALTER TABLE user_conversations DROP CONSTRAINT user_conversations_composite_pkey;
            END IF;
        END $$;
        
        -- Create a new composite key that includes thread_id
        ALTER TABLE user_conversations 
            ADD CONSTRAINT user_conversations_composite_pkey 
            PRIMARY KEY (user_id, guild_id, COALESCE(thread_id, ''));
    END IF;
END
$$;

-- Add comment to document the purpose of the thread_id column
COMMENT ON COLUMN user_conversations.thread_id IS 'Discord thread ID for thread-specific conversations. NULL for regular channel conversations.';