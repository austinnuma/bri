// services/newsService.js
import { openai } from './combinedServices.js';
import { logger } from '../utils/logger.js';
import axios from 'axios';
import { supabase } from './combinedServices.js';

// Default news sources for US politics
const DEFAULT_POLITICAL_SOURCES = [
  'politico.com', 
  'thehill.com', 
  'npr.org/politics', 
  'washingtonpost.com/politics', 
  'nytimes.com/section/politics', 
  'foxnews.com/politics', 
  'cnn.com/politics',
  'apnews.com'
];

// Table names
const POLITICS_NEWS_TABLE = 'bri_politics_settings';
const POLITICS_HISTORY_TABLE = 'bri_politics_history';

/**
 * Fetches U.S. political news using OpenAI's web search capabilities
 * @param {number} maxArticles - Maximum number of articles to fetch (default 10)
 * @returns {Promise<Array>} - Array of news articles
 */
export async function fetchPoliticalNews(maxArticles = 10) {
  try {
    logger.info(`Fetching political news (max ${maxArticles} articles)`);
    
    // Create a search query for recent political news
    const searchQuery = "Latest US politics news today, focusing on major developments, legislation, White House, Congress, and Supreme Court";
    
    // Use OpenAI's search capabilities
    const response = await openai.chat.completions.create({
      model: "gpt-4o-search-preview", // The model with web search capability
      messages: [
        {
          role: "system",
          content: "You are a political news researcher focusing on United States politics. Extract factual information from reliable sources. Provide both liberal and conservative perspectives. Focus on substantive policy matters, major political developments, and important legislative activity. Avoid partisan commentary and trivial political drama. Cite sources for all information."
        },
        {
          role: "user",
          content: searchQuery
        }
      ],
      web_search_options: {
        search_context_size: "high", // Maximum context for comprehensive results
      },
      temperature: 0.1, // Low temperature for factual responses
      max_tokens: 3000,
    });
    
    // Extract the search response and annotations (citations)
    const searchResults = response.choices[0].message.content;
    const annotations = response.choices[0].message.annotations || [];
    
    // Parse the search results to create structured news articles
    const articles = await parseNewsFromSearchResults(searchResults, annotations);
    
    // Limit to the requested number of articles
    const limitedArticles = articles.slice(0, maxArticles);
    
    logger.info(`Successfully fetched ${limitedArticles.length} political news articles`);
    return limitedArticles;
  } catch (error) {
    logger.error('Error fetching political news with OpenAI:', error);
    
    // Fall back to alternative method if OpenAI search fails
    return await fetchPoliticalNewsAlternative(maxArticles);
  }
}

/**
 * Alternative method to fetch news when OpenAI's search fails
 * @param {number} maxArticles - Maximum number of articles to fetch
 * @returns {Promise<Array>} - Array of news articles
 */
async function fetchPoliticalNewsAlternative(maxArticles = 10) {
  try {
    logger.info(`Falling back to alternative news fetching method (max ${maxArticles} articles)`);
    
    // Check if NewsAPI key is available
    const newsApiKey = process.env.NEWS_API_KEY;
    
    if (newsApiKey) {
      // Use NewsAPI if available
      return await fetchFromNewsAPI(maxArticles);
    } else {
      // Use a manual web search approach using OpenAI
      return await manualWebSearch(maxArticles);
    }
  } catch (error) {
    logger.error('Error in alternative news fetching:', error);
    return []; // Return empty array as last resort
  }
}

/**
 * Fetches news from NewsAPI
 * @param {number} maxArticles - Maximum number of articles
 * @returns {Promise<Array>} - Array of news articles
 */
async function fetchFromNewsAPI(maxArticles) {
  try {
    const newsApiKey = process.env.NEWS_API_KEY;
    const response = await axios.get('https://newsapi.org/v2/top-headlines', {
      params: {
        country: 'us',
        category: 'politics',
        pageSize: maxArticles,
        apiKey: newsApiKey
      }
    });
    
    if (response.data && response.data.articles) {
      // Transform to our article format
      return response.data.articles.map(article => ({
        title: article.title,
        url: article.url,
        source: article.source.name,
        content: article.description || 'No description available',
        publishedAt: article.publishedAt
      }));
    }
    
    return [];
  } catch (error) {
    logger.error('Error fetching from NewsAPI:', error);
    return [];
  }
}

