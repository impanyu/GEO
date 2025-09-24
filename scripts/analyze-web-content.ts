#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  PromptCache,
  closeDatabaseConnection as closePromptDb,
  type PromptCacheDocument
} from '../lib/models/PromptCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import { 
  FullWebContentCache,
  closeDatabaseConnection,
  type WebsiteContent,
  type ContentDimension,
  type ContentSnippet
} from '../lib/models/FullWebContentCache'
import { generatePromptsForUrl } from './generate-prompts'
import OpenAI from 'openai'

// Configuration: Number of prompts to sample for analysis
// Note: This should match SAMPLED_PROMPTS_COUNT in generate-data-table.ts for consistency
const NUMBER_OF_SAMPLED_PROMPTS = 5

// Predefined websites to search
const TARGET_WEBSITES = [
  'wikipedia.org',
  'youtube.com',
  'blog.google',
  'reddit.com', 
  'google.com',
  'amazon.com',
  'quora.com',
  'facebook.com',
  'yelp.com',
  'instagram.com',
  'imdb.com',
  'tripadvisor.com',
  'linkedin.com',
  'healthline.com',
  'britannica.com',
  'nytimes.com',
  'forbes.com',
  'nerdwallet.com',
  'goodhousekeeping.com',
  'bankrate.com',
  'medium.com',
  'trustpilot.com',
  'g2.com',
  'capterra.com',
  'washingtonpost.com'
]

