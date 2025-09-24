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
    
    // Find analysis by brand URL
    const analysis = await FullWebContentCache.findByBrandUrl(brandUrl)
    
    if (!analysis) {
      console.log(`❌ No web content analysis found for: ${brandUrl}`)
      return NextResponse.json({
        success: false,
        message: `No web content analysis found for ${brandUrl}. Please run the analyze-web-content script first.`
      } as ApiResponse, { status: 404 })
    }

    console.log(`✅ Found web content analysis for: ${brandUrl}`)
    console.log(`📊 Analysis contains ${Object.keys(analysis.websiteContent).length} websites`)
    
    // Calculate some statistics for logging
    const totalWebsites = Object.keys(analysis.websiteContent).length
    const totalDimensions = new Set(
      Object.values(analysis.websiteContent).flatMap(site => Object.keys(site))
    ).size
    const totalSnippets = Object.values(analysis.websiteContent).reduce((sum, site) => 
      sum + Object.values(site).reduce((dimSum, dim) => 
        dimSum + Object.keys(dim).length, 0), 0)

    console.log(`📈 Analysis stats: ${totalWebsites} websites, ${totalDimensions} dimensions, ${totalSnippets} snippets`)

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
