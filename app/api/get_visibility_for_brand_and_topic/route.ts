import { NextRequest, NextResponse } from 'next/server'
import { AgentRecommendationContentCache } from '../../../lib/models/AgentRecommendationContentCache'
import { normalizeUrl } from '../../../lib/models/PromptCache'
import OpenAI from 'openai'

// Initialize OpenRouter client for topic filtering
let openrouter: OpenAI

function getOpenRouter(): OpenAI {
  if (!openrouter) {
    openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/your-repo",
        "X-Title": "GEO Brand Visibility API",
      }
    })
  }
  return openrouter
}

/**
 * Filter prompts by topic using OpenRouter GPT-4o
 */
async function filterPromptsByTopic(prompts: string[], topic: string): Promise<string[]> {
  try {
    if (topic.toLowerCase() === 'all' || !topic.trim()) {
      return prompts
    }
    
    console.log(`🔍 Filtering ${prompts.length} prompts by topic: "${topic}"`)
    
    // Create batches to avoid token limits
    const batchSize = 20
    const filteredPrompts: string[] = []
    
    for (let i = 0; i < prompts.length; i += batchSize) {
      const batch = prompts.slice(i, i + batchSize)
      
      const filterPrompt = `
You are a topic relevance analyzer. Given a topic and a list of prompts, identify which prompts are relevant to the topic.

TOPIC: "${topic}"

PROMPTS TO ANALYZE:
${batch.map((prompt, index) => `${i + index + 1}. ${prompt}`).join('\n')}

TASK:
Return only the numbers (1, 2, 3, etc.) of prompts that are relevant to the topic "${topic}".
If a prompt is related to, mentions, or could be answered in the context of "${topic}", include its number.

Return the numbers as a comma-separated list (e.g., "1,3,5,7") or "none" if no prompts are relevant.
Return only the numbers, no other text.
`

      const response = await getOpenRouter().chat.completions.create({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: filterPrompt }],
        temperature: 0.1,
        max_tokens: 100
      })

      const responseText = response.choices[0].message.content?.trim() || ''
      
      if (responseText.toLowerCase() !== 'none') {
        // Parse the response to get relevant prompt indices
        const relevantIndices = responseText
          .split(',')
          .map(num => parseInt(num.trim()) - 1) // Convert to 0-based index
          .filter(index => !isNaN(index) && index >= 0 && index < batch.length)
        
        // Add relevant prompts from this batch
        relevantIndices.forEach(index => {
          filteredPrompts.push(batch[index])
        })
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    console.log(`✅ Filtered to ${filteredPrompts.length} relevant prompts`)
    return filteredPrompts
    
  } catch (error) {
    console.error('❌ Error filtering prompts by topic:', error)
    // Return all prompts if filtering fails
    return prompts
  }
}

/**
 * Check if brand name appears in any sentence within the prompt's content snippets
 */
function checkBrandAppearanceInPrompt(
  brandNames: string[], 
  contentSnippets: { [domain: string]: string[] }
): boolean {
  // Get all sentences from all domains for this prompt
  const allSentences = Object.values(contentSnippets).flat()
  
  // Check if any brand name appears in any sentence
  for (const sentence of allSentences) {
    for (const brandName of brandNames) {
      // Case-insensitive search for brand name in sentence
      if (sentence.toLowerCase().includes(brandName.toLowerCase())) {
        return true
      }
    }
  }
  
  return false
}

/**
 * Extract brand names from URL
 */
