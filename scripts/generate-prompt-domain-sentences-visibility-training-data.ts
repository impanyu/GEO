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
import OpenAI from 'openai'

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
 * Process sentences into embeddings with padding
 */
async function processSentencesEmbeddings(sentences: string[], maxSentences: number = 20): Promise<number[]> {
  // Take first 20 sentences or pad with empty strings
  const processedSentences = sentences.slice(0, maxSentences)
  while (processedSentences.length < maxSentences) {
    processedSentences.push("")
  }
  
  // Get embeddings for each sentence
  const sentenceEmbeddings: number[][] = []
  for (const sentence of processedSentences) {
    const embedding = await getEmbedding(sentence)
    sentenceEmbeddings.push(embedding)
  }
  
  // Concatenate all sentence embeddings
  return sentenceEmbeddings.flat()
}

/**
 * Create feature vector from prompt, domain, and sentences
 */
async function createFeatureVector(prompt: string, domain: string, sentences: string[]): Promise<number[]> {
  console.log(`    🔢 Computing embeddings for: prompt="${prompt.substring(0, 50)}...", domain="${domain}", sentences_count=${sentences.length}`)
  
  // Get individual embeddings
  const [promptEmbedding, domainEmbedding, sentencesEmbedding] = await Promise.all([
    getEmbedding(prompt),
    getEmbedding(domain),
    processSentencesEmbeddings(sentences)
  ])
  
  // Concatenate all embeddings
  const featureVector = [...promptEmbedding, ...domainEmbedding, ...sentencesEmbedding]
  
  console.log(`    ✅ Feature vector computed: ${featureVector.length} dimensions`)
  return featureVector
}

/**
 * Calculate visibility for agent recommendation content
 */
async function calculateAgentRecommendationVisibility(
  agentDoc: AgentRecommendationContentDocument
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

  console.log(`📊 Processing agent recommendation document with ${agentDoc.promptsContent?.length || 0} prompts`)

  if (!agentDoc.promptsContent) {
    return results
  }

  for (const promptContent of agentDoc.promptsContent) {
    const prompt = promptContent.prompt
    const contentSnippets = promptContent.contentSnippets
    
    // Calculate total sentences across all domains for this prompt
    const totalSentencesInPrompt = Object.values(contentSnippets).reduce(
      (sum, sentences) => sum + sentences.length,
      0
    )
    
    console.log(`  📝 Prompt: "${prompt.substring(0, 50)}..." - ${totalSentencesInPrompt} total sentences`)
    
    if (totalSentencesInPrompt === 0) {
      console.log(`    ⚠️ Skipping prompt with no sentences`)
      continue
    }
    
    // Calculate visibility for each domain in this prompt
    for (const [domain, sentences] of Object.entries(contentSnippets)) {
      const visibility = sentences.length / totalSentencesInPrompt
      
      // Compute embedding for this tuple
      const embedding = await createFeatureVector(prompt, domain, sentences)
      
      results.push({
        prompt,
        domain,
        sentences,
        visibility,
        embedding
      })
      
      console.log(`    🌐 Domain: ${domain} - ${sentences.length} sentences - visibility: ${(visibility * 100).toFixed(2)}%`)
    }
  }

  console.log(`✅ Generated ${results.length} training entries from agent recommendation content`)
  return results
}

/**
 * Calculate visibility for simple web content against agent recommendation prompts
 */
async function calculateSimpleWebContentVisibility(
  simpleWebDocs: SimpleWebContentDocument[],
  agentDoc: AgentRecommendationContentDocument
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

  console.log(`📊 Processing ${simpleWebDocs.length} simple web content documents against agent prompts`)

  if (!agentDoc.promptsContent) {
    console.log(`⚠️ No prompts content in agent document`)
    return results
  }

  // Iterate through each simple web content document (each brand)
  for (const simpleDoc of simpleWebDocs) {
    const brandName = extractBrandNameFromUrl(simpleDoc.brandUrl)
    console.log(`🏢 Processing brand: ${brandName} (${simpleDoc.brandUrl})`)
    
    // Iterate through each domain in the simple web content
    for (const [domain, domainContent] of Object.entries(simpleDoc.websiteContent)) {
      const sentences = domainContent.sentences || []
      
      if (sentences.length === 0) {
        console.log(`  🌐 Domain: ${domain} - no sentences, skipping`)
        continue
      }
      
      console.log(`  🌐 Domain: ${domain} - ${sentences.length} sentences`)
      
      // For each prompt in the agent recommendation content
      for (const promptContent of agentDoc.promptsContent) {
        const prompt = promptContent.prompt
        const agentContentSnippets = promptContent.contentSnippets
        
        // Calculate total sentences across all domains for this prompt in agent content
        const totalSentencesInAgentPrompt = Object.values(agentContentSnippets).reduce(
          (sum, agentSentences) => sum + agentSentences.length,
          0
        )
        
        if (totalSentencesInAgentPrompt === 0) {
          console.log(`    📝 Prompt: "${prompt.substring(0, 30)}..." - no sentences in agent content, skipping`)
          continue
        }
        
        // Check if this domain exists in the agent content for this prompt
        const agentSentencesForDomain = agentContentSnippets[domain] || []
        
        // Count sentences in agent content for this prompt+domain that contain the brand name
        let brandMentionCount = 0
        
        for (const agentSentence of agentSentencesForDomain) {
          if (sentenceContainsBrand(agentSentence, brandName)) {
            brandMentionCount++
          }
        }
        
        // Calculate visibility: brand mentions in agent[prompt][domain] / total sentences in agent[prompt]
        const visibility = brandMentionCount / totalSentencesInAgentPrompt
        
        // Compute embedding for this tuple
        const embedding = await createFeatureVector(prompt, domain, sentences)
        
        results.push({
          prompt,
          domain,
          sentences, // This is the sentence list from simplewebcontentdocument
          visibility,
          embedding
        })
        
        console.log(`    📝 Prompt: "${prompt.substring(0, 30)}..." - ${brandMentionCount}/${totalSentencesInAgentPrompt} brand mentions in agent[${domain}] - visibility: ${(visibility * 100).toFixed(2)}%`)
      }
    }
  }

  console.log(`✅ Generated ${results.length} training entries from simple web content`)
  return results
}

