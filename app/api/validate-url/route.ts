import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

interface ValidateUrlResponse {
  success: boolean
  message: string
  isValidFormat: boolean
  isReachable: boolean
  url?: string
}

// Simple URL validation function
function isValidUrl(string: string): boolean {
  try {
    const url = new URL(string)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_) {
    return false
  }
}

// Check if URL is reachable
async function checkUrlReachability(url: string): Promise<boolean> {
  try {
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 10000)
    )

    // Race between fetch and timeout
    const response = await Promise.race([
      fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Springbrand.ai Bot/1.0'
        }
      }),
      timeoutPromise
    ])
    
    return response.ok
  } catch (error) {
    console.error('URL reachability check failed:', error)
    return false
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ValidateUrlResponse>> {
  try {
    // TODO: Re-enable authentication check once session issues are resolved
    // const session = await getServerSession(authOptions)
    // if (!session) {
    //   return NextResponse.json({
    //     success: false,
    //     message: 'Unauthorized',
    //     isValidFormat: false,
    //     isReachable: false
    //   }, { status: 401 })
    // }

    const body = await request.json()
    const { url } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json({
        success: false,
        message: 'URL is required',
        isValidFormat: false,
        isReachable: false
      }, { status: 400 })
    }

    // Validate URL format
    const isValidFormat = isValidUrl(url.trim())
    
    if (!isValidFormat) {
      return NextResponse.json({
        success: false,
        message: 'Please input a valid URL format (e.g., https://example.com)',
        isValidFormat: false,
        isReachable: false
      }, { status: 400 })
    }

    // Check if URL is reachable
    const isReachable = await checkUrlReachability(url.trim())

    if (!isReachable) {
      return NextResponse.json({
        success: false,
        message: 'The URL is not reachable. Please check the URL and try again.',
        isValidFormat: true,
        isReachable: false
      }, { status: 400 })
    }

    // If we get here, the URL is valid and reachable
    return NextResponse.json({
      success: true,
      message: 'URL is valid and reachable',
      isValidFormat: true,
      isReachable: true,
      url: url.trim()
    }, { status: 200 })
  } catch (error) {
    console.error('Error in validate-url API:', error)
    return NextResponse.json({
      success: false,
      message: 'Internal server error',
      isValidFormat: false,
      isReachable: false
    }, { status: 500 })
  }
}
