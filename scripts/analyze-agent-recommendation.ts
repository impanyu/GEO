#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  AgentRecommendationContentCache,
  closeDatabaseConnection,
  type WebsiteContent,
  type ContentSnippets
} from '../lib/models/AgentRecommendationContentCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import OpenAI from 'openai'
import FirecrawlApp from '@mendable/firecrawl-js'

// Configuration constants
const SAMPLED_PROMPTS_NUM = 300
const CALLS_PER_PROMPT = 1

// 15 Content Dimensions for Brand Analysis (same as analyze-web-content.ts)
const CONTENT_DIMENSIONS = [
  'Functionality',
  'Quality', 
  'Performance / Reliability',
  'Design & Aesthetic / Visual Identity',
  'Price / Value Proposition',
  'Innovation / Technology',
  'Safety / Security / Privacy',
  'Sustainability / Ethical Practices',
  'Trustworthiness / Credibility',
  'Core Values / Mission / Purpose',
  'Story / Origin / Anecdote',
  'Emotional Connection / Personality',
  'Differentiation / Unique Selling Proposition (USP)',
  'User / Audience Identity & Experience',
  'After-Sales Support / Community / Loyalty'
]

const CONTENT_DIMENSIONS_DESCRIPTIONS = {
  'Functionality': 'What the product or brand does. Its core functions, features, what problem it solves.',
  'Quality': 'The standard or grade of the product: materials, build, craftsmanship, durability, excellence in execution.',
  'Performance / Reliability': 'How well the product delivers in real use: consistent performance, uptime, stability, dependability.',
  'Design & Aesthetic / Visual Identity': 'The visual look and style: form, color, shape, packaging, UI/UX style, art direction.',
  'Price / Value Proposition': 'What the customer gets for the price: cost-vs-benefits, whether premium, mid-tier, budget, value for money.',
  'Innovation / Technology': 'Novel aspects: what\'s new, what\'s advanced, technological edge, R&D, patents, first-mover, unique mechanism.',
  'Safety / Security / Privacy': 'How safe or secure the product or brand is: physical safety, data protection, privacy policies, compliance.',
  'Sustainability / Ethical Practices': 'Environmental friendliness, socially ethical sourcing, carbon footprint, fair trade, cruelty-free, community impact.',
  'Trustworthiness / Credibility': 'Evidence of trust: certifications, guarantees, third-party reviews, awards, endorsements, brand reputation.',
  'Core Values / Mission / Purpose': 'What the brand stands for: its raison d\'être, belief system, social mission, cultural or moral stance.',
  'Story / Origin / Anecdote': 'The narrative behind the brand: founder\'s story, how it started, pivotal moments, anecdotes that humanize the brand.',
  'Emotional Connection / Personality': 'The emotional tone, the "personality" of the brand: friendly, bold, compassionate, adventurous; how people feel about it.',
  'Differentiation / Unique Selling Proposition (USP)': 'What sets this brand/product apart from competitors: special features, niche focus, unique benefit no one else offers.',
  'User / Audience Identity & Experience': 'Who uses this product and how: user lifestyle, demographics, how it fits into their daily lives; UX, ease of use.',
  'After-Sales Support / Community / Loyalty': 'What happens after purchase: warranty/support, customer service, community building, loyalty programs, repeat engagement.'
}

// Supported agent platforms
const SUPPORTED_PLATFORMS = ['openai'] as const
type AgentPlatform = typeof SUPPORTED_PLATFORMS[number]

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

interface Annotation {
  type: string
  title?: string
  url?: string
  start_index?: number
  end_index?: number
  content?: string // Additional content from OpenRouter's url_citation
}

interface AgentResponse {
  content: string
  annotations: Annotation[]
}

// Initialize OpenAI client (native OpenAI)
let openai: OpenAI
let firecrawlApp: FirecrawlApp

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  }
  return openai
}

function getFirecrawl(): FirecrawlApp {
  if (!firecrawlApp) {
    firecrawlApp = new FirecrawlApp({
      apiKey: process.env.FIRECRAWL_API_KEY
    })
  }
  return firecrawlApp
}

