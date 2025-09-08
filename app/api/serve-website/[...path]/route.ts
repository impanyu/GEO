import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

// MIME type mapping
const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip'
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return mimeTypes[ext] || 'application/octet-stream'
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
): Promise<NextResponse> {
  try {
    // Note: No authentication check needed here since we're serving cached content
    // that was already fetched by authenticated users

    const pathSegments = params.path
    
    if (!pathSegments || !Array.isArray(pathSegments) || pathSegments.length < 2) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }

    const [websiteDir, ...filePathSegments] = pathSegments
    const fileName = filePathSegments.join('/')
    
    // Security check: ensure the path doesn't escape the websites_images directory
    if (websiteDir.includes('..') || fileName.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }

    const filePath = path.join(process.cwd(), 'websites_images', websiteDir, fileName)
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Check if the file is actually within the websites_images directory
    const websitesImagesDir = path.join(process.cwd(), 'websites_images')
    const resolvedFilePath = path.resolve(filePath)
    const resolvedWebsitesDir = path.resolve(websitesImagesDir)
    
    if (!resolvedFilePath.startsWith(resolvedWebsitesDir)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 400 })
    }

    // Read and serve the file
    const fileContent = fs.readFileSync(filePath)
    const mimeType = getMimeType(filePath)
    
    // Create response with appropriate headers
    const response = new NextResponse(fileContent, { status: 200 })
    response.headers.set('Content-Type', mimeType)
    response.headers.set('Cache-Control', 'public, max-age=3600') // Cache for 1 hour
    
    // For HTML files, add special headers to improve iframe compatibility
    if (mimeType === 'text/html') {
      response.headers.set('Content-Type', 'text/html; charset=utf-8')
      // Add headers to help with iframe loading and CORS
      response.headers.set('X-Frame-Options', 'SAMEORIGIN')
      response.headers.set('Content-Security-Policy', "frame-ancestors 'self'")
      // Add CORS headers to allow cross-origin requests from the iframe
      response.headers.set('Access-Control-Allow-Origin', '*')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }
    
    // For CSS and JS files, also add CORS headers
    if (mimeType === 'text/css' || mimeType === 'application/javascript') {
      response.headers.set('Access-Control-Allow-Origin', '*')
      response.headers.set('Access-Control-Allow-Methods', 'GET')
    }
    
    return response

  } catch (error) {
    console.error('Error serving website file:', error)
    return NextResponse.json({ 
      error: 'Failed to serve file',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
