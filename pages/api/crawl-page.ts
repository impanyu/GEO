import { NextApiRequest, NextApiResponse } from 'next'
import puppeteer from 'puppeteer'

interface CrawlPageResponse {
  success: boolean
  message: string
  html?: string
  title?: string
  url?: string
  error?: string
}

// Sanitize HTML content while preserving layout
function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  
  // Remove event handlers (onclick, onload, etc.)
  html = html.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
  
  // Remove javascript: URLs
  html = html.replace(/javascript:[^"']*/gi, '#')
  
  // Convert forms to divs but preserve structure and styling
  html = html.replace(/<form\b([^>]*)>/gi, '<div$1 data-was-form="true">')
  html = html.replace(/<\/form>/gi, '</div>')
  
  // Disable inputs but keep them visible for layout
  html = html.replace(/<input\b([^>]*)>/gi, '<input$1 disabled readonly style="pointer-events: none;">')
  html = html.replace(/<textarea\b([^>]*)>/gi, '<textarea$1 disabled readonly style="pointer-events: none;">')
  html = html.replace(/<select\b([^>]*)>/gi, '<select$1 disabled style="pointer-events: none;">')
  html = html.replace(/<button\b([^>]*)>/gi, '<button$1 disabled style="pointer-events: none;">')
  
  // Remove iframe elements to prevent nested frames
  html = html.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '<div style="background: #f0f0f0; border: 1px solid #ccc; padding: 20px; text-align: center; color: #666;">Embedded content removed for security</div>')
  
  return html
}

// Make URLs absolute
function makeUrlsAbsolute(html: string, baseUrl: string): string {
  const base = new URL(baseUrl)
  
  // Fix relative URLs in src attributes
  html = html.replace(/src\s*=\s*["']([^"']*)["']/gi, (match, url) => {
    try {
      const absoluteUrl = new URL(url, base).toString()
      return `src="${absoluteUrl}"`
    } catch {
      return match
    }
  })
  
  // Fix relative URLs in href attributes
  html = html.replace(/href\s*=\s*["']([^"']*)["']/gi, (match, url) => {
    try {
      if (url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:')) {
        return match
      }
      const absoluteUrl = new URL(url, base).toString()
      return `href="${absoluteUrl}" target="_blank"`
    } catch {
      return match
    }
  })
  
  return html
}

// Fallback function using simple fetch when Puppeteer fails
async function fetchWithFallback(url: string): Promise<{ html: string; title: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const html = await response.text()
    
    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled Page'
    
    return { html, title }
  } catch (error) {
    throw new Error(`Failed to fetch page: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CrawlPageResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed'
    })
  }

  const { url } = req.body

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'URL is required'
    })
  }

  // Skip Puppeteer entirely since it's causing consistent failures
  // Go directly to fallback method which is more reliable
  console.log('Using fallback fetch method (Puppeteer disabled due to instability)...')
  
  try {
    const { html, title } = await fetchWithFallback(url)
    
    // Process the HTML while preserving structure
    let processedHtml = sanitizeHtml(html)
    processedHtml = makeUrlsAbsolute(processedHtml, url)

    // Extract head and body content separately to preserve styles
    const headMatch = processedHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
    const bodyMatch = processedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    
    const headContent = headMatch ? headMatch[1] : ''
    const bodyContent = bodyMatch ? bodyMatch[1] : processedHtml.replace(/<\/?(!DOCTYPE|html|head|body)[^>]*>/gi, '')

    // Create a contained version that preserves original styling
    const containedHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        ${headContent}
        <style>
          /* Container styles - preserve original page styling as much as possible */
          .springbrand-container {
            width: 100vw;
            height: 100vh;
            max-width: 1280px;
            max-height: 800px;
            overflow: hidden;
            position: relative;
            background: white;
            margin: 0;
            padding: 0;
            border: none;
            box-shadow: none;
          }
          
          .springbrand-content {
            width: 100%;
            height: 100%;
            overflow: auto;
            position: relative;
            transform: scale(1);
            transform-origin: top left;
          }
          
          /* Minimal body adjustments */
          body {
            margin: 0 !important;
            padding: 0 !important;
            zoom: 1;
            overflow: hidden !important;
          }
          
          html {
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }
          
          /* Only fix critical layout issues - ONLY within springbrand content */
          .springbrand-content img, 
          .springbrand-content video, 
          .springbrand-content iframe, 
          .springbrand-content embed, 
          .springbrand-content object {
            max-width: 100%;
            height: auto;
          }
          
          /* Contain overly wide content - ONLY within springbrand content */
          .springbrand-content * {
            max-width: 100%;
            box-sizing: border-box;
          }
          
          /* Safety overrides for interactions - ONLY within springbrand content */
          .springbrand-content * {
            pointer-events: none !important;
            user-select: none !important;
          }
          
          .springbrand-content a {
            pointer-events: auto !important;
            cursor: pointer !important;
          }
          
          /* Notice styling */
          .springbrand-notice {
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(59, 130, 246, 0.9);
            color: white;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 11px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            z-index: 999999;
            backdrop-filter: blur(4px);
          }
          
          /* Scrollbar styling */
          .springbrand-content::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          .springbrand-content::-webkit-scrollbar-track {
            background: #f1f1f1;
          }
          .springbrand-content::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 4px;
          }
          .springbrand-content::-webkit-scrollbar-thumb:hover {
            background: #a8a8a8;
          }
        </style>
      </head>
      <body>
        <div class="springbrand-container">
          <div class="springbrand-content">
            <div class="springbrand-notice">
              Rendered by Springbrand.ai
            </div>
            ${bodyContent}
          </div>
        </div>
      </body>
      </html>
    `

    return res.status(200).json({
      success: true,
      message: 'Page crawled successfully (fetch mode)',
      html: containedHtml,
      title: title,
      url: url
    })

  } catch (error) {
    console.error('Fetch crawling failed:', error)
    
    return res.status(500).json({
      success: false,
      message: 'Failed to crawl the page',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
