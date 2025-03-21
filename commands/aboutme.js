// commands/aboutMe.js
import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { openai } from '../services/combinedServices.js';
import { getUserCharacterSheet, updateUserCharacterSheet } from '../utils/userCharacterSheet.js';
import { isFeatureEnabled } from '../utils/serverConfigManager.js';

export const data = new SlashCommandBuilder()
    .setName('about-me')
    .setDescription('Share information about yourself to help Bri get to know you better')
    .addStringOption(option => 
        option.setName('information')
            .setDescription('Share details about yourself (name, age, location, job, pets, family, hobbies, etc.)')
            .setRequired(true));

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

        // Get the user input
        const userInfo = interaction.options.getString('information');
        
        // Let user know we're processing
        await interaction.deferReply({ ephemeral: true });
        
        // Get the current character sheet
        const currentSheet = await getUserCharacterSheet(
            interaction.user.id, 
            interaction.guildId
        );
        
        // Process the information using AI to extract structured data
        const updatedSheet = await extractUserInfo(userInfo, currentSheet);
        
        // Save the updated sheet
        await updateUserCharacterSheet(
            interaction.user.id,
            interaction.guildId,
            updatedSheet
        );
        
        // Generate a summary of what was understood/saved
        const summary = generateInfoSummary(currentSheet, updatedSheet);
        
        // Reply to the user with a confirmation and summary
        await interaction.editReply({ 
            content: `Thanks for sharing! I've updated what I know about you.\n\n${summary}\n\nThis information will help me provide more personalized responses!`,
            ephemeral: true
        });
        
    } catch (error) {
        logger.error("Error in about-me command:", error);
        
        // Check if the interaction has already been deferred
        if (interaction.deferred) {
            await interaction.editReply({ 
                content: "Sorry, there was an error processing your information. Please try again later.",
                ephemeral: true 
            });
        } else {
            await interaction.reply({ 
                content: "Sorry, there was an error processing your information. Please try again later.",
                ephemeral: true 
            });
        }
    }
}

/**
 * Uses AI to extract structured information from user input
 * @param {string} userInfo - The user-provided text information
 * @param {Object} currentSheet - The current character sheet
 * @returns {Promise<Object>} - Updated character sheet
 */
async function extractUserInfo(userInfo, currentSheet) {
    // Prepare the current sheet as JSON
    const currentSheetJson = JSON.stringify(currentSheet, null, 2);
    
    // Create the prompt for the AI
    const prompt = `
Extract personal information from the following user input to update their profile. 
Keep existing information unless new information clearly supersedes it.

CURRENT PROFILE:
${currentSheetJson}

USER INPUT:
"${userInfo}"

Extract the following information if present:
- Name, nickname
- Age
- Location
- Occupation/job details
- Education details
- Family members
- Pets
- Hobbies and interests
- Likes and dislikes

Return a valid JSON object that follows the EXACT same structure as the current profile. 
Include ALL fields from the original, updating only the relevant ones based on the user input.
DO NOT add or remove fields from the structure.
`;

    // Call the AI to extract the information
    const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            {
                role: "system",
                content: "You are an expert at extracting structured personal information from text. You always respond with valid JSON."
            },
            { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 2000,
    });
    
    // Parse the updated sheet
    try {
        const updatedSheet = JSON.parse(completion.choices[0].message.content);
        return updatedSheet;
    } catch (error) {
        logger.error("Error parsing AI response for user info extraction:", error);
        // If parsing fails, return the original sheet
        return currentSheet;
    }
}

/**
 * Generates a human-readable summary of what information was updated
 * @param {Object} oldSheet - The previous character sheet
 * @param {Object} newSheet - The updated character sheet
 * @returns {string} - Summary of changes
 */
function generateInfoSummary(oldSheet, newSheet) {
    let changes = [];
    
    // Check personal info
    if (newSheet.name && newSheet.name !== oldSheet.name) {
        changes.push(`• Your name: ${newSheet.name}`);
    }
    
    if (newSheet.nickname && newSheet.nickname !== oldSheet.nickname) {
        changes.push(`• You go by: ${newSheet.nickname}`);
    }
    
    if (newSheet.age && newSheet.age !== oldSheet.age) {
        changes.push(`• Age: ${newSheet.age}`);
    }
    
    if (newSheet.location && newSheet.location !== oldSheet.location) {
        changes.push(`• Location: ${newSheet.location}`);
    }
    
    // Check occupation
    if (newSheet.occupation && newSheet.occupation.job && 
        (!oldSheet.occupation || newSheet.occupation.job !== oldSheet.occupation.job)) {
        let jobInfo = `• Job: ${newSheet.occupation.job}`;
        if (newSheet.occupation.company) {
            jobInfo += ` at ${newSheet.occupation.company}`;
        }
        changes.push(jobInfo);
    }
    
    // Check education
    if (newSheet.education && newSheet.education.level && 
        (!oldSheet.education || newSheet.education.level !== oldSheet.education.level)) {
        let eduInfo = `• Education: ${newSheet.education.level}`;
        if (newSheet.education.field) {
            eduInfo += ` in ${newSheet.education.field}`;
        }
        changes.push(eduInfo);
    }
    
    // Check family
    if (newSheet.family && newSheet.family.length > 0) {
        // Only show new or changed family members
        const newFamilyMembers = newSheet.family.filter(newMember => {
            return !oldSheet.family.some(oldMember => 
                oldMember.name === newMember.name && oldMember.relation === newMember.relation
            );
        });
        
        if (newFamilyMembers.length > 0) {
            const familyInfo = newFamilyMembers.map(f => `${f.name} (${f.relation})`).join(", ");
            changes.push(`• Family: ${familyInfo}`);
        }
    }
    
    // Check pets
    if (newSheet.pets && newSheet.pets.length > 0) {
        // Only show new or changed pets
        const newPets = newSheet.pets.filter(newPet => {
            return !oldSheet.pets.some(oldPet => 
                oldPet.name === newPet.name && oldPet.type === newPet.type
            );
        });
        
        if (newPets.length > 0) {
            const petsInfo = newPets.map(p => `${p.name} (${p.type})`).join(", ");
            changes.push(`• Pets: ${petsInfo}`);
        }
    }
    
    // Check preferences
    if (newSheet.top_preferences && newSheet.top_preferences.length > 0) {
        // Only show new preferences
        const newPreferences = newSheet.top_preferences.filter(newPref => {
            return !oldSheet.top_preferences.some(oldPref => 
                oldPref.item === newPref.item && oldPref.sentiment === newPref.sentiment
            );
        });
        
        if (newPreferences.length > 0) {
            const likesInfo = newPreferences
                .filter(p => p.sentiment === "positive")
                .map(p => p.item)
                .join(", ");
                
            const dislikesInfo = newPreferences
                .filter(p => p.sentiment === "negative")
                .map(p => p.item)
                .join(", ");
                
            if (likesInfo) changes.push(`• Things you like: ${likesInfo}`);
            if (dislikesInfo) changes.push(`• Things you dislike: ${dislikesInfo}`);
        }
    }
    
    // If no specific changes were detected
    if (changes.length === 0) {
        return "I've noted your information, though I didn't detect any specific new details.";
    }
    
    return "Here's what I learned about you:\n" + changes.join("\n");
}