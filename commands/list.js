// list.js - Commands for managing user lists
import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/combinedServices.js';

// Cache for storing lists and items
const listCache = new Map();
const LIST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export const data = new SlashCommandBuilder()
  .setName('list')
  .setDescription('Manage your lists')
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new list')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name for your list')
          .setRequired(true))
      .addStringOption(option =>
        option.setName('items')
          .setDescription('Initial items (comma separated)')
          .setRequired(false)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('show')
      .setDescription('Show a specific list')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name of the list to show')
          .setRequired(true)
          .setAutocomplete(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('add')
      .setDescription('Add items to a list')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name of the list to add to')
          .setRequired(true)
          .setAutocomplete(true))
      .addStringOption(option =>
        option.setName('items')
          .setDescription('Items to add (comma separated)')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('remove')
      .setDescription('Remove an item from a list')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name of the list to remove from')
          .setRequired(true)
          .setAutocomplete(true))
      .addStringOption(option =>
        option.setName('item')
          .setDescription('Item to remove')
          .setRequired(true)
          .setAutocomplete(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete')
      .setDescription('Delete an entire list')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Name of the list to delete')
          .setRequired(true)
          .setAutocomplete(true)))
  .addSubcommand(subcommand =>
    subcommand
      .setName('all')
      .setDescription('Show all your lists'));

export async function execute(interaction) {
  try {
    await interaction.deferReply();
    
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create': {
        const name = interaction.options.getString('name');
        const items = interaction.options.getString('items') || '';
        
        // Parse items if provided
        const itemsArray = items.split(',').map(item => item.trim()).filter(item => item.length > 0);
        
        // Create the list
        const list = await createList(userId, guildId, name, '', itemsArray);
        
        // Response message
        await interaction.editReply(`I've created your list "${list.list_name}" with ${list.items.length} item${list.items.length !== 1 ? 's' : ''}.`);
        break;
      }
      
      case 'show': {
        const name = interaction.options.getString('name');
        
        // Get the list
        const list = await getList(userId, guildId, name);
        
        if (!list) {
          await interaction.editReply(`I couldn't find a list called "${name}".`);
          return;
        }
        
        if (list.items.length === 0) {
          await interaction.editReply(`Your "${list.list_name}" list is empty.`);
          return;
        }
        
        // Format items
        const itemsList = list.items.map((item, index) => `${index + 1}. ${item.item_text}`).join('\\n');
        
        await interaction.editReply(`Here's your "${list.list_name}" list:\n\n${itemsList}`);
        break;
      }
      
      case 'add': {
        const name = interaction.options.getString('name');
        const items = interaction.options.getString('items');
        
        // Get the list
        const list = await getList(userId, guildId, name);
        
        if (!list) {
          await interaction.editReply(`I couldn't find a list called "${name}".`);
          return;
        }
        
        // Parse items
        const itemsArray = items.split(',').map(item => item.trim()).filter(item => item.length > 0);
        
        if (itemsArray.length === 0) {
          await interaction.editReply(`I couldn't find any items to add.`);
          return;
        }
        
        // Add items
        await addItemsToList(list.id, itemsArray);
        
        // Get updated list
        const updatedList = await getList(userId, guildId, name);
        
        await interaction.editReply(`I've added ${itemsArray.length} item${itemsArray.length !== 1 ? 's' : ''} to your "${list.list_name}" list. It now has ${updatedList.items.length} item${updatedList.items.length !== 1 ? 's' : ''}.`);
        break;
      }
      
      case 'remove': {
        const name = interaction.options.getString('name');
        const item = interaction.options.getString('item');
        
        // Get the list
        const list = await getList(userId, guildId, name);
        
        if (!list) {
          await interaction.editReply(`I couldn't find a list called "${name}".`);
          return;
        }
        
        // Remove item
        const removed = await removeItemFromList(list.id, item);
        
        if (!removed) {
          await interaction.editReply(`I couldn't find "${item}" in your "${list.list_name}" list.`);
          return;
        }
        
        // Get updated list
        const updatedList = await getList(userId, guildId, name);
        
        await interaction.editReply(`I've removed "${item}" from your "${list.list_name}" list. It now has ${updatedList.items.length} item${updatedList.items.length !== 1 ? 's' : ''}.`);
        break;
      }
      
      case 'delete': {
        const name = interaction.options.getString('name');
        
        // Get the list first to confirm existence
        const list = await getList(userId, guildId, name);
        
        if (!list) {
          await interaction.editReply(`I couldn't find a list called "${name}".`);
          return;
        }
        
        // Delete the list
        await deleteList(userId, guildId, name);
        
        await interaction.editReply(`I've deleted your "${list.list_name}" list.`);
        break;
      }
      
      case 'all': {
        // Get all lists
        const lists = await getAllLists(userId, guildId);
        
        if (!lists || lists.length === 0) {
          await interaction.editReply(`You don't have any lists yet. Use /list create to make one!`);
          return;
        }
        
        // Format lists
        const listsText = lists.map(list => {
          return `**${list.list_name}** (${list.items.length} item${list.items.length !== 1 ? 's' : ''})`;
        }).join('\n');
        
        await interaction.editReply(`Here are your lists:\n\n${listsText}`);
        break;
      }
    }
  } catch (error) {
    logger.error(`Error in list command:`, error);
    await interaction.editReply('There was an error processing your list command. Please try again later.');
  }
}