/**
 * Manual web search approach using OpenAI
 * @param {number} maxArticles - Maximum number of articles
 * @returns {Promise<Array>} - Array of news articles
 */
async function manualWebSearch(maxArticles) {
  try {
    // Create prompts to generate information about current political news
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert on current US politics. Provide a summary of what you believe to be the most important current political news in the United States, formatted as JSON. Focus on major developments in government, legislation, elections, policy, and other significant political events. Please structure your response as an array of article objects with title, source (news organization), content (brief summary), and an approximate date. Include a mix of perspectives."
        },
        {
          role: "user",
          content: `What are the ${maxArticles} most significant current US political news stories? Please provide factual information only based on what you believe are reliable sources. Format as JSON array.`
        }
      ],
      response_format: { type: "json_object" }
    });
    
    // Parse the JSON response
    const jsonResponse = JSON.parse(response.choices[0].message.content);
    
    // Return the articles
    return jsonResponse.articles || [];
  } catch (error) {
    logger.error('Error in manual web search:', error);
    return [];
  }
}

/**
 * Parses search results into structured news articles
 * @param {string} searchResults - Raw search results text
 * @param {Array} annotations - Citation annotations
 * @returns {Promise<Array>} - Array of structured articles
 */
async function parseNewsFromSearchResults(searchResults, annotations) {
  try {
    // Use OpenAI to parse the search results into structured articles
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a political news analyzer. Your task is to extract distinct political news stories from search results and format them as structured data. For each story, identify the title, source, and content. Ensure each story is distinct and substantive."
        },
        {
          role: "user",
          content: `Extract distinct political news stories from these search results. Format your response as a JSON array of articles with title, source, content, and url fields.\n\nSearch results:\n${searchResults}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });
    
    // Parse the JSON response
    const parsedResponse = JSON.parse(response.choices[0].message.content);
    
    // Extract the articles
    let articles = parsedResponse.articles || [];
    
    // Match URLs from annotations to the articles where possible
    if (annotations && annotations.length > 0) {
      for (const annotation of annotations) {
        if (annotation.type === 'url_citation' && annotation.url_citation) {
          const sourceUrl = annotation.url_citation.url;
          const sourceTitle = annotation.url_citation.title;
          
          // Find any article that might match this source
          for (const article of articles) {
            if (article.source && sourceTitle && sourceTitle.includes(article.source)) {
              article.url = sourceUrl;
            }
          }
        }
      }
    }
    
    return articles;
  } catch (error) {
    logger.error('Error parsing news from search results:', error);
    // Return a simple parsing of the results as fallback
    return simpleParsing(searchResults);
  }
}

/**
 * Simple fallback parsing of search results
 * @param {string} searchResults - Raw search results
 * @returns {Array} - Simplified articles
 */
function simpleParsing(searchResults) {
  // Split by newlines to get potential headlines
  const lines = searchResults.split('\n').filter(line => line.trim().length > 0);
  
  const articles = [];
  let currentArticle = null;
  
  for (const line of lines) {
    // If line starts with a number or bullet, it's likely a new article
    if (/^(\d+[\.\):]|[-•*])/.test(line.trim())) {
      // Save previous article if exists
      if (currentArticle && currentArticle.title) {
        articles.push(currentArticle);
      }
      
      // Start new article
      currentArticle = {
        title: line.replace(/^(\d+[\.\):]|[-•*])\s*/, '').trim(),
        source: 'Unknown',
        content: '',
        url: null
      };
    } else if (currentArticle) {
      // Add to current article content
      currentArticle.content += line + ' ';
      
      // Try to extract source
      if (currentArticle.source === 'Unknown') {
        const sourceMatch = line.match(/\b(according to|from|by|via|source:|sources:)\s+([A-Z][A-Za-z\s]+)/);
        if (sourceMatch) {
          currentArticle.source = sourceMatch[2].trim();
        }
      }
    }
  }
  
  // Add the last article if exists
  if (currentArticle && currentArticle.title) {
    articles.push(currentArticle);
  }
  
  return articles;
}

/**
 * Generates a political news summary from articles
 * @param {Array} articles - Array of news articles
 * @param {Object} options - Options for summary generation
 * @returns {Promise<string>} - Generated summary
 */
export async function generatePoliticalSummary(articles, options = {}) {
  try {
    if (!articles || articles.length === 0) {
      return "No political news available today.";
    }
    
    const {
      perspective = 'balanced',  // 'balanced', 'progressive', 'conservative'
      detailLevel = 'medium',    // 'brief', 'medium', 'detailed'
      tone = 'neutral',          // 'neutral', 'conversational'
      includeSources = true      // Whether to include sources
    } = options;
    
    // Create the articles information
    const articlesInfo = articles.map(article => {
      return `Title: ${article.title}\nSource: ${article.source}\nContent: ${article.content}\nURL: ${article.url || 'N/A'}\n`;
    }).join('\n---\n');
    
    // Determine max tokens based on detail level
    const maxTokens = {
      'brief': 800,
      'medium': 1400,
      'detailed': 2000
    }[detailLevel] || 1400;
    
    // Determine personality/tone instructions
    let toneInstructions = "";
    if (tone === 'conversational') {
      toneInstructions = `Write in Bri's voice - a 14-year-old AI assistant who is enthusiastic, friendly, and likes to explain things clearly. Use age-appropriate language and occasional emojis.`;
    } else {
      toneInstructions = "Write in a neutral, informative tone appropriate for a news summary.";
    }
    
    // Determine perspective instructions
    let perspectiveInstructions = "";
    switch (perspective) {
      case 'progressive':
        perspectiveInstructions = "Emphasize progressive policy priorities and perspectives while remaining factual.";
        break;
      case 'conservative':
        perspectiveInstructions = "Emphasize conservative policy priorities and perspectives while remaining factual.";
        break;
      default:
        perspectiveInstructions = "Provide a balanced perspective covering multiple viewpoints.";
    }
    
    // Create the prompt
    const prompt = `
Generate a daily US political news summary based on the articles below.

${toneInstructions}

Your summary should:
1. Start with "📰 **U.S. POLITICS TODAY**" followed by today's date
2. Cover the most important political developments in the United States
3. Group related stories into themes or categories
4. ${perspectiveInstructions}
5. Be ${detailLevel} in detail level
${includeSources ? "6. Include a 'Sources' section at the end listing the major news sources" : ""}

ARTICLES:
${articlesInfo}
`;

    // Generate the summary
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a political news analyst who creates clear, factual summaries of current US political news."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: maxTokens
    });
    
    return response.choices[0].message.content;
  } catch (error) {
    logger.error('Error generating political summary:', error);
    
    // Create a fallback basic summary
    const today = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    });
    
    let fallbackSummary = `📰 **U.S. POLITICS TODAY** - ${today}\n\n`;
    fallbackSummary += "Here are today's top political stories:\n\n";
    
    for (let i = 0; i < Math.min(articles.length, 5); i++) {
      fallbackSummary += `**${articles[i].title}**\n`;
      fallbackSummary += `${articles[i].content.substring(0, 150)}...\n\n`;
    }
    
    if (includeSources) {
      fallbackSummary += "\n**Sources:**\n";
      const sources = new Set(articles.map(a => a.source).filter(s => s && s !== 'Unknown'));
      fallbackSummary += Array.from(sources).join(', ');
    }
    
    return fallbackSummary;
  }
}

