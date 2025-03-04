// /src/commands/metrics.js - Performance metrics dashboard command
import { SlashCommandBuilder } from '@discordjs/builders';
import { EmbedBuilder } from 'discord.js';
import { getPerformanceMetrics, getPerformanceTrends } from '../utils/performanceMiddleware.js';
import { getEmbeddingCacheStats } from '../utils/improvedEmbeddings.js';
import { getDBCacheStats } from '../services/optimizedDatabase.js';
//import { getMemoryCacheStats } from '../utils/optimizedMemoryManager.js';
import { logger } from '../utils/logger.js';

// Format numbers nicely
function formatNumber(num) {
  return num.toLocaleString();
}

// Format milliseconds to a readable format
function formatTime(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

export const data = new SlashCommandBuilder()
  .setName('metrics')
  .setDescription('View bot performance metrics')
  .addStringOption(option =>
    option.setName('view')
      .setDescription('Type of metrics to view')
      .setRequired(false)
      .addChoices(
        { name: 'API Performance', value: 'api' },
        { name: 'Memory Operations', value: 'memory' },
        { name: 'System Resources', value: 'system' },
        { name: 'Cache Statistics', value: 'cache' }
      ));

export async function execute(interaction) {
  // Only allow admins/owners to access metrics
  if (interaction.guild && interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({ content: 'Only the server owner can view performance metrics.', ephemeral: true });
    return;
  }
  
  try {
    await interaction.deferReply({ ephemeral: true });
    
    const view = interaction.options.getString('view') || 'overview';
    const metrics = getPerformanceMetrics();
    
    // Create appropriate embed based on the requested view
    let embed;
    
    switch (view) {
      case 'api':
        embed = createApiEmbed(metrics);
        break;
      case 'memory':
        embed = createMemoryEmbed(metrics);
        break;
      case 'system':
        embed = createSystemEmbed(metrics);
        break;
      case 'cache':
        embed = createCacheEmbed();
        break;
      default:
        embed = createOverviewEmbed(metrics);
    }
    
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error('Error executing metrics command:', error);
    await interaction.editReply('Sorry, there was an error retrieving performance metrics.');
  }
}

// Create overview metrics embed
function createOverviewEmbed(metrics) {
  // Calculate some summary stats
  const totalApiCalls = 
    metrics.apiCalls.openai.count + 
    metrics.apiCalls.gemini.count + 
    metrics.apiCalls.supabase.count;
    
  const avgApiTime = totalApiCalls > 0 ? 
    (metrics.apiCalls.openai.totalTime + 
     metrics.apiCalls.gemini.totalTime + 
     metrics.apiCalls.supabase.totalTime) / totalApiCalls : 0;
     
  const totalMemoryOps = 
    metrics.memoryOperations.queries.count +
    metrics.memoryOperations.creations.count +
    metrics.memoryOperations.updates.count;
    
  const avgMemoryTime = totalMemoryOps > 0 ?
    (metrics.memoryOperations.queries.totalTime +
     metrics.memoryOperations.creations.totalTime +
     metrics.memoryOperations.updates.totalTime) / totalMemoryOps : 0;
  
  return new EmbedBuilder()
    .setTitle('📊 Bri Bot Performance Overview')
    .setColor(0x00AE86)
    .setDescription('Summary of bot performance metrics')
    .addFields(
      { name: '🤖 Message Processing', 
        value: `Messages: ${formatNumber(metrics.messageProcessing.count)}
Avg Time: ${formatTime(metrics.messageProcessing.avgTime)}`, 
        inline: true },
      { name: '🌐 API Calls', 
        value: `Total Calls: ${formatNumber(totalApiCalls)}
Avg Time: ${formatTime(avgApiTime)}`, 
        inline: true },
      { name: '🧠 Memory Operations', 
        value: `Total Ops: ${formatNumber(totalMemoryOps)}
Avg Time: ${formatTime(avgMemoryTime)}`, 
        inline: true },
      { name: '💬 Message Types', 
        value: `Text: ${formatNumber(metrics.messageProcessing.byType.text.count)}
Images: ${formatNumber(metrics.messageProcessing.byType.image.count)}
Voice: ${formatNumber(metrics.messageProcessing.byType.voice.count)}`, 
        inline: true },
      { name: '📈 Embeddings', 
        value: `Count: ${formatNumber(metrics.embeddings.count)}
Avg Time: ${formatTime(metrics.embeddings.avgTime)}
Cache Hit Rate: ${metrics.embeddings.cacheHitRate}`, 
        inline: true },
      { name: '💾 System', 
        value: `Memory: ${metrics.system.memory.usedPercent}% used
Heap: ${metrics.system.heap.usedPercent}% used
Uptime: ${Math.floor(metrics.system.uptime / 3600)} hours`, 
        inline: true }
    )
    .setFooter({ text: `Current operations: ${metrics.currentOperations} • Updated: ${new Date().toLocaleTimeString()}` })
    .setTimestamp();
}

// Create API performance embed
function createApiEmbed(metrics) {
  return new EmbedBuilder()
    .setTitle('🌐 API Performance Metrics')
    .setColor(0x3498DB)
    .setDescription('Detailed API performance statistics')
    .addFields(
      { name: '🔮 OpenAI API', 
        value: `Calls: ${formatNumber(metrics.apiCalls.openai.count)}
Avg Time: ${formatTime(metrics.apiCalls.openai.avgTime)}
Errors: ${metrics.apiCalls.openai.errors} (${metrics.apiCalls.openai.errorRate})`, 
        inline: true },
      { name: '✨ Gemini API', 
        value: `Calls: ${formatNumber(metrics.apiCalls.gemini.count)}
Avg Time: ${formatTime(metrics.apiCalls.gemini.avgTime)}
Errors: ${metrics.apiCalls.gemini.errors} (${metrics.apiCalls.gemini.errorRate})`, 
        inline: true },
      { name: '📊 Supabase API', 
        value: `Calls: ${formatNumber(metrics.apiCalls.supabase.count)}
Avg Time: ${formatTime(metrics.apiCalls.supabase.avgTime)}
Errors: ${metrics.apiCalls.supabase.errors} (${metrics.apiCalls.supabase.errorRate})`, 
        inline: true }
    )
    .setFooter({ text: `Updated: ${new Date().toLocaleTimeString()}` })
    .setTimestamp();
}

// Create memory operations embed
function createMemoryEmbed(metrics) {
  // Get top commands
  const topCommands = Object.entries(metrics.commandsProcessed.byCommand)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cmd, count]) => `${cmd}: ${count}`)
    .join('\n');
  
  return new EmbedBuilder()
    .setTitle('🧠 Memory Operations Metrics')
    .setColor(0xE67E22)
    .setDescription('Detailed memory operation statistics')
    .addFields(
      { name: '🔍 Memory Queries', 
        value: `Count: ${formatNumber(metrics.memoryOperations.queries.count)}
Avg Time: ${formatTime(metrics.memoryOperations.queries.avgTime)}`, 
        inline: true },
      { name: '➕ Memory Creations', 
        value: `Count: ${formatNumber(metrics.memoryOperations.creations.count)}
Avg Time: ${formatTime(metrics.memoryOperations.creations.avgTime)}`, 
        inline: true },
      { name: '✏️ Memory Updates', 
        value: `Count: ${formatNumber(metrics.memoryOperations.updates.count)}
Avg Time: ${formatTime(metrics.memoryOperations.updates.avgTime)}`, 
        inline: true },
      { name: '📝 Message Processing', 
        value: `Total: ${formatNumber(metrics.messageProcessing.count)}
Text: ${formatNumber(metrics.messageProcessing.byType.text.count)}
Image: ${formatNumber(metrics.messageProcessing.byType.image.count)}
Voice: ${formatNumber(metrics.messageProcessing.byType.voice.count)}`, 
        inline: true },
      { name: '🔢 Embeddings', 
        value: `Total: ${formatNumber(metrics.embeddings.count)}
Cached: ${formatNumber(metrics.embeddings.cached)}
Batched: ${formatNumber(metrics.embeddings.batched)}`, 
        inline: true },
      { name: '⌨️ Top Commands', 
        value: topCommands || 'No commands processed', 
        inline: true }
    )
    .setFooter({ text: `Updated: ${new Date().toLocaleTimeString()}` })
    .setTimestamp();
}

