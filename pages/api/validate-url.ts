import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { authOptions } from './auth/[...nextauth]'

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ValidateUrlResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
      isValidFormat: false,
      isReachable: false
    })
  }

  // TODO: Re-enable authentication check once session issues are resolved
  // const session = await getServerSession(req, res, authOptions)
  // if (!session) {
  //   return res.status(401).json({
  //     success: false,
  //     message: 'Unauthorized',
  //     isValidFormat: false,
  //     isReachable: false
  //   })
  // }

  const { url } = req.body

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'URL is required',
      isValidFormat: false,
      isReachable: false
    })
  }

  // Validate URL format
  const isValidFormat = isValidUrl(url.trim())
  
  if (!isValidFormat) {
    return res.status(400).json({
      success: false,
      message: 'Please input a valid URL format (e.g., https://example.com)',
      isValidFormat: false,
      isReachable: false
    })
  }

  // Check if URL is reachable
  const isReachable = await checkUrlReachability(url.trim())

  if (!isReachable) {
    return res.status(400).json({
      success: false,
      message: 'The URL is not reachable. Please check the URL and try again.',
      isValidFormat: true,
      isReachable: false
    })
  }

  // If we get here, the URL is valid and reachable
  return res.status(200).json({
    success: true,
    message: 'URL is valid and reachable',
    isValidFormat: true,
    isReachable: true,
    url: url.trim()
  })
}
