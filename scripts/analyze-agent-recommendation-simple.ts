#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  AgentRecommendationContentCache,
  closeDatabaseConnection,
  type ContentSnippets
} from '../lib/models/AgentRecommendationContentCache'
import { PromptCache } from '../lib/models/PromptCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import OpenAI from 'openai'
import FirecrawlApp from '@mendable/firecrawl-js'

// Initialize OpenAI client (native OpenAI)
let openai: OpenAI
// Initialize OpenRouter client for sentence extraction
let openrouter: OpenAI
// Initialize Firecrawl client
let firecrawlApp: FirecrawlApp

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  }
  return openai
}

function getOpenRouter(): OpenAI {
  if (!openrouter) {
    openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/your-repo",
        "X-Title": "GEO Agent Recommendation Analysis Tool",
      }
    })
  }
  return openrouter
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
async function scrapePageWithFirecrawl(url: string, title: string): Promise<string> {
  try {
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured')
    }

    console.log(`      🔥 Scraping: ${url}`)

    const firecrawl = getFirecrawl()
    
    // Use the library to scrape with multiple formats
    const result = await firecrawl.scrape(url, {
      formats: [
        {
          type: 'json',
          prompt: `Extract a comprehensive summary of the page content, focusing on information related to "${title}".`
        }
      ]
    })
    
    // The library returns the document directly, not wrapped in success/data
    if (result) {
      // Try to get summary from multiple possible sources
      let summary = ''
      
       if (result.json && typeof result.json === 'string') {
        summary = result.json
        console.log(`      ✅ Scraped successfully using JSON format (${summary.length} chars)`)
      }
      // If JSON is an object, try to extract text content
      else if (result.json && typeof result.json === 'object') {
        summary = (result.json as any).summary || JSON.stringify(result.json)
        console.log(`      ✅ Scraped successfully using JSON object (${summary.length} chars)`)
      }
      // Fallback to markdown if available
      else if (result.markdown) {
        summary = result.markdown
        console.log(`      ✅ Scraped successfully using markdown format (${summary.length} chars)`)
      }
      
      if (summary) {
        return summary
      } else {
        console.log(`      ⚠️ No summary content found in response`)
        return ''
      }
    } else {
      console.log(`      ⚠️ No data extracted from response`)
      return ''
    }
  } catch (error) {
    console.error(`      ❌ Error scraping ${url}:`, error)
    return ''
  }
}

/**
 * Extract relevant sentences from scraped content using OpenRouter GPT-4o
 */