/**
 * Extract domain part from URL (removing path, query, fragment)
 */
function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    return `${urlObj.protocol}//${urlObj.hostname}`
  } catch {
    return url
  }
}

/**
 * Scrape page content using Firecrawl library
 */
async function scrapePageWithFirecrawl(url: string, brandNames: string[]): Promise<string> {
  try {
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured')
    }

    console.log(`    🔥 Scraping: ${url}`)

    const firecrawl = getFirecrawl()
    const brandContext = brandNames.length > 0 ? brandNames.join(', ') : 'the brands'
    
    // Use the library to scrape with multiple formats
    const result = await firecrawl.scrape(url, {
      formats: [
        'summary',
        {
          type: 'json',
          prompt: `Extract a comprehensive summary of the page content, specifically focusing on information about "${brandContext}" and related products or services. Include key details about features, benefits, company information, pricing, reviews, and any brand-related content. Prioritize content that mentions or relates to ${brandContext}.`
        }
      ]
    })
    
    let summary = ''
    
    // Try to get summary from the response
    if (result.summary && typeof result.summary === 'string') {
      summary = result.summary
      console.log(`    ✅ Scraped successfully using summary (${summary.length} chars)`)
    }
    // Try to get from JSON response
    else if (result.json && typeof result.json === 'object') {
      summary = (result.json as any).summary || JSON.stringify(result.json)
      console.log(`    ✅ Scraped successfully using JSON object (${summary.length} chars)`)
    }
    // Fallback to markdown
    else if (result.markdown && typeof result.markdown === 'string') {
      summary = result.markdown
      console.log(`    ✅ Scraped successfully using markdown (${summary.length} chars)`)
    }
    else {
      console.log(`    ⚠️ No content found in Firecrawl response`)
      return ''
    }
    
    return summary.trim()
    
  } catch (error) {
    console.log(`    ❌ Firecrawl error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return ''
  }
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
async function callOpenAIWithWebSearch(prompt: string, retries: number = 3): Promise<AgentResponse> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000) // Exponential backoff, max 10s
        console.log(`    ⏳ Retry attempt ${attempt}/${retries} after ${waitTime}ms...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
      
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
      
      // Extract output_text
      const output_text = (response as any).output_text || ''
      console.log('Response length:', output_text.length)
      console.log('Output text sample:', output_text.substring(0, 200) + '...')
      
      // Extract annotations from the response
      let annotations: Annotation[] = []
      
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
        content: output_text,
        annotations
      }
      
    } catch (error) {
      console.error(`Error calling OpenAI (attempt ${attempt}/${retries}):`, error)
      
      if (attempt === retries) {
        throw new Error(`OpenAI API error after ${retries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      
      // Log retry info
      console.log(`⚠️ Attempt ${attempt} failed, will retry...`)
    }
  }
  
  // This should never be reached due to the throw above
  throw new Error('Unexpected error in OpenAI web search')
}

/**
 * Extract summaries from annotation URLs using Firecrawl
 */
async function extractSummariesFromAnnotations(annotations: Annotation[], brandNames: string[]): Promise<{ [domain: string]: string }> {
  const summariesByDomain: { [domain: string]: string } = {}
  const processedUrls = new Set<string>()
  
  console.log(`    📄 Processing ${annotations.length} annotations with Firecrawl...`)
  
  for (const annotation of annotations) {
    if (annotation.url) {
      try {
        // Skip if we've already processed this exact URL
        if (processedUrls.has(annotation.url)) {
          console.log(`    🔄 Skipping already processed URL: ${annotation.url}`)
          continue
        }
        
        // Extract and normalize domain from annotation URL
        const domainUrl = extractDomainFromUrl(annotation.url)
        const normalizedDomain = normalizeUrl(domainUrl)
        
        console.log(`    🔗 Processing URL: ${annotation.url}`)
        console.log(`    📋 Title: ${annotation.title || 'No title'}`)
        
        // Mark this URL as processed
        processedUrls.add(annotation.url)
        
        // Scrape the URL to get summary content
        const summary = await scrapePageWithFirecrawl(annotation.url, brandNames)
        
        if (summary && summary.length > 0) {
          // Store summary for this domain (merge if domain already exists)
          if (!summariesByDomain[normalizedDomain]) {
            summariesByDomain[normalizedDomain] = summary
          } else {
            // Append to existing summary with separator
            summariesByDomain[normalizedDomain] += '\n\n' + summary
          }
          
          console.log(`    ✅ Added summary for ${normalizedDomain} (${summary.length} chars)`)
        } else {
          console.log(`    ⚠️ No summary extracted for ${normalizedDomain}`)
        }
        
        // Rate limiting - small delay between Firecrawl requests
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.log(`    ❌ Error processing annotation: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  }
  
  console.log(`    📊 Extracted summaries from ${Object.keys(summariesByDomain).length} domains (${processedUrls.size} unique URLs processed)`)
  return summariesByDomain
}

/**
 * Categorize summary content into dimensions by decomposing into sentences
 */
async function categorizeSummaryWithGPT(summary: string, brandNames: string[]): Promise<{ [dimension: string]: string[] }> {
  try {
    if (!summary || summary.length === 0) {
      return {}
    }

    const dimensionsList = CONTENT_DIMENSIONS
      .map((dimension, index) => `${index + 1}. ${dimension}: ${CONTENT_DIMENSIONS_DESCRIPTIONS[dimension as keyof typeof CONTENT_DIMENSIONS_DESCRIPTIONS]}`)
      .join('\n')

    const brandContext = brandNames.length > 0 ? `about "${brandNames.join(', ')}"` : ''

    const prompt = `
You are analyzing content ${brandContext} and need to decompose it into sentences and categorize each sentence into content dimensions.

CONTENT DIMENSIONS:
${dimensionsList}

CRITICAL INSTRUCTIONS:
1. First, decompose the provided summary into individual meaningful sentences
2. Each sentence should be at least 10 words long and contain meaningful information
3. Skip sentences that are just navigation, headers, or non-content text
4. For each sentence, assign it to the ONE most relevant dimension
5. If a sentence doesn't fit any dimension well, place it in the closest match
6. Each sentence should appear in the output exactly once
7. Do NOT create new content - only use sentences from the provided summary

CONTENT SUMMARY TO ANALYZE:
${summary}

Return a JSON object where sentences are categorized by dimension:
{
  "Functionality": ["sentence about what the product does", "sentence about features"],
  "Quality": ["sentence about product quality"],
  "Price / Value Proposition": ["sentence about pricing or value"],
  ...
}

REMEMBER: Extract and categorize actual sentences from the summary. Each sentence should be meaningful and informative.

Return only the JSON object, no other text.
`

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    })

    const responseText = response.choices[0].message.content || '{}'
    
    // Clean and parse JSON response
    const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim()
    
    try {
      const parsed = JSON.parse(cleanedResponse)
      
      // Validate that the response contains valid dimensions and remove duplicates
      const validDimensions: { [dimension: string]: string[] } = {}
      const allUsedSentences = new Set<string>()
      
      for (const [dimension, sentences] of Object.entries(parsed)) {
        if (CONTENT_DIMENSIONS.includes(dimension) && Array.isArray(sentences)) {
          const validSentences: string[] = []
          
          for (const sentence of sentences) {
            if (typeof sentence === 'string' && sentence.length > 0) {
              const trimmedSentence = sentence.trim()
              
              // Check for minimum length and avoid duplicates
              if (trimmedSentence.length >= 10 && !allUsedSentences.has(trimmedSentence)) {
                allUsedSentences.add(trimmedSentence)
                validSentences.push(trimmedSentence)
              } else if (trimmedSentence.length < 10) {
                console.log(`    ⚠️ Skipping short sentence: "${trimmedSentence}"`)
              } else {
                console.log(`    🔄 Duplicate sentence skipped: "${trimmedSentence.substring(0, 50)}..."`)
              }
            }
          }
          
          if (validSentences.length > 0) {
            validDimensions[dimension] = validSentences
          }
        }
      }
      
      console.log(`    📊 Processed ${allUsedSentences.size} unique sentences across ${Object.keys(validDimensions).length} dimensions`)
      
      return validDimensions
    } catch (parseError) {
      console.error('⚠️ Failed to parse GPT response as JSON')
      return {}
    }

  } catch (error) {
    console.error('⚠️ Error categorizing snippets with GPT:', error)
    return {}
  }
}