// Autocomplete function for list names and items
export async function autocomplete(interaction) {
  try {
    const focusedOption = interaction.options.getFocused(true);
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    
    if (focusedOption.name === 'name') {
      // Autocomplete list names
      const lists = await getAllLists(userId, guildId);
      
      const filtered = lists
        .filter(list => list.list_name.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 25);
      
      await interaction.respond(
        filtered.map(list => ({
          name: list.list_name,
          value: list.list_name
        }))
      );
    } 
    else if (focusedOption.name === 'item') {
      // Autocomplete items in a specific list
      const listName = interaction.options.getString('name');
      
      if (!listName) {
        await interaction.respond([]);
        return;
      }
      
      const list = await getList(userId, guildId, listName);
      
      if (!list) {
        await interaction.respond([]);
        return;
      }
      
      const filtered = list.items
        .filter(item => item.item_text.toLowerCase().includes(focusedOption.value.toLowerCase()))
        .slice(0, 25);
      
      await interaction.respond(
        filtered.map(item => ({
          name: item.item_text,
          value: item.item_text
        }))
      );
    }
  } catch (error) {
    logger.error(`Error in list autocomplete:`, error);
    await interaction.respond([]);
  }
}

// ================ List Management Functions ================

/**
 * Creates a new list for a user
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {string} listName - Name of the list
 * @param {string} description - Optional description for the list
 * @param {Array<string>} initialItems - Optional array of initial items
 * @returns {Promise<Object>} - The created list with its items
 */
