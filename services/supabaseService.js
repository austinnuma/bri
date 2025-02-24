// /src/services/supabaseService.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Create and export the Supabase client instance.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Upserts data into a specified table.
 * @param {string} table - The name of the table.
 * @param {Object|Array} data - The data to upsert.
 * @returns {Promise<Object>} - The result data from the upsert.
 */
export async function upsert(table, data) {
  const { data: result, error } = await supabase
    .from(table)
    .upsert(data);
  if (error) {
    console.error(`Error upserting into ${table}:`, error);
    throw error;
  }
  return result;
}

/**
 * Selects data from a specified table using a query condition.
 * @param {string} table - The name of the table.
 * @param {Object} query - An object containing the query key/value pair.
 * @returns {Promise<Object>} - The selected data.
 */
export async function select(table, query) {
  const key = Object.keys(query)[0];
  const value = query[key];
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(key, value);
  if (error) {
    console.error(`Error selecting from ${table}:`, error);
    throw error;
  }
  return data;
}

/**
 * Calls an RPC (stored procedure) on Supabase.
 * @param {string} rpcName - The name of the RPC function.
 * @param {Object} params - Parameters for the RPC.
 * @returns {Promise<Object>} - The result data from the RPC.
 */
export async function callRpc(rpcName, params) {
  const { data, error } = await supabase.rpc(rpcName, params);
  if (error) {
    console.error(`Error calling RPC ${rpcName}:`, error);
    throw error;
  }
  return data;
}
