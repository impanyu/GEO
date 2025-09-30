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
    let allPromptContent = analyses.flatMap(analysis => analysis.promptsContent || [])
    
    // Filter prompts by topic if specified
    if (topic && topic.toLowerCase() !== 'all') {
      const allPrompts = allPromptContent.map(pc => pc.prompt)
      const relevantPrompts = await filterPromptsByTopic(allPrompts, topic)
      
      // Filter prompt content to only include relevant prompts
      allPromptContent = allPromptContent.filter(pc => 
        relevantPrompts.includes(pc.prompt)
      )
      
      console.log(`🎯 Filtered to ${allPromptContent.length} prompts relevant to "${topic}"`)
    }
    
    // Merge sentence lists under each normalized domain
    const mergedDomainContent: { [domain: string]: string[] } = {}
    
    for (const promptContent of allPromptContent) {
      for (const [domain, sentences] of Object.entries(promptContent.contentSnippets)) {
        if (!mergedDomainContent[domain]) {
          mergedDomainContent[domain] = []
        }
        mergedDomainContent[domain].push(...sentences)
      }
    }
    
    // Remove duplicates within each domain
    for (const domain in mergedDomainContent) {
      mergedDomainContent[domain] = [...new Set(mergedDomainContent[domain])]
    }
    
    // Calculate statistics
    const totalDomains = Object.keys(mergedDomainContent).length
    const totalSentences = Object.values(mergedDomainContent).reduce(
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
      totalPromptsProcessed: allPromptContent.length,
      domainContent: mergedDomainContent,
      statistics: {
        totalDomains,
        totalSentences,
        averageSentencesPerDomain: totalDomains > 0 ? Math.round(totalSentences / totalDomains) : 0
      },
      metadata: {
        agentPlatforms: [...new Set(analyses.map(a => a.agentPlatform))],
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
