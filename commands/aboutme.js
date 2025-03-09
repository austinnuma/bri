// commands/aboutme.js
import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/combinedServices.js';
import { 
  getRelationshipLevel, 
  RELATIONSHIP_LEVELS,
  MemoryTypes
} from '../utils/characterDevelopment.js';

export const data = new SlashCommandBuilder()
    .setName('aboutme')
    .setDescription("Learn about Bri's interests and what she's up to")
    .addStringOption(option =>
        option.setName('topic')
            .setDescription('Specific topic to ask about (optional)')
            .setRequired(false)
            .addChoices(
                { name: 'Interests', value: 'interests' },
                { name: 'Current Projects', value: 'projects' },
                { name: 'Relationship', value: 'relationship' }
            ));

export async function execute(interaction) {
    await interaction.deferReply();
    
    try {
        const topic = interaction.options.getString('topic');
        const userId = interaction.user.id;
        
        // Get relationship level
        const relationshipLevel = await getRelationshipLevel(userId);
        
        // Generate appropriate response based on topic and relationship
        if (topic === 'interests') {
            await handleInterestsQuery(interaction, relationshipLevel);
        } else if (topic === 'projects') {
            await handleProjectsQuery(interaction, relationshipLevel);
        } else if (topic === 'relationship') {
            await handleRelationshipQuery(interaction, userId, relationshipLevel);
        } else {
            // No specific topic - give general overview
            await handleGeneralAboutMe(interaction, userId, relationshipLevel);
        }
    } catch (error) {
        logger.error('Error executing aboutme command:', error);
        await interaction.editReply('Oops! Something went wrong trying to tell you about me. Can you try again?');
    }
}

/**
 * Handles query about Bri's interests
 * @param {Object} interaction - Discord interaction
 * @param {number} relationshipLevel - User's relationship level
 */
async function handleInterestsQuery(interaction, relationshipLevel) {
    try {
        // Get Bri's interests from the database
        const { data: interests, error } = await supabase
            .from('bri_interests')
            .select('*')
            .order('level', { ascending: false });
            
        if (error) {
            logger.error("Error fetching interests:", error);
            throw error;
        }
        
        if (!interests || interests.length === 0) {
            await interaction.editReply("I don't really have any specific interests yet! I'm still figuring out what I like!");
            return;
        }
        
        // Format response based on relationship level
        let response = "Here are some things I'm interested in:\n\n";
        
        // Higher relationship level = more detail
        const interestsToShow = relationshipLevel >= RELATIONSHIP_LEVELS.FRIENDLY 
            ? Math.min(interests.length, 5)  // Show up to 5 interests for friends
            : Math.min(interests.length, 3); // Show up to 3 for acquaintances
            
        for (let i = 0; i < interestsToShow; i++) {
            const interest = interests[i];
            response += `**${interest.name.charAt(0).toUpperCase() + interest.name.slice(1)}** `;
            
            // Add star emojis based on interest level
            response += "⭐".repeat(interest.level) + "\n";
            
            // Add description for closer relationships
            if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIENDLY) {
                response += `${interest.description}\n`;
                
                // Add a random fact for close friends
                if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIEND && interest.facts && interest.facts.length > 0) {
                    const randomFact = interest.facts[Math.floor(Math.random() * interest.facts.length)];
                    response += `Fun fact: ${randomFact}\n`;
                }
            }
            
            response += "\n";
        }
        
        // Ending message
        if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIEND) {
            response += "Thanks for asking about my interests! What do you like to do for fun?";
        } else {
            response += "Those are some of my favorite things!";
        }
        
        await interaction.editReply(response);
    } catch (error) {
        logger.error("Error in handleInterestsQuery:", error);
        await interaction.editReply("I had trouble remembering my interests right now. Maybe we can talk about them later!");
    }
}

/**
 * Handles query about Bri's current projects/storylines
 * @param {Object} interaction - Discord interaction
 * @param {number} relationshipLevel - User's relationship level
 */
