import { NextRequest, NextResponse } from 'next/server'
import { AgentRecommendationContentCache } from '@/lib/models/AgentRecommendationContentCache'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Fetching all agent recommendation analyses...')
    
    // Get all agent recommendation content documents
    const analyses = await AgentRecommendationContentCache.findAll()
    
    console.log(`✅ Found ${analyses.length} agent recommendation analyses`)
    
    // Convert Date objects to strings for JSON serialization
    const serializedAnalyses = analyses.map(analysis => ({
      ...analysis,
      sampledTime: analysis.sampledTime instanceof Date 
        ? analysis.sampledTime.toISOString() 
        : analysis.sampledTime
    }))
    
    return NextResponse.json({
      success: true,
      data: serializedAnalyses,
      total: analyses.length
    })
    
  } catch (error) {
    console.error('❌ Error fetching all agent recommendation analyses:', error)
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch analyses',
      data: [],
      total: 0
    }, { status: 500 })
  }
}
