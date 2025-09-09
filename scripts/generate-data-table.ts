#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  DataTableCache, 
  QueryResponseCache,
  closeDatabaseConnection, 
  type DataTableResult,
  type QueryResponse,
  type BrandAnalysis
} from '../lib/models/DataTableCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import OpenAI from 'openai'

// Supported agentic platforms
const SUPPORTED_PLATFORMS = ['openai', 'google-ai'] as const
type AgenticPlatform = typeof SUPPORTED_PLATFORMS[number]

// Configuration: Number of queries per prompt (adjust this value to change query frequency)
const QUERIES_PER_PROMPT = 5

// Configuration: Number of prompts to sample for analysis (adjust this value to change sample size)
const SAMPLED_PROMPTS_COUNT = 5

interface GeneratePromptSetResponse {
  success: boolean
  brandUrl: string
  brandName: string
  topics: string[]
  keywords: string[]
  totalPrompts: number
  prompts: string[]
  keywordToTopic: { [keyword: string]: string }
  promptToKeyword: { [prompt: string]: string }
}

interface AssistantResponse {
  output_text: string
  annotations: Array<{
    type: string
    title?: string
    url?: string
    index?: number | null
  }>
}

// Initialize OpenAI client (lazy initialization)
let openai: OpenAI

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  }
  return openai
}

/**
 * Call the /generate_prompt_set API to get prompts and brand name
 */
async function getPromptSet(brandUrl: string): Promise<GeneratePromptSetResponse> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/generate_prompt_set?url=${encodeURIComponent(brandUrl)}`)
    
    if (!response.ok) {
      throw new Error(`Failed to get prompt set: ${response.status}`)
    }
    
    const data: GeneratePromptSetResponse = await response.json()
    
    if (!data.success) {
      throw new Error('Failed to generate prompt set')
    }
    
    return data
  } catch (error) {
    console.error('Error getting prompt set:', error)
    throw new Error(`Failed to get prompt set: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Call OpenAI with web search tool and return output_text and annotations
 */