async function extractRelevantSentences(content: string, title: string, brandNames: string[]): Promise<string[]> {
  try {
    if (!content || content.length < 50) {
      return []
    }

    const brandContext = brandNames.length > 0 ? brandNames.join(', ') : 'the brands'

    const prompt = `
Extract relevant sentences from the following webpage content that are related to "${title}" and "${brandContext}".

INSTRUCTIONS:
1. Extract sentences that contain information related to the title "${title}"
2. Focus on sentences that mention or relate to the brands: ${brandContext}
3. Extract complete, meaningful sentences (not fragments)
4. Skip generic sentences, navigation text, or irrelevant content
5. Each sentence should be standalone and informative
6. Remove duplicate or very similar sentences
7. Return sentences as a JSON array of strings
8. Limit to maximum 10 most relevant sentences

WEBPAGE CONTENT TO ANALYZE:
${content}

Return only a JSON array of strings, no other text.
`

    const response = await getOpenRouter().chat.completions.create({
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
        
        console.log(`      📊 Extracted ${sentences.length} relevant sentences`)
        return sentences
      } else {
        console.log(`      ⚠️ GPT response is not an array`)
        return []
      }
    } catch (parseError) {
      console.error('      ⚠️ Failed to parse GPT response as JSON')
      return []
    }

  } catch (error) {
    console.error('      ⚠️ Error extracting sentences with GPT:', error)
    return []
  }
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
 * Query agent platform for a prompt using native OpenAI API with web search
 */
async function queryAgentPlatform(prompt: string, agentPlatform: string, retries: number = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000) // Exponential backoff, max 10s
        console.log(`    ⏳ Retry attempt ${attempt}/${retries} after ${waitTime}ms...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
      
      console.log(`    🤖 Querying ${agentPlatform} for prompt: "${prompt.substring(0, 50)}..."`)
      
      if (agentPlatform === 'openai') {
        // Try multiple approaches for web search (mimicking generate-data-table.ts)
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
          console.log('    ⚠️ Forced web search failed, trying without force:', forcedError instanceof Error ? forcedError.message : 'Unknown error')
          
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
            console.log('    ⚠️ Optional web search failed, trying basic web_search:', optionalError instanceof Error ? optionalError.message : 'Unknown error')
            
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
        
        console.log(`    🎯 OpenAI Responses API successful using: ${searchMethod}`)
        
        // Extract output_text from the nested structure
        let output_text = ''
        const responseData = response as any
        
        // Try to extract text from output[0].content[0].text
        if (responseData.output && Array.isArray(responseData.output) && responseData.output.length > 0) {
          const firstOutput = responseData.output[0]
          if (firstOutput.content && Array.isArray(firstOutput.content) && firstOutput.content.length > 0) {
            const firstContent = firstOutput.content[0]
            if (firstContent.text && typeof firstContent.text === 'string') {
              output_text = firstContent.text
            }
          }
        }
        
        // Fallback: try direct output_text property (for backward compatibility)
        if (!output_text && responseData.output_text) {
          output_text = responseData.output_text
        }
        
        console.log(`    ✅ Received response (${output_text.length} chars)`)
        
        // Extract annotations from the response (mimicking generate-data-table.ts)
        let annotations: Array<{
          type: string
          title?: string
          url?: string
          index?: number | null
        }> = []
        
        try {
          console.log('    🔍 Attempting to extract annotations...')
          
          // Extract annotations from the nested structure: output[0].content[0].annotations
          if (responseData.output && Array.isArray(responseData.output)) {
            console.log(`    📊 Found output array with ${responseData.output.length} items`)
            for (const outputItem of responseData.output) {
              if (outputItem.content && Array.isArray(outputItem.content)) {
                console.log(`    📄 Found content array with ${outputItem.content.length} items`)
                for (const contentItem of outputItem.content) {
                  if (contentItem.annotations && Array.isArray(contentItem.annotations)) {
                    console.log(`    📎 Found annotations: ${contentItem.annotations.length}`)
                    // Map the annotation structure to match our expected format
                    const mappedAnnotations = contentItem.annotations.map((ann: any) => ({
                      type: ann.type || 'citation',
                      title: ann.title,
                      url: ann.url,
                      index: ann.location ? ann.location.start : null
                    }))
                    annotations.push(...mappedAnnotations)
                  }
                }
              }
            }
          }
          
          // Also check web_search_call.action.sources for additional URLs
          if (responseData.web_search_call && responseData.web_search_call.action && responseData.web_search_call.action.sources) {
            console.log(`    🌐 Found web search sources: ${responseData.web_search_call.action.sources.length}`)
            const webSearchAnnotations = responseData.web_search_call.action.sources.map((source: any, index: number) => ({
              type: 'web_search_source',
              title: source.title,
              url: source.url,
              index: index
            }))
            annotations.push(...webSearchAnnotations)
          }
          
          // Fallback: check if annotations are directly in the response (for backward compatibility)
          if (responseData.annotations && Array.isArray(responseData.annotations)) {
            console.log(`    📎 Found direct annotations: ${responseData.annotations.length}`)
            annotations.push(...responseData.annotations)
          }
          
          // Check if web search was actually performed
          const hasWebSearchActivity = responseData.output?.some((item: any) => 
            item.type === 'web_search_call' || 
            item.type === 'web_search' ||
            (item.content && item.content.some((content: any) => content.type === 'web_search'))
          )
          
          console.log(`    🌐 Web search activity detected: ${hasWebSearchActivity}`)
          
          // Analyze response text for signs of web search
          const hasCurrentInfo = output_text.includes('2024') || 
                                output_text.includes('2025') || 
                                output_text.includes('recently') ||
                                output_text.includes('currently') ||
                                output_text.includes('latest') ||
                                output_text.includes('http') ||
                                output_text.includes('www.')
          
          console.log(`    📊 Response appears to contain current/web info: ${hasCurrentInfo}`)
          
          // Warning if no web search detected
          if (!hasWebSearchActivity && !hasCurrentInfo) {
            console.log('    ⚠️ WARNING: No evidence of web search activity - response may be from training data only')
          }
            
        } catch (annotationError) {
          console.log('    ⚠️ Could not extract annotations:', annotationError)
        }
        
        console.log(`    📎 Extracted ${annotations.length} annotations`)
        if (annotations.length > 0) {
          console.log('    📋 Sample annotation:', JSON.stringify(annotations[0], null, 2))
        }
        
        return {
          content: output_text,
          annotations
        }
      } else {
        throw new Error(`Unsupported agent platform: ${agentPlatform}`)
      }
      
    } catch (error) {
      console.error(`    ❌ Error querying ${agentPlatform} (attempt ${attempt}/${retries}):`, error)
      
      if (attempt === retries) {
        throw new Error(`${agentPlatform} API error after ${retries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      
      // Log retry info
      console.log(`    ⚠️ Attempt ${attempt} failed, will retry...`)
    }
  }
  
  // This should never be reached due to the throw above
  throw new Error('Unexpected error in agent platform query')
}

