import { NextRequest, NextResponse } from 'next/server'
import { SimpleWebContentCache } from '../../../lib/models/SimpleWebContentCache'
import { normalizeUrl } from '../../../lib/models/PromptCache'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get Simple Web Content')
    
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('brandUrl')
    
    if (!brandUrl) {
      console.log('❌ Missing brandUrl parameter')
      return NextResponse.json(
        { error: 'brandUrl parameter is required' },
        { status: 400 }
      )
    }

    console.log(`🔍 Looking for simple web content for: ${brandUrl}`)
    
    // Normalize the brand URL for consistent lookup
    const normalizedBrandUrl = normalizeUrl(brandUrl)
    console.log(`🔍 Searching for normalized URL: ${normalizedBrandUrl}`)
    
    // Find the document in SimpleWebContentCache
    const analysis = await SimpleWebContentCache.findByBrandUrl(normalizedBrandUrl)
    
    if (!analysis) {
      console.log(`❌ No simple web content found for: ${brandUrl}`)
      return NextResponse.json(
        { error: 'Simple web content not found for this brand' },
        { status: 404 }
      )
    }

    console.log(`✅ Found simple web content analysis for: ${analysis.brandName}`)
    
    // Calculate statistics
    const domains = Object.keys(analysis.websiteContent)
    const totalSentences = Object.values(analysis.websiteContent).reduce(
      (sum, domainContent) => sum + domainContent.sentences.length, 
      0
    )
    
    console.log(`📊 Content statistics:`)
    console.log(`  - Total domains: ${domains.length}`)
    console.log(`  - Total sentences: ${totalSentences}`)
    
    // Prepare response data
    const responseData = {
      brandName: analysis.brandName,
      brandUrl: analysis.brandUrl,
      normalizedBrandUrl: analysis.normalizedBrandUrl,
      sampledTime: analysis.sampledTime,
      websiteContent: analysis.websiteContent,
      totalDomains: domains.length,
      totalSentences,
      metadata: {
        sampledTime: analysis.sampledTime
      }
    }
    
    return NextResponse.json({
      success: true,
      data: responseData
    })

  } catch (error) {
    console.error('❌ Error fetching simple web content:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
