// utils/stripeWebhook.js
import 'dotenv/config';
import express from 'express';
import { logger } from './logger.js';
import { processStripeWebhook } from './creditManager.js';
import Stripe from 'stripe';

// Initialize Stripe with the secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Initialize the Stripe webhook server
 */
export function initializeStripeWebhook() {
  // Only start the webhook server if Stripe keys are configured
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    logger.warn('Stripe webhook server not started: missing configuration');
    return;
  }

  const app = express();

  // Use JSON parsing middleware, but with raw body for Stripe verification
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf.toString();
      },
    })
  );

  // Stripe webhook endpoint
  app.post('/stripe-webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;

    try {
      // Verify the event is from Stripe
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
      logger.error(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Process the event
    try {
      const success = await processStripeWebhook(event);
      
      if (success) {
        logger.info(`Processed Stripe webhook event: ${event.type}`);
        res.json({ received: true });
      } else {
        logger.error(`Failed to process Stripe webhook event: ${event.type}`);
        res.status(500).json({ error: 'Failed to process webhook' });
      }
    } catch (error) {
      logger.error(`Error handling Stripe webhook: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  // Start server on specified port or default to 3000
  const port = process.env.STRIPE_WEBHOOK_PORT || 3000;
  app.listen(port, () => {
    logger.info(`Stripe webhook server listening on port ${port}`);
  });
}