async function handleProjectsQuery(interaction, relationshipLevel) {
    try {
        // Get Bri's active storylines
        const { data: storylines, error } = await supabase
            .from('bri_storyline')
            .select('*')
            .in('status', ['in_progress', 'completed'])
            .order('start_date', { ascending: false })
            .limit(5);
            
        if (error) {
            logger.error("Error fetching storylines:", error);
            throw error;
        }
        
        if (!storylines || storylines.length === 0) {
            await interaction.editReply("I'm not working on any specific projects right now! Just hanging out and chatting with everyone!");
            return;
        }
        
        // Format response based on relationship level
        let response = "Here's what I've been up to lately:\n\n";
        
        // Higher relationship level = more detail and more projects shown
        const projectsToShow = relationshipLevel >= RELATIONSHIP_LEVELS.FRIENDLY 
            ? Math.min(storylines.length, 3)  // Show up to 3 projects for friends
            : Math.min(storylines.length, 1); // Show only the most recent for acquaintances
            
        for (let i = 0; i < projectsToShow; i++) {
            const storyline = storylines[i];
            response += `**${storyline.title}** `;
            
            // Add status indicator
            if (storyline.status === 'completed') {
                response += "✅\n";
            } else {
                // Add progress bar
                const progressPercent = Math.round(storyline.progress * 100);
                response += `(${progressPercent}% done)\n`;
            }
            
            // Add description
            response += `${storyline.description}\n`;
            
            // Add latest update for closer relationships
            if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIENDLY && storyline.updates && storyline.updates.length > 0) {
                // Get the most recent update
                const latestUpdate = storyline.updates.sort(
                    (a, b) => new Date(b.date) - new Date(a.date)
                )[0];
                
                response += `Latest: ${latestUpdate.content}\n`;
            }
            
            response += "\n";
        }
        
        // Ending message
        if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIEND) {
            response += "I'd love to hear about what you're working on too!";
        } else {
            response += "That's what I've been up to!";
        }
        
        await interaction.editReply(response);
    } catch (error) {
        logger.error("Error in handleProjectsQuery:", error);
        await interaction.editReply("I had trouble remembering what I've been working on. I'll tell you about it later!");
    }
}

/**
 * Handles query about the user's relationship with Bri
 * @param {Object} interaction - Discord interaction
 * @param {string} userId - User ID
 * @param {number} relationshipLevel - User's relationship level
 */
async function handleRelationshipQuery(interaction, userId, relationshipLevel) {
    try {
        // Get relationship details
        const { data: relationship, error } = await supabase
            .from('bri_relationships')
            .select('*')
            .eq('user_id', userId)
            .single();
            
        if (error && error.code !== 'PGRST116') { // Not found error
            logger.error("Error fetching relationship:", error);
            throw error;
        }
        
        // Format relationship level in a kid-friendly way
        let levelDescription;
        switch (relationshipLevel) {
            case RELATIONSHIP_LEVELS.STRANGER:
                levelDescription = "We just met! I'm excited to get to know you better!";
                break;
            case RELATIONSHIP_LEVELS.ACQUAINTANCE:
                levelDescription = "We're starting to get to know each other! Thanks for chatting with me!";
                break;
            case RELATIONSHIP_LEVELS.FRIENDLY:
                levelDescription = "We're becoming good friends! I always enjoy our conversations!";
                break;
            case RELATIONSHIP_LEVELS.FRIEND:
                levelDescription = "You're one of my good friends! I really like talking with you!";
                break;
            case RELATIONSHIP_LEVELS.CLOSE_FRIEND:
                levelDescription = "You're one of my best friends! I always look forward to our chats!";
                break;
            default:
                levelDescription = "I'm happy we're getting to know each other!";
        }
        
        let response = `**Our Friendship**\n${levelDescription}\n\n`;
        
        // Only show more details for established relationships
        if (relationship && relationshipLevel >= RELATIONSHIP_LEVELS.FRIENDLY) {
            // Add interaction count
            response += `We've chatted ${relationship.interaction_count} times!\n\n`;
            
            // Add shared interests if any
            if (relationship.shared_interests && relationship.shared_interests.length > 0) {
                response += "**Things we both like:**\n";
                relationship.shared_interests.slice(0, 3).forEach(interest => {
                    response += `• ${interest.charAt(0).toUpperCase() + interest.slice(1)}\n`;
                });
                response += "\n";
            }
            
            // Add common conversation topics for close friends
            if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIEND && relationship.conversation_topics) {
                const topTopics = Object.entries(relationship.conversation_topics)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3);
                    
                if (topTopics.length > 0) {
                    response += "**We often talk about:**\n";
                    topTopics.forEach(([topic, count]) => {
                        response += `• ${topic.charAt(0).toUpperCase() + topic.slice(1)}\n`;
                    });
                    response += "\n";
                }
            }
            
            // Add inside jokes mention for close friends
            if (relationshipLevel >= RELATIONSHIP_LEVELS.CLOSE_FRIEND && 
                relationship.inside_jokes && 
                relationship.inside_jokes.length > 0) {
                response += `We have ${relationship.inside_jokes.length} inside jokes! 😂\n\n`;
            }
        }
        
        response += "I'm really glad we're friends! 💖";
        
        await interaction.editReply(response);
    } catch (error) {
        logger.error("Error in handleRelationshipQuery:", error);
        await interaction.editReply("I know we're friends, but I'm having trouble remembering all the details right now!");
    }
}

