import { NextRequest, NextResponse } from 'next/server'
import { AgentRecommendationContentCache } from '../../../lib/models/AgentRecommendationContentCache'
import { normalizeUrl } from '../../../lib/models/PromptCache'

// Interface for merged domain content
interface MergedDomainContent {
  [domain: string]: string[]
}

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get Simple Web Content (Merged from Prompts)')
    
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('brandUrl')
    
    if (!brandUrl) {
      console.log('❌ Missing brandUrl parameter')
      return NextResponse.json(
        { error: 'brandUrl parameter is required' },
        { status: 400 }
      )
    }

    console.log(`🔍 Looking for agent recommendation content for: ${brandUrl}`)
    
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
    const allPromptContent = analyses.flatMap(analysis => analysis.promptsContent || [])
    console.log(`📊 Total prompt content entries: ${allPromptContent.length}`)
    
    // Merge domain mappings from different prompts
    const mergedDomainContent: MergedDomainContent = {}
    
    console.log(`🔄 Merging domain content from ${allPromptContent.length} prompts...`)
    
    for (const promptContent of allPromptContent) {
      for (const [domain, sentences] of Object.entries(promptContent.contentSnippets)) {
        if (!mergedDomainContent[domain]) {
          mergedDomainContent[domain] = []
        }
        
        // Add unique sentences only
        const existingSentences = new Set(mergedDomainContent[domain])
        for (const sentence of sentences) {
          if (!existingSentences.has(sentence)) {
            mergedDomainContent[domain].push(sentence)
          }
        }
      }
    }
    
    // Calculate statistics
    const domains = Object.keys(mergedDomainContent)
    const totalSentences = Object.values(mergedDomainContent).reduce(
      (sum, sentences) => sum + sentences.length, 
      0
    )
    
    console.log(`📊 Merged content statistics:`)
    console.log(`  - Unique domains: ${domains.length}`)
    console.log(`  - Total unique sentences: ${totalSentences}`)
    console.log(`  - Sentences per domain:`)
    
    domains.forEach(domain => {
      console.log(`    - ${domain}: ${mergedDomainContent[domain].length} sentences`)
    })
    
    // Prepare response data
    const responseData = {
      brandUrl,
      normalizedBrandUrl,
      totalAnalyses: analyses.length,
      totalPromptsProcessed: allPromptContent.length,
      uniqueDomains: domains.length,
      totalSentences,
      domainContent: mergedDomainContent,
      metadata: {
        agentPlatforms: [...new Set(analyses.map(a => a.agentPlatform))],
        sampledTime: analyses.map(a => a.sampledTime).sort().reverse()[0], // Most recent
        totalPrompts: analyses.reduce((sum, a) => sum + (a.totalPrompts || 0), 0),
        sampledPrompts: analyses.reduce((sum, a) => sum + (a.sampledPrompts || 0), 0)
      }
    }
    
    return NextResponse.json({
      success: true,
      data: responseData
    })

  } catch (error) {
    console.error('❌ Error fetching and merging simple web content:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