// Create system resources embed
function createSystemEmbed(metrics) {
  const { system } = metrics;
  
  // Format memory values to MB
  const totalMemMB = Math.round(system.memory.total / 1024 / 1024);
  const usedMemMB = Math.round(system.memory.used / 1024 / 1024);
  const freeMemMB = Math.round(system.memory.free / 1024 / 1024);
  
  const totalHeapMB = Math.round(system.heap.total / 1024 / 1024);
  const usedHeapMB = Math.round(system.heap.used / 1024 / 1024);
  
  // Format uptime
  const uptime = system.uptime;
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const uptimeStr = `${days}d ${hours}h ${minutes}m`;
  
  return new EmbedBuilder()
    .setTitle('💾 System Resource Metrics')
    .setColor(0x9B59B6)
    .setDescription('System resource utilization statistics')
    .addFields(
      { name: '🖥️ System Memory', 
        value: `Total: ${formatNumber(totalMemMB)} MB
Used: ${formatNumber(usedMemMB)} MB (${system.memory.usedPercent}%)
Free: ${formatNumber(freeMemMB)} MB`, 
        inline: true },
      { name: '📊 Node.js Heap', 
        value: `Total: ${formatNumber(totalHeapMB)} MB
Used: ${formatNumber(usedHeapMB)} MB (${system.heap.usedPercent}%)`, 
        inline: true },
      { name: '⏱️ Uptime', 
        value: uptimeStr, 
        inline: true },
      { name: '📈 Current Operations', 
        value: `${metrics.currentOperations} operations in progress`, 
        inline: true }
    )
    .setFooter({ text: `Updated: ${new Date().toLocaleTimeString()}` })
    .setTimestamp();
}

