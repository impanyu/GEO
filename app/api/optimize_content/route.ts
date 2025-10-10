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
  const [promptEmbedding, sentenceEmbedding] = await Promise.all([
    getEmbedding(prompt),
    getEmbedding(sentence)
  ])
  
  // Calculate distances and similarities for all training examples
  const neighbors = trainingData.map(data => {
    const distance = calculateDistance(
      promptEmbedding, domain, sentenceEmbedding,
      data.promptEmbedding, data.domain, data.sentenceEmbedding
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
  
  const score =Math.min(1,totalWeightedVisibility) ;// totalWeight > 0 ? totalWeightedVisibility / totalWeight : 0
  
  return { score, neighbors: top10Neighbors }
}

/**
 * Extract brand name from URL (reused from analyze-simple-web-content.ts)
 */
function extractBrandName(brandUrl: string): string {
  console.log(`🏷️ Extracting brand name from: "${brandUrl}"`)
  
  try {
    if (!brandUrl || brandUrl.trim() === '') {
      console.log('⚠️ Empty brand URL provided, using fallback')
      return 'UnknownBrand'
    }
    
    // Add protocol if missing
    let urlToProcess = brandUrl
    if (!brandUrl.startsWith('http://') && !brandUrl.startsWith('https://')) {
      urlToProcess = 'https://' + brandUrl
    }
    
    const domain = new URL(urlToProcess).hostname.replace('www.', '')
    console.log(`🌐 Extracted domain: "${domain}"`)
    
    const parts = domain.split('.')
    console.log(`📝 Domain parts: [${parts.join(', ')}]`)
    
    // Special extensions that are often part of the brand name
    const brandExtensions = ['.ai', '.chat', '.io', '.dev', '.tech', '.app', '.co']
    
    // Check if domain ends with a brand-relevant extension
    const lastTwoParts = parts.slice(-2).join('.')
    if (parts.length >= 2 && brandExtensions.some(ext => domain.endsWith(ext.substring(1)))) {
      // Include the extension in the brand name (e.g., "rocket.chat" -> "Rocket.chat")
      const brandName = lastTwoParts.charAt(0).toUpperCase() + lastTwoParts.slice(1)
      console.log(`✅ Brand name with extension: "${brandName}"`)
      return brandName
    }
    
    // Default: return just the main domain part (before .com, .org, etc.)
    if (parts.length > 0 && parts[0]) {
      const brandName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
      console.log(`✅ Brand name (main part): "${brandName}"`)
      return brandName
    }
    
    console.log('⚠️ Could not extract brand name from parts, using fallback')
    return 'UnknownBrand'
  } catch (error) {
    console.log(`❌ Error extracting brand name: ${error}`)
    return 'UnknownBrand'
  }
}

/**
 * Generate optimized sentences using GPT-4o
 */
async function generateOptimizedSentences(
  currentSentence: string,
  brandName: string,
  prompt: string,
  higherVisibilitySentences: string[]
): Promise<string[]> {
  try {
    let gptPrompt = ''
    
    if (!currentSentence || currentSentence.trim() === '') {
      // Handle empty sentence case
      if (higherVisibilitySentences.length === 0) {
        gptPrompt = `
Generate 5 different sentences about "${brandName}" that would be suitable for online content and relevant to this context:

CONTEXT PROMPT: "${prompt}"

Requirements:
- Each sentence MUST mention "${brandName}" by its exact name (not "the brand" or any generic term)
- Make them informative and engaging about "${brandName}"
- Ensure the sentences are relevant to the context prompt above
- Vary the style and approach while staying relevant to the prompt
- Keep them concise but meaningful
- Focus on aspects of "${brandName}" that relate to the context prompt

CRITICAL: Always use "${brandName}" explicitly in each sentence, never use "the brand" or other generic references.

Return only a JSON array of 5 strings, no other text.
`
      } else {
        gptPrompt = `
Generate 5 different sentences about "${brandName}" by mimicking the style and approach of these high-visibility examples, while being relevant to the context:

CONTEXT PROMPT: "${prompt}"

HIGH-VISIBILITY EXAMPLES:
${higherVisibilitySentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Requirements:
- Each sentence MUST mention "${brandName}" by its exact name (not "the brand" or any generic term)
- Mimic the style, keywords, and structure of the examples above
- Make them informative and engaging about "${brandName}"
- Ensure the sentences are relevant to the context prompt
- Keep similar length and tone to the examples while addressing the prompt context
- Focus on aspects of "${brandName}" that relate to both the examples and the context prompt

CRITICAL: Always use "${brandName}" explicitly in each sentence, never use "the brand" or other generic references.

Return only a JSON array of 5 strings, no other text.
`
      }
    } else {
      // Handle existing sentence case
      if (higherVisibilitySentences.length === 0) {
        gptPrompt = `
Modify the following sentence about "${brandName}" to create 5 improved versions that are relevant to the context:

CONTEXT PROMPT: "${prompt}"

CURRENT SENTENCE: "${currentSentence}"

Requirements:
- Each version MUST mention "${brandName}" by its exact name (not "the brand" or any generic term)
- Improve clarity, engagement, and informativeness
- Ensure the improved sentences are relevant to the context prompt
- Vary the wording and structure while maintaining relevance to the prompt
- Keep the core meaning but make it more compelling and contextually relevant
- Maintain similar length

CRITICAL: Always use "${brandName}" explicitly in each sentence, never use "the brand" or other generic references.

Return only a JSON array of 5 strings, no other text.
`
      } else {
        gptPrompt = `
Modify the following sentence about "${brandName}" by incorporating the style and approach of these high-visibility examples, while being relevant to the context:

CONTEXT PROMPT: "${prompt}"

CURRENT SENTENCE: "${currentSentence}"

HIGH-VISIBILITY EXAMPLES:
${higherVisibilitySentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Requirements:
- Each modified version MUST mention "${brandName}" by its exact name (not "the brand" or any generic term)
- Mimic the style, keywords, and structure of the high-visibility examples
- Keep the core meaning of the current sentence but adapt the style
- Ensure the modified sentences are relevant to the context prompt
- Make them more similar to the successful examples above while addressing the prompt context
- Maintain appropriate length

CRITICAL: Always use "${brandName}" explicitly in each sentence, never use "the brand" or other generic references.

Return only a JSON array of 5 strings, no other text.
`
      }
    }

    const response = await getOpenRouter().chat.completions.create({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: gptPrompt }],
      temperature: 0.7,
      max_tokens: 500
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
          .slice(0, 5) // Ensure we have at most 5 sentences
        
        // Validate that each sentence contains the brand name
        const validatedSentences = sentences.filter(sentence => {
          const containsBrandName = sentence.toLowerCase().includes(brandName.toLowerCase())
          if (!containsBrandName) {
            console.log(`⚠️ Filtered out sentence without brand name: "${sentence}"`)
          }
          return containsBrandName
        })
        
        console.log(`📝 Generated ${validatedSentences.length} valid sentences with brand name`)
        return validatedSentences
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
      prompt,
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
