// utils/stripeWebhookHandler.js
import { logger } from './logger.js';
import { addCredits } from './creditManager.js';
import { updateServerSubscription, SUBSCRIPTION_PLANS, SUBSCRIPTION_CREDITS } from './subscriptionManager.js';
import Stripe from 'stripe';

// Initialize Stripe with the secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map Stripe price IDs to subscription plans
// Update these IDs with your actual Stripe price IDs
const PRICE_TO_PLAN = {
  'price_standard': SUBSCRIPTION_PLANS.STANDARD,
  'price_premium': SUBSCRIPTION_PLANS.PREMIUM,
  'price_enterprise': SUBSCRIPTION_PLANS.ENTERPRISE
};

/**
 * Process a Stripe webhook event
 * @param {Object} event - Stripe event object
 * @returns {Promise<boolean>} - Success or failure
 */
export async function processStripeWebhook(event) {
  try {
    logger.info(`Processing Stripe webhook event: ${event.type}`);
    
    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        return await handleCheckoutCompleted(event.data.object);
        
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return await handleSubscriptionUpdated(event.data.object);
        
      case 'customer.subscription.deleted':
        return await handleSubscriptionDeleted(event.data.object);
        
      case 'invoice.payment_succeeded':
        return await handleInvoicePaymentSucceeded(event.data.object);
        
      default:
        logger.info(`Unhandled webhook event type: ${event.type}`);
        return true; // Not an error, just not handled
    }
  } catch (error) {
    logger.error(`Error processing Stripe webhook: ${error.message}`);
    return false;
  }
}

/**
 * Handle checkout.session.completed event
 * @param {Object} session - Checkout session object
 * @returns {Promise<boolean>} - Success or failure
 */
async function handleCheckoutCompleted(session) {
  try {
    // Get guild ID from metadata
    const guildId = session.metadata?.guild_id;
    
    if (!guildId) {
      logger.error('No guild ID in checkout session metadata');
      return false;
    }
    
    // If this was a subscription checkout
    if (session.mode === 'subscription') {
      // This will be handled by the subscription events
      logger.info(`Subscription checkout completed for guild ${guildId}`);
      return true;
    }
    
    // If this was a one-time purchase of credits
    if (session.mode === 'payment') {
      // Get the credit package from metadata
      const creditAmount = parseInt(session.metadata?.credit_amount || '0', 10);
      
      if (creditAmount <= 0) {
        logger.error('Invalid credit amount in checkout metadata');
        return false;
      }
      
      // Add the credits to the guild
      const success = await addCredits(guildId, creditAmount, 'purchase');
      
      if (success) {
        logger.info(`Added ${creditAmount} purchased credits to guild ${guildId}`);
        return true;
      } else {
        logger.error(`Failed to add ${creditAmount} credits to guild ${guildId}`);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Error handling checkout.session.completed:', error);
    return false;
  }
}

/**
 * Handle customer.subscription.created or customer.subscription.updated event
 * @param {Object} subscription - Subscription object
 * @returns {Promise<boolean>} - Success or failure
 */
async function handleSubscriptionUpdated(subscription) {
  try {
    // Get guild ID from metadata
    const guildId = subscription.metadata?.guild_id;
    
    if (!guildId) {
      logger.error('No guild ID in subscription metadata');
      return false;
    }
    
    // Get plan ID from the price
    const priceId = subscription.items.data[0]?.price.id;
    let planName = PRICE_TO_PLAN[priceId];
    
    if (!planName) {
      logger.warn(`Unknown plan for price ID: ${priceId}, using price ID as plan name`);
      planName = priceId; // Fallback to using the price ID itself
    }
    
    // Update the subscription record
    const success = await updateServerSubscription(guildId, {
      subscriptionId: subscription.id,
      plan: planName,
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      stripeCustomerId: subscription.customer
    });
    
    if (success) {
      logger.info(`Updated subscription for guild ${guildId}: ${planName}, status: ${subscription.status}`);
      return true;
    } else {
      logger.error(`Failed to update subscription for guild ${guildId}`);
      return false;
    }
  } catch (error) {
    logger.error('Error handling subscription update:', error);
    return false;
  }
}

/**
 * Handle customer.subscription.deleted event
 * @param {Object} subscription - Subscription object
 * @returns {Promise<boolean>} - Success or failure
 */
async function handleSubscriptionDeleted(subscription) {
  try {
    // Get guild ID from metadata
    const guildId = subscription.metadata?.guild_id;
    
    if (!guildId) {
      logger.error('No guild ID in subscription metadata');
      return false;
    }
    
    // Update the subscription record as canceled
    const success = await updateServerSubscription(guildId, {
      subscriptionId: subscription.id,
      plan: 'none',
      status: 'canceled',
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      stripeCustomerId: subscription.customer
    });
    
    if (success) {
      logger.info(`Marked subscription as canceled for guild ${guildId}`);
      return true;
    } else {
      logger.error(`Failed to mark subscription as canceled for guild ${guildId}`);
      return false;
    }
  } catch (error) {
    logger.error('Error handling subscription deletion:', error);
    return false;
  }
}

/**
 * Handle invoice.payment_succeeded event
 * @param {Object} invoice - Invoice object
 * @returns {Promise<boolean>} - Success or failure
 */
async function handleInvoicePaymentSucceeded(invoice) {
  try {
    // Only process subscription invoices
    if (!invoice.subscription) {
      return true;
    }
    
    // Fetch subscription from Stripe to get metadata
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    
    // Get guild ID from metadata
    const guildId = subscription.metadata?.guild_id;
    
    if (!guildId) {
      logger.error('No guild ID in subscription metadata');
      return false;
    }
    
    // Get plan from price ID
    const priceId = subscription.items.data[0]?.price.id;
    const planName = PRICE_TO_PLAN[priceId] || priceId;
    
    // If this is a renewal, add the subscription credits
    const creditAmount = SUBSCRIPTION_CREDITS[planName] || 0;
    
    if (creditAmount > 0) {
      const success = await addCredits(guildId, creditAmount, 'subscription');
      
      if (success) {
        logger.info(`Added ${creditAmount} subscription credits to guild ${guildId} (renewal)`);
        return true;
      } else {
        logger.error(`Failed to add ${creditAmount} subscription credits to guild ${guildId}`);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Error handling invoice payment succeeded:', error);
    return false;
  }
}

export default { processStripeWebhook };