// Create cache statistics embed
function createCacheEmbed() {
  const embeddingStats = getEmbeddingCacheStats();
  const dbStats = getDBCacheStats();
  const memoryStats = getMemoryCacheStats();
  
  return new EmbedBuilder()
    .setTitle('🗄️ Cache Statistics')
    .setColor(0x2ECC71)
    .setDescription('Detailed cache utilization statistics')
    .addFields(
      { name: '📝 Embedding Cache', 
        value: `Size: ${formatNumber(embeddingStats.size)} / ${formatNumber(embeddingStats.maxSize)}
Usage: ${Math.round(embeddingStats.size / embeddingStats.maxSize * 100)}%
Queue Size: ${formatNumber(embeddingStats.queueSize)}`, 
        inline: true },
      { name: '🗃️ Database Cache', 
        value: `Query Cache: ${formatNumber(dbStats.queryCache.size)} / ${formatNumber(dbStats.queryCache.maxSize)}
User Cache: ${formatNumber(dbStats.userCache.size)} / ${formatNumber(dbStats.userCache.maxSize)}
Usage: ${Math.round((dbStats.queryCache.size + dbStats.userCache.size) / (dbStats.queryCache.maxSize + dbStats.userCache.maxSize) * 100)}%`, 
        inline: true },
      { name: '🧠 Memory Manager Cache', 
        value: `Conversations: ${formatNumber(memoryStats.conversations.size)} / ${formatNumber(memoryStats.conversations.maxSize)}
Context Lengths: ${formatNumber(memoryStats.contextLengths.size)} / ${formatNumber(memoryStats.contextLengths.maxSize)}
Dynamic Prompts: ${formatNumber(memoryStats.dynamicPrompts.size)} / ${formatNumber(memoryStats.dynamicPrompts.maxSize)}
Memory Queries: ${formatNumber(memoryStats.memoryQueries.size)} / ${formatNumber(memoryStats.memoryQueries.maxSize)}`, 
        inline: true }
    )
    .setFooter({ text: `Updated: ${new Date().toLocaleTimeString()}` })
    .setTimestamp();
}