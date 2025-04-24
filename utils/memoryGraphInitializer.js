// memoryGraphInitializer.js - Initializes and integrates memory graph and temporal systems
import { logger } from './logger.js';
import { initializeMemoryGraphSystem, scheduleMemoryGraphBuilding } from './memoryGraphManager.js';
import { initializeTemporalMemorySystem, scheduleTemporalAnalysis } from './temporalMemoryUnderstanding.js';

// Track initialization status to prevent multiple initializations
let memoryEnhancementsInitialized = false;

/**
 * Initializes all memory enhancement systems
 * @param {Object} client - Discord client (optional)
 */
export async function initializeMemoryEnhancements(client = null) {
  try {
    // Check if already initialized to prevent duplicate initializations
    if (memoryEnhancementsInitialized) {
      logger.info("Memory enhancement systems already initialized, skipping...");
      return true;
    }
    
    logger.info("Initializing memory enhancement systems...");
    
    // Step 1: Initialize memory graph system
    await initializeMemoryGraphSystem();
    
    // Step 2: Initialize temporal memory system
    await initializeTemporalMemorySystem();
    
    // Step 3: Schedule maintenance tasks
    scheduleMemoryGraphBuilding(24); // Run once a day
    scheduleTemporalAnalysis(12);    // Run twice a day
    
    // Mark as initialized
    memoryEnhancementsInitialized = true;
    
    logger.info("Memory enhancement systems initialized successfully");
    
    return true;
  } catch (error) {
    logger.error("Error initializing memory enhancement systems:", error);
    return false;
  }
}

/**
 * Integrates memory enhancements with the unified memory system
 * Call this function from your main startup script after other initializations.
 * @param {Object} client - Discord client object
 */
export function integrateMemoryEnhancements(client) {
  // Initialize the enhanced memory systems
  initializeMemoryEnhancements(client).then(success => {
    if (success) {
      if (!memoryEnhancementsInitialized) {
        logger.warn("Memory enhancements integration flag not set properly");
      }
    } else {
      logger.warn("Memory enhancements integrated with errors");
    }
  });
}

// Export the original methods from the enhancement modules
export { 
  buildMemoryGraph, 
  traverseMemoryGraph,
  formatMemoryPathsForPrompt
} from './memoryGraphManager.js';

export {
  analyzeTemporalAspects,
  batchProcessTemporalAnalysis,
  findTemporalContradictions,
  categorizeMemoryTimePeriod,
  TIME_PERIODS
} from './temporalMemoryUnderstanding.js';

export {
  retrieveMemoriesWithGraphAndTemporal,
  contextAwareMemoryRetrievalWithEnhancements,
  identifyMemoryContext,
  enhancePromptWithMemoryContext
} from './enhancedGraphMemoryRetrieval.js';