/**
 * Main agent recommendation analysis function
 */
async function analyzeAgentRecommendationForUrls(
  brandUrls: string[], 
  agentPlatform: AgentPlatform = 'openai'
): Promise<void> {
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
    if (!SUPPORTED_PLATFORMS.includes(agentPlatform)) {
      throw new Error(`Unsupported platform: ${agentPlatform}. Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`)
    }

    console.log(`🚀 Starting agent recommendation analysis for ${brandUrls.length} URLs with platform: ${agentPlatform}`)
    console.log(`URLs: ${brandUrls.join(', ')}`)
    
    // Normalize all brand URLs for consistent storage
    const normalizedBrandUrls = brandUrls.map(url => normalizeUrl(url))
    console.log(`Normalized URLs: ${normalizedBrandUrls.join(', ')}`)
    
    // Step 1: Get prompt sets for all URLs and merge them
    console.log('Step 1: Getting prompt sets for all URLs...')
    let allPrompts: string[] = []
    const brandNames: string[] = []
    
    for (const brandUrl of brandUrls) {
      console.log(`Getting prompts for: ${brandUrl}`)
      const promptSet = await getPromptSet(brandUrl)
      allPrompts.push(...promptSet.prompts)
      brandNames.push(promptSet.brandName)
    }
    
    console.log(`Total prompts collected: ${allPrompts.length}`)
    console.log(`Brand names: ${brandNames.join(', ')}`)
    
    // Step 2: Randomly sample prompts from merged set
    const selectedPrompts = allPrompts.length <= SAMPLED_PROMPTS_NUM 
      ? allPrompts 
      : allPrompts.sort(() => Math.random() - 0.5).slice(0, SAMPLED_PROMPTS_NUM)
    console.log(`Randomly selected ${selectedPrompts.length} prompts for analysis (configured: ${SAMPLED_PROMPTS_NUM})`)
    
    // Step 3: Initialize the website content structure
    const websiteContent: WebsiteContent = {}
    
    // Initialize all dimensions
    CONTENT_DIMENSIONS.forEach(dimension => {
      websiteContent[dimension] = {}
    })
    
    // Step 4: Process each prompt with multiple calls and store incrementally
    let documentId: string | null = null
    
    // Try to find existing document for incremental updates
    try {
      const collection = await AgentRecommendationContentCache.getCollectionInstance()
      const existingDoc = await collection.findOne({
        normalizedBrandUrls: { $all: normalizedBrandUrls },
        agentPlatform: agentPlatform
      })
      
      if (existingDoc) {
        documentId = existingDoc._id?.toString() || null
        // Load existing websiteContent to append to it
        if (existingDoc.websiteContent) {
          Object.assign(websiteContent, existingDoc.websiteContent)
        }
        console.log(`📄 Found existing document, will update incrementally: ${documentId}`)
      } else {
        console.log(`📄 No existing document found, will create new one`)
      }
    } catch (error) {
      console.log(`⚠️ Error checking for existing document: ${error}`)
    }
    
    for (let i = 0; i < selectedPrompts.length; i++) {
      const prompt = selectedPrompts[i]
      console.log(`\n📊 Processing prompt ${i + 1}/${selectedPrompts.length}: "${prompt.substring(0, 50)}..."`)
      
      try {        
        // Step 5: Categorize snippets by domain and dimension
        const domainSnippetsMap = new Map<string, string[]>()
        
        // Collect all snippets by domain for this prompt
        for (let callIndex = 0; callIndex < CALLS_PER_PROMPT; callIndex++) {
          console.log(`  🔍 Call ${callIndex + 1}/${CALLS_PER_PROMPT}...`)
          
          try {
            const agentResponse = await callOpenAIWithWebSearch(prompt)
            
            // Extract summaries from annotation URLs using Firecrawl
            const summariesByDomain = await extractSummariesFromAnnotations(agentResponse.annotations, brandNames)
            
            console.log(`    📄 Extracted summaries from ${Object.keys(summariesByDomain).length} domains`)
            
            // Merge summaries by domain
            for (const [domain, summary] of Object.entries(summariesByDomain)) {
              if (!domainSnippetsMap.has(domain)) {
                domainSnippetsMap.set(domain, [])
              }
              // For now, store summary as a single "snippet" - we'll decompose it later
              domainSnippetsMap.get(domain)!.push(summary)
            }
            
            // Rate limiting delay
            await new Promise(resolve => setTimeout(resolve, 2000))
            
          } catch (error) {
            console.error(`    ❌ Error in call ${callIndex + 1}:`, error)
          }
        }
        
        console.log(`  📊 Total snippets collected for prompt: ${Array.from(domainSnippetsMap.values()).flat().length} from ${domainSnippetsMap.size} domains`)
        
        // Categorize summaries for each domain
        for (const [domain, summaries] of Array.from(domainSnippetsMap.entries())) {
          if (summaries.length > 0) {
            console.log(`  🤖 Processing ${summaries.length} summaries for domain: ${domain}`)
            
            try {
              // Combine all summaries for this domain
              const combinedSummary = summaries.join('\n\n')
              console.log(`    📝 Combined summary length: ${combinedSummary.length} chars`)
              console.log(`    📄 Summary preview: "${combinedSummary.substring(0, 200)}..."`)
              
              // Decompose summary into sentences and categorize
              const categorizedSentences = await categorizeSummaryWithGPT(combinedSummary, brandNames)
              
              const outputCount = Object.values(categorizedSentences).flat().length
              console.log(`    📤 Output from GPT: ${outputCount} sentences`)
              
              // Add categorized sentences to website content by domain
              for (const [dimension, dimensionSentences] of Object.entries(categorizedSentences)) {
                if (!websiteContent[dimension][domain]) {
                  websiteContent[dimension][domain] = []
                }
                
                // Add unique sentences only
                const existingSentences = new Set(websiteContent[dimension][domain])
                for (const sentence of dimensionSentences) {
                  if (!existingSentences.has(sentence)) {
                    websiteContent[dimension][domain].push(sentence)
                  }
                }
              }
              
              const totalCategorizedSentences = Object.values(categorizedSentences).flat().length
              console.log(`    ✅ Added ${totalCategorizedSentences} categorized sentences for ${domain}`)
              
            } catch (error) {
              console.log(`    ❌ Error categorizing summary for domain ${domain}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }
        }
          
        // Store/update results in MongoDB after each prompt
        try {
          if (documentId) {
            // Update existing document
            await AgentRecommendationContentCache.update(documentId, {
              totalPrompts: allPrompts.length,
              sampledPrompts: selectedPrompts.length,
              callsPerPrompt: CALLS_PER_PROMPT,
              websiteContent: websiteContent,
              sampledTime: new Date()
            })
            console.log(`  💾 Updated MongoDB document after prompt ${i + 1}`)
          } else {
            // Create new document
            documentId = await AgentRecommendationContentCache.create(
              brandNames,
              normalizedBrandUrls,
              agentPlatform,
              allPrompts.length,
              selectedPrompts.length,
              CALLS_PER_PROMPT,
              websiteContent
            )
            console.log(`  💾 Created new MongoDB document: ${documentId}`)
          }
        } catch (dbError) {
          console.log(`  ❌ Error saving to MongoDB: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`)
        }
        
        // Progress update
        const progress = ((i + 1) / selectedPrompts.length * 100).toFixed(1)
        console.log(`  📈 Progress: ${progress}% (${i + 1}/${selectedPrompts.length} prompts completed)`)
        
        // Delay between prompts
        if (i < selectedPrompts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
        
      } catch (error) {
        console.error(`❌ Error processing prompt ${i + 1}:`, error)
      }
    }
    
    // Step 6: Final summary (results already stored incrementally)
    console.log(`\n✅ All prompts processed and stored incrementally!`)
    
    if (documentId) {
      console.log(`✅ Analysis complete! Document ID: ${documentId}`)
      
      // Print summary
      const totalDomains = new Set(
        Object.values(websiteContent).flatMap(dimensionContent => Object.keys(dimensionContent))
      ).size
      const totalSnippets = Object.values(websiteContent).reduce((sum, dimensionContent) => 
        sum + Object.values(dimensionContent).reduce((dimSum, snippets) => 
          dimSum + snippets.length, 0), 0)
      
      console.log(`📊 Summary:`)
      console.log(`  🏷️ Brands: ${brandNames.join(', ')}`)
      console.log(`  🔗 Normalized URLs: ${normalizedBrandUrls.join(', ')}`)
      console.log(`  🤖 Agent Platform: ${agentPlatform}`)
      console.log(`  📝 Total Prompts: ${allPrompts.length}`)
      console.log(`  🎯 Sampled Prompts: ${selectedPrompts.length}`)
      console.log(`  📞 Calls per Prompt: ${CALLS_PER_PROMPT}`)
      console.log(`  🌐 Unique Domains: ${totalDomains}`)
      console.log(`  📄 Total Snippets: ${totalSnippets}`)
    } else {
      console.error(`❌ Failed to store analysis results`)
    }
    
  } catch (error) {
    console.error('❌ Error in agent recommendation analysis:', error)
    throw error
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length < 1) {
    console.log('Usage: tsx scripts/analyze-agent-recommendation.ts [platform] <brand-url1> <brand-url2> ...')
    console.log('Example: tsx scripts/analyze-agent-recommendation.ts openai https://apple.com https://microsoft.com')
    console.log('Example: tsx scripts/analyze-agent-recommendation.ts https://apple.com (defaults to openai platform)')
    console.log(`Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`)
    process.exit(1)
  }
  
  // Parse arguments: first could be platform or URL
  let agentPlatform: AgentPlatform = 'openai'
  let brandUrls: string[] = []
  
  if (SUPPORTED_PLATFORMS.includes(args[0] as AgentPlatform)) {
    // First argument is platform
    agentPlatform = args[0] as AgentPlatform
    brandUrls = args.slice(1)
  } else {
    // First argument is URL, use default platform
    brandUrls = args
  }
  
  if (brandUrls.length === 0) {
    console.log('❌ Error: At least one brand URL is required')
    process.exit(1)
  }

  // Check required environment variables
  const requiredEnvVars = ['OPENAI_API_KEY', 'FIRECRAWL_API_KEY', 'MONGODB_URI']
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName])
  
  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:')
    missingVars.forEach(varName => console.log(`  - ${varName}`))
    console.log('\nPlease add these to your .env.local file')
    process.exit(1)
  }

  try {
    console.log(`🎯 Configuration:`)
    console.log(`  🌐 Brand URLs: ${brandUrls.length}`)
    console.log(`  🤖 Agent Platform: ${agentPlatform}`)
    console.log(`  📏 Content dimensions: ${CONTENT_DIMENSIONS.length}`)
    console.log(`  🎯 Sampled prompts: ${SAMPLED_PROMPTS_NUM}`)
    console.log(`  📞 Calls per prompt: ${CALLS_PER_PROMPT}`)
    console.log(`  🔗 Original URLs: ${brandUrls.join(', ')}`)

    await analyzeAgentRecommendationForUrls(brandUrls, agentPlatform)
    
  } catch (error) {
    console.error('\n❌ Analysis failed:', error)
    process.exit(1)
  } finally {
    // Close database connections
    await closeDatabaseConnection()
    process.exit(0)
  }
}

// Export for use as module
export { analyzeAgentRecommendationForUrls }

// Run CLI if called directly
if (require.main === module) {
  main()
}