/**
 * Extract domain-specific sentences from annotations using Firecrawl and OpenRouter GPT-4o
 */
async function extractDomainsAndSentences(
  prompt: string, 
  response: string, 
  annotations: any[],
  brandNames: string[]
): Promise<ContentSnippets> {
  try {
    const contentSnippets: ContentSnippets = {}
    const processedUrls = new Set<string>()
    
    console.log(`    📄 Processing ${annotations.length} annotations with Firecrawl and GPT-4o...`)
    
    for (const annotation of annotations) {
      if (annotation.url && annotation.title) {
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
          console.log(`    📋 Title: ${annotation.title}`)
          console.log(`    🌐 Normalized domain: ${normalizedDomain}`)
          
          // Mark this URL as processed
          processedUrls.add(annotation.url)
          
          // Scrape the URL to get content
          const scrapedContent = await scrapePageWithFirecrawl(annotation.url, annotation.title)
          
          if (scrapedContent && scrapedContent.length > 0) {
            // Extract relevant sentences using OpenRouter GPT-4o
            const relevantSentences = await extractRelevantSentences(
              scrapedContent, 
              annotation.title, 
              brandNames
            )
            
            if (relevantSentences.length > 0) {
              // Initialize domain entry if it doesn't exist
              if (!contentSnippets[normalizedDomain]) {
                contentSnippets[normalizedDomain] = []
              }
              
              // Add unique sentences only
              const existingSentences = new Set(contentSnippets[normalizedDomain])
              for (const sentence of relevantSentences) {
                if (!existingSentences.has(sentence)) {
                  contentSnippets[normalizedDomain].push(sentence)
                }
              }
              
              console.log(`    ✅ Added ${relevantSentences.length} sentences for ${normalizedDomain}`)
            } else {
              console.log(`    ⚠️ No relevant sentences extracted for ${normalizedDomain}`)
            }
          } else {
            console.log(`    ⚠️ No content scraped for ${normalizedDomain}`)
          }
          
          // Rate limiting - delay between Firecrawl requests
          await new Promise(resolve => setTimeout(resolve, 2000))
          
        } catch (error) {
          console.log(`    ❌ Error processing annotation: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      } else {
        console.log(`    ⚠️ Skipping annotation without URL or title:`, annotation)
      }
    }
    
    const domainCount = Object.keys(contentSnippets).length
    const sentenceCount = Object.values(contentSnippets).flat().length
    console.log(`    📊 Final result: ${sentenceCount} sentences across ${domainCount} domains (${processedUrls.size} unique URLs processed)`)
    
    return contentSnippets
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
  sampleSize: number = 300
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
    const mergedContentSnippets: ContentSnippets = {}
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
        // Load existing promptsContent to append to it
        if (existingDoc.promptsContent) {
          promptsContent.push(...existingDoc.promptsContent)
        }
        console.log(`📄 Found existing document, will update incrementally: ${documentId}`)
      } else {
        console.log(`📄 No existing document found, will create new one`)
      }
    } catch (error) {
      console.log(`⚠️ Error checking for existing document: ${error}`)
    }
    
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
          agentResponse.annotations,
          brandNames
        )
        
        // Store the prompt content
        const promptContentEntry = {
          prompt: promptText,
          contentSnippets
        }
        promptsContent.push(promptContentEntry)
        
        // Log what's being stored for this prompt
        const domainsCount = Object.keys(contentSnippets).length
        const totalSentencesForPrompt = Object.values(contentSnippets).flat().length
        console.log(`    💾 Stored prompt ${i + 1}: ${domainsCount} domains, ${totalSentencesForPrompt} sentences`)
        
        // Log detailed breakdown if there are sentences
        if (totalSentencesForPrompt > 0) {
          console.log(`    📋 Domain breakdown:`)
          for (const [domain, sentences] of Object.entries(contentSnippets)) {
            console.log(`      - ${domain}: ${sentences.length} sentences`)
          }
        }
        
        // Store/update results in MongoDB after each prompt
        try {
          if (documentId) {
            // Update existing document
            await AgentRecommendationContentCache.update(documentId, {
              totalPrompts: allPrompts.length,
              sampledPrompts: sampledPrompts.length,
              callsPerPrompt: 1,
              promptsContent: promptsContent,
              sampledTime: new Date()
            })
            console.log(`    💾 Updated MongoDB document after prompt ${i + 1}`)
          } else {
            // Create new document
            documentId = await AgentRecommendationContentCache.create(
              brandNames,
              normalizedBrandUrls,
              agentPlatform,
              allPrompts.length,
              sampledPrompts.length,
              1, // callsPerPrompt
              promptsContent
            )
            console.log(`    💾 Created new MongoDB document: ${documentId}`)
          }
        } catch (dbError) {
          console.log(`    ❌ Error saving to MongoDB: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`)
        }
        
        // Progress update
        const progress = ((i + 1) / sampledPrompts.length * 100).toFixed(1)
        console.log(`    📈 Progress: ${progress}% (${i + 1}/${sampledPrompts.length} prompts completed)`)
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.error(`    ❌ Error processing prompt ${i + 1}:`, error)
        // Still add an entry with empty content to maintain count
        promptsContent.push({
          prompt: promptText,
          contentSnippets: {}
        })
        
        // Still try to save to MongoDB even with error
        try {
          if (documentId) {
            await AgentRecommendationContentCache.update(documentId, {
              totalPrompts: allPrompts.length,
              sampledPrompts: sampledPrompts.length,
              callsPerPrompt: 1,
              promptsContent: promptsContent,
              sampledTime: new Date()
            })
            console.log(`    💾 Updated MongoDB document after error in prompt ${i + 1}`)
          } else {
            documentId = await AgentRecommendationContentCache.create(
              brandNames,
              normalizedBrandUrls,
              agentPlatform,
              allPrompts.length,
              sampledPrompts.length,
              1,
              promptsContent
            )
            console.log(`    💾 Created new MongoDB document after error: ${documentId}`)
          }
        } catch (dbError) {
          console.log(`    ❌ Error saving to MongoDB after prompt error: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`)
        }
      }
    }
    
    // Step 5: Final summary (results already stored incrementally)
    console.log(`\n✅ All prompts processed and stored incrementally!`)
    console.log(`📊 Final summary:`)
    console.log(`  📝 Total prompts processed: ${promptsContent.length}`)
    
    let totalDomainsAcrossAllPrompts = new Set<string>()
    let totalSentencesAcrossAllPrompts = 0
    
    promptsContent.forEach((pc, index) => {
      const domains = Object.keys(pc.contentSnippets)
      const sentences = Object.values(pc.contentSnippets).flat().length
      totalDomainsAcrossAllPrompts = new Set([...totalDomainsAcrossAllPrompts, ...domains])
      totalSentencesAcrossAllPrompts += sentences
    })
    
    console.log(`  🌐 Unique domains across all prompts: ${totalDomainsAcrossAllPrompts.size}`)
    console.log(`  📄 Total sentences across all prompts: ${totalSentencesAcrossAllPrompts}`)
    
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
  const requiredEnvVars = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'FIRECRAWL_API_KEY', 'MONGODB_URI']
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
