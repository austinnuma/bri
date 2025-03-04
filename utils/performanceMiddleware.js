// performanceMiddleware.js - Logging, metrics, and performance tracking
import { logger } from './logger.js';
import os from 'os';
import v8 from 'v8';

// Track running operations
const runningOperations = new Map();

// Performance metrics
const metrics = {
  apiCalls: {
    openai: { count: 0, totalTime: 0, errors: 0 },
    gemini: { count: 0, totalTime: 0, errors: 0 },
    supabase: { count: 0, totalTime: 0, errors: 0 }
  },
  messageProcessing: {
    count: 0,
    totalTime: 0,
    byType: {
      text: { count: 0, totalTime: 0 },
      image: { count: 0, totalTime: 0 },
      voice: { count: 0, totalTime: 0 }
    }
  },
  memoryOperations: {
    queries: { count: 0, totalTime: 0 },
    creations: { count: 0, totalTime: 0 },
    updates: { count: 0, totalTime: 0 }
  },
  embeddings: {
    count: 0,
    totalTime: 0,
    cached: 0,
    batched: 0
  },
  commandsProcessed: {
    total: 0,
    byCommand: {}
  }
};

// Performance history for trending
const metricsHistory = [];
const HISTORY_POINTS = 30; // Keep 30 data points

/**
 * Track the start of an operation
 * @param {string} type - Operation type
 * @param {string} name - Operation name
 * @param {object} details - Operation details
 * @returns {string} - Operation ID
 */