/**
 * Handles general query about Bri
 * @param {Object} interaction - Discord interaction
 * @param {string} userId - User ID
 * @param {number} relationshipLevel - User's relationship level
 */
async function handleGeneralAboutMe(interaction, userId, relationshipLevel) {
    try {
        // Get a combination of interests and current projects
        const { data: interests, error: interestsError } = await supabase
            .from('bri_interests')
            .select('name, level, description')
            .order('level', { ascending: false })
            .limit(3);
            
        if (interestsError) {
            logger.error("Error fetching interests:", interestsError);
            throw interestsError;
        }
        
        const { data: storylines, error: storylinesError } = await supabase
            .from('bri_storyline')
            .select('title, description, status, progress, updates')
            .eq('status', 'in_progress')
            .order('start_date', { ascending: false })
            .limit(1);
            
        if (storylinesError) {
            logger.error("Error fetching storylines:", storylinesError);
            throw storylinesError;
        }
        
        // Build response
        let response = "# 🌟 All About Bri 🌟\n\n";
        
        // Intro varies slightly based on relationship level
        if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIEND) {
            response += "Hey friend! Here's a bit about me!\n\n";
        } else {
            response += "Hi there! Here's a bit about me!\n\n";
        }
        
        // Add interests section
        if (interests && interests.length > 0) {
            response += "## My Favorite Things\n";
            interests.forEach(interest => {
                response += `**${interest.name.charAt(0).toUpperCase() + interest.name.slice(1)}** - `;
                
                if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIENDLY) {
                    response += `${interest.description}\n`;
                } else {
                    response += "I really like this!\n";
                }
            });
            response += "\n";
        }
        
        // Add current project
        if (storylines && storylines.length > 0) {
            const currentProject = storylines[0];
            response += "## What I'm Up To\n";
            response += `I'm working on **${currentProject.title}**!\n`;
            response += `${currentProject.description}\n`;
            
            // Add latest update for closer relationships
            if (relationshipLevel >= RELATIONSHIP_LEVELS.FRIENDLY && 
                currentProject.updates && 
                currentProject.updates.length > 0) {
                // Get the most recent update
                const latestUpdate = currentProject.updates.sort(
                    (a, b) => new Date(b.date) - new Date(a.date)
                )[0];
                
                response += `\n*${latestUpdate.content}*\n`;
            }
            
            response += "\n";
        }
        
        // Friendly ending
        response += "Thanks for asking about me! I'd love to learn more about you too! 💖";
        
        await interaction.editReply(response);
    } catch (error) {
        logger.error("Error in handleGeneralAboutMe:", error);
        await interaction.editReply("I'm a 10-year-old AI assistant named Bri! I love chatting with people and making new friends! What about you?");
    }
}