import { NextRequest, NextResponse } from 'next/server'
import { PromptDomainSentencesVisibilityTrainingDataCache } from '../../../lib/models/PromptDomainSentencesVisibilityTrainingDataCache'
import OpenAI from 'openai'

// Initialize OpenAI clients
let openaiClient: OpenAI
let openRouterClient: OpenAI

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  }
  return openaiClient
}

function getOpenRouter(): OpenAI {
  if (!openRouterClient) {
    openRouterClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1'
    })
  }
  return openRouterClient
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
 * Calculate distance between two (prompt, domain, sentence) combinations
 */
function calculateDistance(
  promptEmb1: number[], domainEmb1: number[], sentenceEmb1: number[],
  promptEmb2: number[], domainEmb2: number[], sentenceEmb2: number[]
): number {
  const promptSim = cosineSimilarity(promptEmb1, promptEmb2)
  const domainSim = cosineSimilarity(domainEmb1, domainEmb2)
  const sentenceSim = cosineSimilarity(sentenceEmb1, sentenceEmb2)
  
  // Distance = 1 - similarity, then weighted sum
  const distance = 0.3 * (1 - promptSim) + 0.2 * (1 - domainSim) + 0.5 * (1 - sentenceSim)
  
  return distance
}

/**
 * Calculate visibility score for a given sentence and return top 10 nearest neighbors
 */
async function calculateVisibilityScore(
  prompt: string,
  domain: string,
  sentence: string,
  trainingData: any[]
): Promise<{
  score: number,
  neighbors: Array<{
    sentence: string,
    visibility: number,
    distance: number,
    similarity: number
  }>
}> {
  if (!sentence || sentence.trim() === '') {
    return { score: 0, neighbors: [] }
  }
  
  // Get embeddings for the input
  const [promptEmbedding, domainEmbedding, sentenceEmbedding] = await Promise.all([
    getEmbedding(prompt),
    getEmbedding(domain),
    getEmbedding(sentence)
  ])
  
  // Calculate distances and similarities for all training examples
  const neighbors = trainingData.map(data => {
    const distance = calculateDistance(
      promptEmbedding, domainEmbedding, sentenceEmbedding,
      data.promptEmbedding, data.domainEmbedding, data.sentenceEmbedding
    )
    
    // Convert distance back to similarity for weighting
    const similarity = Math.max(0, 1 - distance)
    
    return {
      sentence: data.sentence,
      visibility: data.visibility,
      similarity,
      distance
    }
  })
  
  // Sort by distance and take top 10
  neighbors.sort((a, b) => a.distance - b.distance)
  const top10Neighbors = neighbors.slice(0, 10)
  
  // Calculate weighted visibility score
  let totalWeightedVisibility = 0
  let totalWeight = 0
  
  for (const neighbor of top10Neighbors) {
    const weight = neighbor.similarity
    totalWeightedVisibility += neighbor.visibility * weight
    totalWeight += weight
  }
  
  const score = totalWeight > 0 ? totalWeightedVisibility / totalWeight : 0
  
  return { score, neighbors: top10Neighbors }
}

/**
 * Extract brand name from URL (reused from analyze-simple-web-content.ts)
 */
function extractBrandName(brandUrl: string): string {
  try {
    if (!brandUrl) return 'the brand'
    
    const domain = new URL(brandUrl).hostname.replace('www.', '')
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
    return 'the brand'
  }
}

/**
 * Generate optimized sentences using GPT-4o
 */
