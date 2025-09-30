#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  AgentRecommendationContentCache,
  closeDatabaseConnection,
  type PromptContent,
  type ContentSnippets
} from '../lib/models/AgentRecommendationContentCache'
import { PromptCache } from '../lib/models/PromptCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import OpenAI from 'openai'

// Initialize OpenAI client for OpenRouter
let openai: OpenAI

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/your-repo",
        "X-Title": "GEO Agent Recommendation Analysis Tool",
      }
    })
  }
  return openai
}

/**
 * Extract brand names from URLs
 */
function extractBrandNamesFromUrls(urls: string[]): string[] {
  return urls.map(url => {
    try {
      const domain = new URL(url).hostname.replace('www.', '')
      const parts = domain.split('.')
      
      // Special extensions that are often part of the brand name
      const brandExtensions = ['.ai', '.chat', '.io', '.dev', '.tech', '.app', '.co']
      
      // Check if domain ends with a brand-relevant extension
      const lastTwoParts = parts.slice(-2).join('.')
      if (parts.length >= 2 && brandExtensions.some(ext => domain.endsWith(ext.substring(1)))) {
        return lastTwoParts.charAt(0).toUpperCase() + lastTwoParts.slice(1)
      }
      
      // Default: return just the main domain part
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
    } catch {
      return url
    }
  })
}

/**
 * Get all prompts for given brand URLs from MongoDB
 */
async function getAllPromptsForBrands(brandUrls: string[]): Promise<any[]> {
  try {
    const normalizedUrls = brandUrls.map(url => normalizeUrl(url))
    console.log(`🔍 Retrieving prompts for brands: ${normalizedUrls.join(', ')}`)
    
    const allPrompts: any[] = []
    
    for (const normalizedUrl of normalizedUrls) {
      const promptSet = await PromptCache.findByUrl(normalizedUrl)
      
      if (promptSet && promptSet.data && promptSet.data.prompts && Array.isArray(promptSet.data.prompts)) {
        allPrompts.push(...promptSet.data.prompts)
      }
    }
    
    console.log(`📊 Found ${allPrompts.length} total prompts across all brands`)
    return allPrompts
  } catch (error) {
    console.error('❌ Error retrieving prompts:', error)
    return []
  }
}

/**
 * Randomly sample prompts from the collection
 */
function samplePrompts(prompts: any[], sampleSize: number): any[] {
  if (prompts.length <= sampleSize) {
    return prompts
  }
  
  const shuffled = [...prompts].sort(() => 0.5 - Math.random())
  return shuffled.slice(0, sampleSize)
}

/**
 * Query agent platform for a prompt
 */
async function queryAgentPlatform(prompt: string, agentPlatform: string): Promise<any> {
  try {
    console.log(`    🤖 Querying ${agentPlatform} for prompt: "${prompt.substring(0, 50)}..."`)
    
    if (agentPlatform === 'openai') {
      const response = await getOpenAI().chat.completions.create({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      })
      
      const content = response.choices[0].message.content || ''
      console.log(`    ✅ Received response (${content.length} chars)`)
      return { content, annotations: [] } // OpenAI doesn't provide annotations directly
    } else {
      throw new Error(`Unsupported agent platform: ${agentPlatform}`)
    }
  } catch (error) {
    console.error(`    ❌ Error querying ${agentPlatform}:`, error)
    return { content: '', annotations: [] }
  }
}

/**
 * Extract domain and sentences from response using GPT-4o
 */
