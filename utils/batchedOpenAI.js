// batchedOpenAI.js - Batched OpenAI API service
import { openai } from '../services/openaiService.js';
import { logger } from './logger.js';

// Batch queue configuration
const BATCH_DELAY = 100; // milliseconds to wait for batching
const MAX_BATCH_SIZE = 20; // maximum items per batch
const MAX_TOKENS_PER_BATCH = 8000; // max tokens for chat completions

// Queues for different API operations
const queues = {
  chatCompletions: [],
  embeddings: []
};

// Timers for processing queues
const timers = {
  chatCompletions: null,
  embeddings: null
};

// Processing state
const processing = {
  chatCompletions: false,
  embeddings: false
};

/**
 * Batched version of openai.chat.completions.create
 * @param {Object} params - Parameters for the completion
 * @returns {Promise<Object>} - The completion response
 */
export async function createChatCompletion(params) {
  // Don't batch if it's a streaming request
  if (params.stream) {
    return openai.chat.completions.create(params);
  }
  
  // For system-critical or certain model types, don't batch
  if (params.skipBatching || params.model.includes('gpt-4-vision') || params.model.includes('gpt-4-1106-vision')) {
    return openai.chat.completions.create(params);
  }
  
  // Create a promise that will be resolved when the batch is processed
  return new Promise((resolve, reject) => {
    // Add to queue
    queues.chatCompletions.push({
      params,
      resolve,
      reject,
      enqueueTime: Date.now()
    });
    
    // If no timer is active, start one
    if (!timers.chatCompletions) {
      timers.chatCompletions = setTimeout(() => processCompletionQueue(), BATCH_DELAY);
    }
  });
}

/**
 * Process the queued chat completion requests
 */
async function processCompletionQueue() {
  // Clear timer
  timers.chatCompletions = null;
  
  // If already processing or queue is empty, exit
  if (processing.chatCompletions || queues.chatCompletions.length === 0) {
    return;
  }
  
  // Mark as processing
  processing.chatCompletions = true;
  
  try {
    // Group requests by model
    const groupedByModel = {};
    
    // Move items from queue to grouped lists
    while (queues.chatCompletions.length > 0) {
      const request = queues.chatCompletions.shift();
      const model = request.params.model;
      
      if (!groupedByModel[model]) {
        groupedByModel[model] = [];
      }
      
      groupedByModel[model].push(request);
    }
    
    // Process each model group
    for (const [model, requests] of Object.entries(groupedByModel)) {
      // Further group by compatibility for batching
      const batchGroups = groupRequestsForBatching(requests);
      
      // Process each batch group
      for (const batch of batchGroups) {
        try {
          // If batch has only one item, process directly
          if (batch.length === 1) {
            const request = batch[0];
            const response = await openai.chat.completions.create(request.params);
            request.resolve(response);
            continue;
          }
          
          // Create batch request
          const batchedMessages = batch.map(request => ({
            role: "user",
            content: `Request ID: ${request.id}\n${JSON.stringify(request.params.messages)}`
          }));
          
          // Calculate max tokens for the batch
          const maxTokens = Math.max(...batch.map(request => request.params.max_tokens || 1500));
          
          // Make batched API call
          const batchResponse = await openai.chat.completions.create({
            model,
            messages: [{
              role: "system",
              content: "You are processing multiple requests. Respond to each request separately."
            }, ...batchedMessages],
            max_tokens: maxTokens,
          });
          
          // Parse and distribute responses
          const content = batchResponse.choices[0].message.content;
          const responseSegments = content.split(/Request ID: [a-zA-Z0-9]+/);
          
          // Skip the first segment (usually empty)
          for (let i = 1; i < responseSegments.length; i++) {
            // Format as a completion response
            const individualResponse = {
              choices: [{
                message: {
                  role: "assistant",
                  content: responseSegments[i].trim()
                }
              }],
              model: batchResponse.model,
              usage: {
                // Estimate usage proportionally
                prompt_tokens: Math.round(batchResponse.usage.prompt_tokens / batch.length),
                completion_tokens: Math.round(batchResponse.usage.completion_tokens / batch.length),
                total_tokens: Math.round(batchResponse.usage.total_tokens / batch.length)
              }
            };
            
            batch[i-1].resolve(individualResponse);
          }
        } catch (error) {
          // Reject all requests in the batch
          for (const request of batch) {
            request.reject(error);
          }
        }
      }
    }
  } catch (error) {
    logger.error("Error processing chat completion batch:", error);
    
    // Reject all remaining requests in the queue
    for (const request of queues.chatCompletions) {
      request.reject(error);
    }
    queues.chatCompletions = [];
  } finally {
    // Mark as no longer processing
    processing.chatCompletions = false;
    
    // If more items were added during processing, schedule another run
    if (queues.chatCompletions.length > 0) {
      timers.chatCompletions = setTimeout(() => processCompletionQueue(), BATCH_DELAY);
    }
  }
}

/**
 * Group requests based on compatibility for batching
 * @param {Array} requests - List of requests
 * @returns {Array} - Array of batches
 */
function groupRequestsForBatching(requests) {
  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;
  
  for (const request of requests) {
    // Skip requests that are too large for batching
    if (estimateTokens(request.params) > MAX_TOKENS_PER_BATCH / 2) {
      batches.push([request]);
      continue;
    }
    
    // If adding this request exceeds batch limits, start a new batch
    if (currentBatch.length >= MAX_BATCH_SIZE || 
        currentTokens + estimateTokens(request.params) > MAX_TOKENS_PER_BATCH) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }
    
    // Add ID to request for tracking
    request.id = Math.random().toString(36).substring(2, 10);
    
    // Add to current batch
    currentBatch.push(request);
    currentTokens += estimateTokens(request.params);
  }
  
  // Add final batch if not empty
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  
  return batches;
}

