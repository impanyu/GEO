import { NextRequest, NextResponse } from 'next/server'
import { DataTableCache, closeDatabaseConnection, type DataTableResult, type BrandAnalysis } from '@/lib/models/DataTableCache'
import { normalizeUrl } from '@/lib/models/PromptCache'
import { generateDataTableForUrls } from '../../../scripts/generate-data-table'

// Supported agentic platforms
const SUPPORTED_PLATFORMS = ['openai', 'google-ai'] as const
type AgenticPlatform = typeof SUPPORTED_PLATFORMS[number]

interface TopicGroupedResult {
  topic: string
  normalizedBrandUrl: string
  brandName: string
  agenticPlatform: string
  promptCount: number
  totalAppearances: number
  totalQueries: number
  visibility: number
  avgRank: number
  datetime: Date
  prompts: string[]
}

/**
 * Group DataTableResults by topic
 */
function groupByTopic(results: DataTableResult[]): TopicGroupedResult[] {
  console.log(`Grouping ${results.length} results by topic...`)
  const topicGroups = new Map<string, DataTableResult[]>()
  
  // Group results by topic
  results.forEach(result => {
    const topic = result.topic || 'Unknown'
    console.log(`Result topic: "${topic}"`)
    if (!topicGroups.has(topic)) {
      topicGroups.set(topic, [])
    }
    topicGroups.get(topic)!.push(result)
  })
  
  console.log(`Found ${topicGroups.size} unique topics:`, Array.from(topicGroups.keys()))
  
  // Calculate aggregated metrics for each topic
  const groupedResults: TopicGroupedResult[] = []
  
  topicGroups.forEach((topicResults, topic) => {
    if (topicResults.length === 0) return
    
    const firstResult = topicResults[0]
    const promptCount = topicResults.length
    
    // Calculate total appearances and total queries across all prompts in this topic
    let totalAppearances = 0
    let totalQueries = 0
    let totalQueriesWithNonZeroRank = 0
    let totalRankSum = 0
    const prompts: string[] = []
    
    topicResults.forEach(result => {
      totalAppearances += result.brandAnalysis.totalAppearancesAcrossResponses
      totalQueries += result.totalCitationsOfAllBrands // Sum actual queries per result
      prompts.push(result.prompt)
      
      // Only include non-zero ranks in average calculation
      if (result.brandAnalysis.avgRank > 0) {
        totalRankSum += result.brandAnalysis.avgRank
        totalQueriesWithNonZeroRank++
      }
    })
    
    // Visibility = total appearances / total queries
    const visibility = totalQueries > 0 ? totalAppearances / totalQueries : 0
    
    // Average rank = sum of non-zero ranks / count of non-zero ranks
    const avgRank = totalQueriesWithNonZeroRank > 0 ? totalRankSum / totalQueriesWithNonZeroRank : 0
    
    // Debug logging for topic grouping
    console.log(`Topic "${topic}" calculation:`)
    console.log(`- Prompt count: ${promptCount}`)
    console.log(`- Total appearances: ${totalAppearances}`)
    console.log(`- Total queries: ${totalQueries}`)
    console.log(`- Individual totalCitationsOfAllBrands:`, topicResults.map(r => r.totalCitationsOfAllBrands))
    console.log(`- Visibility: ${(visibility * 100).toFixed(1)}%`)
    
    // Use the most recent datetime
    const datetime = new Date(Math.max(...topicResults.map(r => r.datetime.getTime())))
    
    groupedResults.push({
      topic,
      normalizedBrandUrl: firstResult.normalizedBrandUrl,
      brandName: firstResult.brandName,
      agenticPlatform: firstResult.agenticPlatform,
      promptCount,
      totalAppearances,
      totalQueries,
      visibility,
      avgRank,
      datetime,
      prompts
    })
  })
  
  // Sort by topic name for consistent ordering
  return groupedResults.sort((a, b) => a.topic.localeCompare(b.topic))
}

/**
 * Filter DataTableResults by datetime range
 */
function filterByDatetime(results: DataTableResult[], beginDatetime?: string, endDatetime?: string): DataTableResult[] {
  if (!beginDatetime && !endDatetime) {
    return results
  }

  const begin = beginDatetime ? new Date(beginDatetime) : null
  const end = endDatetime ? new Date(endDatetime) : null

  return results.filter(result => {
    const resultDate = new Date(result.datetime)
    
    if (begin && resultDate < begin) {
      return false
    }
    
    if (end && resultDate > end) {
      return false
    }
    
    return true
  })
}