/**
 * Main function to generate training data
 */
async function generateTrainingData(): Promise<void> {
  try {
    console.log(`🚀 Starting training data generation`)
    
    // Step 1: Load agent recommendation content documents with 'test' in brandNames
    console.log(`\n📥 Step 1: Loading agent recommendation content documents...`)
    const agentCollection = await AgentRecommendationContentCache.getCollectionInstance()
    const agentDocs = await agentCollection.find({
      brandNames: { $in: ['test'] }
    }).toArray()
    
    console.log(`✅ Found ${agentDocs.length} agent recommendation documents with 'test' brand`)
    
    if (agentDocs.length === 0) {
      console.log(`❌ No agent recommendation documents found with 'test' brand. Exiting.`)
      return
    }
    
    // Step 2: Load all simple web content documents
    console.log(`\n📥 Step 2: Loading simple web content documents...`)
    const simpleWebResult = await SimpleWebContentCache.findAll()
    const simpleWebDocs = simpleWebResult.items
    
    console.log(`✅ Found ${simpleWebDocs.length} simple web content documents`)
    
    if (simpleWebDocs.length === 0) {
      console.log(`❌ No simple web content documents found. Exiting.`)
      return
    }
    
    // Step 3: Process each agent recommendation document
    console.log(`\n🔄 Step 3: Processing agent recommendation documents...`)
    const allTrainingEntries: Array<{
      prompt: string
      domain: string
      sentences: string[]
      visibility: number
      embedding: number[]
    }> = []
    
    for (let i = 0; i < agentDocs.length; i++) {
      const agentDoc = agentDocs[i]
      console.log(`\n📄 Processing agent document ${i + 1}/${agentDocs.length}`)
      console.log(`  🤖 Platform: ${agentDoc.agentPlatform}`)
      console.log(`  🏢 Brands: ${agentDoc.brandNames?.join(', ')}`)
      
      // Step 3a: Calculate visibility for agent recommendation content
      console.log(`\n🔄 Step 3a: Calculating agent recommendation visibility...`)
      const agentEntries = await calculateAgentRecommendationVisibility(agentDoc)
      allTrainingEntries.push(...agentEntries)
      
      // Step 3b: Calculate visibility for simple web content against this agent document
      console.log(`\n🔄 Step 3b: Calculating simple web content visibility...`)
      const simpleWebEntries = await calculateSimpleWebContentVisibility(simpleWebDocs, agentDoc)
      allTrainingEntries.push(...simpleWebEntries)
    }
    
    console.log(`\n📊 Total training entries generated: ${allTrainingEntries.length}`)
    
    // Step 4: Clear existing training data and store new entries
    console.log(`\n💾 Step 4: Storing training data in MongoDB...`)
    
    // Clear existing data
    const deletedCount = await PromptDomainSentencesVisibilityTrainingDataCache.deleteAll()
    console.log(`🗑️ Deleted ${deletedCount} existing training entries`)
    
    // Store new data in batches
    const batchSize = 1000
    let storedCount = 0
    
    for (let i = 0; i < allTrainingEntries.length; i += batchSize) {
      const batch = allTrainingEntries.slice(i, i + batchSize)
      const insertedIds = await PromptDomainSentencesVisibilityTrainingDataCache.createMany(batch)
      storedCount += insertedIds.length
      
      const progress = ((i + batch.length) / allTrainingEntries.length * 100).toFixed(1)
      console.log(`💾 Stored batch ${Math.floor(i / batchSize) + 1}: ${insertedIds.length} entries (${progress}% complete)`)
    }
    
    console.log(`✅ Successfully stored ${storedCount} training entries`)
    
    // Step 5: Generate statistics
    console.log(`\n📊 Step 5: Generating statistics...`)
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
    await generateTrainingData()
  } catch (error) {
    console.error('\n❌ Training data generation failed:', error)
    process.exit(1)
  } finally {
    // Close database connection
    await closeTrainingDataConnection()
    process.exit(0)
  }
}

// Export for use as module
export { generateTrainingData }

// Run CLI if called directly
if (require.main === module) {
  main()
}
