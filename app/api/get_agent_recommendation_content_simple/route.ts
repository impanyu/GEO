import { NextRequest, NextResponse } from 'next/server'
import { AgentRecommendationContentCache } from '../../../lib/models/AgentRecommendationContentCache'
import { normalizeUrl } from '../../../lib/models/PromptCache'
import OpenAI from 'openai'

// Initialize OpenAI client for topic filtering
let openai: OpenAI

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/your-repo",
        "X-Title": "GEO Agent Recommendation API",
      }
    })
  }
  return openai
}

/**
 * Filter prompts by topic using GPT-4o
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

      const response = await getOpenAI().chat.completions.create({
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

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get Agent Recommendation Content (Simple)')
    
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

    console.log(`🔍 Looking for agent recommendation content for: ${brandUrl}`)
    console.log(`🏷️ Topic filter: ${topic}`)
    
    // Normalize the brand URL for consistent lookup
    const normalizedBrandUrl = normalizeUrl(brandUrl)
    console.log(`🔍 Searching for normalized URL: ${normalizedBrandUrl}`)
    
    // Find documents that contain this brand URL
    const analyses = await AgentRecommendationContentCache.findByBrandUrls([normalizedBrandUrl])
    
    if (analyses.length === 0) {
      console.log(`❌ No agent recommendation content found for: ${brandUrl}`)
      return NextResponse.json(
        { error: 'Agent recommendation content not found for this brand' },
        { status: 404 }
      )
    }

    console.log(`✅ Found ${analyses.length} agent recommendation analyses`)
    
    // Merge all prompt content from all analyses
    // Merge all contentSnippets from all analyses and all prompts
    let mergedContentSnippets: { [domain: string]: string[] } = {}
    analyses.forEach(analysis => {
      if (analysis.promptContentMapping) {
        Object.values(analysis.promptContentMapping).forEach(contentSnippets => {
          Object.entries(contentSnippets).forEach(([domain, sentences]) => {
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
          })
        })
      }
    })
    
    // Topic filtering is now supported again with prompt-based structure
    if (topic && topic.toLowerCase() !== 'all') {
      console.log(`🎯 Filtering prompts by topic: "${topic}"`)
      
      // Get all prompts from all analyses
      const allPrompts: string[] = []
      analyses.forEach(analysis => {
        if (analysis.promptContentMapping) {
          allPrompts.push(...Object.keys(analysis.promptContentMapping))
        }
      })
      
      if (allPrompts.length > 0) {
        // Filter prompts by topic using OpenRouter GPT-4o
        const relevantPrompts = await filterPromptsByTopic(allPrompts, topic)
        console.log(`🎯 Filtered to ${relevantPrompts.length} relevant prompts`)
        
        // Re-merge content snippets only from relevant prompts
        mergedContentSnippets = {}
        analyses.forEach(analysis => {
          if (analysis.promptContentMapping) {
            Object.entries(analysis.promptContentMapping).forEach(([prompt, contentSnippets]) => {
              if (relevantPrompts.includes(prompt)) {
                Object.entries(contentSnippets).forEach(([domain, sentences]) => {
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
                })
              }
            })
          }
        })
      }
    }
    
    console.log(`📊 Merged content from ${analyses.length} analyses:`)
    console.log(`  - Total domains: ${Object.keys(mergedContentSnippets).length}`)
    console.log(`  - Total sentences: ${Object.values(mergedContentSnippets).flat().length}`)
    
    // Calculate statistics
    const totalDomains = Object.keys(mergedContentSnippets).length
    const totalSentences = Object.values(mergedContentSnippets).reduce(
      (sum, sentences) => sum + sentences.length, 
      0
    )
    
    console.log(`📊 Merged content: ${totalDomains} domains, ${totalSentences} sentences`)
    
    // Prepare response with metadata
    const responseData = {
      brandUrl,
      normalizedBrandUrl,
      topic,
      totalAnalyses: analyses.length,
      domainContent: mergedContentSnippets,
      statistics: {
        totalDomains,
        totalSentences,
        averageSentencesPerDomain: totalDomains > 0 ? Math.round(totalSentences / totalDomains) : 0
      },
      metadata: {
        agentPlatforms: Array.from(new Set(analyses.map(a => a.agentPlatform))),
        sampledTime: analyses.map(a => a.sampledTime).sort().reverse()[0] // Most recent
      }
    }
    
    return NextResponse.json({
      success: true,
      data: responseData
    })

  } catch (error) {
    console.error('❌ Error fetching agent recommendation content:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
