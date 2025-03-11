// commands/ytaudio.js
import { SlashCommandBuilder } from 'discord.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { execSync } from 'child_process';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to find the absolute path of an executable
function findExecutablePath(name) {
    try {
        // On Windows, we can use the 'where' command to find the full path
        const output = execSync(`where ${name}`).toString().trim().split('\n')[0];
        return output;
    } catch (error) {
        // If 'where' fails, we'll try some common locations
        const commonLocations = [
            // Common Windows locations
            `C:\\Program Files\\${name}\\bin\\${name}.exe`,
            `C:\\Program Files (x86)\\${name}\\bin\\${name}.exe`,
            `C:\\${name}\\bin\\${name}.exe`,
            `C:\\${name}\\${name}.exe`,
            // Node modules locations
            path.join(__dirname, '..', 'node_modules', '.bin', `${name}.exe`),
            // User profile locations
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', name, `${name}.exe`),
            // Current directory
            path.join(__dirname, '..', `${name}.exe`),
            path.join(__dirname, '..', 'bin', `${name}.exe`),
        ];

        for (const location of commonLocations) {
            if (fs.existsSync(location)) {
                return location;
            }
        }

        return null;
    }
}

// Find the absolute paths to ffmpeg, ffprobe, and yt-dlp
let ffmpegPath = findExecutablePath('ffmpeg');
let ffprobePath = findExecutablePath('ffprobe');
let ytDlpPath = findExecutablePath('yt-dlp');

// Log the found paths
//logger.info(`FFmpeg absolute path: ${ffmpegPath || 'Not found'}`);
//logger.info(`FFprobe absolute path: ${ffprobePath || 'Not found'}`);
//logger.info(`yt-dlp absolute path: ${ytDlpPath || 'Not found'}`);

export const data = new SlashCommandBuilder()
    .setName('ytaudio')
    .setDescription('Download audio from a YouTube video as MP3')
    .addStringOption(option => 
        option.setName('url')
            .setDescription('YouTube video URL')
            .setRequired(true))
    .addStringOption(option => 
        option.setName('quality')
            .setDescription('Audio quality')
            .setRequired(false)
            .addChoices(
                { name: 'High (192kbps)', value: '192' },
                { name: 'Medium (128kbps)', value: '128' },
                { name: 'Low (96kbps)', value: '96' }
            ));

// Function to check if a URL is a valid YouTube URL
function isValidYouTubeUrl(url) {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
}

