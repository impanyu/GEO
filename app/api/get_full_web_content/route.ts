import { NextRequest, NextResponse } from 'next/server'
import { 
  FullWebContentCache, 
  closeDatabaseConnection,
  type FullWebContentDocument 
} from '@/lib/models/FullWebContentCache'
import { normalizeUrl } from '@/lib/models/PromptCache'

interface ApiResponse {
  success: boolean
  data?: FullWebContentDocument
  error?: string
  message?: string
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('url')
    
    console.log('🔍 API Request - Full Web Content:', { brandUrl })
    
    if (!brandUrl) {
      return NextResponse.json({
        success: false,
        error: 'Brand URL parameter is required'
      } as ApiResponse, { status: 400 })
    }

    // Validate URL format
    try {
      new URL(brandUrl)
    } catch {
      return NextResponse.json({
        success: false,
        error: 'Invalid URL format'
      } as ApiResponse, { status: 400 })
    }

    console.log(`🔍 Looking for web content analysis for: ${brandUrl}`)
    
    // Normalize the brand URL for consistent searching
    const normalizedBrandUrl = normalizeUrl(brandUrl)
    console.log(`🔍 Searching for normalized URL: ${normalizedBrandUrl}`)
    
    // Find analysis by normalized brand URL first, then fall back to original brandUrl
    let analysis = await FullWebContentCache.findByBrandUrl(normalizedBrandUrl)
    
    if (!analysis) {
      console.log(`🔄 No match with normalized URL, trying original brandUrl: ${brandUrl}`)
      // Fall back to searching by original brandUrl for backward compatibility
      const collection = await FullWebContentCache.getCollectionInstance()
      analysis = await collection.findOne({ brandUrl })
    }
    
    if (!analysis) {
      console.log(`❌ No web content analysis found for: ${brandUrl}`)
      return NextResponse.json({
        success: false,
        message: `No web content analysis found for ${brandUrl}. Please run the analyze-web-content script first.`
      } as ApiResponse, { status: 404 })
    }

    console.log(`✅ Found web content analysis for: ${brandUrl}`)
    console.log(`📊 Analysis contains ${Object.keys(analysis.websiteContent).length} dimensions`)
    
    // Calculate some statistics for logging (with backward compatibility)
    const totalDomains = new Set(
      Object.values(analysis.websiteContent).flatMap(dimensionContent => Object.keys(dimensionContent))
    ).size
    
    const totalSnippets = Object.values(analysis.websiteContent).reduce((sum, dimensionContent) => 
      sum + Object.values(dimensionContent).reduce((dimSum, domainData) => {
        // Backward compatibility: handle both old (string[]) and new ({sentences: [], visibility: number}) formats
        if (Array.isArray(domainData)) {
          return dimSum + domainData.length
        } else {
          return dimSum + (domainData.sentences?.length || 0)
        }
      }, 0), 0)
    
    const dimensionsWithContent = Object.keys(analysis.websiteContent).filter(
      dimension => Object.keys(analysis.websiteContent[dimension]).length > 0
    ).length

    console.log(`📈 Analysis stats: ${totalDomains} domains, ${dimensionsWithContent} dimensions, ${totalSnippets} snippets`)

    return NextResponse.json({
      success: true,
      data: analysis
    } as ApiResponse)
    
  } catch (error) {
    console.error('❌ Error fetching full web content:', error)
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