function extractBrandNamesFromUrl(url: string): string[] {
  try {
    const domain = new URL(url).hostname.replace('www.', '')
    const parts = domain.split('.')
    
    // Special extensions that are often part of the brand name
    const brandExtensions = ['.ai', '.chat', '.io', '.dev', '.tech', '.app', '.co']
    
    // Check if domain ends with a brand-relevant extension
    const lastTwoParts = parts.slice(-2).join('.')
    if (parts.length >= 2 && brandExtensions.some(ext => domain.endsWith(ext.substring(1)))) {
      return [lastTwoParts.charAt(0).toUpperCase() + lastTwoParts.slice(1)]
    }
    
    // Default: return just the main domain part
    return [parts[0].charAt(0).toUpperCase() + parts[0].slice(1)]
  } catch {
    return [url]
  }
}

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get Visibility for Brand and Topic')
    
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('brandUrl')
    const topic = searchParams.get('topic') || 'all'
    
    if (!brandUrl) {
      console.log('❌ Missing brandUrl parameter')
      return NextResponse.json(
        { error: 'brandUrl parameter is required' },
        { status: 400 }
      )
    }

    console.log(`🔍 Calculating visibility for brand: ${brandUrl}`)
    console.log(`🏷️ Topic filter: ${topic}`)
    
    // Normalize the brand URL for consistent lookup
    const normalizedBrandUrl = normalizeUrl(brandUrl)
    console.log(`🔍 Searching for normalized URL: ${normalizedBrandUrl}`)
    
    // Extract brand names from the URL
    const brandNames = extractBrandNamesFromUrl(brandUrl)
    console.log(`🏢 Brand names to search for: ${brandNames.join(', ')}`)
    
    // Find documents that contain this brand URL
    const analyses = await AgentRecommendationContentCache.findByBrandUrls([normalizedBrandUrl])
    
    if (analyses.length === 0) {
      console.log(`❌ No agent recommendation content found for: ${brandUrl}`)
      return NextResponse.json({
        success: true,
        data: {
          brandUrl,
          normalizedBrandUrl,
          topic,
          visibility: 0,
          totalPrompts: 0,
          filteredPrompts: 0,
          brandAppearances: 0,
          message: 'No agent recommendation content found for this brand'
        }
      })
    }

    console.log(`✅ Found ${analyses.length} agent recommendation analyses`)
    
    // Merge all prompt content from all analyses
    // Merge all contentSnippets from all analyses
    let mergedContentSnippets: { [domain: string]: string[] } = {}
    analyses.forEach(analysis => {
      if (analysis.contentSnippets) {
        Object.entries(analysis.contentSnippets).forEach(([domain, sentences]) => {
          if (!mergedContentSnippets[domain]) {
            mergedContentSnippets[domain] = []
          }
          mergedContentSnippets[domain].push(...sentences)
        })
      }
    })
    const totalDomains = Object.keys(mergedContentSnippets).length
    console.log(`📊 Total merged domains: ${totalDomains}`)
    
    // Since we now have merged content, we calculate visibility based on 
    // brand mentions across all domains in the merged content
    let brandAppearanceCount = 0
    let totalSentences = 0
    
    console.log(`🔍 Checking brand appearances in merged content across ${totalDomains} domains...`)
    
    for (const [domain, sentences] of Object.entries(mergedContentSnippets)) {
      totalSentences += sentences.length
      
      // Check if any sentence in this domain contains the brand
      const domainHasBrand = sentences.some(sentence => 
        brandNames.some(brandName => 
          sentence.toLowerCase().includes(brandName.toLowerCase())
        )
      )
      
      if (domainHasBrand) {
        brandAppearanceCount += sentences.length
        console.log(`✅ Brand found in domain ${domain}: ${sentences.length} sentences`)
      }
    }
    
    // Calculate visibility (sentences with brand mentions / total sentences)
    const visibility = totalSentences > 0 ? brandAppearanceCount / totalSentences : 0
    
    console.log(`📊 Visibility calculation:`)
    console.log(`  - Sentences with brand mentions: ${brandAppearanceCount}`)
    console.log(`  - Total sentences: ${totalSentences}`)
    console.log(`  - Visibility: ${visibility.toFixed(4)} (${(visibility * 100).toFixed(2)}%)`)
    
    // Prepare response
    const responseData = {
      brandUrl,
      normalizedBrandUrl,
      topic,
      visibility: Math.round(visibility * 10000) / 10000, // Round to 4 decimal places
      totalDomains: totalDomains,
      totalSentences: totalSentences,
      sentencesWithBrandMentions: brandAppearanceCount,
      brandNames,
      metadata: {
        totalAnalyses: analyses.length,
        agentPlatforms: Array.from(new Set(analyses.map(a => a.agentPlatform))),
        sampledTime: analyses.map(a => a.sampledTime).sort().reverse()[0] // Most recent
      }
    }
    
    return NextResponse.json({
      success: true,
      data: responseData
    })

  } catch (error) {
    console.error('❌ Error calculating brand visibility:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
