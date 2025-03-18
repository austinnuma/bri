// commands/subscription.js
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../utils/logger.js';
import { hasActiveSubscription, SUBSCRIPTION_PLANS, SUBSCRIPTION_FEATURES, SUBSCRIPTION_CREDITS } from '../utils/subscriptionManager.js';
import { getServerCredits } from '../utils/creditManager.js';

export const data = new SlashCommandBuilder()
    .setName('subscription')
    .setDescription('Check server subscription status and information');

export async function execute(interaction) {
    await interaction.deferReply();
    
    try {
        const guildId = interaction.guildId;
        
        // Check current subscription status
        const { subscribed, plan, error } = await hasActiveSubscription(guildId);
        
        // Get credit information
        const credits = await getServerCredits(guildId);
        
        // Create the subscription embed
        const embed = new EmbedBuilder()
            .setTitle('Bri Subscription Status')
            .setColor(subscribed ? 0x00FF00 : 0xFFA500) // Green if subscribed, orange if not
            .setTimestamp();
        
        if (subscribed) {
            // Show information about active subscription
            embed.setDescription(`This server has an active **${plan.toUpperCase()}** subscription!`)
                .addFields(
                    {
                        name: '💎 Current Plan',
                        value: `${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
                        inline: true
                    },
                    {
                        name: '🎁 Monthly Subscription Credits',
                        value: `${SUBSCRIPTION_CREDITS[plan] || 0} credits`,
                        inline: true
                    },
                    {
                        name: '💰 Credits Balance',
                        value: `${credits?.remaining_credits || 0} credits available`,
                        inline: true
                    }
                );
            
            // Add features based on plan
            let featuresText = "";
            
            switch (plan) {
                case SUBSCRIPTION_PLANS.STANDARD:
                    featuresText = "✅ Bri's Journal System\n" +
                                "✅ Monthly Subscription Credits\n" +
                                "❌ Custom System Prompt\n" +
                                "❌ Unlimited Reminders\n" +
                                "❌ Unlimited Message Scheduling\n" +
                                "❌ Unlimited Image Analysis";
                    break;
                case SUBSCRIPTION_PLANS.PREMIUM:
                    featuresText = "✅ Bri's Journal System\n" +
                                "✅ Monthly Subscription Credits\n" +
                                "✅ Custom System Prompt\n" +
                                "✅ Unlimited Reminders\n" +
                                "❌ Unlimited Message Scheduling\n" +
                                "❌ Unlimited Image Analysis";
                    break;
                case SUBSCRIPTION_PLANS.ENTERPRISE:
                    featuresText = "✅ Bri's Journal System\n" +
                                "✅ Monthly Subscription Credits\n" +
                                "✅ Custom System Prompt\n" +
                                "✅ Unlimited Reminders\n" +
                                "✅ Unlimited Message Scheduling\n" +
                                "✅ Unlimited Image Analysis";
                    break;
                default:
                    featuresText = "Features information not available";
            }
            
            embed.addFields({ name: '✨ Features', value: featuresText });
            
        } else {
            // Show information for non-subscribers
            embed.setDescription(`This server does not have an active subscription.`)
                .addFields(
                    {
                        name: '💰 Credits Balance',
                        value: `${credits?.remaining_credits || 0} credits available`,
                        inline: true
                    },
                    {
                        name: '🎁 Free Monthly Credits',
                        value: '100 credits',
                        inline: true
                    },
                    {
                        name: '💡 Available Plans',
                        value: 'Standard, Premium, and Enterprise',
                        inline: true
                    },
                    {
                        name: '✨ Subscription Benefits',
                        value: '• Journal System - Get personal journal entries from Bri\n' +
                               '• Custom System Prompt - Customize Bri\'s behavior\n' +
                               '• Unlimited Feature Usage - No credits for certain features\n' +
                               '• Monthly Subscription Credits - Get bonus credits monthly'
                    }
                );
        }
        
        // Create buttons for subscription management
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Subscribe Now')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://your-subscription-url.com/subscribe?guild=${guildId}`),
                new ButtonBuilder()
                    .setLabel('Buy Credits')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://your-subscription-url.com/credits?guild=${guildId}`),
                new ButtonBuilder()
                    .setLabel('Manage Subscription')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://your-subscription-url.com/manage?guild=${guildId}`)
            );
        
        // Send the embed with buttons
        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });
        
    } catch (error) {
        logger.error('Error in subscription command:', error);
        await interaction.editReply('Sorry, there was an error checking your subscription status. Please try again later.');
    }
}