/**
 * Estimate tokens for a completion request
 * @param {Object} params - Completion parameters
 * @returns {number} - Estimated token count
 */
function estimateTokens(params) {
  // Simple estimation: 4 characters ~= 1 token
  let total = 0;
  for (const message of params.messages) {
    total += message.content.length / 4;
  }
  return Math.ceil(total);
}

/**
 * Batched version of openai.embeddings.create
 * @param {Object} params - Parameters for the embedding
 * @returns {Promise<Object>} - The embedding response
 */
export async function createEmbedding(params) {
  // If only one input, process directly
  if (typeof params.input === 'string' || params.input.length === 1) {
    return openai.embeddings.create(params);
  }
  
  // Create a promise that will be resolved when the batch is processed
  return new Promise((resolve, reject) => {
    // Add to queue
    queues.embeddings.push({
      params,
      resolve,
      reject,
      enqueueTime: Date.now()
    });
    
    // If no timer is active, start one
    if (!timers.embeddings) {
      timers.embeddings = setTimeout(() => processEmbeddingQueue(), BATCH_DELAY);
    }
  });
}

/**
 * Process the queued embedding requests
 */
async function processEmbeddingQueue() {
  // Clear timer
  timers.embeddings = null;
  
  // If already processing or queue is empty, exit
  if (processing.embeddings || queues.embeddings.length === 0) {
    return;
  }
  
  // Mark as processing
  processing.embeddings = true;
  
  try {
    // Group requests by model
    const groupedByModel = {};
    
    // Move items from queue to grouped lists
    while (queues.embeddings.length > 0) {
      const request = queues.embeddings.shift();
      const model = request.params.model || "text-embedding-ada-002";
      
      if (!groupedByModel[model]) {
        groupedByModel[model] = [];
      }
      
      groupedByModel[model].push(request);
    }
    
    // Process each model group
    for (const [model, requests] of Object.entries(groupedByModel)) {
      // Group compatible requests into batches
      const batches = [];
      let currentBatch = [];
      let currentBatchSize = 0;
      
      for (const request of requests) {
        // If this request would put us over the limit, start a new batch
        const inputSize = Array.isArray(request.params.input) ? 
                          request.params.input.length : 1;
                          
        if (currentBatchSize + inputSize > MAX_BATCH_SIZE) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchSize = 0;
        }
        
        currentBatch.push(request);
        currentBatchSize += inputSize;
      }
      
      // Add final batch if not empty
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      
      // Process each batch
      for (const batch of batches) {
        try {
          // If batch has only one item, process directly
          if (batch.length === 1) {
            const request = batch[0];
            const response = await openai.embeddings.create(request.params);
            request.resolve(response);
            continue;
          }
          
          // Build combined input for batch
          const inputs = [];
          const requestMap = new Map(); // Maps input index to request and its input index
          
          let globalIndex = 0;
          for (const request of batch) {
            const requestInputs = Array.isArray(request.params.input) ? 
                                request.params.input : [request.params.input];
            
            for (let i = 0; i < requestInputs.length; i++) {
              inputs.push(requestInputs[i]);
              requestMap.set(globalIndex, { request, inputIndex: i });
              globalIndex++;
            }
          }
          
          // Make batched API call
          const batchResponse = await openai.embeddings.create({
            model,
            input: inputs
          });
          
          // Distribute results back to original requests
          const responseData = batchResponse.data;
          const responseMap = new Map(); // Maps request to its response data
          
          for (let i = 0; i < responseData.length; i++) {
            const { request, inputIndex } = requestMap.get(i);
            
            if (!responseMap.has(request)) {
              responseMap.set(request, {
                object: "list",
                data: [],
                model: batchResponse.model,
                usage: { total_tokens: 0 }
              });
            }
            
            const requestResponse = responseMap.get(request);
            requestResponse.data[inputIndex] = responseData[i];
            requestResponse.usage.total_tokens += responseData[i].embedding.length;
          }
          
          // Resolve each request with its portion of the response
          for (const request of batch) {
            if (responseMap.has(request)) {
              request.resolve(responseMap.get(request));
            } else {
              request.reject(new Error("Request not found in response mapping"));
            }
          }
        } catch (error) {
          logger.error("Error processing embedding batch:", error);
          
          // Reject all requests in the batch
          for (const request of batch) {
            request.reject(error);
          }
        }
      }
    }
  } catch (error) {
    logger.error("Error in embedding batch processing:", error);
    
    // Reject all remaining requests in the queue
    for (const request of queues.embeddings) {
      request.reject(error);
    }
    queues.embeddings = [];
  } finally {
    // Mark as no longer processing
    processing.embeddings = false;
    
    // If more items were added during processing, schedule another run
    if (queues.embeddings.length > 0) {
      timers.embeddings = setTimeout(() => processEmbeddingQueue(), BATCH_DELAY);
    }
  }
}

/**
 * Get statistics about the batching system
 */
export function getBatchStats() {
  return {
    queueSizes: {
      chatCompletions: queues.chatCompletions.length,
      embeddings: queues.embeddings.length
    },
    processing: {
      chatCompletions: processing.chatCompletions,
      embeddings: processing.embeddings
    }
  };
}