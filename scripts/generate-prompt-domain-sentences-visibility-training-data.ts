#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  AgentRecommendationContentCache,
  type AgentRecommendationContentDocument
} from '../lib/models/AgentRecommendationContentCache'
import { 
  SimpleWebContentCache,
  closeDatabaseConnection as closeSimpleWebConnection,
  type SimpleWebContentDocument 
} from '../lib/models/SimpleWebContentCache'
import { 
  PromptDomainSentencesVisibilityTrainingDataCache,
  closeDatabaseConnection as closeTrainingDataConnection
} from '../lib/models/PromptDomainSentencesVisibilityTrainingDataCache'
import { 
  QueryResponseCache,
  type QueryResponseDocument,
  closeDatabaseConnection as closeQueryResponseConnection
} from '../lib/models/QueryResponseCache'
import { normalizeUrl } from '../lib/models/PromptCache'
import OpenAI from 'openai'
import fs from 'fs'

// Initialize OpenAI client for embeddings
let openaiClient: OpenAI

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  }
  return openaiClient
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
 * Extract brand name from URL
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
      return lastTwoParts.toLowerCase()
    }
    
    // Default: return just the main domain part
    return parts[0].toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

/**
 * Check if a sentence contains the brand name (case insensitive)
 */
function sentenceContainsBrand(sentence: string, brandName: string): boolean {
  const lowerSentence = sentence.toLowerCase()
  const lowerBrandName = brandName.toLowerCase()
  
  // Check for exact word match (not just substring)
  const wordBoundaryRegex = new RegExp(`\\b${lowerBrandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  return wordBoundaryRegex.test(sentence)
}

/**
 * Get OpenAI embedding for text
 */
async function getEmbedding(text: string): Promise<number[]> {
  try {
    if (!text.trim()) {
      // Return zero embedding for empty strings
      return new Array(1536).fill(0)
    }
    
    const response = await getOpenAI().embeddings.create({
      model: "text-embedding-3-small",
      input: text
    })
    
    return response.data[0].embedding
  } catch (error) {
    console.error(`Error getting embedding for text: ${error}`)
    return new Array(1536).fill(0)
  }
}



/**
 * Check if output text contains information mentioned in sentence using GPT-4o
 */
async function checkSentenceInOutputText(outputText: string, sentence: string): Promise<boolean> {
  try {
    const prompt = `
Does the following OUTPUT TEXT contain the information mentioned in the SENTENCE?

SENTENCE: "${sentence}"

OUTPUT TEXT: "${outputText}"

Answer with only "YES" or "NO".
`

    const openRouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1'
    })

    const response = await openRouter.chat.completions.create({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 10
    })

    const answer = response.choices[0].message.content?.trim().toLowerCase()
    return answer === 'yes'
  } catch (error) {
    console.error(`    ❌ Error checking sentence in output text:`, error)
    return false
  }
}

/**
 * Calculate visibility for agent recommendation content based on query responses
 */
async function calculateAgentRecommendationVisibility(
  prompt: string,
  agentDoc: AgentRecommendationContentDocument,
  queryResponseDoc: QueryResponseDocument
): Promise<Array<{
  prompt: string
  domain: string
  sentence: string
  promptEmbedding: number[]
  domainEmbedding: number[]
  sentenceEmbedding: number[]
  visibility: number
}>> {
  const results: Array<{
    prompt: string
    domain: string
    sentence: string
    promptEmbedding: number[]
    domainEmbedding: number[]
    sentenceEmbedding: number[]
    visibility: number
  }> = []

  console.log(`📊 Processing agent recommendation visibility for prompt: "${prompt.substring(0, 50)}..."`)

  if (!agentDoc.promptContentMapping) {
    console.log(`⚠️ No prompt content mapping in agent document`)
    return results
  }

  // Get content snippets for this specific prompt
  const contentSnippets = agentDoc.promptContentMapping[prompt]
  if (!contentSnippets) {
    console.log(`⚠️ No content snippets found for this prompt`)
    return results
  }

  const totalResponses = queryResponseDoc.responses.length
  console.log(`  📎 Total responses: ${totalResponses}`)
  
  if (totalResponses === 0) {
    console.log(`    ⚠️ No responses found, skipping prompt`)
    return results
  }

  // Get embeddings for prompt and domain once
  const promptEmbedding = await getEmbedding(prompt)

  // For each domain in content snippets for this prompt
  for (const [domain, sentences] of Object.entries(contentSnippets)) {
    console.log(`  🌐 Processing domain: ${domain} with ${sentences.length} sentences`)
    
    const domainEmbedding = await getEmbedding(domain)
    
    // For each sentence in this domain
    for (const sentence of sentences) {
      console.log(`    📝 Processing sentence: "${sentence.substring(0, 50)}..."`)
      
      let matchCount = 0
      
      // For each response, check if output_text contains the sentence information
      for (const response of queryResponseDoc.responses) {
        const outputText = response.output_text || ''
        if (outputText.trim()) {
          const containsInfo = await checkSentenceInOutputText(outputText, sentence)
          if (containsInfo) {
            matchCount++
          }
        }
      }
      
      // Calculate visibility: matches / total responses
      const visibility = totalResponses > 0 ? matchCount / totalResponses : 0
      
      // Get sentence embedding
      const sentenceEmbedding = await getEmbedding(sentence)
      
      results.push({
        prompt,
        domain,
        sentence,
        promptEmbedding,
        domainEmbedding,
        sentenceEmbedding,
        visibility
      })
      
      console.log(`    📊 Sentence visibility: ${matchCount}/${totalResponses} = ${(visibility * 100).toFixed(2)}%`)
    }
  }

  console.log(`✅ Generated ${results.length} training entries from agent recommendation content`)
  return results
}

/**
 * Calculate visibility for simple web content based on query responses
 */
async function calculateSimpleWebContentVisibility(
  prompt: string,
  simpleWebDocs: SimpleWebContentDocument[],
  queryResponseDoc: QueryResponseDocument
): Promise<Array<{
  prompt: string
  domain: string
  sentences: string[]
  visibility: number
  embedding: number[]
}>> {
  const results: Array<{
    prompt: string
    domain: string
    sentences: string[]
    visibility: number
    embedding: number[]
  }> = []

  console.log(`📊 Processing ${simpleWebDocs.length} simple web content documents for prompt: "${prompt.substring(0, 50)}..."`)

  // Merge all annotations from all responses for this prompt
  const allAnnotations = queryResponseDoc.responses.flatMap(response => response.annotations || [])
  const totalAnnotationsCount = allAnnotations.length
  
  console.log(`  📎 Total annotations from all responses: ${totalAnnotationsCount}`)
  
  if (totalAnnotationsCount === 0) {
    console.log(`    ⚠️ No annotations found, skipping prompt`)
    return results
  }

  // Iterate through each simple web content document (each brand)
  for (const simpleDoc of simpleWebDocs) {
    const brandName = extractBrandNameFromUrl(simpleDoc.brandUrl)
    console.log(`🏢 Processing brand: ${brandName} (${simpleDoc.brandUrl})`)
    
    // Iterate through each domain in the simple web content
    for (const [domain, domainContent] of Object.entries(simpleDoc.websiteContent)) {
      const sentences = domainContent.sentences || []
      
      console.log(`  🌐 Domain: ${domain} - ${sentences.length} sentences`)
      
      // Count how many times this domain appears in annotation URLs
      let domainAppearanceCount = 0
      
      for (const annotation of allAnnotations) {
        console.log(`    🌐 Annotation URL: ${annotation.url} - Domain: ${domain}`)
        if (annotation.url && annotation.url.includes(domain)) {
          domainAppearanceCount++
        }
      }
      
      // Calculate visibility: domain appearances / total annotations
      const visibility = domainAppearanceCount / totalAnnotationsCount
      
      // Compute embedding for this tuple
      const embedding = await createFeatureVector(prompt, domain, sentences)
      
      results.push({
        prompt,
        domain,
        sentences, // This is the sentence list from simplewebcontentdocument
        visibility,
        embedding
      })
      
      console.log(`    🌐 Domain appearances in URLs: ${domainAppearanceCount}/${totalAnnotationsCount} - visibility: ${(visibility * 100).toFixed(2)}%`)
    }
  }

  console.log(`✅ Generated ${results.length} training entries from simple web content`)
  return results
}

/**
 * Main function to generate training data
 */
async function generateTrainingData(promptsFilePath: string): Promise<void> {
  try {
    console.log(`🚀 Starting training data generation`)
    console.log(`📁 Prompts file: ${promptsFilePath}`)
    
    // Step 1: Load prompts from JSON file
    console.log(`\n📥 Step 1: Loading prompts from JSON file...`)
    const prompts = loadPromptsFromFile(promptsFilePath)
    
    if (prompts.length === 0) {
      console.log(`❌ No prompts found in the file. Exiting.`)
      return
    }
    
    // Step 2: Load agent recommendation content document with 'test' in brandNames (should be only one)
    console.log(`\n📥 Step 2: Loading agent recommendation content document...`)
    const agentCollection = await AgentRecommendationContentCache.getCollectionInstance()
    const agentDocs = await agentCollection.find({
      brandNames: { $in: ['test'] }
    }).toArray()
    
    console.log(`✅ Found ${agentDocs.length} agent recommendation documents with 'test' brand`)
    
    if (agentDocs.length === 0) {
      console.log(`❌ No agent recommendation documents found with 'test' brand. Exiting.`)
      return
    }
    
    if (agentDocs.length > 1) {
      console.log(`⚠️ Found multiple agent recommendation documents, using the first one`)
    }
    
    const agentDoc = agentDocs[0]
    console.log(`  🤖 Platform: ${agentDoc.agentPlatform}`)
    console.log(`  🏢 Brands: ${agentDoc.brandNames?.join(', ')}`)
    
    // Step 3: Load all simple web content documents
    console.log(`\n📥 Step 3: Loading simple web content documents...`)
    const simpleWebResult = await SimpleWebContentCache.findAll()
    const simpleWebDocs = simpleWebResult.items
    
    console.log(`✅ Found ${simpleWebDocs.length} simple web content documents`)
    
    if (simpleWebDocs.length === 0) {
      console.log(`❌ No simple web content documents found. Exiting.`)
      //return
    }
    
    // Step 4: Clear existing training data
    console.log(`\n🗑️ Step 4: Clearing existing training data...`)
    const deletedCount = await PromptDomainSentencesVisibilityTrainingDataCache.deleteAll()
    console.log(`🗑️ Deleted ${deletedCount} existing training entries`)
    
    // Step 5: Process each prompt
    console.log(`\n🔄 Step 5: Processing prompts and generating training data...`)
    
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i]
      console.log(`\n📝 Processing prompt ${i + 1}/${prompts.length}: "${prompt.substring(0, 50)}..."`)
      
      try {
        // Step 5.1: Load query response document for this prompt
        const queryResponseDoc = await QueryResponseCache.findByPrompt(prompt)
        
        if (!queryResponseDoc || queryResponseDoc.length === 0) {
          console.log(`  ⚠️ No query response found for this prompt, skipping`)
          continue
        }
        
        if (queryResponseDoc.length > 1) {
          console.log(`  ⚠️ Found multiple query responses, using the first one`)
        }
        
        const queryDoc = queryResponseDoc[0]
        console.log(`  📎 Found query response with ${queryDoc.responses.length} responses`)
        
        // Step 5.2: Calculate agent recommendation visibility
        console.log(`  🔄 Step 5.2: Calculating agent recommendation visibility...`)
        const agentEntries = await calculateAgentRecommendationVisibility(prompt, agentDoc, queryDoc)
        
        // Step 5.3: Calculate simple web content visibility
        //console.log(`  🔄 Step 5.3: Calculating simple web content visibility...`)
        //const simpleWebEntries = await calculateSimpleWebContentVisibility(prompt, simpleWebDocs, queryDoc)
        
        // Step 5.4: Store training data for this prompt
        const allEntriesForPrompt = [...agentEntries]
        
        if (allEntriesForPrompt.length > 0) {
          console.log(`  💾 Storing ${allEntriesForPrompt.length} training entries for this prompt...`)
          const insertedIds = await PromptDomainSentencesVisibilityTrainingDataCache.createMany(allEntriesForPrompt)
          console.log(`  ✅ Stored ${insertedIds.length} entries for prompt ${i + 1}`)
        } else {
          console.log(`  ⚠️ No training entries generated for this prompt`)
        }
        
      } catch (error) {
        console.error(`  ❌ Error processing prompt ${i + 1}:`, error)
        continue
      }
    }
    
    // Step 6: Generate final statistics
    console.log(`\n📊 Step 6: Generating final statistics...`)
    const stats = await PromptDomainSentencesVisibilityTrainingDataCache.getStats()
    
    console.log(`\n📈 Training Data Statistics:`)
    console.log(`  📝 Total entries: ${stats.totalEntries}`)
    console.log(`  🔤 Unique prompts: ${stats.uniquePrompts}`)
    console.log(`  🌐 Unique domains: ${stats.uniqueDomains}`)
    console.log(`  👁️ Average visibility: ${(stats.averageVisibility * 100).toFixed(2)}%`)
    console.log(`  📄 Average sentences per entry: ${stats.averageSentencesPerEntry.toFixed(1)}`)
    
    console.log(`\n✅ Training data generation completed successfully!`)
    
  } catch (error) {
    console.error('❌ Error generating training data:', error)
    throw error
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length !== 1) {
    console.log('Usage: tsx scripts/generate-prompt-domain-sentences-visibility-training-data.ts <json-file-path>')
    console.log('       json-file-path: path to JSON file containing array of prompts')
    console.log('Example: tsx scripts/generate-prompt-domain-sentences-visibility-training-data.ts ./prompts.json')
    console.log('')
    console.log('JSON file format examples:')
    console.log('1. Simple array: ["prompt 1", "prompt 2", ...]')
    console.log('2. Object with prompts array: {"prompts": ["prompt 1", "prompt 2", ...]}')
    console.log('3. Array of objects: [{"prompt": "text"}, {"text": "text"}, ...]')
    process.exit(1)
  }
  
  const [jsonFilePath] = args
  
  // Validate file path
  if (!fs.existsSync(jsonFilePath)) {
    console.log(`❌ File not found: ${jsonFilePath}`)
    process.exit(1)
  }
  
  // Check required environment variables
  const requiredEnvVars = ['MONGODB_URI', 'OPENAI_API_KEY']
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName])
  
  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:')
    missingVars.forEach(varName => console.log(`  - ${varName}`))
    console.log('Please add them to your .env.local file')
    process.exit(1)
  }

  try {
    await generateTrainingData(jsonFilePath)
  } catch (error) {
    console.error('\n❌ Training data generation failed:', error)
    process.exit(1)
  } finally {
    // Close database connections
    await closeTrainingDataConnection()
    await closeQueryResponseConnection()
    process.exit(0)
  }
}

// Export for use as module
export { generateTrainingData }

// Run CLI if called directly
if (require.main === module) {
  main()
}