// 15 Content Dimensions for Brand Analysis
const CONTENT_DIMENSIONS = {
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

// Content dimensions are now imported from the model file

// Initialize OpenAI and Exa clients
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
 * Get content from URL using Exa API
 */
async function getContentFromExa(url: string): Promise<string> {
  try {
    const response = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EXA_API_KEY || ''
      },
      body: JSON.stringify({
        ids: [url],
        text: {
          maxCharacters: 10000,
          includeHtmlTags: false
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Exa API error: ${response.status}`)
    }

    const data = await response.json()
    if (data.results && data.results.length > 0) {
      return data.results[0].text || ''
    }
    return ''
  } catch (error) {
    console.error(`⚠️ Error getting content from ${url}:`, error)
    return ''
  }
}

/**
 * Search using SerpApi for a specific site
 */
async function searchWithSerpApi(query: string, site: string, page: number = 1): Promise<any[]> {
  try {
    if (!process.env.SERPAPI_KEY) {
      throw new Error('SERPAPI_KEY not configured')
    }

    const searchQuery = `${query} site:${site}`
    const start = (page - 1) * 10

    const response = await fetch(`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&start=${start}&api_key=${process.env.SERPAPI_KEY}`)
    
    if (!response.ok) {
      throw new Error(`SerpApi error: ${response.status}`)
    }

    const data = await response.json()
    return data.organic_results || []
  } catch (error) {
    console.error(`⚠️ Error searching ${site} for "${query}":`, error)
    return []
  }
}

/**
 * Analyze content using GPT-4 to categorize into 15 dimensions
 */
async function analyzeContentWithGPT(content: string, brandName: string): Promise<ContentDimension> {
  try {
    const dimensionsList = Object.entries(CONTENT_DIMENSIONS)
      .map(([name, desc], index) => `${index + 1}. ${name}: ${desc}`)
      .join('\n')

    const prompt = `
Analyze the following web content about "${brandName}" and categorize each sentence or continuous snippet into one of these 15 content dimensions:

${dimensionsList}

Instructions:
1. Read the content sentence by sentence
2. For each sentence/snippet, determine which dimension it belongs to
3. If multiple sentences have the same meaning, create one snippet and count frequency
4. Preserve original words as much as possible in snippets
5. Return ONLY a JSON object in this format:

{
  "Functionality": {
    "snippet text 1": frequency_count,
    "snippet text 2": frequency_count
  },
  "Quality": {
    "snippet text": frequency_count
  },
  ...other dimensions...
}

Content to analyze:
${content.substring(0, 8000)}

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
      return JSON.parse(cleanedResponse)
    } catch (parseError) {
      console.error('⚠️ Failed to parse GPT response as JSON:', parseError)
      return {}
    }

  } catch (error) {
    console.error('⚠️ Error analyzing content with GPT:', error)
    return {}
  }
}

/**
 * Sample prompts from cache or generate new ones
 */
async function getOrGenerateSampledPrompts(brandUrl: string): Promise<{ prompts: string[], brandName: string }> {
  try {
    const normalizedUrl = normalizeUrl(brandUrl)
    
    // Try to get existing prompts from cache
    let cachedPrompts = await PromptCache.findByUrl(normalizedUrl)
    
    if (!cachedPrompts) {
      console.log(`📝 No cached prompts found for ${brandUrl}, generating new ones...`)
      await generatePromptsForUrl(brandUrl)
      cachedPrompts = await PromptCache.findByUrl(normalizedUrl)
    }

    if (!cachedPrompts || !cachedPrompts.data.prompts) {
      throw new Error('Failed to get or generate prompts')
    }

    // Sample prompts randomly
    const allPrompts = cachedPrompts.data.prompts
    const sampledPrompts = allPrompts.length <= NUMBER_OF_SAMPLED_PROMPTS 
      ? allPrompts 
      : allPrompts.sort(() => Math.random() - 0.5).slice(0, NUMBER_OF_SAMPLED_PROMPTS)

    console.log(`🎯 Sampled ${sampledPrompts.length} prompts from ${allPrompts.length} total prompts`)
    
    return {
      prompts: sampledPrompts,
      brandName: cachedPrompts.data.brandName
    }

  } catch (error) {
    console.error('❌ Error getting/generating prompts:', error)
    throw error
  }
}

/**
 * Main analysis function
 */
async function analyzeWebContentForBrand(brandUrl: string): Promise<void> {
  try {
    console.log(`🚀 Starting web content analysis for: ${brandUrl}`)
    
    // Step 1: Get or generate sampled prompts
    const { prompts, brandName } = await getOrGenerateSampledPrompts(brandUrl)
    console.log(`📊 Brand: ${brandName}`)
    console.log(`📝 Prompts: ${prompts.join(', ')}`)

    const websiteContent: WebsiteContent = {}

    // Step 2: For each prompt, search across all target websites
    for (let promptIndex = 0; promptIndex < prompts.length; promptIndex++) {
      const prompt = prompts[promptIndex]
      console.log(`\n🔍 Processing prompt ${promptIndex + 1}/${prompts.length}: "${prompt}"`)

      for (const website of TARGET_WEBSITES) {
        console.log(`  🌐 Searching ${website}...`)

        try {
          // Search up to 2 pages (20 results) per website per prompt
          const allResults: any[] = []
          
          for (let page = 1; page <= 2; page++) {
            const results = await searchWithSerpApi(`${prompt} ${brandName}`, website, page)
            allResults.push(...results)
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000))
          }

          console.log(`    📄 Found ${allResults.length} results on ${website}`)

          if (!websiteContent[website]) {
            websiteContent[website] = {}
          }

          // Step 3: Analyze content from each search result
          for (let resultIndex = 0; resultIndex < Math.min(allResults.length, 10); resultIndex++) {
            const result = allResults[resultIndex]
            
            if (!result.link) continue

            console.log(`    📖 Analyzing content from: ${result.link}`)

            try {
              // Get content using Exa API
              const content = await getContentFromExa(result.link)
              
              if (!content || content.length < 100) {
                console.log(`    ⚠️ No substantial content found`)
                continue
              }

              // Analyze content with GPT-4
              const dimensionAnalysis = await analyzeContentWithGPT(content, brandName)

              // Merge results into website content
              for (const [dimension, snippets] of Object.entries(dimensionAnalysis)) {
                if (!websiteContent[website][dimension]) {
                  websiteContent[website][dimension] = {}
                }

                for (const [snippet, frequency] of Object.entries(snippets)) {
                  if (websiteContent[website][dimension][snippet]) {
                    websiteContent[website][dimension][snippet] += frequency
                  } else {
                    websiteContent[website][dimension][snippet] = frequency
                  }
                }
              }

              console.log(`    ✅ Analyzed content, found ${Object.keys(dimensionAnalysis).length} dimensions`)

              // Delay to avoid overwhelming APIs
              await new Promise(resolve => setTimeout(resolve, 2000))

            } catch (error) {
              console.error(`    ❌ Error analyzing ${result.link}:`, error)
            }
          }

        } catch (error) {
          console.error(`  ❌ Error searching ${website}:`, error)
        }
      }
    }

    // Step 4: Store results in MongoDB
    console.log(`\n💾 Storing analysis results...`)
    const documentId = await FullWebContentCache.create(brandName, brandUrl, websiteContent)
    
    if (documentId) {
      console.log(`✅ Analysis complete! Document ID: ${documentId}`)
      
      // Print summary
      const totalWebsites = Object.keys(websiteContent).length
      const totalDimensions = new Set(
        Object.values(websiteContent).flatMap(site => Object.keys(site))
      ).size
      const totalSnippets = Object.values(websiteContent).reduce((sum, site) => 
        sum + Object.values(site).reduce((dimSum, dim) => 
          dimSum + Object.keys(dim).length, 0), 0)

      console.log(`\n📊 Analysis Summary:`)
      console.log(`  🌐 Websites analyzed: ${totalWebsites}`)
      console.log(`  📏 Dimensions found: ${totalDimensions}`)
      console.log(`  📝 Total snippets: ${totalSnippets}`)
    } else {
      throw new Error('Failed to store analysis results')
    }

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
  
  if (args.length !== 1) {
    console.log('Usage: tsx scripts/analyze-web-content.ts <brand-url>')
    console.log('Example: tsx scripts/analyze-web-content.ts https://apple.com')
    process.exit(1)
  }
  
  const brandUrl = args[0]
  
  // Validate URL format
  try {
    new URL(brandUrl)
  } catch {
    console.log('❌ Invalid URL format. Please provide a valid URL.')
    process.exit(1)
  }

  // Check required environment variables
  const requiredEnvVars = ['OPENAI_API_KEY', 'EXA_API_KEY', 'SERPAPI_KEY', 'MONGODB_URI']
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName])
  
  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:')
    missingVars.forEach(varName => console.log(`  - ${varName}`))
    console.log('\nPlease add these to your .env.local file')
    process.exit(1)
  }

  try {
    console.log(`🎯 Configuration:`)
    console.log(`  📊 Sampled prompts: ${NUMBER_OF_SAMPLED_PROMPTS}`)
    console.log(`  🌐 Target websites: ${TARGET_WEBSITES.length}`)
    console.log(`  📏 Content dimensions: ${Object.keys(CONTENT_DIMENSIONS).length}`)
    console.log(`  🔗 Brand URL: ${brandUrl}`)

    await analyzeWebContentForBrand(brandUrl)
    
  } catch (error) {
    console.error('\n❌ Analysis failed:', error)
    process.exit(1)
  } finally {
    // Close database connections
    await closeDatabaseConnection()
    await closePromptDb()
    process.exit(0)
  }
}

// Export for use as module
export { analyzeWebContentForBrand }

// Run CLI if called directly
if (require.main === module) {
  main()
}
