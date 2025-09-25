import { NextRequest, NextResponse } from 'next/server'
import { 
  FullWebContentCache, 
  closeDatabaseConnection,
  type FullWebContentDocument 
} from '@/lib/models/FullWebContentCache'

interface ApiResponse {
  success: boolean
  data?: FullWebContentDocument[]
  error?: string
  total?: number
}

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get All Web Content Analyses')
    
    // Get pagination parameters
    const { searchParams } = new URL(request.url)
    const skip = parseInt(searchParams.get('skip') || '0')
    const limit = parseInt(searchParams.get('limit') || '50')
    
    console.log(`📊 Fetching analyses with pagination: skip=${skip}, limit=${limit}`)
    
    // Get all analyses with pagination
    const result = await FullWebContentCache.findAll(skip, limit)
    
    if (!result || result.items.length === 0) {
      console.log(`❌ No web content analyses found`)
      return NextResponse.json({
        success: false,
        message: 'No web content analyses found. Please run the analyze-web-content script first.',
        data: [],
        total: 0
      } as ApiResponse, { status: 404 })
    }

    console.log(`✅ Found ${result.items.length} analyses (total: ${result.total})`)
    
    return NextResponse.json({
      success: true,
      data: result.items,
      total: result.total
    } as ApiResponse)
    
  } catch (error) {
    console.error('❌ Error fetching all web content:', error)
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
