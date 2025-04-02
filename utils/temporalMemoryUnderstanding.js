// temporalMemoryUnderstanding.js - Temporal analysis of memories
import { supabase } from '../services/combinedServices.js';
import { logger } from './logger.js';
import { openai } from '../services/combinedServices.js';
import { createMemoryConnection, RELATIONSHIP_TYPES } from './memoryGraphManager.js';

// Time periods for categorizing memories
export const TIME_PERIODS = {
  VERY_RECENT: 'very_recent',     // Within last 24 hours
  RECENT: 'recent',               // Within last week
  MODERATE: 'moderate',           // Within last month
  OLDER: 'older',                 // Within last year
  HISTORICAL: 'historical'        // Over a year old
};

// Temporal markers frequently found in memories
const TEMPORAL_MARKERS = [
  // Present markers
  { marker: /now|currently|lately|these days|at the moment|presently/i, tense: 'present' },
  // Past markers
  { marker: /yesterday|last (week|month|year)|previously|formerly|used to|before|ago|in the past/i, tense: 'past' },
  // Future markers
  { marker: /tomorrow|next (week|month|year)|soon|planning to|going to|will|intends to|wants to/i, tense: 'future' },
  // Change markers
  { marker: /changed|switched|upgraded|started|stopped|no longer|now/i, tense: 'change' },
  // Frequency markers
  { marker: /always|never|sometimes|occasionally|rarely|frequently|often|every (day|week|month|year)/i, tense: 'frequency' }
];

/**
 * Initialize temporal memory system
 * Creates necessary database columns/indices if they don't exist
 */
export async function initializeTemporalMemorySystem() {
  try {
    logger.info("Initializing temporal memory system...");
    
    // Check if the temporal_analysis column exists in unified_memories
    try {
      // This query will fail if the column doesn't exist
      const { data, error } = await supabase
        .from('unified_memories')
        .select('temporal_analysis')
        .limit(1);
        
      if (error && error.message && error.message.includes('column "temporal_analysis" does not exist')) {
        logger.info("Adding temporal_analysis column to unified_memories table...");
        
        // Add the column
        await supabase.query(`
          ALTER TABLE unified_memories
          ADD COLUMN IF NOT EXISTS temporal_analysis JSONB;
          
          CREATE INDEX IF NOT EXISTS idx_unified_memories_temporal
          ON unified_memories USING gin (temporal_analysis);
        `);
        
        logger.info("Temporal analysis column added successfully");
      } else {
        //logger.info("Temporal analysis column already exists");
      }
    } catch (columnError) {
      logger.error("Error checking/adding temporal column:", columnError);
    }
    
    //logger.info("Temporal memory system initialization complete");
  } catch (error) {
    logger.error("Error initializing temporal memory system:", error);
  }
}

/**
 * Analyzes the temporal aspects of a memory
 * @param {Object} memory - The memory to analyze
 * @returns {Promise<Object|null>} - Temporal analysis results
 */
