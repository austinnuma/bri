// api/serverCreditsApi.js
import express from 'express';
import cors from 'cors';
import { logger } from '../utils/logger.js';
import { getServerCredits } from '../utils/creditManager.js';
import { supabase } from '../services/combinedServices.js';
import Stripe from 'stripe';
import 'dotenv/config';

// Initialize Stripe with the secret key
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Initialize the server credits API
 * This runs in the same Express app as the Stripe webhook server
 * @param {express.Application} app - Express application
 */
export function initializeServerCreditsApi(app) {
  // Use CORS middleware
  app.use(cors({
    origin: process.env.WEBSITE_URL || '*', // Restrict to website URL in production
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  // Authentication middleware to verify user has permission to access server data
  const authenticateUser = async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const token = authHeader.split(' ')[1];
      
      // Verify token with Supabase
      const { data: userData, error } = await supabase.auth.getUser(token);
      
      if (error || !userData) {
        logger.error('Authentication error:', error);
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      // Store user data for use in route handlers
      req.user = userData.user;
      next();
    } catch (error) {
      logger.error('Authentication error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // Route to get server credits
  app.get('/api/server/:serverId/credits', authenticateUser, async (req, res) => {
    try {
      const serverId = req.params.serverId;
      
      // Check if user has permission to access this server
      const hasPermission = await checkServerPermission(req.user.id, serverId);
      if (!hasPermission) {
        return res.status(403).json({ error: 'You do not have permission to access this server' });
      }
      
      // Get credit information
      const credits = await getServerCredits(serverId);
      if (!credits) {
        return res.status(404).json({ error: 'Server not found' });
      }
      
      // Get transaction history
      const { data: transactions, error } = await supabase
        .from('credit_transactions')
        .select('*')
        .eq('guild_id', serverId)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) {
        logger.error('Error fetching transactions:', error);
        return res.status(500).json({ error: 'Error fetching transaction history' });
      }
      
      res.json({
        credits,
        transactions: transactions || []
      });
    } catch (error) {
      logger.error('Error fetching server credits:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Route to create a checkout session for purchasing credits
  app.post('/api/server/:serverId/credits/checkout', authenticateUser, async (req, res) => {
    try {
      const serverId = req.params.serverId;
      const { productId, successUrl, cancelUrl } = req.body;
      
      if (!productId || !successUrl || !cancelUrl) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }
      
      // Check if user has permission to manage this server
      const hasPermission = await checkServerPermission(req.user.id, serverId, true);
      if (!hasPermission) {
        return res.status(403).json({ error: 'You do not have permission to purchase credits for this server' });
      }
      
      // Create a checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: productId,
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          guild_id: serverId,
          user_id: req.user.id
        }
      });
      
      res.json({ url: session.url });
    } catch (error) {
      logger.error('Error creating checkout session:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get credit package options
  app.get('/api/credit-packages', async (req, res) => {
    try {
      // Fetch available credit packages from Stripe
      const prices = await stripe.prices.list({
        active: true,
        expand: ['data.product']
      });
      
      // Filter and format the packages
      const packages = prices.data
        .filter(price => price.product.metadata.type === 'credits')
        .map(price => ({
          id: price.id,
          name: price.product.name,
          description: price.product.description,
          credits: parseInt(price.product.metadata.credits, 10) || 0,
          price: price.unit_amount / 100, // Convert from cents to dollars
          currency: price.currency.toUpperCase()
        }));
      
      res.json(packages);
    } catch (error) {
      logger.error('Error fetching credit packages:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  logger.info('Server credits API initialized');
}

/**
 * Check if a user has permission to access a server
 * @param {string} userId - User ID
 * @param {string} serverId - Server ID
 * @param {boolean} requireAdmin - Whether admin permission is required
 * @returns {Promise<boolean>} - Whether the user has permission
 */
async function checkServerPermission(userId, serverId, requireAdmin = false) {
  try {
    // Check if user is an owner or admin of the server
    // This would typically involve querying Discord's API or
    // maintaining a local database of server roles
    
    // For now, check our mapping table for the user-server relationship
    const { data, error } = await supabase
      .from('discord_users')
      .select('*')
      .eq('user_id', userId)
      .eq('server_id', serverId)
      .single();
    
    if (error || !data) {
      return false;
    }
    
    // If admin permission is required, check the user's roles
    if (requireAdmin) {
      // This would need to be expanded based on how roles are stored
      return data.is_admin || data.is_owner || false;
    }
    
    return true;
  } catch (error) {
    logger.error('Error checking server permission:', error);
    return false;
  }
}