// listManager.js - Manages user lists in Bri
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';

// Cache for storing lists and items
const listCache = new Map();
const LIST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Creates a new list for a user
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {string} listName - Name of the list
 * @param {string} description - Optional description for the list
 * @param {Array<string>} initialItems - Optional array of initial items
 * @returns {Promise<Object>} - The created list with its items
 */
export async function createList(userId, guildId, listName, description = '', initialItems = []) {
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
export async function getList(userId, guildId, listName) {
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
export async function getAllLists(userId, guildId) {
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
export async function addItemsToList(listId, items) {
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
export async function removeItemFromList(listId, itemText) {
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
export async function deleteList(userId, guildId, listName) {
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

/**
 * Checks if a string appears to be a list creation request
 * @param {string} text - The text to analyze
 * @returns {Object|null} - Parsed list data if detected, null otherwise
 */
export function detectListCreation(text) {
  // Pattern: variations of "remember this list as [listName]:" or "create a list called [listName]:"
  const createPatterns = [
    /(?:remember|save)\s+(?:this|a|my)\s+list\s+(?:as|called|named)\s+["']?([\w\s]+)["']?\s*(?::|with|containing)\s*(.+)/i,
    /create\s+(?:a|my)\s+(?:new\s+)?list\s+(?:called|named)\s+["']?([\w\s]+)["']?\s*(?::|with|containing)\s*(.+)/i,
    /make\s+(?:a|my)\s+(?:new\s+)?list\s+(?:called|named|for)\s+["']?([\w\s]+)["']?\s*(?::|with|containing)\s*(.+)/i
  ];

  for (const pattern of createPatterns) {
    const match = text.match(pattern);
    if (match) {
      const listName = match[1].trim();
      const itemsText = match[2].trim();
      const items = parseListItems(itemsText);

      return {
        operation: 'create',
        listName,
        items
      };
    }
  }

  return null;
}

/**
 * Checks if a string appears to be a list addition request
 * @param {string} text - The text to analyze
 * @returns {Object|null} - Parsed operation data if detected, null otherwise
 */
export function detectListAddition(text) {
  // Pattern: variations of "add X to my list of Y" or "add X to my Y list"
  const addPatterns = [
    /add\s+(.+?)\s+to\s+(?:my|the)\s+(?:list\s+(?:of|for|called|named)\s+)([\w\s]+)/i,
    /add\s+(.+?)\s+to\s+(?:my|the)\s+([\w\s]+?)\s+list/i
  ];

  for (const pattern of addPatterns) {
    const match = text.match(pattern);
    if (match) {
      const itemsText = match[1].trim();
      const listName = match[2].trim();
      const items = parseListItems(itemsText);

      return {
        operation: 'add',
        listName,
        items
      };
    }
  }

  return null;
}

/**
 * Checks if a string appears to be a list removal request
 * @param {string} text - The text to analyze
 * @returns {Object|null} - Parsed operation data if detected, null otherwise
 */
export function detectListRemoval(text) {
  // Pattern: variations of "remove X from my list of Y" or "remove X from my Y list"
  const removePatterns = [
    /(?:remove|delete)\s+(.+?)\s+from\s+(?:my|the)\s+(?:list\s+(?:of|for|called|named)\s+)([\w\s]+)/i,
    /(?:remove|delete)\s+(.+?)\s+from\s+(?:my|the)\s+([\w\s]+?)\s+list/i
  ];

  for (const pattern of removePatterns) {
    const match = text.match(pattern);
    if (match) {
      const itemText = match[1].trim();
      const listName = match[2].trim();

      return {
        operation: 'remove',
        listName,
        itemText
      };
    }
  }

  return null;
}

/**
 * Checks if a string appears to be a request to show a list
 * @param {string} text - The text to analyze
 * @returns {Object|null} - Parsed operation data if detected, null otherwise
 */
export function detectListShow(text) {
  // Pattern: variations of "show me my list of X" or "what's on my X list"
  const showPatterns = [
    /(?:show|display|view)\s+(?:me\s+)?(?:my|the)\s+(?:list\s+(?:of|for|called|named)\s+)([\w\s]+)/i,
    /(?:show|display|view)\s+(?:me\s+)?(?:my|the)\s+([\w\s]+?)\s+list/i,
    /what(?:'s|\s+is)\s+(?:on|in)\s+(?:my|the)\s+(?:list\s+(?:of|for|called|named)\s+)([\w\s]+)/i,
    /what(?:'s|\s+is)\s+(?:on|in)\s+(?:my|the)\s+([\w\s]+?)\s+list/i
  ];

  for (const pattern of showPatterns) {
    const match = text.match(pattern);
    if (match) {
      const listName = match[1].trim();

      return {
        operation: 'show',
        listName
      };
    }
  }

  return null;
}

/**
 * Processes a list operation detected in a message
 * @param {string} userId - Discord user ID
 * @param {string} guildId - Discord guild ID 
 * @param {Object} operation - The detected operation
 * @returns {Promise<string>} - Response message to send to the user
 */
export async function processListOperation(userId, guildId, operation) {
  try {
    switch (operation.operation) {
      case 'create': {
        const list = await createList(userId, guildId, operation.listName, '', operation.items);
        return `I've created your list "${list.list_name}" with ${list.items.length} item${list.items.length !== 1 ? 's' : ''}.`;
      }
      
      case 'add': {
        const list = await getList(userId, guildId, operation.listName);
        if (!list) {
          return `I couldn't find a list called "${operation.listName}". Would you like me to create it for you?`;
        }
        
        await addItemsToList(list.id, operation.items);
        const updatedList = await getListById(list.id);
        return `I've added ${operation.items.length} item${operation.items.length !== 1 ? 's' : ''} to your "${list.list_name}" list. It now has ${updatedList.items.length} item${updatedList.items.length !== 1 ? 's' : ''}.`;
      }
      
      case 'remove': {
        const list = await getList(userId, guildId, operation.listName);
        if (!list) {
          return `I couldn't find a list called "${operation.listName}".`;
        }
        
        const removed = await removeItemFromList(list.id, operation.itemText);
        if (!removed) {
          return `I couldn't find "${operation.itemText}" in your "${list.list_name}" list.`;
        }
        
        const updatedList = await getListById(list.id);
        return `I've removed "${operation.itemText}" from your "${list.list_name}" list. It now has ${updatedList.items.length} item${updatedList.items.length !== 1 ? 's' : ''}.`;
      }
      
      case 'show': {
        const list = await getList(userId, guildId, operation.listName);
        if (!list) {
          return `I couldn't find a list called "${operation.listName}".`;
        }
        
        if (list.items.length === 0) {
          return `Your "${list.list_name}" list is empty.`;
        }
        
        const itemsList = list.items.map((item, index) => `${index + 1}. ${item.item_text}`).join('\n');
        return `Here's your "${list.list_name}" list:\n\n${itemsList}`;
      }
      
      default:
        return null;
    }
  } catch (error) {
    logger.error(`Error processing list operation:`, error);
    return `I had an error processing your list request. Please try again later.`;
  }
}

/**
 * Detects if a message contains a list operation
 * @param {string} messageText - The message text to analyze
 * @returns {Object|null} - Detected operation or null if none
 */
export function detectListOperation(messageText) {
  // Try each detection function in order
  return (
    detectListCreation(messageText) ||
    detectListAddition(messageText) ||
    detectListRemoval(messageText) ||
    detectListShow(messageText)
  );
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
 * Parses a string of list items into an array
 * @param {string} itemsText - Text containing list items
 * @returns {Array<string>} - Array of parsed items
 */
function parseListItems(itemsText) {
  // Try to detect if items are comma-separated, bullet points, or numbered
  if (itemsText.includes(',')) {
    // Comma-separated
    return itemsText.split(',').map(item => item.trim()).filter(item => item.length > 0);
  } else if (itemsText.match(/\d+\.\s+\w+/) || itemsText.match(/•\s+\w+/) || itemsText.match(/-\s+\w+/)) {
    // Numbered or bullet points
    return itemsText
      .split(/\n|\r|\r\n/)
      .map(line => line.replace(/^\d+\.\s+|^•\s+|^-\s+/, '').trim())
      .filter(item => item.length > 0);
  } else {
    // Space separated or single item
    return [itemsText.trim()];
  }
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

// Initialize the list system
export async function initializeListSystem() {
  try {
    // Ensure tables exist
    const { data, error } = await supabase
      .from('user_lists')
      .select('count(*)', { count: 'exact', head: true });
      
    if (error && error.code === '42P01') { // Table doesn't exist
      logger.warn("List tables don't exist. Please run migrations/add_list_support.sql to create them.");
    } else {
      logger.info(`List system initialized with ${data || 0} existing lists`);
    }
    
    return true;
  } catch (error) {
    logger.error("Error initializing list system:", error);
    return false;
  }
}