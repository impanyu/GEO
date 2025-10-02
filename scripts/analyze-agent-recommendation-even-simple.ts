#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  AgentRecommendationContentCache,
  closeDatabaseConnection,
  type ContentSnippets
} from '../lib/models/AgentRecommendationContentCache'
import { QueryResponseCache, type QueryResponse, closeDatabaseConnection as closeQueryResponseConnection } from '../lib/models/QueryResponseCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import OpenAI from 'openai'
import FirecrawlApp from '@mendable/firecrawl-js'
import fs from 'fs'
import path from 'path'

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
async function extractRelevantSentences(content: string, title: string): Promise<string[]> {
  try {
    if (!content || content.length < 50) {
      return []
    }

    const prompt = `
Extract relevant sentences from the following webpage content that are related to "${title}".

INSTRUCTIONS:
1. Extract sentences that contain information related to the title "${title}"
2. Extract complete, meaningful sentences (not fragments)
3. Skip generic sentences, navigation text, or irrelevant content
4. Each sentence should be standalone and informative
5. Remove duplicate or very similar sentences
6. Return sentences as a JSON array of strings
7. Limit to maximum 10 most relevant sentences

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
 * Load prompts from JSON file
 */
function loadPromptsFromFile(filePath: string): string[] {
  try {
    console.log(`📁 Loading prompts from: ${filePath}`)
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(fileContent)
    
    let prompts: string[] = []
    
    if (Array.isArray(parsed)) {
      // If it's an array, assume each element is a prompt (string or object with prompt field)
      prompts = parsed.map(item => {
        if (typeof item === 'string') {
          return item
        } else if (typeof item === 'object' && item.prompt) {
          return item.prompt
        } else if (typeof item === 'object' && item.text) {
          return item.text
        } else {
          return String(item)
        }
      })
    } else if (typeof parsed === 'object' && parsed.prompts && Array.isArray(parsed.prompts)) {
      // If it's an object with a prompts array
      prompts = parsed.prompts.map((item: any) => {
        if (typeof item === 'string') {
          return item
        } else if (typeof item === 'object' && item.prompt) {
          return item.prompt
        } else if (typeof item === 'object' && item.text) {
          return item.text
        } else {
          return String(item)
        }
      })
    } else {
      throw new Error('Invalid JSON format. Expected an array of prompts or an object with a "prompts" array.')
    }
    
    console.log(`✅ Loaded ${prompts.length} prompts from file`)
    return prompts.filter(prompt => prompt && prompt.trim().length > 0)
    
  } catch (error) {
    console.error('❌ Error loading prompts from file:', error)
    throw error
  }
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
          location?: { start: number; end: number } | null
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
                      location: ann.location ? { start: ann.location.start || 0, end: ann.location.end || 0 } : null
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
              location: { start: index, end: index }  // For web search sources, use index as both start and end
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
  annotations: any[]
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
              annotation.title
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
                  existingSentences.add(sentence)  // Update the Set to reflect the new addition
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
async function analyzeAgentRecommendationsFromFile(
  agentPlatform: string,
  promptsFilePath: string,
  queriesPerPrompt: number = 1
): Promise<void> {
  try {
    console.log(`🚀 Starting agent recommendation analysis from file`)
    console.log(`🤖 Agent Platform: ${agentPlatform}`)
    console.log(`📁 Prompts File: ${promptsFilePath}`)
    console.log(`🔄 Queries per prompt: ${queriesPerPrompt}`)
    
    // Hardcoded test values
    const brandNames = ['test']
    const normalizedBrandUrls = ['test.com']
    
    console.log(`🏢 Brand Names: ${brandNames.join(', ')}`)
    console.log(`🌐 Normalized Brand URLs: ${normalizedBrandUrls.join(', ')}`)
    
    // Step 1: Load prompts from file
    const allPrompts = loadPromptsFromFile(promptsFilePath)
    
    if (allPrompts.length === 0) {
      console.log('❌ No prompts found in the file')
      return
    }
    
    console.log(`📝 Loaded ${allPrompts.length} prompts from file`)
    
    // Step 2: Query agent platform and extract content for each prompt
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
        // Load existing contentSnippets to merge with new ones
        if (existingDoc.contentSnippets) {
          Object.assign(mergedContentSnippets, existingDoc.contentSnippets)
        }
        console.log(`📄 Found existing document, will update incrementally: ${documentId}`)
      } else {
        console.log(`📄 No existing document found, will create new one`)
      }
    } catch (error) {
      console.log(`⚠️ Error checking for existing document: ${error}`)
    }
    
    for (let i = 0; i < allPrompts.length; i++) {
      const promptText = allPrompts[i]
      
      console.log(`\n📝 Processing prompt ${i + 1}/${allPrompts.length}`)
      
      try {
        // Store all query responses for this prompt
        const queryResponses: QueryResponse[] = []
        let combinedContentSnippets: ContentSnippets = {}
        
        // Query the agent platform multiple times for this prompt
        for (let queryIndex = 0; queryIndex < queriesPerPrompt; queryIndex++) {
          console.log(`    🔄 Query ${queryIndex + 1}/${queriesPerPrompt} for prompt ${i + 1}`)
          
          // Query the agent platform
          const agentResponse = await queryAgentPlatform(promptText, agentPlatform)
          
          // Store the query response
          const queryResponse: QueryResponse = {
            output_text: agentResponse.content,
            annotations: agentResponse.annotations
          }
          queryResponses.push(queryResponse)
          
          // Extract domains and sentences from the response
          const contentSnippets = await extractDomainsAndSentences(
            promptText,
            agentResponse.content,
            agentResponse.annotations
          )
          
          // Merge this query's content snippets into the combined results
          for (const [domain, sentences] of Object.entries(contentSnippets)) {
            if (!combinedContentSnippets[domain]) {
              combinedContentSnippets[domain] = []
            }
            
            // Add unique sentences only
            const existingSentences = new Set(combinedContentSnippets[domain])
            for (const sentence of sentences) {
              if (!existingSentences.has(sentence)) {
                combinedContentSnippets[domain].push(sentence)
                existingSentences.add(sentence)
              }
            }
          }
          
          // Rate limiting delay between queries for the same prompt
          if (queryIndex < queriesPerPrompt - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
        
        // Store all query responses for this prompt in QueryResponseCache
        try {
          await QueryResponseCache.create(
            promptText,
            queryResponses,
            agentPlatform,
            new Date()
          )
          console.log(`    💾 Stored ${queryResponses.length} query responses for prompt ${i + 1}`)
        } catch (queryError) {
          console.log(`    ⚠️ Error storing query responses: ${queryError instanceof Error ? queryError.message : 'Unknown error'}`)
        }
        
        // Merge combined content snippets from all queries into the accumulated results
        for (const [domain, sentences] of Object.entries(combinedContentSnippets)) {
          if (!mergedContentSnippets[domain]) {
            mergedContentSnippets[domain] = []
          }
          
          // Add unique sentences only
          const existingSentences = new Set(mergedContentSnippets[domain])
          for (const sentence of sentences) {
            if (!existingSentences.has(sentence)) {
              mergedContentSnippets[domain].push(sentence)
              existingSentences.add(sentence)
            }
          }
        }
        
        // Log what's being merged for this prompt
        const domainsCount = Object.keys(combinedContentSnippets).length
        const totalSentencesForPrompt = Object.values(combinedContentSnippets).flat().length
        console.log(`    💾 Merged prompt ${i + 1} (${queriesPerPrompt} queries): ${domainsCount} domains, ${totalSentencesForPrompt} sentences`)
        
        // Log detailed breakdown if there are sentences
        if (totalSentencesForPrompt > 0) {
          console.log(`    📋 Domain breakdown:`)
          for (const [domain, sentences] of Object.entries(combinedContentSnippets)) {
            console.log(`      - ${domain}: ${sentences.length} sentences`)
          }
        }
        
        // Store/update results in MongoDB after each prompt
        try {
          if (documentId) {
            // Update existing document
            await AgentRecommendationContentCache.update(documentId, {
              totalPrompts: allPrompts.length,
              sampledPrompts: allPrompts.length, // Using all prompts, no sampling
              callsPerPrompt: queriesPerPrompt,
              contentSnippets: mergedContentSnippets,
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
              allPrompts.length, // Using all prompts, no sampling
              queriesPerPrompt, // callsPerPrompt
              mergedContentSnippets
            )
            console.log(`    💾 Created new MongoDB document: ${documentId}`)
          }
        } catch (dbError) {
          console.log(`    ❌ Error saving to MongoDB: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`)
        }
        
        // Progress update
        const progress = ((i + 1) / allPrompts.length * 100).toFixed(1)
        console.log(`    📈 Progress: ${progress}% (${i + 1}/${allPrompts.length} prompts completed)`)
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.error(`    ❌ Error processing prompt ${i + 1}:`, error)
        // Continue with existing merged content (no need to add empty content)
        
        // Still try to save to MongoDB even with error
        try {
          if (documentId) {
            await AgentRecommendationContentCache.update(documentId, {
              totalPrompts: allPrompts.length,
              sampledPrompts: allPrompts.length,
              callsPerPrompt: queriesPerPrompt,
              contentSnippets: mergedContentSnippets,
              sampledTime: new Date()
            })
            console.log(`    💾 Updated MongoDB document after error in prompt ${i + 1}`)
          } else {
            documentId = await AgentRecommendationContentCache.create(
              brandNames,
              normalizedBrandUrls,
              agentPlatform,
              allPrompts.length,
              allPrompts.length,
              queriesPerPrompt,
              mergedContentSnippets
            )
            console.log(`    💾 Created new MongoDB document after error: ${documentId}`)
          }
        } catch (dbError) {
          console.log(`    ❌ Error saving to MongoDB after prompt error: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`)
        }
      }
    }
    
    // Step 3: Final summary (results already stored incrementally)
    console.log(`\n✅ All prompts processed and stored incrementally!`)
    console.log(`📊 Final summary:`)
    console.log(`  📝 Total prompts processed: ${allPrompts.length}`)
    
    const totalDomainsAcrossAllPrompts = Object.keys(mergedContentSnippets).length
    const totalSentencesAcrossAllPrompts = Object.values(mergedContentSnippets).flat().length
    
    console.log(`  🌐 Unique domains in merged content: ${totalDomainsAcrossAllPrompts}`)
    console.log(`  📄 Total sentences in merged content: ${totalSentencesAcrossAllPrompts}`)
    
    // Log domain breakdown
    if (totalDomainsAcrossAllPrompts > 0) {
      console.log(`  📋 Domain breakdown:`)
      for (const [domain, sentences] of Object.entries(mergedContentSnippets)) {
        console.log(`    - ${domain}: ${sentences.length} sentences`)
      }
    }
    
    if (documentId) {
      console.log(`✅ Analysis complete! Document ID: ${documentId}`)
      
      // Print summary statistics
      console.log(`📊 Summary:`)
      console.log(`  🏢 Brands: ${brandNames.join(', ')}`)
      console.log(`  🤖 Platform: ${agentPlatform}`)
      console.log(`  📝 Prompts processed: ${allPrompts.length}`)
      console.log(`  🌐 Unique domains: ${totalDomainsAcrossAllPrompts}`)
      console.log(`  📄 Total sentences: ${totalSentencesAcrossAllPrompts}`)
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
  
  if (args.length < 2 || args.length > 3) {
    console.log('Usage: tsx scripts/analyze-agent-recommendation-even-simple.ts <agent-platform> <json-file-path> [queries-per-prompt]')
    console.log('       agent-platform: openai')
    console.log('       json-file-path: path to JSON file containing array of prompts')
    console.log('       queries-per-prompt: number of queries to make per prompt (default: 1)')
    console.log('Example: tsx scripts/analyze-agent-recommendation-even-simple.ts openai ./prompts.json 2')
    console.log('')
    console.log('JSON file format examples:')
    console.log('1. Simple array: ["prompt 1", "prompt 2", ...]')
    console.log('2. Object with prompts array: {"prompts": ["prompt 1", "prompt 2", ...]}')
    console.log('3. Array of objects: [{"prompt": "text"}, {"text": "text"}, ...]')
    process.exit(1)
  }
  
  const [agentPlatform, jsonFilePath, queriesPerPromptStr] = args
  const queriesPerPrompt = queriesPerPromptStr ? parseInt(queriesPerPromptStr, 10) : 1
  
  // Validate queries per prompt
  if (isNaN(queriesPerPrompt) || queriesPerPrompt < 1 || queriesPerPrompt > 10) {
    console.log('❌ queries-per-prompt must be a number between 1 and 10')
    process.exit(1)
  }
  
  // Validate agent platform
  if (agentPlatform !== 'openai') {
    console.log('❌ Currently only "openai" agent platform is supported')
    process.exit(1)
  }
  
  // Validate file path
  if (!fs.existsSync(jsonFilePath)) {
    console.log(`❌ File not found: ${jsonFilePath}`)
    process.exit(1)
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
    await analyzeAgentRecommendationsFromFile(agentPlatform, jsonFilePath, queriesPerPrompt)
  } catch (error) {
    console.error('\n❌ Analysis failed:', error)
    process.exit(1)
  } finally {
    // Close database connections
    await closeDatabaseConnection()
    await closeQueryResponseConnection()
    process.exit(0)
  }
}

// Export for use as module
export { analyzeAgentRecommendationsFromFile }

// Run CLI if called directly
if (require.main === module) {
  main()
}
