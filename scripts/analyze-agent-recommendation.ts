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

// Configuration constants
const SAMPLED_PROMPTS_NUM = 300
const CALLS_PER_PROMPT = 2

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
}

interface AgentResponse {
  content: string
  annotations: Annotation[]
}

// Initialize OpenAI client (using OpenRouter)
let openai: OpenAI

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/your-repo", // Optional: for OpenRouter rankings
        "X-Title": "GEO Agent Recommendation Analysis Tool", // Optional: for OpenRouter rankings
      }
    })
  }
  return openai
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
 * Call OpenRouter API with web search enabled
 */
async function callOpenRouterWithWebSearch(prompt: string, platform: AgentPlatform = 'openai'): Promise<AgentResponse> {
  try {
    console.log(`🔍 Making OpenRouter call with web search for: "${prompt.substring(0, 50)}..."`)
    
    const modelName = platform === 'openai' ? 'openai/gpt-4o' : 'openai/gpt-4o'
    
    // Create the request body with web search enabled
    const requestBody = {
      model: modelName,
      messages: [
        {
          role: 'user',
          content: `Please search the web and provide comprehensive information about: ${prompt}`
        }
      ],
      temperature: 0.1,
      tools: [
        {
          type: 'web_search' as any,
          search_results_count: 10
        }
      ],
      tool_choice: 'auto' as any
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/your-repo',
        'X-Title': 'GEO Agent Recommendation Analysis Tool'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    
    const content = data.choices?.[0]?.message?.content || ''
    
    // Extract annotations/citations from tool calls or response metadata
    let annotations: Annotation[] = []
    
    // Check for tool calls that might contain web search results
    const toolCalls = data.choices?.[0]?.message?.tool_calls || []
    
    for (const toolCall of toolCalls) {
      if (toolCall.type === 'web_search' && toolCall.function?.arguments) {
        try {
          const searchResults = JSON.parse(toolCall.function.arguments)
          if (searchResults.results && Array.isArray(searchResults.results)) {
            searchResults.results.forEach((result: any, index: number) => {
              if (result.url && result.title) {
                annotations.push({
                  type: 'web_search_result',
                  title: result.title,
                  url: result.url,
                  start_index: index * 100, // Approximate position
                  end_index: (index + 1) * 100 - 1
                })
              }
            })
          }
        } catch (parseError) {
          console.log('⚠️ Could not parse tool call arguments')
        }
      }
    }
    
    // Also check for citations in the response metadata
    if (data.citations && Array.isArray(data.citations)) {
      data.citations.forEach((citation: any) => {
        annotations.push({
          type: 'citation',
          title: citation.title || citation.url,
          url: citation.url,
          start_index: citation.start_index || 0,
          end_index: citation.end_index || content.length
        })
      })
    }
    
    console.log(`✅ OpenRouter call successful, content length: ${content.length}, annotations: ${annotations.length}`)
    
    return {
      content,
      annotations
    }
  } catch (error) {
    console.error('Error calling OpenRouter:', error)
    throw new Error(`OpenRouter API error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Extract annotated snippets from content based on annotations
 */
function extractAnnotatedSnippets(content: string, annotations: Annotation[]): { [domain: string]: string[] } {
  const snippetsByDomain: { [domain: string]: string[] } = {}
  
  for (const annotation of annotations) {
    if (annotation.url && annotation.start_index !== undefined && annotation.end_index !== undefined) {
      try {
        // Extract snippet from content
        const snippet = content.substring(annotation.start_index, annotation.end_index).trim()
        
        if (snippet.length > 0) {
          // Extract and normalize domain from annotation URL
          const domainUrl = extractDomainFromUrl(annotation.url)
          const normalizedDomain = normalizeUrl(domainUrl)
          
          if (!snippetsByDomain[normalizedDomain]) {
            snippetsByDomain[normalizedDomain] = []
          }
          
          snippetsByDomain[normalizedDomain].push(snippet)
        }
      } catch (error) {
        console.log(`⚠️ Error extracting snippet for annotation: ${error}`)
      }
    }
  }
  
  return snippetsByDomain
}

/**
 * Categorize snippets into content dimensions using OpenRouter/OpenAI
 */
async function categorizeSnippetsWithGPT(snippets: string[], brandNames: string[]): Promise<{ [dimension: string]: string[] }> {
  try {
    if (!snippets || snippets.length === 0) {
      return {}
    }

    const dimensionsList = CONTENT_DIMENSIONS
      .map((dimension, index) => `${index + 1}. ${dimension}: ${CONTENT_DIMENSIONS_DESCRIPTIONS[dimension as keyof typeof CONTENT_DIMENSIONS_DESCRIPTIONS]}`)
      .join('\n')

    const brandContext = brandNames.length > 0 ? `about "${brandNames.join(', ')}"` : ''

    const prompt = `
Analyze the following content snippets ${brandContext} and categorize each snippet into ONE of these 15 content dimensions.

CONTENT DIMENSIONS:
${dimensionsList}

CRITICAL INSTRUCTIONS:
1. Process each snippet EXACTLY ONCE - no snippet should appear multiple times in the output
2. For each snippet, determine which ONE dimension it belongs to most closely
3. Each snippet should be assigned to exactly ONE dimension only
4. Skip snippets that don't contain meaningful brand/product information
5. Do NOT duplicate any snippets across different dimensions
6. Do NOT include the same snippet multiple times in any dimension
7. Return ONLY a JSON object with each snippet appearing exactly once across all dimensions

Expected JSON format:
{
  "Functionality": ["unique snippet 1", "unique snippet 2"],
  "Quality": ["unique snippet 3"],
  "Price / Value Proposition": ["unique snippet 4", "unique snippet 5"],
  ...
}

CONTENT SNIPPETS TO ANALYZE:
${snippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n\n')}

Important: Each snippet from the list should appear in the output exactly once. No duplicates allowed.

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
      const allUsedSnippets = new Set<string>()
      
      for (const [dimension, snippets] of Object.entries(parsed)) {
        if (CONTENT_DIMENSIONS.includes(dimension) && Array.isArray(snippets)) {
          const uniqueSnippets: string[] = []
          
          for (const snippet of snippets) {
            if (typeof snippet === 'string' && snippet.length > 0) {
              const trimmedSnippet = snippet.trim()
              // Only add if we haven't seen this snippet before
              if (!allUsedSnippets.has(trimmedSnippet)) {
                allUsedSnippets.add(trimmedSnippet)
                uniqueSnippets.push(trimmedSnippet)
              } else {
                console.log(`    ⚠️ Duplicate snippet detected and removed: "${trimmedSnippet.substring(0, 50)}..."`)
              }
            }
          }
          
          if (uniqueSnippets.length > 0) {
            validDimensions[dimension] = uniqueSnippets
          }
        }
      }
      
      console.log(`    📊 Processed ${allUsedSnippets.size} unique snippets across ${Object.keys(validDimensions).length} dimensions`)
      
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
    
    // Step 4: Process each prompt with multiple calls
    for (let i = 0; i < selectedPrompts.length; i++) {
      const prompt = selectedPrompts[i]
      console.log(`\n📊 Processing prompt ${i + 1}/${selectedPrompts.length}: "${prompt.substring(0, 50)}..."`)
      
      try {
        const allSnippetsForPrompt: string[] = []
        const allDomainsForPrompt = new Set<string>()
        
        // Make multiple calls for this prompt
        for (let callIndex = 0; callIndex < CALLS_PER_PROMPT; callIndex++) {
          console.log(`  🔍 Call ${callIndex + 1}/${CALLS_PER_PROMPT}...`)
          
          try {
            const agentResponse = await callOpenRouterWithWebSearch(prompt, agentPlatform)
            
            // Extract annotated snippets
            const snippetsByDomain = extractAnnotatedSnippets(agentResponse.content, agentResponse.annotations)
            
            console.log(`    📄 Extracted snippets from ${Object.keys(snippetsByDomain).length} domains`)
            
            // Collect all snippets and domains
            for (const [domain, snippets] of Object.entries(snippetsByDomain)) {
              allSnippetsForPrompt.push(...snippets)
              allDomainsForPrompt.add(domain)
            }
            
            // Rate limiting delay
            await new Promise(resolve => setTimeout(resolve, 2000))
            
          } catch (error) {
            console.error(`    ❌ Error in call ${callIndex + 1}:`, error)
          }
        }
        
        console.log(`  📊 Total snippets collected for prompt: ${allSnippetsForPrompt.length} from ${allDomainsForPrompt.size} domains`)
        
        // Step 5: Categorize all snippets for this prompt
        if (allSnippetsForPrompt.length > 0) {
          console.log(`  🤖 Categorizing snippets with GPT...`)
          const categorizedSnippets = await categorizeSnippetsWithGPT(allSnippetsForPrompt, brandNames)
          
          // Add categorized snippets to website content
          for (const [dimension, snippets] of Object.entries(categorizedSnippets)) {
            // For agent recommendations, we'll assign snippets to a generic domain since 
            // we're processing mixed content from multiple sources
            const agentDomain = `agent-${agentPlatform}.recommendations`
            
            if (!websiteContent[dimension][agentDomain]) {
              websiteContent[dimension][agentDomain] = []
            }
            
            websiteContent[dimension][agentDomain].push(...snippets)
          }
          
          const totalCategorizedSnippets = Object.values(categorizedSnippets).flat().length
          console.log(`  ✅ Added ${totalCategorizedSnippets} categorized snippets across ${Object.keys(categorizedSnippets).length} dimensions`)
        }
        
        // Delay between prompts
        if (i < selectedPrompts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
        
      } catch (error) {
        console.error(`❌ Error processing prompt ${i + 1}:`, error)
      }
    }
    
    // Step 6: Store results in MongoDB
    console.log(`\n💾 Storing agent recommendation analysis results...`)
    const documentId = await AgentRecommendationContentCache.create(
      brandNames,
      normalizedBrandUrls,
      agentPlatform,
      allPrompts.length,
      selectedPrompts.length,
      CALLS_PER_PROMPT,
      websiteContent
    )
    
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
  const requiredEnvVars = ['OPENROUTER_API_KEY', 'MONGODB_URI']
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
