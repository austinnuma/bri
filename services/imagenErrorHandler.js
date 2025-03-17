import { logger } from '../utils/logger.js';

/**
 * Handles and logs specific Imagen API errors
 * @param {Error} error - The error object
 * @returns {string} - User-friendly error message
 */
export function handleImagenApiError(error) {
  // Extract error message
  let errorMessage = error.message || 'Unknown error';
  let userMessage = 'Sorry, I couldn\'t generate that image. Please try again later.';
  
  try {
    // Check if the error contains JSON response data
    if (errorMessage.includes('{') && errorMessage.includes('}')) {
      const jsonStartIndex = errorMessage.indexOf('{');
      const jsonString = errorMessage.substring(jsonStartIndex);
      const errorData = JSON.parse(jsonString);
      
      // Log the structured error
      logger.error('Structured Imagen API error:', errorData);
      
      // Handle specific error types
      if (errorData.error && errorData.error.message) {
        errorMessage = errorData.error.message;
        
        // Check for content policy violations
        if (errorMessage.includes('safety') || 
            errorMessage.includes('policy') || 
            errorMessage.includes('content')) {
          userMessage = 'Your request couldn\'t be processed due to content safety policies. Please try a different prompt.';
        }
        
        // Check for quota/rate limit issues
        if (errorMessage.includes('quota') || 
            errorMessage.includes('rate') || 
            errorMessage.includes('limit')) {
          userMessage = 'We\'ve reached our image generation limit for now. Please try again later.';
        }
        
        // Check for authentication issues
        if (errorMessage.includes('auth') || 
            errorMessage.includes('permission') || 
            errorMessage.includes('credential')) {
          userMessage = 'There\'s an authentication issue with the image service. Please notify the bot administrator.';
          // Log a more specific message for the admin
          logger.error('Authentication error with Imagen API - check your credentials and permissions');
        }
      }
    }
  } catch (parseError) {
    // If we can't parse the error, just use the original error message
    logger.error('Error parsing Imagen API error:', parseError);
  }
  
  // Log the full error for debugging
  logger.error(`Imagen API error: ${errorMessage}`);
  
  return userMessage;
}

/**
 * Checks if a prompt might violate content policies
 * @param {string} prompt - The user's prompt
 * @returns {boolean} - Whether the prompt might be problematic
 */
export function preCheckPrompt(prompt) {
  if (!prompt) return false;
  
  // List of potentially problematic terms (this is a very basic check)
  const sensitiveTerms = [
    'nude', 'naked', 'pornographic', 'sexual', 'violence', 'gore', 'blood',
    'terrorist', 'weapon', 'bomb', 'kill', 'dead', 'death', 'murder'
  ];
  
  const lowercasePrompt = prompt.toLowerCase();
  
  // Check if any sensitive terms are in the prompt
  return sensitiveTerms.some(term => lowercasePrompt.includes(term));
}