/**
 * Get or create politics settings for a guild
 * @param {string} guildId - Guild ID
 * @returns {Promise<Object>} - Politics settings
 */
export async function getPoliticsSettings(guildId) {
  try {
    // Check if settings exist
    const { data, error } = await supabase
      .from(POLITICS_NEWS_TABLE)
      .select('*')
      .eq('guild_id', guildId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // Not found
        // Create default settings
        const defaultSettings = {
          guild_id: guildId,
          enabled: false,
          channel_id: null,
          cron_schedule: '0 8 * * *', // Default: 8:00 AM daily
          timezone: 'America/New_York',
          perspective: 'balanced',
          detail_level: 'medium',
          tone: 'conversational',
          include_sources: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        const { data: newData, error: createError } = await supabase
          .from(POLITICS_NEWS_TABLE)
          .insert(defaultSettings)
          .select()
          .single();
          
        if (createError) {
          logger.error(`Error creating politics settings for guild ${guildId}:`, createError);
          return defaultSettings; // Return default even if save failed
        }
        
        return newData;
      }
      
      logger.error(`Error fetching politics settings for guild ${guildId}:`, error);
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error(`Error in getPoliticsSettings for guild ${guildId}:`, error);
    return null;
  }
}

/**
 * Updates politics settings for a guild
 * @param {string} guildId - Guild ID
 * @param {Object} settings - New settings
 * @returns {Promise<Object>} - Updated settings
 */
export async function updatePoliticsSettings(guildId, settings) {
  try {
    // Add timestamps
    const updatedSettings = {
      ...settings,
      updated_at: new Date().toISOString()
    };
    
    // Upsert the settings
    const { data, error } = await supabase
      .from(POLITICS_NEWS_TABLE)
      .upsert({
        guild_id: guildId,
        ...updatedSettings
      })
      .select()
      .single();
      
    if (error) {
      logger.error(`Error updating politics settings for guild ${guildId}:`, error);
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error(`Error in updatePoliticsSettings for guild ${guildId}:`, error);
    return null;
  }
}

/**
 * Records a summary in the history table
 * @param {string} guildId - Guild ID
 * @param {string} summary - Generated summary
 * @param {Array} articles - Articles used
 * @returns {Promise<boolean>} - Success status
 */
export async function recordPoliticsSummary(guildId, summary, articles) {
  try {
    const historyEntry = {
      guild_id: guildId,
      summary: summary,
      article_count: articles.length,
      article_data: articles,
      created_at: new Date().toISOString()
    };
    
    const { error } = await supabase
      .from(POLITICS_HISTORY_TABLE)
      .insert(historyEntry);
      
    if (error) {
      logger.error(`Error recording politics summary for guild ${guildId}:`, error);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in recordPoliticsSummary for guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Gets active guilds with politics enabled
 * @returns {Promise<Array>} - Array of guild settings
 */
export async function getActivePoliticsGuilds() {
  try {
    const { data, error } = await supabase
      .from(POLITICS_NEWS_TABLE)
      .select('*')
      .eq('enabled', true);
      
    if (error) {
      logger.error('Error fetching active politics guilds:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.error('Error in getActivePoliticsGuilds:', error);
    return [];
  }
}

/**
 * Check if a politics summary is due for a guild
 * @param {Object} settings - Guild politics settings
 * @returns {Promise<boolean>} - Whether a summary is due
 */
export async function isPoliticsSummaryDue(settings) {
  try {
    // Get the last sent summary
    const { data, error } = await supabase
      .from(POLITICS_HISTORY_TABLE)
      .select('created_at')
      .eq('guild_id', settings.guild_id)
      .order('created_at', { ascending: false })
      .limit(1);
      
    if (error) {
      logger.error(`Error checking politics history for guild ${settings.guild_id}:`, error);
      return true; // If we can't check, default to true
    }
    
    if (!data || data.length === 0) {
      return true; // No history, so definitely due
    }
    
    // Parse the cron schedule
    const [minute, hour, dayOfMonth, month, dayOfWeek] = settings.cron_schedule.split(' ');
    
    // Get current time in the guild's timezone
    const now = new Date();
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: settings.timezone }));
    
    const currentMinute = tzNow.getMinutes();
    const currentHour = tzNow.getHours();
    const currentDayOfMonth = tzNow.getDate();
    const currentMonth = tzNow.getMonth() + 1; // 1-12
    const currentDayOfWeek = tzNow.getDay(); // 0-6 (Sunday-Saturday)
    
    // Check if the current time matches the cron expression
    const minuteMatch = minute === '*' || minute.split(',').includes(String(currentMinute));
    const hourMatch = hour === '*' || hour.split(',').includes(String(currentHour));
    const dayOfMonthMatch = dayOfMonth === '*' || dayOfMonth.split(',').includes(String(currentDayOfMonth));
    const monthMatch = month === '*' || month.split(',').includes(String(currentMonth));
    const dayOfWeekMatch = dayOfWeek === '*' || dayOfWeek.split(',').includes(String(currentDayOfWeek));
    
    const isTimeMatch = minuteMatch && hourMatch && dayOfMonthMatch && monthMatch && dayOfWeekMatch;
    
    if (!isTimeMatch) {
      return false;
    }
    
    // Check if it's already been sent today
    const lastSentDate = new Date(data[0].created_at);
    const lastSentDay = lastSentDate.toDateString();
    const currentDay = tzNow.toDateString();
    
    // If it's already been sent today, it's not due
    if (lastSentDay === currentDay) {
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in isPoliticsSummaryDue for guild ${settings.guild_id}:`, error);
    return true; // Default to true on error
  }
}

/**
 * Generates and sends a politics news summary for a guild
 * @param {Object} settings - Guild politics settings
 * @param {Object} client - Discord client
 * @returns {Promise<boolean>} - Success status
 */
export async function generateAndSendPoliticsSummary(settings, client) {
  try {
    if (!client) {
      logger.error(`No Discord client available for sending politics summary to guild ${settings.guild_id}`);
      return false;
    }
    
    // Check if channel exists
    let channel;
    try {
      channel = await client.channels.fetch(settings.channel_id);
      if (!channel) {
        logger.error(`Channel ${settings.channel_id} not found for politics summary in guild ${settings.guild_id}`);
        return false;
      }
    } catch (channelError) {
      logger.error(`Error fetching channel for politics summary:`, channelError);
      return false;
    }
    
    // Fetch the latest political news
    const articles = await fetchPoliticalNews(15); // Get 15 articles to ensure good coverage
    
    if (!articles || articles.length === 0) {
      logger.error(`No political news articles found for guild ${settings.guild_id}`);
      await channel.send("📰 **U.S. POLITICS TODAY**\n\nI wasn't able to gather political news today. I'll try again later!");
      return false;
    }
    
    // Generate the summary
    const summary = await generatePoliticalSummary(articles, {
      perspective: settings.perspective,
      detailLevel: settings.detail_level,
      tone: settings.tone,
      includeSources: settings.include_sources
    });
    
    // Send the summary
    if (summary.length <= 2000) {
      await channel.send(summary);
    } else {
      // Split into parts for longer summaries
      const parts = [];
      for (let i = 0; i < summary.length; i += 2000) {
        parts.push(summary.substring(i, i + 2000));
      }
      
      // Send each part
      for (const part of parts) {
        await channel.send(part);
      }
    }
    
    // Record the summary
    await recordPoliticsSummary(settings.guild_id, summary, articles);
    
    logger.info(`Successfully sent politics summary to guild ${settings.guild_id}`);
    return true;
  } catch (error) {
    logger.error(`Error generating and sending politics summary for guild ${settings.guild_id}:`, error);
    return false;
  }
}

/**
 * Setup tables for politics functionality
 * @returns {Promise<boolean>} - Success status
 */
export async function setupPoliticsTables() {
  try {
    // Check if tables exist
    const { error: settingsCheckError } = await supabase
      .from(POLITICS_NEWS_TABLE)
      .select('guild_id')
      .limit(1);
      
    if (settingsCheckError && settingsCheckError.code === '42P01') {
      logger.info(`Creating ${POLITICS_NEWS_TABLE} table`);
      
      // Create settings table
      const createSettingsTable = `
        CREATE TABLE IF NOT EXISTS ${POLITICS_NEWS_TABLE} (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL UNIQUE,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          channel_id TEXT,
          cron_schedule TEXT NOT NULL DEFAULT '0 8 * * *',
          timezone TEXT NOT NULL DEFAULT 'America/New_York',
          perspective TEXT NOT NULL DEFAULT 'balanced',
          detail_level TEXT NOT NULL DEFAULT 'medium',
          tone TEXT NOT NULL DEFAULT 'conversational',
          include_sources BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `;
      
      const { error: createSettingsError } = await supabase.query(createSettingsTable);
      
      if (createSettingsError) {
        logger.error(`Error creating ${POLITICS_NEWS_TABLE} table:`, createSettingsError);
        return false;
      }
    }
    
    // Check if history table exists
    const { error: historyCheckError } = await supabase
      .from(POLITICS_HISTORY_TABLE)
      .select('guild_id')
      .limit(1);
      
    if (historyCheckError && historyCheckError.code === '42P01') {
      logger.info(`Creating ${POLITICS_HISTORY_TABLE} table`);
      
      // Create history table
      const createHistoryTable = `
        CREATE TABLE IF NOT EXISTS ${POLITICS_HISTORY_TABLE} (
          id SERIAL PRIMARY KEY,
          guild_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          article_count INTEGER NOT NULL,
          article_data JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `;
      
      const { error: createHistoryError } = await supabase.query(createHistoryTable);
      
      if (createHistoryError) {
        logger.error(`Error creating ${POLITICS_HISTORY_TABLE} table:`, createHistoryError);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Error setting up politics tables:', error);
    return false;
  }
}