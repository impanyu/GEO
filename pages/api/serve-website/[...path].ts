import { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '../auth/[...nextauth]'

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Note: No authentication check needed here since we're serving cached content
  // that was already fetched by authenticated users

  try {
    const { path: pathSegments } = req.query
    
    if (!pathSegments || !Array.isArray(pathSegments) || pathSegments.length < 2) {
      return res.status(400).json({ error: 'Invalid path' })
    }

    const [websiteDir, ...filePathSegments] = pathSegments
    const fileName = filePathSegments.join('/')
    
    // Security check: ensure the path doesn't escape the websites_images directory
    if (websiteDir.includes('..') || fileName.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' })
    }

    const filePath = path.join(process.cwd(), 'websites_images', websiteDir, fileName)
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' })
    }

    // Check if the file is actually within the websites_images directory
    const websitesImagesDir = path.join(process.cwd(), 'websites_images')
    const resolvedFilePath = path.resolve(filePath)
    const resolvedWebsitesDir = path.resolve(websitesImagesDir)
    
    if (!resolvedFilePath.startsWith(resolvedWebsitesDir)) {
      return res.status(400).json({ error: 'Access denied' })
    }

    // Read and serve the file
    const fileContent = fs.readFileSync(filePath)
    const mimeType = getMimeType(filePath)
    
    // Set appropriate headers
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Cache-Control', 'public, max-age=3600') // Cache for 1 hour
    
    // For HTML files, add special headers to improve iframe compatibility
    if (mimeType === 'text/html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      // Add headers to help with iframe loading and CORS
      res.setHeader('X-Frame-Options', 'SAMEORIGIN')
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
      // Add CORS headers to allow cross-origin requests from the iframe
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }
    
    // For CSS and JS files, also add CORS headers
    if (mimeType === 'text/css' || mimeType === 'application/javascript') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET')
    }
    
    res.status(200).send(fileContent)

  } catch (error) {
    console.error('Error serving website file:', error)
    res.status(500).json({ 
      error: 'Failed to serve file',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