// Function to execute a shell command and return its output
function executeCommand(command, args) {
    return new Promise((resolve, reject) => {
        logger.info(`Executing: ${command} ${args.join(' ')}`);
        const process = spawn(command, args, { shell: true });
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
            logger.debug(`Command stderr: ${data.toString()}`);
        });

        process.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Command failed with code ${code}: ${stderr}`));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

// Function to safely reply to an interaction
async function safeReply(interaction, content, options = {}) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }
        
        if (interaction.replied) {
            await interaction.followUp({
                content,
                ...options
            });
        } else {
            await interaction.editReply({
                content,
                ...options
            });
        }
    } catch (error) {
        logger.error('Error replying to interaction:', error);
    }
}

// A direct way to download audio using ffmpeg
async function downloadAudioDirectly(url, outputPath, quality) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            reject(new Error("FFmpeg not found"));
            return;
        }

        // Build the ffmpeg command
        const args = [
            '-i', url,
            '-vn',                  // No video
            '-acodec', 'libmp3lame',
            '-ab', `${quality}k`,  // Bitrate
            '-ar', '44100',        // Sample rate
            '-y',                  // Overwrite output files
            outputPath
        ];

        logger.info(`Executing direct FFmpeg: ${ffmpegPath} ${args.join(' ')}`);
        
        const process = spawn(ffmpegPath, args, { shell: true });
        
        let stderr = '';
        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        process.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
            } else {
                resolve();
            }
        });
    });
}

export async function execute(interaction) {
    let tempFilePath = null;
    
    try {
        // Defer the reply right away to avoid timing issues
        await interaction.deferReply();

        // First check: Can we run the commands at all?
        if (!ytDlpPath && !ffmpegPath) {
            return interaction.editReply('Error: Neither FFmpeg nor yt-dlp could be found. Please install them and make sure they\'re in your PATH.');
        }

        const url = interaction.options.getString('url');
        const quality = interaction.options.getString('quality') || '128'; // Default to medium quality
        
        // Validate that this is a YouTube URL
        if (!isValidYouTubeUrl(url)) {
            return interaction.editReply('Please provide a valid YouTube URL');
        }

        // Ensure temp directory exists
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const timestamp = Date.now();
        tempFilePath = path.join(tempDir, `ytaudio_${timestamp}.mp3`);
        
        await interaction.editReply('Fetching video information...');
        
        // Get video title
        let title = `YouTube_Audio_${timestamp}`;
        
        if (ytDlpPath) {
            try {
                const titleCommand = await executeCommand(ytDlpPath, [
                    '--skip-download',
                    '--print', 'title',
                    url
                ]);
                
                if (titleCommand && titleCommand.trim()) {
                    title = titleCommand.trim().replace(/[^\w\s]/gi, '_');
                }
            } catch (error) {
                logger.warn(`Couldn't get video title: ${error.message}`);
                // Continue with default title
            }
        }
        
        await interaction.editReply(`Downloading audio for: ${title}...`);
        
        try {
            // Try with yt-dlp first, with explicit ffmpeg path if available
            if (ytDlpPath && ffmpegPath) {
                const ytdlpArgs = [
                    '-f', 'bestaudio',
                    '--extract-audio',
                    '--audio-format', 'mp3',
                    '--audio-quality', quality
                ];
                
                // Only add ffmpeg location if we have a valid path
                if (ffmpegPath) {
                    const ffmpegDir = path.dirname(ffmpegPath);
                    ytdlpArgs.push('--ffmpeg-location', `"${ffmpegDir}"`);
                }
                
                ytdlpArgs.push('-o', tempFilePath, url);
                
                try {
                    await executeCommand(ytDlpPath, ytdlpArgs);
                } catch (ytdlpError) {
                    logger.error(`yt-dlp failed: ${ytdlpError.message}`);
                    
                    // If yt-dlp fails, try direct FFmpeg download
                    if (ffmpegPath) {
                        logger.info("Falling back to direct FFmpeg download");
                        await downloadAudioDirectly(url, tempFilePath, quality);
                    } else {
                        throw ytdlpError; // Re-throw if we can't use FFmpeg
                    }
                }
            } 
            // If no yt-dlp but we have ffmpeg, try direct download
            else if (ffmpegPath) {
                await downloadAudioDirectly(url, tempFilePath, quality);
            }
            else {
                throw new Error("No download method available");
            }
            
            // Check file size
            if (fs.existsSync(tempFilePath)) {
                const stats = fs.statSync(tempFilePath);
                const fileSizeInMB = stats.size / (1024 * 1024);
                
                if (fileSizeInMB > 8) { // Discord's file size limit for regular users
                    await interaction.editReply(
                        `Audio file is too large (${fileSizeInMB.toFixed(2)}MB). Discord limits uploads to 8MB. Try with lower quality or a shorter video.`
                    );
                    
                    // Clean up the file
                    fs.unlinkSync(tempFilePath);
                    tempFilePath = null;
                } else {
                    // Send the file as a reply
                    await interaction.editReply({
                        content: `Audio from: ${title} (${quality}kbps)`,
                        files: [{
                            attachment: tempFilePath,
                            name: `${title}.mp3`
                        }]
                    });
                    
                    // We'll clean up the file after sending in the finally block
                }
            } else {
                throw new Error("Failed to create output file");
            }
            
        } catch (error) {
            logger.error('Error downloading audio:', error);
            
            // Make sure we don't try to reply if the interaction has already been handled
            if (!interaction.replied) {
                await interaction.editReply(
                    `Error downloading from YouTube: ${error.message}\n\n` + 
                    `FFmpeg path: ${ffmpegPath || 'Not found'}\n` +
                    `yt-dlp path: ${ytDlpPath || 'Not found'}`
                );
            }
        }
        
    } catch (error) {
        logger.error('Error in ytaudio command:', error);
        
        // Use the safe reply function to handle all cases
        await safeReply(interaction, 'An error occurred while processing your request');
    } finally {
        // Clean up the temporary file if it exists
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            setTimeout(() => {
                try {
                    fs.unlinkSync(tempFilePath);
                    logger.info(`Deleted temporary file: ${tempFilePath}`);
                } catch (error) {
                    logger.error(`Error deleting temp file: ${error}`);
                }
            }, 5000); // Give it 5 seconds before deleting
        }
    }
}