async function extractDomainsAndSentences(
  prompt: string, 
  response: string, 
  annotations: any[]
): Promise<ContentSnippets> {
  try {
    // Create a comprehensive text to analyze
    let textToAnalyze = response
    
    // Add annotation titles if available
    if (annotations && annotations.length > 0) {
      const annotationTitles = annotations
        .map(ann => ann.title || ann.text || ann.content)
        .filter(title => title && typeof title === 'string')
        .join('\n')
      
      if (annotationTitles) {
        textToAnalyze += '\n\nAnnotations:\n' + annotationTitles
      }
    }
    
    if (!textToAnalyze || textToAnalyze.length < 20) {
      return {}
    }
    
    const extractionPrompt = `
Analyze the following AI agent response and extract domain-specific information.

ORIGINAL PROMPT:
${prompt}

AI RESPONSE TO ANALYZE:
${textToAnalyze}

TASK:
1. Identify any website URLs, domain names, or company/service references in the response
2. For each domain/service mentioned, extract relevant sentences that describe or relate to that domain
3. Normalize domain names (remove www, protocols, paths - keep just the main domain)
4. Return a JSON object mapping normalized domains to arrays of relevant sentences

GUIDELINES:
- Only include domains that are explicitly mentioned or clearly referenced
- Extract complete, meaningful sentences (not fragments)
- Normalize domains: "https://www.example.com/path" → "example.com"
- Skip generic domains like "google.com", "wikipedia.org" unless specifically relevant
- Each sentence should be informative and relate to the domain
- Limit to maximum 5 sentences per domain

Expected JSON format:
{
  "example.com": ["Sentence about example.com service", "Another relevant sentence"],
  "another-site.org": ["Sentence about another-site.org"]
}

Return only the JSON object, no other text.
`

    const response_extraction = await getOpenAI().chat.completions.create({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: extractionPrompt }],
      temperature: 0.1,
      max_tokens: 800
    })

    const responseText = response_extraction.choices[0].message.content || '{}'
    
    // Clean and parse JSON response
    const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim()
    
    try {
      const parsed = JSON.parse(cleanedResponse)
      
      if (typeof parsed === 'object' && parsed !== null) {
        // Validate and clean the response
        const contentSnippets: ContentSnippets = {}
        
        for (const [domain, sentences] of Object.entries(parsed)) {
          if (Array.isArray(sentences) && sentences.length > 0) {
            const validSentences = sentences
              .filter(sentence => typeof sentence === 'string' && sentence.length > 10)
              .map(sentence => sentence.trim())
            
            if (validSentences.length > 0) {
              contentSnippets[domain] = validSentences
            }
          }
        }
        
        const domainCount = Object.keys(contentSnippets).length
        const sentenceCount = Object.values(contentSnippets).flat().length
        console.log(`    📊 Extracted ${sentenceCount} sentences across ${domainCount} domains`)
        
        return contentSnippets
      }
    } catch (parseError) {
      console.error('    ⚠️ Failed to parse domain extraction response as JSON')
    }
    
    return {}
  } catch (error) {
    console.error('    ❌ Error extracting domains and sentences:', error)
    return {}
  }
}

/**
 * Main analysis function
 */
