import { NextRequest, NextResponse } from 'next/server'
import { QueryResponseCache } from '../../../lib/models/QueryResponseCache'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get Available Prompts')
    
    // Get all unique prompts from QueryResponseCache
    const collection = await QueryResponseCache.getCollectionInstance()
    const prompts = await collection.distinct('prompt')
    
    console.log(`✅ Found ${prompts.length} unique prompts`)
    
    return NextResponse.json({
      success: true,
      prompts: prompts.sort()
    })

  } catch (error) {
    console.error('❌ Error fetching available prompts:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
