#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  SimpleWebContentCache,
  closeDatabaseConnection,
  type WebsiteContent,
  type DomainContent
} from '../lib/models/SimpleWebContentCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import OpenAI from 'openai'
import FirecrawlApp from '@mendable/firecrawl-js'

const LARGE_SITE_LIST = [
  'wikipedia.org',
  'youtube.com',
  'reddit.com',
  'quora.com',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'linkedin.com',
  'forbes.com',
  'medium.com',
  'g2.com'
]

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
        "X-Title": "GEO Simple Brand Analysis Tool", // Optional: for OpenRouter rankings
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
          prompt: `Extract a comprehensive summary of the page content, focusing on information about "${brandName}".`
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
        summary = (result.json as any).summary || JSON.stringify(result.json)
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
 * Extract sentences from content summary using AI models (via OpenRouter)
 */
async function extractSentencesWithGPT(summary: string, brandName: string): Promise<string[]> {
  try {
    if (!summary || summary.length < 50) {
      return []
    }

    const prompt = `
Extract meaningful sentences about "${brandName}" from the following content summary.

INSTRUCTIONS:
1. Extract sentences that contain information about the brand, product, or company
2. Focus on factual statements, features, descriptions, and key information
3. Skip generic sentences, navigation text, or irrelevant content
4. Each sentence should be complete and standalone
5. Remove duplicate or very similar sentences
6. Return sentences as a JSON array of strings
7. Limit to maximum 20 most relevant sentences

CONTENT SUMMARY TO ANALYZE:
${summary}

Return only a JSON array of strings, no other text.
`

    const response = await getOpenAI().chat.completions.create({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    })

    const responseText = response.choices[0].message.content || '[]'
    
    // Clean and parse JSON response
    const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim()
    
    try {
      const parsed = JSON.parse(cleanedResponse)
      
      if (Array.isArray(parsed)) {
        const sentences = parsed
          .filter(sentence => typeof sentence === 'string' && sentence.length > 0)
          .map(sentence => sentence.trim())
          .filter(sentence => sentence.length > 10) // Filter out very short sentences
        
        console.log(`    📊 Extracted ${sentences.length} sentences`)
        return sentences
      } else {
        console.log(`    ⚠️ GPT response is not an array`)
        return []
      }
    } catch (parseError) {
      console.error('⚠️ Failed to parse GPT response as JSON')
      return []
    }

  } catch (error) {
    console.error('⚠️ Error extracting sentences with GPT:', error)
    return []
  }
}

/**
 * Main analysis function for multiple brand URLs
 */
async function analyzeSimpleWebContentForBrands(brandUrls: string[]): Promise<void> {
  try {
    console.log(`🚀 Starting simple web content analysis for ${brandUrls.length} brands`)
    
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
      
      // Initialize the website content structure (simplified - no dimensions)
      const websiteContent: WebsiteContent = {}
      
      // Pre-initialize all large sites with empty sentence arrays
      LARGE_SITE_LIST.forEach(largeSite => {
        const normalizedLargeSite = normalizeUrl(`https://${largeSite}`)
        websiteContent[normalizedLargeSite] = {
          sentences: [],
          visibility: 0,
          modifiedSentences: [],
          modifiedVisibility: 0,
          modificationSuggestions: ''
        }
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
          
          // Extract sentences with AI models via OpenRouter
          const sentences = await extractSentencesWithGPT(summary, brandName)
          
          if (sentences.length === 0) {
            console.log(`    ⚠️ No sentences extracted, skipping`)
            continue
          }
          
          // Extract domain part first, then normalize
          const domainUrl = extractDomainFromUrl(result.link)
          const normalizedDomain = normalizeUrl(domainUrl)
          
          // Add sentences to the domain
          if (!websiteContent[normalizedDomain]) {
            websiteContent[normalizedDomain] = {
              sentences: [],
              visibility: 0,
              modifiedSentences: [],
              modifiedVisibility: 0,
              modificationSuggestions: ''
            }
          }
          websiteContent[normalizedDomain].sentences.push(...sentences)
          
          console.log(`    ✅ Added ${sentences.length} sentences for domain: ${normalizedDomain}`)
          
          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, 2000))
          
        } catch (error) {
          console.error(`    ❌ Error processing ${result.link}:`, error)
        }
      }
      
      // Store results in MongoDB
      console.log(`\n💾 Storing analysis results for ${brandName}...`)
      const normalizedBrandUrl = normalizeUrl(brandUrl)
      const documentId = await SimpleWebContentCache.create(brandName, brandUrl, normalizedBrandUrl, websiteContent)
      
      if (documentId) {
        console.log(`✅ Analysis complete for ${brandName}! Document ID: ${documentId}`)
        
        // Print summary
        const totalDomains = Object.keys(websiteContent).length
        const totalSentences = Object.values(websiteContent).reduce((sum, domainContent) => 
          sum + domainContent.sentences.length, 0)
        
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
    console.error('❌ Error in simple web content analysis:', error)
    throw error
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.log('Usage: tsx scripts/analyze-simple-web-content.ts <brand-url1> <brand-url2> ...')
    console.log('Example: tsx scripts/analyze-simple-web-content.ts https://apple.com https://microsoft.com')
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
    console.log(`  🔍 Search results per brand: ~100`)
    console.log(`  🔗 URLs: ${brandUrls.join(', ')}`)

    await analyzeSimpleWebContentForBrands(brandUrls)
    
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
export { analyzeSimpleWebContentForBrands }

// Run CLI if called directly
if (require.main === module) {
  main()
}
