import { NextRequest, NextResponse } from 'next/server'
import { 
  AgentRecommendationContentCache, 
  closeDatabaseConnection,
  type AgentRecommendationContentDocument 
} from '@/lib/models/AgentRecommendationContentCache'
import { normalizeUrl } from '@/lib/models/PromptCache'

interface ApiResponse {
  success: boolean
  data?: AgentRecommendationContentDocument & {
    sampledTime: string // Serialized as string for API response
  }
  error?: string
  message?: string
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('url')
    
    console.log(`🔍 API Request - Agent Recommendation Content: { brandUrl: '${brandUrl}' }`)
    
    if (!brandUrl) {
      return NextResponse.json({
        success: false,
        error: 'Brand URL parameter is required'
      } as ApiResponse, { status: 400 })
    }

    // Normalize the input URL to match stored format
    const normalizedBrandUrl = normalizeUrl(brandUrl)
    console.log(`🔍 Looking for agent recommendation content for normalized URL: ${normalizedBrandUrl}`)
    
    // Find agent recommendation content document that contains this normalized brand URL
    const collection = await AgentRecommendationContentCache.getCollectionInstance()
    const document = await collection.findOne({
      normalizedBrandUrls: { $in: [normalizedBrandUrl] }
    })
    
    if (!document) {
      console.log(`❌ No agent recommendation content found for: ${normalizedBrandUrl}`)
      return NextResponse.json({
        success: false,
        message: `No agent recommendation content analysis found for "${brandUrl}". Please run the analyze-agent-recommendation script first.`
      } as ApiResponse, { status: 404 })
    }

    console.log(`✅ Found agent recommendation content for: ${normalizedBrandUrl}`)
    
    // Calculate some basic stats for the response
    const totalDomains = new Set(
      Object.values(document.websiteContent).flatMap(dimensionContent => Object.keys(dimensionContent))
    ).size
    
    const totalSnippets = Object.values(document.websiteContent).reduce((sum, dimensionContent) => 
      sum + Object.values(dimensionContent).reduce((dimSum, snippets) => 
        dimSum + snippets.length, 0), 0)
    
    const dimensionsWithContent = Object.keys(document.websiteContent).filter(
      dimension => Object.keys(document.websiteContent[dimension]).length > 0
    ).length
    
    console.log(`📊 Agent recommendation content contains ${dimensionsWithContent} dimensions`)
    console.log(`📈 Analysis stats: ${totalDomains} domains, ${dimensionsWithContent} dimensions, ${totalSnippets} snippets`)
    
    return NextResponse.json({
      success: true,
      data: {
        ...document,
        // Convert MongoDB ObjectId to string for JSON serialization
        _id: document._id?.toString(),
        // Ensure sampledTime is serializable
        sampledTime: document.sampledTime instanceof Date 
          ? document.sampledTime.toISOString() 
          : document.sampledTime
      }
    } as ApiResponse)
    
  } catch (error) {
    console.error('❌ Error fetching agent recommendation content:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    } as ApiResponse, { status: 500 })
  } finally {
    await closeDatabaseConnection()
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