async function callOpenAIAssistant(prompt: string): Promise<AssistantResponse> {
  try {
    console.log(`🔍 Making OpenAI call with web search for: "${prompt.substring(0, 50)}..."`)
    
    // Try multiple approaches for web search
    let response;
    let searchMethod = 'unknown';
    
    try {
      // Method 1: Force web search with tool_choice
      searchMethod = 'forced web_search_preview';
      response = await getOpenAI().responses.create({
        model: 'gpt-4o',
        tools: [{ 
          type: 'web_search_preview',
          search_context_size: 'high'
        }],
        tool_choice: 'required',  // Force tool usage
        input: `Please search the web for current information about: ${prompt}`
      })
    } catch (forcedError) {
      console.log('⚠️ Forced web search failed, trying without force:', forcedError instanceof Error ? forcedError.message : 'Unknown error')
      
      try {
        // Method 2: Try without forcing tool usage
        searchMethod = 'optional web_search_preview';
        response = await getOpenAI().responses.create({
          model: 'gpt-4o',
          tools: [{ 
            type: 'web_search_preview',
            search_context_size: 'high'
          }],
          input: `Please search the web for current information about: ${prompt}`
        })
      } catch (optionalError) {
        console.log('⚠️ Optional web search failed, trying basic web_search:', optionalError instanceof Error ? optionalError.message : 'Unknown error')
        
        // Method 3: Try basic web_search
        searchMethod = 'basic web_search';
        response = await getOpenAI().responses.create({
          model: 'gpt-4o',
          tools: [{ 
            type: 'web_search'
          }],
          input: `Please search the web for current information about: ${prompt}`
        })
      }
    }
    
    console.log(`🎯 OpenAI Responses API successful using: ${searchMethod}`)
    
    // Debug: Log the full response structure
    console.log('Full response structure:')
    console.log(JSON.stringify(response, null, 2))
    
    // Extract output_text
    const output_text = (response as any).output_text || ''
    console.log('Response length:', output_text.length)
    console.log('Output text sample:', output_text.substring(0, 200) + '...')
    
    // Extract annotations from the response
    let annotations: Array<{
      type: string
      title?: string
      url?: string
      index?: number | null
    }> = []
    
    try {
      const responseData = response as any
      console.log('Attempting to extract annotations...')
      
      // Try multiple possible locations for annotations
      if (responseData.output && Array.isArray(responseData.output)) {
        console.log('Found output array with', responseData.output.length, 'items')
        for (const outputItem of responseData.output) {
          console.log('Output item type:', outputItem.type)
          if (outputItem.content && Array.isArray(outputItem.content)) {
            console.log('Found content array with', outputItem.content.length, 'items')
            for (const contentItem of outputItem.content) {
              console.log('Content item:', JSON.stringify(contentItem, null, 2))
              if (contentItem.annotations && Array.isArray(contentItem.annotations)) {
                console.log('Found annotations:', contentItem.annotations.length)
                annotations.push(...contentItem.annotations)
              }
            }
          }
        }
      }
      
      // Also check if annotations are directly in the response
      if (responseData.annotations && Array.isArray(responseData.annotations)) {
        console.log('Found direct annotations:', responseData.annotations.length)
        annotations.push(...responseData.annotations)
      }
      
    // Check if there are any web search results or citations
    if (responseData.web_search_results) {
      console.log('Found web_search_results:', JSON.stringify(responseData.web_search_results, null, 2))
    }
    
    // Check if web search was actually performed
    const hasWebSearchActivity = responseData.output?.some((item: any) => 
      item.type === 'web_search_call' || 
      item.type === 'web_search' ||
      (item.content && item.content.some((content: any) => content.type === 'web_search'))
    )
    
    console.log('🌐 Web search activity detected:', hasWebSearchActivity)
    
    // Analyze response text for signs of web search
    const hasCurrentInfo = output_text.includes('2024') || 
                          output_text.includes('2025') || 
                          output_text.includes('recently') ||
                          output_text.includes('currently') ||
                          output_text.includes('latest') ||
                          output_text.includes('http') ||
                          output_text.includes('www.')
    
    console.log('📊 Response appears to contain current/web info:', hasCurrentInfo)
    
    // Warning if no web search detected
    if (!hasWebSearchActivity && !hasCurrentInfo) {
      console.log('⚠️ WARNING: No evidence of web search activity - response may be from training data only')
    }
      
    } catch (annotationError) {
      console.log('⚠️ Could not extract annotations:', annotationError)
    }
    
    console.log(`Extracted ${annotations.length} annotations`)
    if (annotations.length > 0) {
      console.log('Sample annotation:', JSON.stringify(annotations[0], null, 2))
    }
    
    return {
      output_text,
      annotations
    }
  } catch (error) {
    console.error('Error calling OpenAI:', error)
    throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Call Google AI Assistant (placeholder)
 */
async function callGoogleAIAssistant(prompt: string): Promise<AssistantResponse> {
  throw new Error('Google AI integration not yet implemented. Please use "openai" platform.')
}

/**
 * Call the specified agentic platform
 */
async function callAgenticPlatform(platform: AgenticPlatform, prompt: string): Promise<AssistantResponse> {
  switch (platform) {
    case 'openai':
      return await callOpenAIAssistant(prompt)
    case 'google-ai':
      return await callGoogleAIAssistant(prompt)
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

/**
 * Extract brand name from domain (middle part)
 */
function extractBrandNameFromDomain(url: string): string {
  try {
    const domain = new URL(url).hostname.replace('www.', '')
    const parts = domain.split('.')
    return parts[0] // Return the first part as brand name
  } catch {
    return url
  }
}

/**
 * Analyze brand mentions for multiple brands in response text
 */
async function analyzeBrandMentions(
  brandNames: string[],
  responseTexts: string[] // Array of QUERIES_PER_PROMPT response texts
): Promise<BrandAnalysis[]> {
  try {
    const analyses: BrandAnalysis[] = []
    
    console.log(`🔍 Analyzing brand mentions for: ${brandNames.join(', ')}`)
    
    // Process each brand
    for (const brandName of brandNames) {
    console.log(`Analyzing brand: ${brandName}`)
    
    let totalAppearancesAcrossResponses = 0
    let totalRankSum = 0
    let responsesWithBrand = 0
    
    // Process each response text (QUERIES_PER_PROMPT responses per prompt)
    for (let i = 0; i < responseTexts.length; i++) {
      const responseText = responseTexts[i]
      console.log(`Processing response ${i + 1}/${QUERIES_PER_PROMPT} for brand: ${brandName}`)
      
      try {
        // Step 1: Extract all brand names from this response
        const brandExtractionPrompt = `
Analyze the following text and extract ALL brand names exactly as they appear in the text, in the exact order they appear.

Text to analyze:
${responseText}

Instructions:
1. Find every brand name, company name, product name mentioned
2. List them in the exact order they appear in the text
3. Use the exact spelling and capitalization as in the text
4. Do NOT count generic terms like "laptop", "smartphone", "computer", "software"
5. Include company names, product names, service names

Return ONLY a JSON array of brand names in order:
["Apple", "Samsung", "iPhone", "Galaxy", "Microsoft", "Windows"]

If no brands are mentioned, return an empty array: []
`

        const brandExtractionResponse = await getOpenAI().responses.create({
          model: 'gpt-4o',
          tools: [{ 
            type: 'web_search',
            search_context_size: 'high'
          }],
          input: brandExtractionPrompt
        })

        const extractionText = (brandExtractionResponse as any).output_text || ''
        
        let extractedBrands: string[] = []
        try {
          const cleanedResponse = extractionText.replace(/```json\n?|\n?```/g, '').trim()
          extractedBrands = JSON.parse(cleanedResponse)
        } catch (parseError) {
          console.log('⚠️ Could not parse brand extraction response')
          extractedBrands = []
        }

        // Step 2: Check if brand appears and find rank for target brand
        const countingPrompt = `
Given this list of brand names in order: ${JSON.stringify(extractedBrands)}

Check if the brand "${brandName}" appears in this list, considering:
- Exact matches
- Minor variations (e.g., "Apple" vs "apple")
- Products/sub-brands under this brand (e.g., iPhone, MacBook for Apple)

Also find the first rank/position where "${brandName}" (or its products) appears in the list (1-based indexing).

Return ONLY a JSON object:
{
  "appears": true,
  "firstRank": 2
}

If the brand doesn't appear at all, return:
{
  "appears": false,
  "firstRank": 0
}
`

        const countingResponse = await getOpenAI().responses.create({
          model: 'gpt-4o',
          tools: [{ 
            type: 'web_search',
            search_context_size: 'high'
          }],
          input: countingPrompt
        })

        const countingText = (countingResponse as any).output_text || ''
        
        let appears = false
        let firstRank = 0
        try {
          const cleanedResponse = countingText.replace(/```json\n?|\n?```/g, '').trim()
          const parsed = JSON.parse(cleanedResponse)
          appears = parsed.appears || false
          firstRank = parsed.firstRank || 0
        } catch (parseError) {
          console.log('⚠️ Could not parse counting response')
        }

        // Count 1 if brand appears at least once in this response
        if (appears) {
          totalAppearancesAcrossResponses += 1
          totalRankSum += firstRank
          responsesWithBrand++
        }

        console.log(`Response ${i + 1}: ${appears ? 'appears' : 'not found'}, rank ${firstRank}`)
        
      } catch (error) {
        console.error(`Error analyzing response ${i + 1} for brand ${brandName}:`, error)
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    // Calculate averages
    // Note: totalAppearancesAcrossResponses is now the count of responses where brand appears (max QUERIES_PER_PROMPT)
    const avgAppearancesPerResponse = responseTexts.length > 0 
      ? totalAppearancesAcrossResponses / responseTexts.length 
      : 0
    const avgRank = responsesWithBrand > 0 
      ? totalRankSum / responsesWithBrand 
      : 0
    
    const brandAnalysis: BrandAnalysis = {
      brandName,
      totalAppearancesAcrossResponses: totalAppearancesAcrossResponses,
      avgAppearancesPerResponse: Math.round(avgAppearancesPerResponse * 100) / 100,
      avgRank: Math.round(avgRank * 100) / 100
    }
    
    analyses.push(brandAnalysis)
    
      console.log(`Brand ${brandName} analysis complete:`, brandAnalysis)
    }
    
    return analyses
  } catch (error) {
    console.error('Error analyzing brand mentions:', error)
    // Return default analysis for all brands
    return brandNames.map(brandName => ({
      brandName,
      totalAppearancesAcrossResponses: 0,
      avgAppearancesPerResponse: 0,
      avgRank: 0
    }))
  }
}

/**
 * Main data table generation function for multiple brand URLs
 */
async function generateDataTableForUrls(
  brandUrls: string[], 
  agenticPlatform: AgenticPlatform = 'openai'
): Promise<DataTableResult[]> {
  try {
    // Validate URL formats
    for (const url of brandUrls) {
      try {
        new URL(url)
      } catch {
        throw new Error(`Invalid URL format: ${url}`)
      }
    }

    // Validate platform
    if (!SUPPORTED_PLATFORMS.includes(agenticPlatform)) {
      throw new Error(`Unsupported platform: ${agenticPlatform}. Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`)
    }

    console.log(`Starting data table generation for ${brandUrls.length} URLs with platform: ${agenticPlatform}`)
    console.log(`URLs: ${brandUrls.join(', ')}`)
    
    // Step 1: Get prompt sets for all URLs and merge them
    console.log('Step 1: Getting prompt sets for all URLs...')
    let allPrompts: string[] = []
    let promptToTopicMap: { [prompt: string]: string } = {}
    const brandNames: string[] = []
    const normalizedUrls: string[] = []
    
    for (const brandUrl of brandUrls) {
      console.log(`Getting prompts for: ${brandUrl}`)
      const promptSet = await getPromptSet(brandUrl)
      allPrompts.push(...promptSet.prompts)
      brandNames.push(promptSet.brandName)  // Use brand name from API response
      normalizedUrls.push(normalizeUrl(brandUrl))
      
      // Map each prompt to its topic using the promptToKeyword and keywordToTopic mappings
      console.log(`Mapping topics for ${promptSet.prompts.length} prompts from ${brandUrl}`)
      console.log('Available promptToKeyword mappings:', Object.keys(promptSet.promptToKeyword).length)
      console.log('Available keywordToTopic mappings:', Object.keys(promptSet.keywordToTopic).length)
      
      for (const prompt of promptSet.prompts) {
        const keyword = promptSet.promptToKeyword[prompt]
        if (keyword) {
          const topic = promptSet.keywordToTopic[keyword]
          if (topic) {
            promptToTopicMap[prompt] = topic
            console.log(`Mapped prompt "${prompt.substring(0, 30)}..." → keyword: "${keyword}" → topic: "${topic}"`)
          } else {
            console.log(`⚠️ No topic found for keyword: "${keyword}"`)
          }
        } else {
          console.log(`⚠️ No keyword found for prompt: "${prompt.substring(0, 30)}..."`)
        }
      }
    }
    
    console.log(`Total prompts collected: ${allPrompts.length}`)
    console.log(`Brand names: ${brandNames.join(', ')}`)
    
    // Step 2: Randomly sample prompts from merged set
    const selectedPrompts = allPrompts.length <= SAMPLED_PROMPTS_COUNT 
      ? allPrompts 
      : allPrompts.sort(() => Math.random() - 0.5).slice(0, SAMPLED_PROMPTS_COUNT)
    console.log(`Randomly selected ${selectedPrompts.length} prompts for analysis (configured: ${SAMPLED_PROMPTS_COUNT})`)
    
    // Step 3: For each prompt, query multiple times and store responses
    const results: DataTableResult[] = []
    
    for (let i = 0; i < selectedPrompts.length; i++) {
      const prompt = selectedPrompts[i]
      console.log(`Processing prompt ${i + 1}/${selectedPrompts.length}: "${prompt.substring(0, 50)}..."`)
      
      try {
        // Query the platform multiple times for this prompt
        console.log(`Querying platform ${QUERIES_PER_PROMPT} times for prompt ${i + 1}...`)
        const responses: QueryResponse[] = []
        const responseTexts: string[] = []
        
        for (let j = 0; j < QUERIES_PER_PROMPT; j++) {
          console.log(`Query ${j + 1}/${QUERIES_PER_PROMPT}...`)
          try {
            const assistantResponse = await callAgenticPlatform(agenticPlatform, prompt)
            responses.push({
              output_text: assistantResponse.output_text,
              annotations: assistantResponse.annotations
            })
            responseTexts.push(assistantResponse.output_text)
            
            // Small delay between queries
            await new Promise(resolve => setTimeout(resolve, 1000))
          } catch (error) {
            console.error(`Error in query ${j + 1}:`, error)
            // Add error response
            responses.push({
              output_text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              annotations: []
            })
            responseTexts.push(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }
        
        // Store query responses in MongoDB
        console.log('Storing query responses in MongoDB...')
        const queryResponseId = await QueryResponseCache.create(prompt, responses, agenticPlatform)
        
        if (!queryResponseId) {
          throw new Error('Failed to store query responses')
        }
        
        // Analyze brand mentions across all responses
        console.log(`Analyzing brand mentions across ${QUERIES_PER_PROMPT} responses...`)
        const brandAnalyses = await analyzeBrandMentions(brandNames, responseTexts)
        
        // Create a result for each brand
        const resultsForThisPrompt: DataTableResult[] = []
        for (let i = 0; i < brandNames.length; i++) {
          const brandName = brandNames[i]
          const normalizedUrl = normalizedUrls[i]
          const brandAnalysis = brandAnalyses.find(ba => ba.brandName === brandName)
          
          if (brandAnalysis) {
            const assignedTopic = promptToTopicMap[prompt] || 'Unknown'
            console.log(`Creating DataTableResult - Prompt: "${prompt.substring(0, 30)}..." → Topic: "${assignedTopic}"`)
            
            resultsForThisPrompt.push({
              normalizedBrandUrl: normalizedUrl,
              brandName,
              agenticPlatform,
              prompt,
              topic: assignedTopic, // Get topic from mapping
              datetime: new Date(),
              brandAnalysis,
              totalCitationsOfAllBrands: QUERIES_PER_PROMPT, // Always QUERIES_PER_PROMPT responses
              queryResponseDocumentId: queryResponseId
            })
          }
        }
        
        results.push(...resultsForThisPrompt)
        console.log(`Completed analysis for prompt ${i + 1}`)
        
        // Delay between prompts
        if (i < selectedPrompts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
        
      } catch (error) {
        console.error(`Error processing prompt ${i + 1}:`, error)
        
        // Create fallback results for each brand
        const fallbackResults: DataTableResult[] = []
        for (let i = 0; i < brandNames.length; i++) {
          fallbackResults.push({
            normalizedBrandUrl: normalizedUrls[i],
            brandName: brandNames[i],
            agenticPlatform,
            prompt,
            topic: promptToTopicMap[prompt] || 'Unknown', // Get topic from mapping
            datetime: new Date(),
            brandAnalysis: {
              brandName: brandNames[i],
              totalAppearancesAcrossResponses: 0,
              avgAppearancesPerResponse: 0,
              avgRank: 0
            },
            totalCitationsOfAllBrands: QUERIES_PER_PROMPT,
            queryResponseDocumentId: 'error'
          })
        }
        
        results.push(...fallbackResults)
      }
    }
    
    console.log(`Completed analysis of ${results.length} prompts`)
    
    // Cache the results for each brand URL individually
    for (let i = 0; i < brandUrls.length; i++) {
      const brandUrl = brandUrls[i]
      const normalizedUrl = normalizedUrls[i]
      const brandName = brandNames[i]
      
      // Filter results for this specific brand
      const brandSpecificResults = results.filter(result => result.brandName === brandName)
      
      await DataTableCache.upsert(normalizedUrl, brandUrl, brandName, agenticPlatform, brandSpecificResults)
      console.log(`Data table cached for brand: ${brandName} (${normalizedUrl}) - ${brandSpecificResults.length} results`)
    }
    
    console.log('All data tables cached successfully!')
    
    return results
    
  } catch (error) {
    console.error('Error in data table generation:', error)
    throw error
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 1) {
    console.log('Usage: tsx scripts/generate-data-table.ts [platform] <brand-url1> <brand-url2> ...')
    console.log('Example: tsx scripts/generate-data-table.ts openai https://apple.com https://microsoft.com')
    console.log('Example: tsx scripts/generate-data-table.ts https://apple.com (defaults to openai platform)')
    console.log(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`)
    process.exit(1)
  }
  
  // Parse arguments: first could be platform or URL
  let agenticPlatform: AgenticPlatform = 'openai'
  let brandUrls: string[] = []
  
  if (SUPPORTED_PLATFORMS.includes(args[0] as AgenticPlatform)) {
    // First argument is platform
    agenticPlatform = args[0] as AgenticPlatform
    brandUrls = args.slice(1)
  } else {
    // First argument is URL, use default platform
    brandUrls = args
  }
  
  if (brandUrls.length === 0) {
    console.log('❌ Error: At least one brand URL is required')
    process.exit(1)
  }
  
  try {
    console.log(`🚀 Starting data table generation for ${brandUrls.length} brand(s) with platform: ${agenticPlatform}`)
    console.log(`URLs: ${brandUrls.join(', ')}`)
    
    const results = await generateDataTableForUrls(brandUrls, agenticPlatform)
    
    console.log('\n✅ Data table generation completed successfully!')
    console.log(`📊 Generated ${results.length} analysis results`)
    console.log(`🤖 Platform: ${agenticPlatform}`)
    
    // Calculate aggregated metrics by brand
    const brandMetrics = new Map<string, { totalAppearances: number, avgRank: number, count: number }>()
    
    results.forEach(result => {
      const brandName = result.brandName
      const existing = brandMetrics.get(brandName) || { totalAppearances: 0, avgRank: 0, count: 0 }
      
      existing.totalAppearances += result.brandAnalysis.totalAppearancesAcrossResponses
      existing.avgRank += result.brandAnalysis.avgRank
      existing.count += 1
      
      brandMetrics.set(brandName, existing)
    })
    
    console.log(`🏷️ Brands analyzed: ${Array.from(brandMetrics.keys()).join(', ')}`)
    
    brandMetrics.forEach((metrics, brandName) => {
      const avgRank = metrics.avgRank / metrics.count
      console.log(`📈 ${brandName}: ${metrics.totalAppearances} total appearances, avg rank ${avgRank.toFixed(2)}`)
    })
    
  } catch (error) {
    console.error('\n❌ Error generating data table:', error)
    process.exit(1)
  } finally {
    // Close MongoDB connection
    await closeDatabaseConnection()
    process.exit(0)
  }
}

// Export for use as module
export { generateDataTableForUrls }

// Run CLI if called directly
if (require.main === module) {
  main()
}
