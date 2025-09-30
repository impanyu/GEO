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

    console.log(`🔍 Looking for simple web content analysis for: ${brandUrl}`)
    
    // Normalize the brand URL for consistent lookup
    const normalizedBrandUrl = normalizeUrl(brandUrl)
    console.log(`🔍 Searching for normalized URL: ${normalizedBrandUrl}`)
    
    // Find the analysis in MongoDB
    const analysis = await SimpleWebContentCache.findByBrandUrl(normalizedBrandUrl)
    
    if (!analysis) {
      console.log(`❌ No simple web content analysis found for: ${brandUrl}`)
      return NextResponse.json(
        { error: 'Simple web content analysis not found for this brand' },
        { status: 404 }
      )
    }

    console.log(`✅ Found simple web content analysis for: ${brandUrl}`)
    
    // Calculate some basic statistics
    const domains = Object.keys(analysis.websiteContent)
    const totalSentences = Object.values(analysis.websiteContent).reduce(
      (sum, domainContent) => sum + domainContent.sentences.length, 
      0
    )
    
    console.log(`📊 Analysis contains ${domains.length} domains`)
    console.log(`📈 Analysis stats: ${domains.length} domains, ${totalSentences} sentences`)
    
    return NextResponse.json({
      success: true,
      data: analysis
    })

  } catch (error) {
    console.error('❌ Error fetching simple web content analysis:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