export async function analyzeTemporalAspects(memory) {
  try {
    const memoryText = memory.memory_text;
    
    // Initial analysis based on simple pattern matching
    const initialAnalysis = analyzeTemporalMarkers(memoryText);
    
    // For more complex memories, use AI to extract temporal information
    if (memory.category === 'personal' || memory.category === 'professional' || 
        memory.memory_type === 'explicit' || initialAnalysis.complexity > 0) {
      
      const prompt = `
Analyze this memory for temporal information:

"${memoryText}"

Extract these temporal aspects:
1. Tense (past, present, future, or a combination)
2. Any specific time references (dates, days, periods)
3. Is this a current fact or something that has changed?
4. Temporal stability (is this likely to change soon or remain stable?)
5. Any frequency information (how often something occurs)

Format your response as JSON:
{
  "tense": "past|present|future|mixed",
  "time_references": ["list", "of", "time references"],
  "is_current": true/false,
  "stability": "high|medium|low",
  "frequency": "one_time|occasional|regular|constant|null",
  "temporal_value": "specific text that indicates when this happened/happens",
  "likely_to_change": true/false
}
`;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { 
            role: "system", 
            content: "You are a specialized system for analyzing temporal aspects of statements about users. You extract timestamps, tenses, and time-related information from memories."
          },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
      });
      
      // Parse and return the full analysis
      const aiAnalysis = JSON.parse(completion.choices[0].message.content);
      
      // Combine with pattern-based analysis
      return {
        ...initialAnalysis,
        ...aiAnalysis,
        analyzed_at: new Date().toISOString()
      };
    }
    
    // For simpler memories, just use the pattern-based analysis
    return {
      ...initialAnalysis,
      analyzed_at: new Date().toISOString()
    };
  } catch (error) {
    logger.error("Error analyzing temporal aspects:", error);
    return {
      tense: 'unknown',
      is_current: true, // Default assumption
      stability: 'medium',
      analyzed_at: new Date().toISOString()
    };
  }
}

/**
 * Performs basic pattern matching for temporal markers in text
 * @param {string} text - Memory text to analyze
 * @returns {Object} - Simple temporal analysis
 */
function analyzeTemporalMarkers(text) {
  // Default return structure
  const analysis = {
    tense: 'present', // Default assumption
    time_references: [],
    is_current: true,
    stability: 'medium',
    complexity: 0
  };
  
  // Check for temporal markers
  const matches = [];
  
  for (const marker of TEMPORAL_MARKERS) {
    const match = text.match(marker.marker);
    if (match) {
      matches.push({
        term: match[0],
        tense: marker.tense
      });
      
      // Store time references
      if (!analysis.time_references.includes(match[0])) {
        analysis.time_references.push(match[0]);
      }
    }
  }
  
  // Determine overall tense based on markers
  if (matches.length > 0) {
    // Count occurrences of each tense
    const tenseCounts = matches.reduce((counts, match) => {
      counts[match.tense] = (counts[match.tense] || 0) + 1;
      return counts;
    }, {});
    
    // Find the most common tense
    let maxCount = 0;
    let dominantTense = null;
    
    for (const [tense, count] of Object.entries(tenseCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantTense = tense;
      }
    }
    
    // Set the tense if we found one
    if (dominantTense) {
      analysis.tense = dominantTense;
    }
    
    // Adjust is_current based on tense
    if (dominantTense === 'past') {
      analysis.is_current = false;
    } else if (dominantTense === 'change') {
      // For change markers, check if the change was to a current state or away from it
      if (text.match(/no longer|used to|stopped|previously/i)) {
        analysis.is_current = true; // The change was away from a past state
      } else if (text.match(/now|currently|started/i)) {
        analysis.is_current = true; // The change is to a current state
      }
    }
    
    // Complexity increases with number of temporal markers
    analysis.complexity = Math.min(1, matches.length / 2); // Scale to 0-1
  }
  
  return analysis;
}

/**
 * Updates the temporal analysis for a memory
 * @param {number} memoryId - The memory ID
 * @param {Object} temporalAnalysis - The temporal analysis data
 * @returns {Promise<boolean>} - Success status
 */
