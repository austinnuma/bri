// rateLimiter.js - Server-based rate limiting for API operations
import { logger } from './logger.js';

// Default rate limits
const DEFAULT_LIMITS = {
  MESSAGES: {
    points: 10,       // Number of messages
    window: 60 * 1000 // Per minute
  },
  IMAGE_GENERATION: {
    points: 5,        // Number of images
    window: 5 * 60 * 1000 // Per 5 minutes
  },
  MEMORY_OPERATIONS: {
    points: 30,       // Number of operations
    window: 60 * 1000 // Per minute
  },
  VECTOR_SEARCH: {
    points: 20,       // Number of searches
    window: 60 * 1000 // Per minute
  }
};

// Store rate limit data
class RateLimiter {
  constructor() {
    // Main storage - Map of serverIds to operation types to timestamps
    this.limits = new Map();
    
    // Default limits for different operation types
    this.defaultLimits = DEFAULT_LIMITS;
    
    // Custom limits by server
    this.customLimits = new Map();
    
    // Initialize cleanup interval (every minute)
    setInterval(() => this.cleanup(), 60 * 1000);
  }
  
  /**
   * Set custom rate limits for a server
   * @param {string} serverId - Server/guild ID
   * @param {string} operation - Operation type
   * @param {Object} limits - Custom limits {points, window}
   */
  setCustomLimits(serverId, operation, limits) {
    if (!this.customLimits.has(serverId)) {
      this.customLimits.set(serverId, new Map());
    }
    
    this.customLimits.get(serverId).set(operation, limits);
  }
  
  /**
   * Get limits for a server and operation
   * @param {string} serverId - Server/guild ID
   * @param {string} operation - Operation type
   * @returns {Object} - Limits {points, window}
   */
  getLimits(serverId, operation) {
    // Check for custom limits
    if (this.customLimits.has(serverId) && 
        this.customLimits.get(serverId).has(operation)) {
      return this.customLimits.get(serverId).get(operation);
    }
    
    // Otherwise use default
    return this.defaultLimits[operation] || this.defaultLimits.MESSAGES;
  }
  
  /**
   * Check if operation would exceed rate limit
   * @param {string} serverId - Server/guild ID
   * @param {string} operation - Operation type (MESSAGES, IMAGE_GENERATION, etc.)
   * @param {number} cost - Cost of the operation (default 1)
   * @returns {Object} - {limited: boolean, resetTime: number, current: number, max: number}
   */
  checkLimit(serverId, operation, cost = 1) {
    const now = Date.now();
    const limits = this.getLimits(serverId, operation);
    
    // Initialize server if not exists
    if (!this.limits.has(serverId)) {
      this.limits.set(serverId, new Map());
    }
    
    // Initialize operation if not exists
    const serverLimits = this.limits.get(serverId);
    if (!serverLimits.has(operation)) {
      serverLimits.set(operation, []);
    }
    
    // Get timestamps for this operation
    const timestamps = serverLimits.get(operation);
    
    // Filter out old timestamps
    const validTimestamps = timestamps.filter(
      ts => now - ts < limits.window
    );
    
    // Update timestamps
    serverLimits.set(operation, validTimestamps);
    
    // Check if operation would exceed limit
    const currentPoints = validTimestamps.length;
    const wouldExceed = currentPoints + cost > limits.points;
    
    // Calculate reset time
    let resetTime = now;
    if (validTimestamps.length > 0) {
      // Oldest timestamp + window is when the first point expires
      resetTime = validTimestamps[0] + limits.window;
    }
    
    return {
      limited: wouldExceed,
      resetTime,
      resetInMs: resetTime - now,
      current: currentPoints,
      max: limits.points,
      remaining: limits.points - currentPoints
    };
  }
  
  /**
   * Record usage of an operation
   * @param {string} serverId - Server/guild ID
   * @param {string} operation - Operation type
   * @param {number} cost - Cost of the operation
   * @returns {boolean} - Whether operation was allowed
   */
  recordUsage(serverId, operation, cost = 1) {
    const { limited } = this.checkLimit(serverId, operation, cost);
    
    if (limited) {
      return false;
    }
    
    // Add timestamps (one per cost point)
    const now = Date.now();
    const timestamps = this.limits.get(serverId).get(operation);
    
    for (let i = 0; i < cost; i++) {
      timestamps.push(now);
    }
    
    return true;
  }
  
  /**
   * Clean up old timestamps
   */
  cleanup() {
    const now = Date.now();
    
    // Iterate through servers
    for (const [serverId, operations] of this.limits.entries()) {
      let isEmpty = true;
      
      // Iterate through operations
      for (const [operation, timestamps] of operations.entries()) {
        const limits = this.getLimits(serverId, operation);
        
        // Filter old timestamps
        const validTimestamps = timestamps.filter(
          ts => now - ts < limits.window
        );
        
        if (validTimestamps.length > 0) {
          isEmpty = false;
          operations.set(operation, validTimestamps);
        } else {
          operations.delete(operation);
        }
      }
      
      // If no operations left, remove server
      if (isEmpty) {
        this.limits.delete(serverId);
      }
    }
  }
  
  /**
   * Get rate limit status for a server
   * @param {string} serverId - Server/guild ID
   * @returns {Object} - Rate limit status by operation
   */
  getStatus(serverId) {
    if (!this.limits.has(serverId)) {
      return {};
    }
    
    const result = {};
    const operations = this.limits.get(serverId);
    
    for (const [operation, timestamps] of operations.entries()) {
      const limits = this.getLimits(serverId, operation);
      
      result[operation] = {
        current: timestamps.length,
        max: limits.points,
        remaining: limits.points - timestamps.length,
        resetInMs: timestamps.length > 0 
          ? (timestamps[0] + limits.window) - Date.now()
          : 0
      };
    }
    
    return result;
  }
}

// Create singleton instance
const limiter = new RateLimiter();

/**
 * Check if an operation would exceed rate limit
 * @param {string} serverId - Server/guild ID
 * @param {string} operation - Operation type
 * @param {number} cost - Cost of the operation
 * @returns {Object} - Rate limit info
 */
export function checkRateLimit(serverId, operation, cost = 1) {
  return limiter.checkLimit(serverId, operation, cost);
}

/**
 * Try to perform an operation, respecting rate limits
 * @param {string} serverId - Server/guild ID
 * @param {string} operation - Operation type
 * @param {number} cost - Cost of the operation
 * @returns {boolean} - Whether operation was allowed
 */
export function consumeRateLimit(serverId, operation, cost = 1) {
  const allowed = limiter.recordUsage(serverId, operation, cost);
  
  if (!allowed) {
    logger.warn(`Rate limit exceeded for ${operation} in server ${serverId}`);
  }
  
  return allowed;
}

/**
 * Set custom rate limits for a server
 * @param {string} serverId - Server/guild ID
 * @param {string} operation - Operation type
 * @param {Object} limits - Custom limits {points, window}
 */
export function setCustomRateLimit(serverId, operation, limits) {
  limiter.setCustomLimits(serverId, operation, limits);
}

/**
 * Get rate limit status for a server
 * @param {string} serverId - Server/guild ID
 * @returns {Object} - Rate limit status
 */
export function getRateLimitStatus(serverId) {
  return limiter.getStatus(serverId);
}

// Export operation types for convenience
export const RATE_LIMIT_OPERATIONS = {
  MESSAGES: 'MESSAGES',
  IMAGE_GENERATION: 'IMAGE_GENERATION',
  MEMORY_OPERATIONS: 'MEMORY_OPERATIONS',
  VECTOR_SEARCH: 'VECTOR_SEARCH'
};