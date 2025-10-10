import { NextRequest, NextResponse } from 'next/server'
import { PromptDomainSentencesVisibilityTrainingDataCache } from '../../../lib/models/PromptDomainSentencesVisibilityTrainingDataCache'
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
 * Get OpenAI embedding for text
 */
async function getEmbedding(text: string): Promise<number[]> {
  try {
    if (!text.trim()) {
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
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  if (normA === 0 || normB === 0) {
    return 0
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Calculate domain similarity based on common domain components from right to left
 */
function calculateDomainSimilarity(domain1: string, domain2: string): number {
  const components1 = domain1.toLowerCase().split('.')
  const components2 = domain2.toLowerCase().split('.')
  
  // Start from the rightmost components and count consecutive matches
  let commonComponents = 0
  const minLength = Math.min(components1.length, components2.length)
  
  for (let i = 1; i <= minLength; i++) {
    const comp1 = components1[components1.length - i]
    const comp2 = components2[components2.length - i]
    
    if (comp1 === comp2) {
      commonComponents++
    } else {
      break // Stop at first mismatch
    }
  }
  
  // Calculate similarity as common components / max components
  const maxComponents = Math.max(components1.length, components2.length)
  const similarity = maxComponents > 0 ? commonComponents / maxComponents : 0
  
  return similarity
}

/**
 * Calculate distance between two (prompt, domain, sentence) combinations
 * with improved similarity thresholding and domain component matching
 */
function calculateDistance(
  promptEmb1: number[], domain1: string, sentenceEmb1: number[],
  promptEmb2: number[], domain2: string, sentenceEmb2: number[]
): number {
  const promptSim = cosineSimilarity(promptEmb1, promptEmb2)
  const domainSim = calculateDomainSimilarity(domain1, domain2)
  const sentenceSim = cosineSimilarity(sentenceEmb1, sentenceEmb2)
  
  // Apply similarity thresholding - below threshold becomes 0
  const threshold = 0.1
  const thresholdedPromptSim = promptSim > threshold ? promptSim : 0
  const thresholdedDomainSim = domainSim > threshold ? domainSim : 0
  const thresholdedSentenceSim = sentenceSim > threshold ? sentenceSim : 0
  
  // Distance = 1 - similarity, then weighted sum
  // Increased sentence weight to 0.6, reduced others
  const distance = 0.3 * (1 - thresholdedPromptSim) + 0.2 * (1 - thresholdedDomainSim) + 0.5 * (1 - thresholdedSentenceSim)
  
  return distance
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get Visibility Score')
    
    const body = await request.json()
    const { brandUrl, agentPlatform, prompt, domain, sentence } = body
    
    if (!prompt || !domain) {
      return NextResponse.json(
        { error: 'Prompt and domain are required' },
        { status: 400 }
      )
    }
    
    console.log(`📊 Calculating visibility for:`)
    console.log(`  - Prompt: ${prompt.substring(0, 50)}...`)
    console.log(`  - Domain: ${domain}`)
    console.log(`  - Sentence: ${sentence ? sentence.substring(0, 50) + '...' : '(empty)'}`)
    
    // Handle empty sentence case
    if (!sentence || sentence.trim() === '') {
      console.log('⚠️ Empty sentence provided, returning 0 visibility')
      return NextResponse.json({
        success: true,
        score: 0,
        nearestNeighbors: []
      })
    }
    

    
    // Get embeddings for the input
    console.log('🔢 Computing embeddings for input...')
    const [promptEmbedding, sentenceEmbedding] = await Promise.all([
      getEmbedding(prompt),
      getEmbedding(sentence)
    ])
    
    // Get all training data
    console.log('📚 Loading training data...')
    const trainingData = await PromptDomainSentencesVisibilityTrainingDataCache.findAll()
    
    if (trainingData.length === 0) {
      console.log('⚠️ No training data found')
      return NextResponse.json({
        success: true,
        score: 0,
        nearestNeighbors: []
      })
    }
    
    console.log(`📊 Found ${trainingData.length} training examples`)
    
    // Calculate distances and similarities for all training examples
    const neighbors = trainingData.map(data => {
      const distance = calculateDistance(
        promptEmbedding, domain, sentenceEmbedding,
        data.promptEmbedding, data.domain, data.sentenceEmbedding
      )
      
      // Convert distance back to similarity for weighting
      const similarity = Math.max(0, 1 - distance)
      
      return {
        prompt: data.prompt,
        domain: data.domain,
        sentence: data.sentence,
        visibility: data.visibility,
        similarity,
        distance
      }
    })
    
    // Sort by distance (ascending) and take top 10
    neighbors.sort((a, b) => a.distance - b.distance)
    const top10Neighbors = neighbors.slice(0, 10)
    
    console.log(`🎯 Top 10 nearest neighbors found`)
    
    // Calculate weighted visibility score with non-linear weighting
    let totalWeightedVisibility = 0
    let totalWeight = 0
    
    for (const neighbor of top10Neighbors) {
      // Exponential weighting: e^(k * similarity) - 1 where k controls steepness
      // Using k = 3 for good discrimination
      // When similarity = 1.0, weight ≈ 1.0 (e^3 - 1) / (e^3 - 1) = 1.0
      // When similarity = 0.5, weight ≈ 0.22 (much lower)
      // When similarity = 0.0, weight = 0.0
      const k = 10
      const weight = (Math.exp(k * neighbor.similarity) - 1) / (Math.exp(k) - 1)
      totalWeightedVisibility += neighbor.visibility * weight
      totalWeight += weight
    }
    
    const visibilityScore = Math.min(1,totalWeightedVisibility) ;//totalWeight > 0 ? totalWeightedVisibility / totalWeight : 0
    
    console.log(`✅ Calculated visibility score: ${(visibilityScore * 100).toFixed(2)}%`)
    
    return NextResponse.json({
      success: true,
      score: visibilityScore,
      nearestNeighbors: top10Neighbors.map(n => ({
        prompt: n.prompt,
        domain: n.domain,
        sentence: n.sentence,
        visibility: n.visibility,
        similarity: n.similarity
      }))
    })

  } catch (error) {
    console.error('❌ Error calculating visibility score:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