export async function updateMemoryTemporalAnalysis(memoryId, temporalAnalysis) {
  try {
    const { error } = await supabase
      .from('unified_memories')
      .update({
        temporal_analysis: temporalAnalysis
      })
      .eq('id', memoryId);
      
    if (error) {
      logger.error(`Error updating temporal analysis for memory ${memoryId}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in updateMemoryTemporalAnalysis for memory ${memoryId}:`, error);
    return false;
  }
}

/**
 * Processes a batch of memories to add temporal analysis
 * @param {string} userId - Optionally filter by user ID
 * @param {string} guildId - Optionally filter by guild ID
 * @param {number} batchSize - Number of memories to process
 * @returns {Promise<Object>} - Results of the processing
 */
export async function batchProcessTemporalAnalysis(userId = null, guildId = null, batchSize = 50) {
  try {
    // Build the query
    let query = supabase
      .from('unified_memories')
      .select('*')
      .is('temporal_analysis', null) // Only get memories without temporal analysis
      .order('created_at', { ascending: false })
      .limit(batchSize);
      
    // Add filters if provided
    if (userId) {
      query = query.eq('user_id', userId);
    }
    
    if (guildId) {
      query = query.eq('guild_id', guildId);
    }
    
    // Execute the query
    const { data: memories, error } = await query;
    
    if (error) {
      logger.error("Error fetching memories for temporal analysis:", error);
      return { processed: 0, success: 0, errors: 1 };
    }
    
    if (!memories || memories.length === 0) {
      return { processed: 0, success: 0, errors: 0 };
    }
    
    // Process each memory
    const results = {
      processed: memories.length,
      success: 0,
      errors: 0
    };
    
    for (const memory of memories) {
      try {
        // Analyze temporal aspects
        const analysis = await analyzeTemporalAspects(memory);
        
        // Update the memory with the analysis
        const updated = await updateMemoryTemporalAnalysis(memory.id, analysis);
        
        if (updated) {
          results.success++;
        } else {
          results.errors++;
        }
      } catch (memoryError) {
        logger.error(`Error processing temporal analysis for memory ${memory.id}:`, memoryError);
        results.errors++;
      }
    }
    
    return results;
  } catch (error) {
    logger.error("Error in batchProcessTemporalAnalysis:", error);
    return { processed: 0, success: 0, errors: 1 };
  }
}

/**
 * Identifies potential contradictions or changes in temporal memories
 * @param {string} userId - The user ID
 * @param {string} guildId - The guild ID
 * @returns {Promise<Array>} - Array of potential contradictions
 */
export async function findTemporalContradictions(userId, guildId) {
  try {
    // Get all memories with temporal analysis for this user and guild
    const { data: memories, error } = await supabase
      .from('unified_memories')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .not('temporal_analysis', 'is', null)
      .order('created_at', { ascending: false });
      
    if (error) {
      logger.error("Error fetching memories for contradiction analysis:", error);
      return [];
    }
    
    if (!memories || memories.length < 2) {
      return []; // Need at least 2 memories to find contradictions
    }
    
    // Group memories by topic/category to find related ones
    const memoryGroups = groupRelatedMemories(memories);
    
    // Analyze each group for temporal contradictions
    const contradictions = [];
    
    for (const group of memoryGroups) {
      // Skip groups with only one memory
      if (group.length < 2) continue;
      
      // Check for contradictions within this group
      const groupContradictions = analyzeGroupForContradictions(group);
      contradictions.push(...groupContradictions);
    }
    
    return contradictions;
  } catch (error) {
    logger.error("Error finding temporal contradictions:", error);
    return [];
  }
}

/**
 * Groups memories that are likely related to the same topic
 * @param {Array} memories - Array of memories
 * @returns {Array<Array>} - Groups of related memories
 */
function groupRelatedMemories(memories) {
  // Use a simple approach based on keyword matching
  // A more sophisticated approach would use embeddings or the memory graph
  
  const groups = [];
  const processedIds = new Set();
  
  for (const memory of memories) {
    // Skip already processed memories
    if (processedIds.has(memory.id)) continue;
    
    // Start a new group with this memory
    const relatedGroup = [memory];
    processedIds.add(memory.id);
    
    // Extract key terms from this memory
    const keyTerms = extractKeyTerms(memory.memory_text);
    
    // Find related memories
    for (const otherMemory of memories) {
      // Skip same memory or already processed ones
      if (otherMemory.id === memory.id || processedIds.has(otherMemory.id)) continue;
      
      // Check for term overlap
      const otherTerms = extractKeyTerms(otherMemory.memory_text);
      const overlap = keyTerms.filter(term => otherTerms.includes(term));
      
      // If significant overlap, add to group
      if (overlap.length >= 2 || (overlap.length === 1 && overlap[0].length > 5)) {
        relatedGroup.push(otherMemory);
        processedIds.add(otherMemory.id);
      }
    }
    
    // Only add groups with multiple memories
    if (relatedGroup.length > 1) {
      groups.push(relatedGroup);
    }
  }
  
  return groups;
}

/**
 * Extracts important terms from memory text
 * @param {string} text - Memory text
 * @returns {Array<string>} - Array of key terms
 */
function extractKeyTerms(text) {
  // Remove common words and punctuation
  const cleanText = text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .replace(/\s{2,}/g, ' ');
    
  // Split into words
  const words = cleanText.split(' ');
  
  // Filter out common stop words
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 
                    'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 
                    'does', 'did', 'to', 'at', 'in', 'on', 'for', 'with', 'about', 
                    'user', 'that', 'this', 'these', 'those', 'i', 'you', 'he', 
                    'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 
                    'our', 'their'];
                    
  return words.filter(w => w.length > 2 && !stopWords.includes(w));
}