async function generateOptimizedSentences(
  currentSentence: string,
  brandName: string,
  higherVisibilitySentences: string[]
): Promise<string[]> {
  try {
    let prompt = ''
    
    if (!currentSentence || currentSentence.trim() === '') {
      // Handle empty sentence case
      if (higherVisibilitySentences.length === 0) {
        prompt = `
Generate 5 different sentences about "${brandName}" that would be suitable for online content.

Requirements:
- Each sentence must mention "${brandName}" by name
- Make them informative and engaging
- Vary the style and approach
- Keep them concise but meaningful
- Focus on different aspects (features, benefits, use cases, etc.)

Return only a JSON array of 5 strings, no other text.
`
      } else {
        prompt = `
Generate 5 different sentences about "${brandName}" by mimicking the style and approach of these high-visibility examples:

HIGH-VISIBILITY EXAMPLES:
${higherVisibilitySentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Requirements:
- Each sentence must mention "${brandName}" by name
- Mimic the style, keywords, and structure of the examples above
- Make them informative and engaging about "${brandName}"
- Keep similar length and tone to the examples
- Focus on similar topics/aspects as the examples

Return only a JSON array of 5 strings, no other text.
`
      }
    } else {
      // Handle existing sentence case
      if (higherVisibilitySentences.length === 0) {
        prompt = `
Modify the following sentence about "${brandName}" to create 5 improved versions:

CURRENT SENTENCE: "${currentSentence}"

Requirements:
- Each version must mention "${brandName}" by name
- Improve clarity, engagement, and informativeness
- Vary the wording and structure
- Keep the core meaning but make it more compelling
- Maintain similar length

Return only a JSON array of 5 strings, no other text.
`
      } else {
        prompt = `
Modify the following sentence about "${brandName}" by incorporating the style and approach of these high-visibility examples:

CURRENT SENTENCE: "${currentSentence}"

HIGH-VISIBILITY EXAMPLES:
${higherVisibilitySentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Requirements:
- Each modified version must mention "${brandName}" by name
- Mimic the style, keywords, and structure of the high-visibility examples
- Keep the core meaning of the current sentence but adapt the style
- Make them more similar to the successful examples above
- Maintain appropriate length

Return only a JSON array of 5 strings, no other text.
`
      }
    }

    const response = await getOpenRouter().chat.completions.create({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500
    })

    const responseText = response.choices[0].message.content || '[]'
    
    // Clean and parse JSON response
    const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim()
    
    try {
      const parsed = JSON.parse(cleanedResponse)
      
      if (Array.isArray(parsed)) {
        return parsed
          .filter(sentence => typeof sentence === 'string' && sentence.length > 0)
          .map(sentence => sentence.trim())
          .slice(0, 5) // Ensure we have at most 5 sentences
      } else {
        console.log('⚠️ GPT response is not an array')
        return []
      }
    } catch (parseError) {
      console.log('⚠️ Failed to parse GPT response as JSON:', parseError)
      return []
    }

  } catch (error) {
    console.error('❌ Error generating optimized sentences:', error)
    return []
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔍 API Request - Optimize Content')
    
    const body = await request.json()
    const { brandUrl, agentPlatform, prompt, domain, sentence } = body
    
    if (!prompt || !domain) {
      return NextResponse.json(
        { error: 'Prompt and domain are required' },
        { status: 400 }
      )
    }
    
    console.log(`🎯 Optimizing content for:`)
    console.log(`  - Brand: ${brandUrl}`)
    console.log(`  - Prompt: ${prompt.substring(0, 50)}...`)
    console.log(`  - Domain: ${domain}`)
    console.log(`  - Current sentence: ${sentence ? sentence.substring(0, 50) + '...' : '(empty)'}`)
    
    // Extract brand name
    const brandName = extractBrandName(brandUrl)
    console.log(`🏷️ Extracted brand name: ${brandName}`)
    
    // Get all training data
    console.log('📚 Loading training data...')
    const trainingData = await PromptDomainSentencesVisibilityTrainingDataCache.findAll()
    
    if (trainingData.length === 0) {
      console.log('⚠️ No training data found')
      return NextResponse.json({
        success: true,
        originalScore: 0,
        optimizedSentence: sentence || '',
        optimizedScore: 0,
        improvement: 0,
        candidates: []
      })
    }
    
    // Calculate original visibility score
    const originalResult = await calculateVisibilityScore(prompt, domain, sentence || '', trainingData)
    const originalScore = originalResult.score
    const originalNeighbors = originalResult.neighbors
    console.log(`📊 Original visibility score: ${(originalScore * 100).toFixed(2)}%`)
    
    // Find neighbors with higher visibility from the already computed neighbors
    const higherVisibilityNeighbors = originalNeighbors.filter(n => n.visibility > originalScore)
    const higherVisibilitySentences = higherVisibilityNeighbors.map(n => n.sentence)
    
    console.log(`🎯 Found ${higherVisibilityNeighbors.length} neighbors with higher visibility`)
    
    // Generate optimized sentences using GPT-4o
    console.log('🤖 Generating optimized sentences with GPT-4o...')
    const candidateSentences = await generateOptimizedSentences(
      sentence || '',
      brandName,
      higherVisibilitySentences
    )
    
    if (candidateSentences.length === 0) {
      console.log('⚠️ No candidate sentences generated')
      return NextResponse.json({
        success: true,
        originalScore,
        optimizedSentence: sentence || '',
        optimizedScore: originalScore,
        improvement: 0,
        candidates: []
      })
    }
    
    console.log(`📝 Generated ${candidateSentences.length} candidate sentences`)
    
    // Calculate visibility scores for all candidates
    console.log('📊 Calculating visibility scores for candidates...')
    const candidatesWithScores = []
    
    for (const candidateSentence of candidateSentences) {
      const result = await calculateVisibilityScore(prompt, domain, candidateSentence, trainingData)
      const score = result.score
      candidatesWithScores.push({
        sentence: candidateSentence,
        score
      })
      console.log(`  - "${candidateSentence.substring(0, 50)}...": ${(score * 100).toFixed(2)}%`)
    }
    
    // Find the best candidate
    candidatesWithScores.sort((a, b) => b.score - a.score)
    const bestCandidate = candidatesWithScores[0]
    
    const improvement = bestCandidate.score - originalScore
    
    console.log(`✅ Best optimized sentence: ${(bestCandidate.score * 100).toFixed(2)}%`)
    console.log(`📈 Improvement: +${(improvement * 100).toFixed(2)}%`)
    
    return NextResponse.json({
      success: true,
      originalScore,
      optimizedSentence: bestCandidate.sentence,
      optimizedScore: bestCandidate.score,
      improvement,
      candidates: candidatesWithScores
    })

  } catch (error) {
    console.error('❌ Error optimizing content:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
