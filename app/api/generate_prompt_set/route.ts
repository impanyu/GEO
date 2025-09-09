import { NextRequest, NextResponse } from 'next/server'
import { PromptCache, normalizeUrl, closeDatabaseConnection } from '@/lib/models/PromptCache'
import { generatePromptsForUrl } from '../../../scripts/generate-prompts'




/**
 * Main API handler - Only handles cache checking and optional generation triggering
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Extract URL parameter
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('url')
    const forceGenerate = searchParams.get('generate') === 'true'
    
    if (!brandUrl) {
      return NextResponse.json({
        error: 'Missing required parameter: url'
      }, { status: 400 })
    }
    
    // Validate URL format
    try {
      new URL(brandUrl)
    } catch {
      return NextResponse.json({
        error: 'Invalid URL format'
      }, { status: 400 })
    }

    console.log('Checking prompt cache for:', brandUrl)
    
    // Normalize URL for caching
    const normalizedUrl = normalizeUrl(brandUrl)
    console.log('Normalized URL:', normalizedUrl)
    
    // Check cache first
    console.log('Checking cache for existing prompts...')
    const cachedPrompts = await PromptCache.findByUrl(normalizedUrl)
    
    if (cachedPrompts && !forceGenerate) {
      console.log('Found cached prompts, returning cached data')
      return NextResponse.json(cachedPrompts.data, { status: 200 })
    }
    
    if (forceGenerate) {
      console.log('Force generation requested, generating new prompts...')
      try {
        const result = await generatePromptsForUrl(brandUrl)
        return NextResponse.json(result, { status: 200 })
      } catch (error) {
        console.error('Error generating prompts:', error)
        return NextResponse.json({
          error: 'Failed to generate prompts',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
      }
    }
    
    // No cached data found and no generation requested
    console.log('No cached data found')
    return NextResponse.json({
      success: false,
      error: 'No cached prompts found for this URL',
      message: 'Please run the generation script first: tsx scripts/generate-prompts.ts <url>',
      brandUrl,
      cached: false
    }, { status: 404 })
    
  } catch (error) {
    console.error('Error in generate_prompt_set API:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  } finally {
    // Close MongoDB connection
    await closeDatabaseConnection()
  }
}