/**
 * Analyzes a group of related memories for temporal contradictions
 * @param {Array} memoryGroup - Group of related memories
 * @returns {Array} - Contradictions found
 */
function analyzeGroupForContradictions(memoryGroup) {
  const contradictions = [];
  
  // Sort by creation time, newest first
  memoryGroup.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  // Check each pair of memories
  for (let i = 0; i < memoryGroup.length; i++) {
    for (let j = i + 1; j < memoryGroup.length; j++) {
      const memoryA = memoryGroup[i];
      const memoryB = memoryGroup[j];
      
      // Skip pairs without temporal analysis
      if (!memoryA.temporal_analysis || !memoryB.temporal_analysis) continue;
      
      // Check for contradictions in temporal information
      const contradiction = checkTemporalContradiction(memoryA, memoryB);
      
      if (contradiction) {
        contradictions.push(contradiction);
        
        // Create a connection between these contradicting memories
        createMemoryConnection(
          memoryA.id, 
          memoryB.id, 
          RELATIONSHIP_TYPES.CONTRADICTS, 
          contradiction.confidence
        ).catch(err => {
          logger.error("Error creating contradiction connection:", err);
        });
      }
    }
  }
  
  return contradictions;
}

/**
 * Checks if two memories have temporal contradictions
 * @param {Object} memoryA - First memory (newer)
 * @param {Object} memoryB - Second memory (older)
 * @returns {Object|null} - Contradiction information or null
 */
function checkTemporalContradiction(memoryA, memoryB) {
  // Skip if either doesn't have temporal analysis
  if (!memoryA.temporal_analysis || !memoryB.temporal_analysis) {
    return null;
  }
  
  const analysisA = memoryA.temporal_analysis;
  const analysisB = memoryB.temporal_analysis;
  
  // Check clear contradictions like stability changes
  if (analysisB.is_current === true && 
      analysisB.stability === 'high' && 
      analysisA.tense === 'change') {
    
    return {
      type: 'stability_change',
      newer_memory: memoryA,
      older_memory: memoryB,
      description: "A supposedly stable fact has changed",
      confidence: 0.85
    };
  }
  
  // Check for present/past tense contradictions
  if (analysisA.is_current === true && 
      analysisB.is_current === false && 
      analysisB.tense === 'present') {
    
    return {
      type: 'tense_contradiction',
      newer_memory: memoryA,
      older_memory: memoryB,
      description: "Memories have conflicting temporal status",
      confidence: 0.8
    };
  }
  
  // Check for direct contradictions based on frequency
  if (analysisA.frequency && 
      analysisB.frequency && 
      analysisA.frequency !== analysisB.frequency && 
      // Only flag if both frequencies are strong assertions
      (analysisA.frequency === 'constant' || analysisA.frequency === 'never') &&
      (analysisB.frequency === 'constant' || analysisB.frequency === 'never')) {
    
    return {
      type: 'frequency_contradiction',
      newer_memory: memoryA,
      older_memory: memoryB,
      description: "Memories have conflicting frequency information",
      confidence: 0.75
    };
  }
  
  return null;
}