export function trackOperationStart(type, name, details = {}) {
  const opId = `${type}_${name}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  
  runningOperations.set(opId, {
    type,
    name,
    details,
    startTime: Date.now(),
    endTime: null,
    duration: null
  });
  
  return opId;
}

/**
 * Track the end of an operation
 * @param {string} opId - Operation ID
 * @param {boolean} isError - Whether operation ended with error
 * @param {object} result - Operation result details
 */
export function trackOperationEnd(opId, isError = false, result = {}) {
  if (!runningOperations.has(opId)) return;
  
  const operation = runningOperations.get(opId);
  operation.endTime = Date.now();
  operation.duration = operation.endTime - operation.startTime;
  operation.isError = isError;
  operation.result = result;
  
  // Update metrics based on operation type
  updateMetrics(operation);
  
  // Clean up after some time to avoid memory leaks
  setTimeout(() => {
    runningOperations.delete(opId);
  }, 60000); // Keep for 1 minute for debugging
  
  return operation.duration;
}

/**
 * Update metrics based on completed operation
 * @param {object} operation - Completed operation
 */
function updateMetrics(operation) {
  const { type, name, duration, isError } = operation;
  
  // Update based on operation type
  switch (type) {
    case 'api':
      if (name.startsWith('openai')) {
        metrics.apiCalls.openai.count++;
        metrics.apiCalls.openai.totalTime += duration;
        if (isError) metrics.apiCalls.openai.errors++;
      } else if (name.startsWith('gemini')) {
        metrics.apiCalls.gemini.count++;
        metrics.apiCalls.gemini.totalTime += duration;
        if (isError) metrics.apiCalls.gemini.errors++;
      } else if (name.startsWith('supabase')) {
        metrics.apiCalls.supabase.count++;
        metrics.apiCalls.supabase.totalTime += duration;
        if (isError) metrics.apiCalls.supabase.errors++;
      }
      break;
      
    case 'message':
      metrics.messageProcessing.count++;
      metrics.messageProcessing.totalTime += duration;
      
      if (name === 'text') {
        metrics.messageProcessing.byType.text.count++;
        metrics.messageProcessing.byType.text.totalTime += duration;
      } else if (name === 'image') {
        metrics.messageProcessing.byType.image.count++;
        metrics.messageProcessing.byType.image.totalTime += duration;
      } else if (name === 'voice') {
        metrics.messageProcessing.byType.voice.count++;
        metrics.messageProcessing.byType.voice.totalTime += duration;
      }
      break;
      
    case 'memory':
      if (name === 'query') {
        metrics.memoryOperations.queries.count++;
        metrics.memoryOperations.queries.totalTime += duration;
      } else if (name === 'create') {
        metrics.memoryOperations.creations.count++;
        metrics.memoryOperations.creations.totalTime += duration;
      } else if (name === 'update') {
        metrics.memoryOperations.updates.count++;
        metrics.memoryOperations.updates.totalTime += duration;
      }
      break;
      
    case 'embedding':
      metrics.embeddings.count++;
      metrics.embeddings.totalTime += duration;
      
      if (operation.details.cached) {
        metrics.embeddings.cached++;
      }
      
      if (operation.details.batched) {
        metrics.embeddings.batched++;
      }
      break;
      
    case 'command':
      metrics.commandsProcessed.total++;
      
      if (!metrics.commandsProcessed.byCommand[name]) {
        metrics.commandsProcessed.byCommand[name] = 0;
      }
      metrics.commandsProcessed.byCommand[name]++;
      break;
  }
  
  // Every 5 minutes, record metrics for trending
  const now = Date.now();
  if (!metrics.lastRecorded || now - metrics.lastRecorded > 5 * 60 * 1000) {
    recordMetricsSnapshot();
    metrics.lastRecorded = now;
  }
}

/**
 * Record a snapshot of current metrics for trending
 */
function recordMetricsSnapshot() {
  // Calculate system metrics
  const systemInfo = getSystemMetrics();
  
  // Create a deep copy of current metrics
  const snapshot = {
    timestamp: Date.now(),
    metrics: JSON.parse(JSON.stringify(metrics)),
    system: systemInfo
  };
  
  // Add to history
  metricsHistory.push(snapshot);
  
  // Keep history size manageable
  if (metricsHistory.length > HISTORY_POINTS) {
    metricsHistory.shift();
  }
}

/**
 * Get system metrics (memory, CPU, etc.)
 * @returns {object} - System metrics
 */
function getSystemMetrics() {
  // Basic system metrics
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  // V8 heap statistics
  const heapStats = v8.getHeapStatistics();
  
  return {
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usedPercent: (usedMem / totalMem * 100).toFixed(2)
    },
    heap: {
      total: heapStats.total_heap_size,
      used: heapStats.used_heap_size,
      limit: heapStats.heap_size_limit,
      usedPercent: (heapStats.used_heap_size / heapStats.total_heap_size * 100).toFixed(2)
    },
    uptime: process.uptime(),
    cpuUsage: process.cpuUsage()
  };
}

/**
 * Creates a timing middleware function for wrapping APIs
 * @param {string} apiName - Name of the API
 * @returns {Function} - Middleware function
 */
export function createTimingMiddleware(apiName) {
  return async (req, res, next) => {
    const opId = trackOperationStart('api', `${apiName}_${req.method || 'call'}`);
    
    // Track original methods
    const originalEnd = res.end;
    const originalJson = res.json;
    
    // Override end
    res.end = function(...args) {
      trackOperationEnd(opId, res.statusCode >= 400);
      return originalEnd.apply(this, args);
    };
    
    // Override json
    res.json = function(...args) {
      trackOperationEnd(opId, res.statusCode >= 400);
      return originalJson.apply(this, args);
    };
    
    next();
  };
}

/**
 * Creates an API wrapper that tracks timing
 * @param {Function} fn - API function to wrap
 * @param {string} apiName - Name of the API
 * @param {string} methodName - Name of the method
 * @returns {Function} - Wrapped function
 */
export function createApiWrapper(fn, apiName, methodName) {
  return async function(...args) {
    const opId = trackOperationStart('api', `${apiName}_${methodName}`);
    
    try {
      const result = await fn.apply(this, args);
      trackOperationEnd(opId, false);
      return result;
    } catch (error) {
      trackOperationEnd(opId, true);
      throw error;
    }
  };
}

/**
 * Get current performance metrics
 * @returns {object} - Current metrics
 */
export function getPerformanceMetrics() {
  // Calculate averages for more readable metrics
  const enriched = JSON.parse(JSON.stringify(metrics));
  
  // Calculate API call averages
  for (const api of Object.keys(enriched.apiCalls)) {
    const apiData = enriched.apiCalls[api];
    apiData.avgTime = apiData.count > 0 ? apiData.totalTime / apiData.count : 0;
    apiData.errorRate = apiData.count > 0 ? (apiData.errors / apiData.count * 100).toFixed(2) + '%' : '0%';
  }
  
  // Calculate message processing averages
  enriched.messageProcessing.avgTime = 
    enriched.messageProcessing.count > 0 ? 
    enriched.messageProcessing.totalTime / enriched.messageProcessing.count : 0;
    
  for (const type of Object.keys(enriched.messageProcessing.byType)) {
    const typeData = enriched.messageProcessing.byType[type];
    typeData.avgTime = typeData.count > 0 ? typeData.totalTime / typeData.count : 0;
  }
  
  // Calculate memory operation averages
  for (const op of Object.keys(enriched.memoryOperations)) {
    const opData = enriched.memoryOperations[op];
    opData.avgTime = opData.count > 0 ? opData.totalTime / opData.count : 0;
  }
  
  // Calculate embedding averages
  enriched.embeddings.avgTime = 
    enriched.embeddings.count > 0 ? 
    enriched.embeddings.totalTime / enriched.embeddings.count : 0;
  enriched.embeddings.cacheHitRate = 
    enriched.embeddings.count > 0 ? 
    (enriched.embeddings.cached / enriched.embeddings.count * 100).toFixed(2) + '%' : '0%';
  enriched.embeddings.batchRate = 
    enriched.embeddings.count > 0 ? 
    (enriched.embeddings.batched / enriched.embeddings.count * 100).toFixed(2) + '%' : '0%';
  
  // Add system metrics
  enriched.system = getSystemMetrics();
  
  // Include current number of running operations
  enriched.currentOperations = runningOperations.size;
  
  return enriched;
}

/**
 * Get historical performance metrics for trends
 * @param {number} points - Number of history points to return
 * @returns {Array} - Historical metrics
 */
export function getPerformanceTrends(points = 10) {
  const count = Math.min(points, metricsHistory.length);
  return metricsHistory.slice(-count);
}

/**
 * Instrument an existing function to track performance
 * @param {Function} originalFn - Function to instrument
 * @param {string} type - Operation type
 * @param {string} name - Operation name
 * @returns {Function} - Instrumented function
 */
export function instrumentFunction(originalFn, type, name) {
  return async function(...args) {
    const opId = trackOperationStart(type, name, { args: args.length });
    
    try {
      const result = await originalFn.apply(this, args);
      trackOperationEnd(opId, false);
      return result;
    } catch (error) {
      trackOperationEnd(opId, true);
      throw error;
    }
  };
}