/**
 * Main API handler - Only handles cache checking and optional generation triggering
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Extract URL parameter (single URL only)
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('url')
    const agenticPlatform = searchParams.get('platform') || 'openai'
    const forceGenerate = searchParams.get('generate') === 'true'
    const groupBy = searchParams.get('group_by') || 'prompt' // 'prompt' or 'topic'
    const beginDatetime = searchParams.get('begin_datetime') // ISO string
    const endDatetime = searchParams.get('end_datetime') // ISO string
    
    if (!brandUrl) {
      return NextResponse.json({
        error: 'Missing required parameter: url'
      }, { status: 400 })
    }
    
    // Validate platform
    if (!SUPPORTED_PLATFORMS.includes(agenticPlatform as AgenticPlatform)) {
      return NextResponse.json({
        error: `Unsupported platform: ${agenticPlatform}. Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`
      }, { status: 400 })
    }
    
    // Validate group_by parameter
    if (!['prompt', 'topic'].includes(groupBy)) {
      return NextResponse.json({
        error: `Invalid group_by parameter: ${groupBy}. Must be 'prompt' or 'topic'`
      }, { status: 400 })
    }
    
    console.log(`Checking data table cache for: ${brandUrl} with platform: ${agenticPlatform}`)
    
    // Normalize URL for caching
    const normalizedUrl = normalizeUrl(brandUrl)
    console.log('Normalized URL:', normalizedUrl)
    
    // Check cache first - look for this specific URL
    console.log('Checking cache for existing data table...')
    const cachedDataTable = await DataTableCache.findByUrlAndPlatform(normalizedUrl, agenticPlatform)
    
    if (cachedDataTable && !forceGenerate) {
      console.log('Found cached data table, returning cached data')
      console.log('Sample cached result structure:', cachedDataTable.results[0])
      console.log('Cached result has topic field:', 'topic' in (cachedDataTable.results[0] || {}))
      
      // Check if cached data has topic field, if not, force regeneration
      const hasTopicField = cachedDataTable.results.length > 0 && 'topic' in cachedDataTable.results[0]
      if (!hasTopicField) {
        console.log('⚠️ Cached data missing topic field, forcing regeneration...')
        // Fall through to regeneration logic
      } else {
        // Apply datetime filtering first
        const filteredResults = filterByDatetime(cachedDataTable.results, beginDatetime || undefined, endDatetime || undefined)
        console.log(`Filtered ${cachedDataTable.results.length} results to ${filteredResults.length} by datetime`)
        
        // Apply grouping based on group_by parameter
        const responseData = groupBy === 'topic' 
          ? groupByTopic(filteredResults)
          : filteredResults
        
        console.log(`Returning ${groupBy} data:`, responseData.length, 'items')
        if (groupBy === 'topic') {
          console.log('Sample topic result:', responseData[0])
        }
        
        return NextResponse.json(responseData, { status: 200 })
      }
    }
    
    if (forceGenerate) {
      console.log('Force generation requested, generating new data table...')
      try {
        const results = await generateDataTableForUrls([brandUrl], agenticPlatform as AgenticPlatform)
        
        // Apply datetime filtering first
        const filteredResults = filterByDatetime(results, beginDatetime || undefined, endDatetime || undefined)
        console.log(`Filtered ${results.length} generated results to ${filteredResults.length} by datetime`)
        
        // Apply grouping based on group_by parameter
        const responseData = groupBy === 'topic' 
          ? groupByTopic(filteredResults)
          : filteredResults
        
        console.log(`Returning generated ${groupBy} data:`, responseData.length, 'items')
        if (groupBy === 'topic') {
          console.log('Sample generated topic result:', responseData[0])
        }
        
        return NextResponse.json(responseData, { status: 200 })
      } catch (error) {
        console.error('Error generating data table:', error)
        return NextResponse.json({
          error: 'Failed to generate data table',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
      }
    }
    
    // No cached data found and no generation requested
    console.log('No cached data found')
    return NextResponse.json({
      success: false,
      error: 'No cached data table found for this URL and platform',
      message: `Please run the generation script first: tsx scripts/generate-data-table.ts ${agenticPlatform} ${brandUrl}`,
      brandUrl,
      platform: agenticPlatform,
      cached: false
    }, { status: 404 })
    
  } catch (error) {
    console.error('Error in get_full_data_table API:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  } finally {
    // Close MongoDB connection
    await closeDatabaseConnection()
  }
}