/**
 * Categorizes a memory by its time period relative to now
 * @param {Object} memory - The memory object
 * @returns {string} - Time period category
 */
export function categorizeMemoryTimePeriod(memory) {
  // Get the memory creation date
  const memoryDate = new Date(memory.created_at);
  const now = new Date();
  
  // Calculate time difference in days
  const diffTime = Math.abs(now - memoryDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // Categorize based on age
  if (diffDays <= 1) {
    return TIME_PERIODS.VERY_RECENT;
  } else if (diffDays <= 7) {
    return TIME_PERIODS.RECENT;
  } else if (diffDays <= 30) {
    return TIME_PERIODS.MODERATE;
  } else if (diffDays <= 365) {
    return TIME_PERIODS.OLDER;
  } else {
    return TIME_PERIODS.HISTORICAL;
  }
}

/**
 * Gets basic temporal context for memory retrieval based on query
 * This is a fast, non-blocking version that only uses pattern matching
 * @param {string} query - The user's query
 * @returns {Object} - Temporal context information
 */
export function getBasicTemporalContext(query) {
  // Start with default context
  const context = {
    time_focus: 'present', // Default focus on current information
    includes_time_reference: false,
    prioritize_recent: false,
    explicit_time_references: []
  };
  
  // Check for temporal markers in the query
  for (const marker of TEMPORAL_MARKERS) {
    const matches = query.match(marker.marker);
    if (matches) {
      context.includes_time_reference = true;
      
      // Adjust time focus based on markers
      if (marker.tense === 'past') {
        context.time_focus = 'past';
        context.prioritize_recent = false;
      } else if (marker.tense === 'future') {
        context.time_focus = 'future';
        context.prioritize_recent = true; // Latest info for future planning
      } else if (marker.tense === 'change') {
        context.time_focus = 'changes';
        context.prioritize_recent = true; // Focus on latest changes
      }
      
      // Add explicit time references - matches is an array with the first element being the full match
      if (matches[0] && !context.explicit_time_references.includes(matches[0])) {
        context.explicit_time_references.push(matches[0]);
      }
    }
  }
  
  return context;
}

/**
 * Gets full temporal context for memory retrieval based on query
 * This function may make API calls for detailed analysis
 * @param {string} query - The user's query
 * @returns {Promise<Object>} - Temporal context information
 */
export async function getTemporalQueryContext(query) {
  try {
    // Start with the basic context from pattern matching
    const context = getBasicTemporalContext(query);
    
    // For complex queries, we'll still do AI-based analysis, but in a non-blocking way
    // Returning the basic context immediately so we don't hold up the response
    
    // This function could be called from a background job or scheduled task
    if (query.length > 20) {
      // Schedule the detailed analysis for later rather than waiting for it
      setTimeout(async () => {
        try {
          await performDetailedTemporalAnalysis(query, context);
        } catch (err) {
          logger.error("Error in background temporal analysis:", err);
        }
      }, 0);
    }
    
    return context;
  } catch (error) {
    logger.error("Error getting temporal query context:", error);
    return {
      time_focus: 'present',
      includes_time_reference: false,
      prioritize_recent: false,
      explicit_time_references: []
    };
  }
}

/**
 * Performs detailed temporal analysis in the background without blocking
 * @param {string} query - The user's query
 * @param {Object} basicContext - The basic context from pattern matching
 */
async function performDetailedTemporalAnalysis(query, basicContext) {
  try {
    const prompt = `
Analyze this query for temporal aspects:

"${query}"

Does this query:
1. Ask about past information?
2. Focus on current/present information?
3. Ask about changes over time?
4. Reference specific time periods?
5. Ask about future possibilities?

Format your response as JSON:
{
  "time_focus": "past|present|changes|future",
  "includes_time_reference": true/false,
  "explicit_time_references": ["list", "of", "references"],
  "prioritize_recent": true/false
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You analyze user queries for temporal aspects and time references."
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 300,
    });
    
    // Process the detailed analysis, but don't block the main thread
    // This analysis could be stored for future use or update a cache
    const aiContext = JSON.parse(completion.choices[0].message.content);
    logger.info("Completed detailed temporal analysis in background", {
      query_snippet: query.substring(0, 30),
      time_focus: aiContext.time_focus
    });
    
    // Here you could store this analysis for future use
    // For example, it could be cached or stored in the database
  } catch (error) {
    logger.error("Error in detailed temporal analysis:", error);
  }
}

/**
 * Enhances memory retrieval with temporal understanding
 * @param {Array} memories - Retrieved memories
 * @param {Object} temporalContext - Temporal context from query
 * @returns {Array} - Temporally enhanced memories
 */
export function enhanceMemoriesWithTemporal(memories, temporalContext) {
  if (!memories || memories.length === 0) {
    return memories;
  }
  
  // Add time-based info to each memory
  const enhancedMemories = memories.map(memory => {
    // Calculate time period category
    const timePeriod = categorizeMemoryTimePeriod(memory);
    
    // Create enhanced memory with temporal metadata
    return {
      ...memory,
      time_period: timePeriod,
      temporal_context: memory.temporal_analysis || null
    };
  });
  
  // If there's no specific temporal focus in the query, return as is
  if (!temporalContext.includes_time_reference) {
    return enhancedMemories;
  }
  
  // Otherwise, adjust scores and ordering based on temporal context
  return enhancedMemories.map(memory => {
    let temporalRelevance = 1.0; // Default relevance
    
    // Adjust based on temporal analysis if available
    if (memory.temporal_context) {
      // For past focus, prioritize memories marked as past
      if (temporalContext.time_focus === 'past' && 
          memory.temporal_context.tense === 'past') {
        temporalRelevance *= 1.3;
      }
      
      // For present focus, prioritize current memories
      else if (temporalContext.time_focus === 'present' && 
               memory.temporal_context.is_current === true) {
        temporalRelevance *= 1.2;
      }
      
      // For change focus, prioritize memories about changes
      else if (temporalContext.time_focus === 'changes' && 
               memory.temporal_context.tense === 'change') {
        temporalRelevance *= 1.5;
      }
      
      // For future focus, prioritize stable present facts
      else if (temporalContext.time_focus === 'future' && 
               memory.temporal_context.is_current === true &&
               memory.temporal_context.stability === 'high') {
        temporalRelevance *= 1.2;
      }
    }
    
    // Adjust for recency if prioritizing recent memories
    if (temporalContext.prioritize_recent) {
      if (memory.time_period === TIME_PERIODS.VERY_RECENT) {
        temporalRelevance *= 1.5;
      } else if (memory.time_period === TIME_PERIODS.RECENT) {
        temporalRelevance *= 1.3;
      } else if (memory.time_period === TIME_PERIODS.MODERATE) {
        temporalRelevance *= 1.1;
      }
    }
    
    // Return memory with temporal relevance score
    return {
      ...memory,
      temporal_relevance: temporalRelevance
    };
  })
  // Sort by combined relevance (original relevance * temporal relevance)
  .sort((a, b) => {
    const scoreA = (a.similarity || 0.5) * (a.temporal_relevance || 1.0);
    const scoreB = (b.similarity || 0.5) * (b.temporal_relevance || 1.0);
    return scoreB - scoreA;
  });
}

/**
 * Formats memories with temporal context for prompt enhancement
 * @param {Array} memories - Memories with temporal metadata
 * @returns {string} - Formatted memories with temporal context
 */
export function formatMemoriesWithTemporal(memories) {
  if (!memories || memories.length === 0) {
    return "";
  }
  
  // Group memories by time period for better organization
  const groupedMemories = {
    [TIME_PERIODS.VERY_RECENT]: [],
    [TIME_PERIODS.RECENT]: [],
    [TIME_PERIODS.MODERATE]: [],
    [TIME_PERIODS.OLDER]: [],
    [TIME_PERIODS.HISTORICAL]: []
  };
  
  // Group memories
  for (const memory of memories) {
    const timePeriod = memory.time_period || TIME_PERIODS.MODERATE;
    groupedMemories[timePeriod].push(memory);
  }
  
  // Format each time period
  let result = "";
  
  // Helper to format one memory with temporal context
  const formatMemoryWithContext = (memory) => {
    let line = `- ${memory.memory_text}`;
    
    // Add temporal context if available
    if (memory.temporal_context) {
      // Add temporal qualifiers for non-current memories
      if (memory.temporal_context.is_current === false) {
        line += " (in the past)";
      } 
      else if (memory.temporal_context.tense === 'change') {
        line += " (changed recently)";
      }
      else if (memory.temporal_context.stability === 'low') {
        line += " (may have changed)";
      }
      // Add frequency information if available
      else if (memory.temporal_context.frequency) {
        let frequencyText = "";
        
        switch (memory.temporal_context.frequency) {
          case 'constant':
            frequencyText = "always";
            break;
          case 'regular':
            frequencyText = "regularly";
            break;
          case 'occasional':
            frequencyText = "sometimes";
            break;
          case 'one_time':
            frequencyText = "once";
            break;
          default:
            frequencyText = "";
        }
        
        if (frequencyText) {
          line += ` (${frequencyText})`;
        }
      }
    }
    
    return line;
  };
  
  // Add very recent memories first with header
  if (groupedMemories[TIME_PERIODS.VERY_RECENT].length > 0) {
    result += "VERY RECENT MEMORIES:\n";
    for (const memory of groupedMemories[TIME_PERIODS.VERY_RECENT]) {
      result += formatMemoryWithContext(memory) + "\n";
    }
    result += "\n";
  }
  
  // Add recent memories 
  if (groupedMemories[TIME_PERIODS.RECENT].length > 0) {
    result += "RECENT MEMORIES:\n";
    for (const memory of groupedMemories[TIME_PERIODS.RECENT]) {
      result += formatMemoryWithContext(memory) + "\n";
    }
    result += "\n";
  }
  
  // Add moderate memories
  if (groupedMemories[TIME_PERIODS.MODERATE].length > 0) {
    for (const memory of groupedMemories[TIME_PERIODS.MODERATE]) {
      result += formatMemoryWithContext(memory) + "\n";
    }
    result += "\n";
  }
  
  // Add older memories
  if (groupedMemories[TIME_PERIODS.OLDER].length > 0) {
    for (const memory of groupedMemories[TIME_PERIODS.OLDER]) {
      result += formatMemoryWithContext(memory) + "\n";
    }
  }
  
  // Add historical memories (usually skip unless specifically relevant)
  if (groupedMemories[TIME_PERIODS.HISTORICAL].length > 0) {
    for (const memory of groupedMemories[TIME_PERIODS.HISTORICAL]) {
      result += formatMemoryWithContext(memory) + "\n";
    }
  }
  
  return result.trim();
}

/**
 * Schedule regular temporal analysis of memories
 * @param {number} intervalHours - Hours between runs
 */
export function scheduleTemporalAnalysis(intervalHours = 12) {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  setInterval(async () => {
    try {
      logger.info(`Running scheduled temporal analysis of memories`);
      
      // Process a batch of memories
      const result = await batchProcessTemporalAnalysis(null, null, 100);
      
      logger.info(`Completed scheduled temporal analysis: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error("Error in scheduled temporal analysis:", error);
    }
  }, intervalMs);
  
  //logger.info(`Temporal analysis scheduled to run every ${intervalHours} hours`);
}