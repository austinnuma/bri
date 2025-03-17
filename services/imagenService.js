import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration for the Imagen API
const API_KEY = process.env.GEMINI_API_KEY; // Using GEMINI_API_KEY as you mentioned
const API_ENDPOINT = 'https://us-central1-aiplatform.googleapis.com/v1/projects/bri----1741551454345/locations/us-central1/publishers/google/models/imagen-3.0-fast-generate-001:predict';

/**
 * Gets an authentication token using gcloud CLI
 * @returns {Promise<string>} - Bearer token for API requests
 */
async function getAuthToken() {
  try {
    const { stdout, stderr } = await execAsync('gcloud auth print-access-token');
    if (stderr) {
      logger.error(`Error getting gcloud token: ${stderr}`);
      throw new Error('Failed to get authentication token');
    }
    return stdout.trim();
  } catch (error) {
    logger.error('Error executing gcloud command:', error);
    // Fall back to API key if gcloud command fails
    logger.info('Falling back to API key authentication');
    return null;
  }
}

/**
 * Generate an image from a text prompt using Google's Imagen
 * @param {string} prompt - The text description of the image to generate
 * @param {number} sampleCount - Number of images to generate (default: 1)
 * @param {string} safetyLevel - Safety filtering level (default: block_medium_and_above)
 * @returns {Promise<Buffer>} - A Promise resolving to the image binary data
 */
export async function generateImageFromPrompt(prompt, sampleCount = 1, safetyLevel = 'block_medium_and_above') {
  try {
    // Construct the request payload according to Imagen documentation
    const payload = {
      "instances": [
        {
          "prompt": prompt
        }
      ],
      "parameters": {
        "sampleCount": sampleCount
      }
    };
    // Add safety settings if provided
    if (safetyLevel) {
      payload.parameters.safetySetting = safetyLevel;
    }

    // Get auth token from gcloud if possible
    const authToken = await getAuthToken();
    
    // Set up headers
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Use bearer token if available, otherwise use API key in URL
    let requestUrl = API_ENDPOINT;
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    } else if (API_KEY) {
      requestUrl = `${API_ENDPOINT}?key=${API_KEY}`;
    } else {
      throw new Error('No authentication method available');
    }

    // Log the request (remove in production)
    logger.info(`Sending request to Imagen API: ${JSON.stringify(payload)}`);

    // Make the API request
    const response = await fetch(
      requestUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }
    );

    // Check if the request was successful
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Image generation API error (${response.status}): ${errorText}`);
      throw new Error(`API responded with status ${response.status}: ${errorText}`);
    }

    // Parse the response
    const data = await response.json();
    
    // Log the response structure to help debug (remove in production)
    logger.info(`Response structure: ${JSON.stringify(Object.keys(data))}`);
    
    // Check if we have predictions in the response
    if (!data.predictions || data.predictions.length === 0) {
      throw new Error('No images were returned from the API');
    }

    // Log how many images we received
    logger.info(`Received ${data.predictions.length} images from Imagen API`);
    
    // Extract all images and convert to buffers
    const imageBuffers = [];
    
    for (let i = 0; i < data.predictions.length; i++) {
      const prediction = data.predictions[i];
      const base64Data = prediction.bytesBase64Encoded;
      
      if (!base64Data) {
        logger.warn(`Image ${i} missing base64 data`);
        continue;
      }
      
      // Convert base64 to buffer and add to array
      imageBuffers.push(Buffer.from(base64Data, 'base64'));
    }
    
    if (imageBuffers.length === 0) {
      throw new Error('No valid images were found in the response');
    }
    
    // Return array of image buffers
    return imageBuffers;
  } catch (error) {
    logger.error('Error generating image:', error);
    throw error;
  }
}

/**
 * Adds the generateImageFromPrompt function to the combined services
 * (Add this to your combinedServices.js file)
 */
export function addImagenToServices() {
  return {
    generateImageFromPrompt
  };
}