async function analyzeAgentRecommendations(
  agentPlatform: string,
  brandUrls: string[],
  sampleSize: number = 100
): Promise<void> {
  try {
    console.log(`🚀 Starting agent recommendation analysis`)
    console.log(`🤖 Agent Platform: ${agentPlatform}`)
    console.log(`🏢 Brand URLs: ${brandUrls.join(', ')}`)
    console.log(`📊 Sample Size: ${sampleSize}`)
    
    // Extract brand names
    const brandNames = extractBrandNamesFromUrls(brandUrls)
    const normalizedBrandUrls = brandUrls.map(url => normalizeUrl(url))
    
    // Step 1: Get all prompts for the brands
    const allPrompts = await getAllPromptsForBrands(brandUrls)
    
    if (allPrompts.length === 0) {
      console.log('❌ No prompts found for the specified brands')
      return
    }
    
    // Step 2: Sample prompts
    const sampledPrompts = samplePrompts(allPrompts, sampleSize)
    console.log(`🎲 Sampled ${sampledPrompts.length} prompts from ${allPrompts.length} total`)
    
    // Step 3 & 4: Query agent platform and extract content for each prompt
    const promptsContent: PromptContent[] = []
    
    for (let i = 0; i < sampledPrompts.length; i++) {
      const prompt = sampledPrompts[i]
      const promptText = typeof prompt === 'string' ? prompt : prompt.prompt || prompt.text || String(prompt)
      
      console.log(`\n📝 Processing prompt ${i + 1}/${sampledPrompts.length}`)
      
      try {
        // Query the agent platform
        const agentResponse = await queryAgentPlatform(promptText, agentPlatform)
        
        // Extract domains and sentences from the response
        const contentSnippets = await extractDomainsAndSentences(
          promptText,
          agentResponse.content,
          agentResponse.annotations
        )
        
        // Store the prompt content
        promptsContent.push({
          prompt: promptText,
          contentSnippets
        })
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.error(`    ❌ Error processing prompt ${i + 1}:`, error)
        // Still add an entry with empty content to maintain count
        promptsContent.push({
          prompt: promptText,
          contentSnippets: {}
        })
      }
    }
    
    // Step 5: Store results in MongoDB
    console.log(`\n💾 Storing analysis results...`)
    const documentId = await AgentRecommendationContentCache.create(
      brandNames,
      normalizedBrandUrls,
      agentPlatform,
      allPrompts.length,
      sampledPrompts.length,
      1, // callsPerPrompt
      promptsContent
    )
    
    if (documentId) {
      console.log(`✅ Analysis complete! Document ID: ${documentId}`)
      
      // Print summary statistics
      const totalDomains = new Set(
        promptsContent.flatMap(pc => Object.keys(pc.contentSnippets))
      ).size
      const totalSentences = promptsContent.reduce(
        (sum, pc) => sum + Object.values(pc.contentSnippets).flat().length,
        0
      )
      
      console.log(`📊 Summary:`)
      console.log(`  🏢 Brands: ${brandNames.join(', ')}`)
      console.log(`  🤖 Platform: ${agentPlatform}`)
      console.log(`  📝 Prompts processed: ${promptsContent.length}`)
      console.log(`  🌐 Unique domains: ${totalDomains}`)
      console.log(`  📄 Total sentences: ${totalSentences}`)
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
  
  if (args.length === 0) {
    console.log('Usage: tsx scripts/analyze-agent-recommendation-simple.ts [agent-platform] <brand-url1> <brand-url2> ...')
    console.log('       agent-platform: openai (default)')
    console.log('Example: tsx scripts/analyze-agent-recommendation-simple.ts openai https://apple.com https://microsoft.com')
    console.log('Example: tsx scripts/analyze-agent-recommendation-simple.ts https://apple.com  # uses openai by default')
    process.exit(1)
  }
  
  // Parse arguments
  let agentPlatform = 'openai'
  let brandUrls: string[] = []
  
  // Check if first argument is an agent platform or a URL
  const firstArg = args[0]
  if (firstArg && !firstArg.startsWith('http')) {
    // First argument is agent platform
    agentPlatform = firstArg
    brandUrls = args.slice(1)
  } else {
    // First argument is a URL, use default platform
    brandUrls = args
  }
  
  if (brandUrls.length === 0) {
    console.log('❌ At least one brand URL is required')
    process.exit(1)
  }
  
  // Validate URLs
  for (const url of brandUrls) {
    try {
      new URL(url)
    } catch {
      console.log(`❌ Invalid URL format: ${url}`)
      process.exit(1)
    }
  }
  
  // Check required environment variables
  const requiredEnvVars = ['OPENROUTER_API_KEY', 'MONGODB_URI']
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName])
  
  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:')
    missingVars.forEach(varName => console.log(`  - ${varName}`))
    console.log('\nPlease add these to your .env.local file')
    process.exit(1)
  }

  try {
    await analyzeAgentRecommendations(agentPlatform, brandUrls)
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
export { analyzeAgentRecommendations }

// Run CLI if called directly
if (require.main === module) {
  main()
}
