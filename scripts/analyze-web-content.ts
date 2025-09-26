#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  FullWebContentCache,
  closeDatabaseConnection,
  type WebsiteContent,
  type ContentSnippets
} from '../lib/models/FullWebContentCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import OpenAI from 'openai'
import FirecrawlApp from '@mendable/firecrawl-js'

// 15 Content Dimensions for Brand Analysis
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

// Initialize OpenAI client
let openai: OpenAI
let firecrawlApp: FirecrawlApp

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/your-repo", // Optional: for OpenRouter rankings
        "X-Title": "GEO Brand Analysis Tool", // Optional: for OpenRouter rankings
      }
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
 * Extract brand name from URL domain
 */
function extractBrandNameFromUrl(url: string): string {
  try {
    const domain = new URL(url).hostname.replace('www.', '')
    const parts = domain.split('.')
    
    // Special extensions that are often part of the brand name
    const brandExtensions = ['.ai', '.chat', '.io', '.dev', '.tech', '.app', '.co']
    
    // Check if domain ends with a brand-relevant extension
    const lastTwoParts = parts.slice(-2).join('.')
    if (parts.length >= 2 && brandExtensions.some(ext => domain.endsWith(ext.substring(1)))) {
      // Include the extension in the brand name (e.g., "rocket.chat" -> "Rocket.chat")
      return lastTwoParts.charAt(0).toUpperCase() + lastTwoParts.slice(1)
    }
    
    // Default: return just the main domain part (before .com, .org, etc.)
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
  } catch {
    return url
  }
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
 * Search Google using SerpApi for organic results
 */
async function searchGoogleWithSerpApi(brandName: string): Promise<any[]> {
  try {
    if (!process.env.SERPAPI_KEY) {
      throw new Error('SERPAPI_KEY not configured')
    }

    console.log(`🔍 Searching Google for "${brandName}"`)

    const allResults: any[] = []
    
    // Get top 100 results (10 results per page, 10 pages)
    for (let page = 0; page < 10; page++) {
      const start = page * 10
      
      const response = await fetch(
        `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(brandName)}&start=${start}&num=10&api_key=${process.env.SERPAPI_KEY}`
      )
      
      if (!response.ok) {
        throw new Error(`SerpApi error: ${response.status}`)
      }

      const data = await response.json()
      const organicResults = data.organic_results || []
      
      console.log(`  📄 Page ${page + 1}: Found ${organicResults.length} results`)
      allResults.push(...organicResults)
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log(`✅ Total organic results found: ${allResults.length}`)
    return allResults
  } catch (error) {
    console.error(`❌ Error searching Google for "${brandName}":`, error)
    return []
  }
}

/**
 * Scrape page content using Firecrawl library
 */
async function scrapePageWithFirecrawl(url: string, brandName: string): Promise<string> {
  try {
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured')
    }

    console.log(`    🔥 Scraping: ${url}`)

    const firecrawl = getFirecrawl()
    
    // Use the library to scrape with multiple formats
    const result = await firecrawl.scrape(url, {
      formats: [

        {
          type: 'json',
          prompt: `Extract a comprehensive summary of the page content,focusing on information about "${brandName}".`
        }
      ]
    })
    
    // The library returns the document directly, not wrapped in success/data
    if (result) {
      // Try to get summary from multiple possible sources
      let summary = ''
      
       if (result.json && typeof result.json === 'string') {
        summary = result.json
        console.log(`    ✅ Scraped successfully using JSON format (${summary.length} chars)`)
      }
      // If JSON is an object, try to extract text content
      else if (result.json && typeof result.json === 'object') {
        summary = result.json.summary || JSON.stringify(result.json)
        console.log(`    ✅ Scraped successfully using JSON object (${summary.length} chars)`)
      }
      // Fallback to markdown if available
      else if (result.markdown) {
        summary = result.markdown
        console.log(`    ✅ Scraped successfully using markdown format (${summary.length} chars)`)
      }
      
      if (summary) {
        return summary
      } else {
        console.log(`    ⚠️ No summary content found in response`)
        return ''
      }
    } else {
      console.log(`    ⚠️ No data extracted from response`)
      return ''
    }
  } catch (error) {
    console.error(`    ❌ Error scraping ${url}:`, error)
    return ''
  }
}

/**
 * Analyze content summary using AI models (via OpenRouter) to categorize sentences into dimensions
 */
async function analyzeContentWithGPT(summary: string, brandName: string): Promise<{ [dimension: string]: string[] }> {
  try {
    if (!summary || summary.length < 50) {
      return {}
    }

    const dimensionsList = CONTENT_DIMENSIONS
      .map((dimension, index) => `${index + 1}. ${dimension}: ${CONTENT_DIMENSIONS_DESCRIPTIONS[dimension as keyof typeof CONTENT_DIMENSIONS_DESCRIPTIONS]}`)
      .join('\n')

    const prompt = `
Analyze the following content summary about "${brandName}" and categorize each sentence into ONE of these 15 content dimensions.

CONTENT DIMENSIONS:
${dimensionsList}

CRITICAL INSTRUCTIONS:
1. Split the content summary into individual sentences first
2. Process each sentence EXACTLY ONCE - no sentence should appear multiple times in the output
3. For each sentence, determine which ONE dimension it belongs to most closely
4. Each sentence should be assigned to exactly ONE dimension only
5. Skip sentences that don't contain meaningful brand/product information
6. Do NOT duplicate any sentences across different dimensions
7. Do NOT include the same sentence multiple times in any dimension
8. Return ONLY a JSON object with each sentence appearing exactly once across all dimensions

Expected JSON format:
{
  "Functionality": ["unique sentence 1", "unique sentence 2"],
  "Quality": ["unique sentence 3"],
  "Price / Value Proposition": ["unique sentence 4", "unique sentence 5"],
  ...
}

CONTENT SUMMARY TO ANALYZE:
${summary}

Important: Each sentence from the summary should appear in the output exactly once. No duplicates allowed.

Return only the JSON object, no other text.
`

    const response = await getOpenAI().chat.completions.create({
      model: 'openai/gpt-4o',
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
          const uniqueSentences: string[] = []
          
          for (const sentence of sentences) {
            if (typeof sentence === 'string' && sentence.length > 0) {
              const trimmedSentence = sentence.trim()
              // Only add if we haven't seen this sentence before
              if (!allUsedSentences.has(trimmedSentence)) {
                allUsedSentences.add(trimmedSentence)
                uniqueSentences.push(trimmedSentence)
              } else {
                console.log(`    ⚠️ Duplicate sentence detected and removed: "${trimmedSentence.substring(0, 50)}..."`)
              }
            }
          }
          
          if (uniqueSentences.length > 0) {
            validDimensions[dimension] = uniqueSentences
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
    console.error('⚠️ Error analyzing content with GPT:', error)
    return {}
  }
}

/**
 * Main analysis function for multiple brand URLs
 */
async function analyzeWebContentForBrands(brandUrls: string[]): Promise<void> {
  try {
    console.log(`🚀 Starting web content analysis for ${brandUrls.length} brands`)
    
    for (let urlIndex = 0; urlIndex < brandUrls.length; urlIndex++) {
      const brandUrl = brandUrls[urlIndex]
      console.log(`\n📊 Processing brand ${urlIndex + 1}/${brandUrls.length}: ${brandUrl}`)
      
      // Extract brand name from URL
      const brandName = extractBrandNameFromUrl(brandUrl)
      console.log(`📱 Brand name: ${brandName}`)
      
      // Search Google for the brand
      const searchResults = await searchGoogleWithSerpApi(brandName)
      
      if (searchResults.length === 0) {
        console.log(`⚠️ No search results found for ${brandName}, skipping...`)
        continue
      }
      
      // Initialize the website content structure
      const websiteContent: WebsiteContent = {}
      
      // Initialize all dimensions
      CONTENT_DIMENSIONS.forEach(dimension => {
        websiteContent[dimension] = {}
      })
      
      console.log(`🌐 Processing ${searchResults.length} search results...`)
      
      // Process each search result
      for (let resultIndex = 0; resultIndex < searchResults.length; resultIndex++) {
        const result = searchResults[resultIndex]
        
        if (!result.link) {
          console.log(`  ⚠️ Result ${resultIndex + 1}: No link, skipping`)
          continue
        }
        
        console.log(`  📄 Processing result ${resultIndex + 1}/${searchResults.length}: ${result.title}`)
        
        try {
          // Scrape page content
          const summary = await scrapePageWithFirecrawl(result.link, brandName)
          
          if (!summary) {
            console.log(`    ⚠️ No summary content, skipping`)
            continue
          }
          
          // Analyze content with AI models via OpenRouter
          const dimensionAnalysis = await analyzeContentWithGPT(summary, brandName)
          
          if (Object.keys(dimensionAnalysis).length === 0) {
            console.log(`    ⚠️ No dimensions analyzed, skipping`)
            continue
          }
          
          // Extract domain part first, then normalize
          const domainUrl = extractDomainFromUrl(result.link)
          const normalizedDomain = normalizeUrl(domainUrl)
          
          // Add sentences to appropriate dimensions
          for (const [dimension, sentences] of Object.entries(dimensionAnalysis)) {
            if (sentences.length > 0) {
              if (!websiteContent[dimension][normalizedDomain]) {
                websiteContent[dimension][normalizedDomain] = {
                  sentences: [],
                  visibility: 0
                }
              }
              websiteContent[dimension][normalizedDomain].sentences.push(...sentences)
            }
          }
          
          const totalSentencesAdded = Object.values(dimensionAnalysis).flat().length
          console.log(`    ✅ Added ${totalSentencesAdded} unique sentences across ${Object.keys(dimensionAnalysis).length} dimensions for domain: ${normalizedDomain}`)
          
          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, 2000))
          
        } catch (error) {
          console.error(`    ❌ Error processing ${result.link}:`, error)
        }
      }
      
      // Store results in MongoDB
      console.log(`\n💾 Storing analysis results for ${brandName}...`)
      const normalizedBrandUrl = normalizeUrl(brandUrl)
      const documentId = await FullWebContentCache.create(brandName, brandUrl, normalizedBrandUrl, websiteContent)
      
      if (documentId) {
        console.log(`✅ Analysis complete for ${brandName}! Document ID: ${documentId}`)
        
        // Print summary
        const totalDomains = new Set(
          Object.values(websiteContent).flatMap(dimensionContent => Object.keys(dimensionContent))
        ).size
        const totalSentences = Object.values(websiteContent).reduce((sum, dimensionContent) => 
          sum + Object.values(dimensionContent).reduce((dimSum, domainData) => 
            dimSum + domainData.sentences.length, 0), 0)
        
        console.log(`  📊 Summary: ${totalDomains} unique domains, ${totalSentences} total sentences`)
      } else {
        console.error(`❌ Failed to store analysis results for ${brandName}`)
      }
      
      // Delay between brands
      if (urlIndex < brandUrls.length - 1) {
        console.log(`⏳ Waiting before processing next brand...`)
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
    
    console.log(`\n🎉 All brand analyses completed!`)
    
  } catch (error) {
    console.error('❌ Error in web content analysis:', error)
    throw error
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.log('Usage: tsx scripts/analyze-web-content.ts <brand-url1> <brand-url2> ...')
    console.log('Example: tsx scripts/analyze-web-content.ts https://apple.com https://microsoft.com')
    process.exit(1)
  }
  
  // Validate all URLs
  const brandUrls: string[] = []
  for (const url of args) {
    try {
      new URL(url)
      brandUrls.push(url)
    } catch {
      console.log(`❌ Invalid URL format: ${url}`)
      process.exit(1)
    }
  }

  // Check required environment variables
  const requiredEnvVars = ['OPENROUTER_API_KEY', 'SERPAPI_KEY', 'FIRECRAWL_API_KEY', 'MONGODB_URI']
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
    console.log(`  📏 Content dimensions: ${CONTENT_DIMENSIONS.length}`)
    console.log(`  🔍 Search results per brand: ~100`)
    console.log(`  🔗 URLs: ${brandUrls.join(', ')}`)

    await analyzeWebContentForBrands(brandUrls)
    
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
export { analyzeWebContentForBrands }

// Run CLI if called directly
if (require.main === module) {
  main()
}