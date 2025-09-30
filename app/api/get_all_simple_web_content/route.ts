import { NextRequest, NextResponse } from 'next/server'
import { SimpleWebContentCache } from '../../../lib/models/SimpleWebContentCache'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get All Simple Web Content Analyses')
    
    const { searchParams } = new URL(request.url)
    const skip = parseInt(searchParams.get('skip') || '0')
    const limit = parseInt(searchParams.get('limit') || '50')
    
    console.log(`📊 Fetching analyses with pagination: skip=${skip}, limit=${limit}`)
    
    // Get all analyses with pagination
    const result = await SimpleWebContentCache.findAll(skip, limit)
    
    if (result.items.length === 0) {
      console.log('❌ No simple web content analyses found')
      return NextResponse.json({
        success: true,
        data: [],
        total: 0,
        skip,
        limit
      })
    }

    console.log(`✅ Found ${result.items.length} analyses (total: ${result.total})`)
    
    return NextResponse.json({
      success: true,
      data: result.items,
      total: result.total,
      skip,
      limit
    })

  } catch (error) {
    console.error('❌ Error fetching all simple web content analyses:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
