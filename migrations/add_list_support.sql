-- Migration to add list support tables

-- Create tables for user lists
CREATE TABLE IF NOT EXISTS user_lists (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    list_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, guild_id, list_name)
);
CREATE INDEX IF NOT EXISTS user_lists_user_guild_idx ON user_lists (user_id, guild_id);

-- Create table for list items
CREATE TABLE IF NOT EXISTS user_list_items (
    id SERIAL PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
    item_text TEXT NOT NULL,
    position INTEGER NOT NULL, -- For preserving order
    completed BOOLEAN DEFAULT FALSE, -- Optional, for task lists
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(list_id, position)
);
CREATE INDEX IF NOT EXISTS user_list_items_list_idx ON user_list_items (list_id);