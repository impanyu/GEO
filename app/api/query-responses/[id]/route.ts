import { NextRequest, NextResponse } from 'next/server'
import { QueryResponseCache, closeDatabaseConnection } from '@/lib/models/DataTableCache'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { id } = params
    
    if (!id || id === 'error') {
      return NextResponse.json({
        error: 'Invalid query response ID'
      }, { status: 400 })
    }
    
    console.log(`Fetching query response document: ${id}`)
    
    const queryResponseDoc = await QueryResponseCache.findById(id)
    
    if (!queryResponseDoc) {
      return NextResponse.json({
        error: 'Query response document not found'
      }, { status: 404 })
    }
    
    return NextResponse.json({
      id: queryResponseDoc._id,
      prompt: queryResponseDoc.prompt,
      responses: queryResponseDoc.responses,
      queryDatetime: queryResponseDoc.queryDatetime,
      agenticPlatform: queryResponseDoc.agenticPlatform,
      createdDatetime: queryResponseDoc.createdDatetime
    }, { status: 200 })
    
  } catch (error) {
    console.error('Error fetching query response document:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  } finally {
    await closeDatabaseConnection()
  }
}