async function createList(userId, guildId, listName, description = '', initialItems = []) {
  try {
    // Normalize list name
    const normalizedListName = normalizeListName(listName);
    
    // Create the list entry
    const { data: list, error } = await supabase
      .from('user_lists')
      .upsert({
        user_id: userId,
        guild_id: guildId,
        list_name: normalizedListName,
        description,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id, guild_id, list_name',
        returning: true
      })
      .select('*')
      .single();

    if (error) {
      logger.error(`Error creating list '${listName}' for user ${userId}:`, error);
      throw error;
    }

    // Add initial items if provided
    if (initialItems && initialItems.length > 0) {
      await addItemsToList(list.id, initialItems);
    }

    // Get the complete list with items
    const completeList = await getListById(list.id);
    
    // Update the cache
    updateListCache(userId, guildId, normalizedListName, completeList);
    
    return completeList;
  } catch (error) {
    logger.error(`Error in createList for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Gets a list by user, guild, and list name
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID  
 * @param {string} listName - Name of the list
 * @returns {Promise<Object|null>} - The list with its items, or null if not found
 */
async function getList(userId, guildId, listName) {
  try {
    // Normalize list name
    const normalizedListName = normalizeListName(listName);
    
    // Check cache first
    const cacheKey = `${userId}:${guildId}:${normalizedListName}`;
    if (listCache.has(cacheKey)) {
      const cachedList = listCache.get(cacheKey);
      if (cachedList.expires > Date.now()) {
        return cachedList.data;
      }
      // Expired cache, remove it
      listCache.delete(cacheKey);
    }
    
    // Get the list from the database
    const { data: list, error } = await supabase
      .from('user_lists')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .eq('list_name', normalizedListName)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Not found error
        return null;
      }
      logger.error(`Error getting list '${listName}' for user ${userId}:`, error);
      throw error;
    }

    if (!list) {
      return null;
    }

    // Get the list items
    const completeList = await getListById(list.id);
    
    // Update the cache
    updateListCache(userId, guildId, normalizedListName, completeList);
    
    return completeList;
  } catch (error) {
    logger.error(`Error in getList for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Gets all lists for a user
 * @param {string} userId - Discord user ID 
 * @param {string} guildId - Discord guild ID
 * @returns {Promise<Array>} - Array of lists with their items
 */
async function getAllLists(userId, guildId) {
  try {
    // Get all lists for this user in this guild
    const { data: lists, error } = await supabase
      .from('user_lists')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error(`Error getting all lists for user ${userId}:`, error);
      throw error;
    }

    if (!lists || lists.length === 0) {
      return [];
    }

    // Get items for each list
    const completeLists = await Promise.all(
      lists.map(list => getListById(list.id))
    );
    
    // Update cache for each list
    for (const list of completeLists) {
      updateListCache(userId, guildId, list.list_name, list);
    }
    
    return completeLists;
  } catch (error) {
    logger.error(`Error in getAllLists for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Adds items to a list
 * @param {number} listId - The ID of the list 
 * @param {Array<string>} items - Array of items to add
 * @returns {Promise<Array>} - Updated array of items
 */
async function addItemsToList(listId, items) {
  try {
    // Get the current max position
    const { data: existingItems, error: positionError } = await supabase
      .from('user_list_items')
      .select('position')
      .eq('list_id', listId)
      .order('position', { ascending: false })
      .limit(1);

    if (positionError) {
      logger.error(`Error getting max position for list ${listId}:`, positionError);
      throw positionError;
    }

    let nextPosition = 1; // Default if no items exist
    if (existingItems && existingItems.length > 0) {
      nextPosition = existingItems[0].position + 1;
    }

    // Prepare the items to insert
    const itemsToInsert = items.map((item, index) => ({
      list_id: listId,
      item_text: item.trim(),
      position: nextPosition + index,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    // Insert the items
    const { data: newItems, error } = await supabase
      .from('user_list_items')
      .insert(itemsToInsert)
      .select('*');

    if (error) {
      logger.error(`Error adding items to list ${listId}:`, error);
      throw error;
    }

    // Update the list's updated_at timestamp
    await supabase
      .from('user_lists')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', listId);

    // Clear cache for this list
    clearListCacheById(listId);

    return newItems;
  } catch (error) {
    logger.error(`Error in addItemsToList for list ${listId}:`, error);
    throw error;
  }
}

/**
 * Removes an item from a list by its content
 * @param {number} listId - The ID of the list
 * @param {string} itemText - The text of the item to remove
 * @returns {Promise<boolean>} - True if removed, false if not found
 */
async function removeItemFromList(listId, itemText) {
  try {
    // Find the item by its text
    const { data: itemToRemove, error: findError } = await supabase
      .from('user_list_items')
      .select('*')
      .eq('list_id', listId)
      .ilike('item_text', itemText)
      .limit(1);

    if (findError) {
      logger.error(`Error finding item in list ${listId}:`, findError);
      throw findError;
    }

    if (!itemToRemove || itemToRemove.length === 0) {
      return false; // Item not found
    }

    // Delete the item
    const { error: deleteError } = await supabase
      .from('user_list_items')
      .delete()
      .eq('id', itemToRemove[0].id);

    if (deleteError) {
      logger.error(`Error deleting item from list ${listId}:`, deleteError);
      throw deleteError;
    }

    // Reorder remaining items to maintain consecutive positions
    await reorderListItems(listId);

    // Update the list's updated_at timestamp
    await supabase
      .from('user_lists')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', listId);

    // Clear cache for this list
    clearListCacheById(listId);

    return true;
  } catch (error) {
    logger.error(`Error in removeItemFromList for list ${listId}:`, error);
    throw error;
  }
}

/**
 * Deletes a list and all its items
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {string} listName - Name of the list to delete
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
async function deleteList(userId, guildId, listName) {
  try {
    // Normalize list name
    const normalizedListName = normalizeListName(listName);
    
    // Find the list
    const { data: list, error: findError } = await supabase
      .from('user_lists')
      .select('id')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .eq('list_name', normalizedListName)
      .single();

    if (findError) {
      if (findError.code === 'PGRST116') { // Not found error
        return false;
      }
      logger.error(`Error finding list '${listName}' for user ${userId}:`, findError);
      throw findError;
    }

    if (!list) {
      return false;
    }

    // Delete the list (items will be cascade deleted)
    const { error: deleteError } = await supabase
      .from('user_lists')
      .delete()
      .eq('id', list.id);

    if (deleteError) {
      logger.error(`Error deleting list '${listName}' for user ${userId}:`, deleteError);
      throw deleteError;
    }

    // Clear cache
    const cacheKey = `${userId}:${guildId}:${normalizedListName}`;
    listCache.delete(cacheKey);

    return true;
  } catch (error) {
    logger.error(`Error in deleteList for user ${userId}:`, error);
    throw error;
  }
}

// ================ Helper functions ================

/**
 * Gets a list by its ID with all items
 * @param {number} listId - The list ID
 * @returns {Promise<Object>} - The list with its items
 */
async function getListById(listId) {
  try {
    // Get the list
    const { data: list, error } = await supabase
      .from('user_lists')
      .select('*')
      .eq('id', listId)
      .single();

    if (error) {
      logger.error(`Error getting list with ID ${listId}:`, error);
      throw error;
    }

    // Get the items
    const { data: items, error: itemsError } = await supabase
      .from('user_list_items')
      .select('*')
      .eq('list_id', listId)
      .order('position', { ascending: true });

    if (itemsError) {
      logger.error(`Error getting items for list ${listId}:`, itemsError);
      throw itemsError;
    }

    return {
      ...list,
      items: items || []
    };
  } catch (error) {
    logger.error(`Error in getListById for list ${listId}:`, error);
    throw error;
  }
}

/**
 * Reorders list items to ensure consecutive positions
 * @param {number} listId - The list ID 
 * @returns {Promise<void>}
 */
async function reorderListItems(listId) {
  try {
    // Get all items for this list
    const { data: items, error } = await supabase
      .from('user_list_items')
      .select('*')
      .eq('list_id', listId)
      .order('position', { ascending: true });

    if (error) {
      logger.error(`Error getting items for reordering in list ${listId}:`, error);
      throw error;
    }

    if (!items || items.length === 0) {
      return; // No items to reorder
    }

    // Update positions
    const updates = items.map((item, index) => ({
      id: item.id,
      position: index + 1
    }));

    // Perform the updates one by one
    for (const update of updates) {
      await supabase
        .from('user_list_items')
        .update({ position: update.position })
        .eq('id', update.id);
    }
  } catch (error) {
    logger.error(`Error in reorderListItems for list ${listId}:`, error);
    throw error;
  }
}

/**
 * Normalizes a list name for consistent storage and retrieval
 * @param {string} listName - The list name to normalize 
 * @returns {string} - Normalized list name
 */
function normalizeListName(listName) {
  // Remove extra spaces, make lowercase
  return listName.trim().toLowerCase();
}

/**
 * Updates the cache for a list
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {string} listName - Normalized list name 
 * @param {Object} listData - List data to cache
 */
function updateListCache(userId, guildId, listName, listData) {
  const cacheKey = `${userId}:${guildId}:${listName}`;
  listCache.set(cacheKey, {
    data: listData,
    expires: Date.now() + LIST_CACHE_TTL
  });
}

/**
 * Clears the cache for a list by its ID
 * @param {number} listId - The list ID
 */
async function clearListCacheById(listId) {
  try {
    // Get the list to find its key values
    const { data: list, error } = await supabase
      .from('user_lists')
      .select('user_id, guild_id, list_name')
      .eq('id', listId)
      .single();

    if (error || !list) {
      return; // Can't clear the cache without the list info
    }

    const cacheKey = `${list.user_id}:${list.guild_id}:${list.list_name}`;
    listCache.delete(cacheKey);
  } catch (error) {
    logger.error(`Error in clearListCacheById for list ${listId}:`, error);
    // Don't throw the error as this is a non-critical operation
  }
}