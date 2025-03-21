// commands/viewProfile.js
import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getUserCharacterSheet } from '../utils/userCharacterSheet.js';
import { isFeatureEnabled } from '../utils/serverConfigManager.js';

export const data = new SlashCommandBuilder()
    .setName('my-profile')
    .setDescription('See what information Bri knows about you');

export async function execute(interaction) {
    try {
        // Check if character feature is enabled for this server
        const characterEnabled = await isFeatureEnabled(interaction.guildId, 'character');
        if (!characterEnabled) {
            return interaction.reply({ 
                content: "The character features are currently disabled on this server. Please ask a server admin to enable them.",
                ephemeral: true 
            });
        }

        // Get the user's character sheet
        const sheet = await getUserCharacterSheet(
            interaction.user.id, 
            interaction.guildId
        );
        
        // Generate a human-readable profile
        const profile = generateReadableProfile(sheet);
        
        // Reply to the user with their profile
        await interaction.reply({ 
            content: profile,
            ephemeral: true // Make it private
        });
        
    } catch (error) {
        logger.error("Error in my-profile command:", error);
        await interaction.reply({ 
            content: "Sorry, there was an error retrieving your profile. Please try again later.",
            ephemeral: true 
        });
    }
}

/**
 * Generates a human-readable profile from a character sheet
 * @param {Object} sheet - The character sheet
 * @returns {string} - Formatted profile information
 */
function generateReadableProfile(sheet) {
    let profile = "# Your Profile\n\n";
    
    // Check if there's any meaningful information to display
    const hasPersonalInfo = sheet.name || sheet.age || sheet.location;
    const hasOccupation = sheet.occupation && sheet.occupation.job;
    const hasEducation = sheet.education && sheet.education.level;
    const hasFamily = sheet.family && sheet.family.length > 0;
    const hasPets = sheet.pets && sheet.pets.length > 0;
    const hasPreferences = sheet.top_preferences && sheet.top_preferences.length > 0;
    
    // If there's not much info yet
    if (!hasPersonalInfo && !hasOccupation && !hasEducation && 
        !hasFamily && !hasPets && !hasPreferences) {
        return "# Your Profile\n\nI don't know much about you yet! Use `/about-me` to share some information, or just chat with me more so I can learn about you.";
    }
    
    // Personal Information
    profile += "## Personal Information\n";
    
    if (sheet.name) {
        profile += `**Name:** ${sheet.name}`;
        if (sheet.nickname && sheet.nickname !== sheet.name) {
            profile += ` (goes by ${sheet.nickname})`;
        }
        profile += "\n";
    } else {
        profile += "**Name:** Not provided yet\n";
    }
    
    if (sheet.age) {
        profile += `**Age:** ${sheet.age}\n`;
    }
    
    if (sheet.location) {
        profile += `**Location:** ${sheet.location}\n`;
    }
    
    profile += "\n";
    
    // Occupation & Education
    if (hasOccupation || hasEducation) {
        profile += "## Work & Education\n";
        
        if (hasOccupation) {
            profile += `**Job:** ${sheet.occupation.job}`;
            if (sheet.occupation.company) {
                profile += ` at ${sheet.occupation.company}`;
            }
            if (sheet.occupation.position) {
                profile += ` as ${sheet.occupation.position}`;
            }
            profile += "\n";
        }
        
        if (hasEducation) {
            profile += `**Education:** ${sheet.education.level}`;
            if (sheet.education.field) {
                profile += ` in ${sheet.education.field}`;
            }
            if (sheet.education.school) {
                profile += ` at ${sheet.education.school}`;
            }
            profile += "\n";
        }
        
        profile += "\n";
    }
    
    // Relationships
    if (hasFamily || hasPets) {
        profile += "## Relationships\n";
        
        if (hasFamily) {
            profile += "**Family:**\n";
            sheet.family.forEach(member => {
                profile += `- ${member.name} (${member.relation})`;
                if (member.details) {
                    profile += ` - ${member.details}`;
                }
                profile += "\n";
            });
        }
        
        if (hasPets) {
            profile += "\n**Pets:**\n";
            sheet.pets.forEach(pet => {
                profile += `- ${pet.name} (${pet.type})`;
                if (pet.details) {
                    profile += ` - ${pet.details}`;
                }
                profile += "\n";
            });
        }
        
        profile += "\n";
    }
    
    // Preferences
    if (hasPreferences) {
        profile += "## Preferences\n";
        
        const likes = sheet.top_preferences
            .filter(pref => pref.sentiment === "positive")
            .map(pref => pref.item);
            
        const dislikes = sheet.top_preferences
            .filter(pref => pref.sentiment === "negative")
            .map(pref => pref.item);
        
        if (likes.length > 0) {
            profile += "**Things you like:**\n";
            likes.forEach(item => {
                profile += `- ${item}\n`;
            });
            profile += "\n";
        }
        
        if (dislikes.length > 0) {
            profile += "**Things you dislike:**\n";
            dislikes.forEach(item => {
                profile += `- ${item}\n`;
            });
        }
    }
    
    profile += "\n---\n";
    profile += "You can update this information using the `/about-me` command.";
    
    return profile;
}