import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import { authOptions } from './auth/[...nextauth]'
import fs from 'fs'
import path from 'path'
import { URL } from 'url'
import crypto from 'crypto'
import { chromium, Page } from 'playwright'

// Helper function to create safe directory names
function createSafeDirName(url: string): string {
  const urlObj = new URL(url)
  const hostname = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_')
  const pathname = urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '_')
  const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8)
  return `${hostname}${pathname}_${hash}`
}

// Helper function to get file extension from URL
function getFileExtension(url: string): string {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const ext = path.extname(pathname)
    return ext || '.html'
  } catch {
    return '.html'
  }
}

// Helper function to get safe filename from URL
function getSafeFileName(url: string, fallbackExtension: string = ''): string {
  try {
    const urlObj = new URL(url)
    let pathname = urlObj.pathname
    
    // If pathname ends with /, treat as index file
    if (pathname.endsWith('/')) {
      pathname += 'index.html'
    }
    
    // Extract just the filename
    let fileName = path.basename(pathname)
    
    // If no filename, create one based on the path
    if (!fileName || fileName === '/') {
      const pathParts = pathname.split('/').filter(Boolean)
      fileName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'index'
      
      // Add extension if needed
      if (!path.extname(fileName) && fallbackExtension) {
        fileName += fallbackExtension
      }
    }
    
    // Ensure the filename has an extension
    if (!path.extname(fileName) && fallbackExtension) {
      fileName += fallbackExtension
    }
    
    // Make filename safe for filesystem
    fileName = fileName.replace(/[<>:"/\\|?*]/g, '_')
    
    // Ensure it's not too long
    if (fileName.length > 100) {
      const ext = path.extname(fileName)
      const name = path.basename(fileName, ext)
      fileName = name.substring(0, 100 - ext.length) + ext
    }
    
    return fileName
  } catch {
    return fallbackExtension ? `file${fallbackExtension}` : 'file'
  }
}

// Helper function to ensure unique filename
function ensureUniqueFileName(baseFileName: string, existingFiles: Set<string>): string {
  let fileName = baseFileName
  let counter = 1
  
  while (existingFiles.has(fileName)) {
    const ext = path.extname(baseFileName)
    const name = path.basename(baseFileName, ext)
    fileName = `${name}_${counter}${ext}`
    counter++
  }
  
  existingFiles.add(fileName)
  return fileName
}

// Helper function to download a file
async function downloadFile(url: string, baseUrl: string): Promise<{ content: Buffer | string; contentType: string; isBinary: boolean }> {
  try {
    // Resolve relative URLs
    const absoluteUrl = new URL(url, baseUrl).href
    
    const response = await fetch(absoluteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    })
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${absoluteUrl}: ${response.status}`)
    }
    
    const contentType = response.headers.get('content-type') || 'text/plain'
    
    // Determine if content is binary
    const isBinary = contentType.includes('image/') || 
                     contentType.includes('video/') || 
                     contentType.includes('audio/') ||
                     contentType.includes('font/') ||
                     contentType.includes('application/font') ||
                     contentType.includes('application/vnd.ms-fontobject') ||
                     contentType.includes('application/octet-stream')
    
    let content: Buffer | string
    if (isBinary) {
      const arrayBuffer = await response.arrayBuffer()
      content = Buffer.from(arrayBuffer)
    } else {
      content = await response.text()
    }
    
    return { content, contentType, isBinary }
  } catch (error) {
    console.error(`Error downloading ${url}:`, error)
    return { content: '', contentType: 'text/plain', isBinary: false }
  }
}

// Helper function to extract URLs from CSS
function extractUrlsFromCSS(cssContent: string, baseUrl: string): string[] {
  const urls: string[] = []
  
  // Enhanced CSS URL patterns
  const cssPatterns = [
    // Standard url() references with various quote styles
    /url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi,
    
    // @import statements - all variations
    /@import\s+(?:url\s*\(\s*)?(['"]?)([^'")\s;]+)\1(?:\s*\))?\s*(?:[^;]*)?;/gi,
    
    // CSS variables containing URLs
    /(--[^:]+)\s*:\s*url\s*\(\s*(['"]?)([^'")\s]+)\2\s*\)/gi,
    
    // Background shorthand with URLs
    /background\s*:\s*[^;]*url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)[^;]*/gi,
    
    // Filter properties (for IE/legacy browsers)
    /filter\s*:\s*[^;]*url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)[^;]*/gi,
    
    // Mask properties
    /mask(?:-image)?\s*:\s*[^;]*url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)[^;]*/gi,
    
    // List style images
    /list-style-image\s*:\s*url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi,
    
    // Border images
    /border-image\s*:\s*[^;]*url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)[^;]*/gi,
    
    // Content property URLs (for pseudo-elements)
    /content\s*:\s*[^;]*url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)[^;]*/gi,
    
    // Cursor property URLs
    /cursor\s*:\s*[^;]*url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)[^;]*/gi
  ]
  
  for (const pattern of cssPatterns) {
    let match
    while ((match = pattern.exec(cssContent)) !== null) {
      // Extract URL from different capture groups depending on pattern
      let url = match[2] || match[3] || match[1]
      
      if (!url || url.startsWith('data:') || url.startsWith('#')) {
        continue
      }
      
      try {
        const absoluteUrl = new URL(url, baseUrl).href
        urls.push(absoluteUrl)
      } catch {
        // Skip invalid URLs
      }
    }
    
    // Reset regex lastIndex for next iteration
    pattern.lastIndex = 0
  }
  
  return Array.from(new Set(urls)) // Remove duplicates
}

// Helper function to extract URLs from JavaScript
function extractUrlsFromJS(jsContent: string, baseUrl: string): string[] {
  const urls: string[] = []
  
  // Enhanced URL patterns for modern web applications
  const urlPatterns = [
    // Standard URL patterns in strings
    /['"`]([^'"`]*(?:https?:\/\/|\/\/)[^'"`]+)['"`]/g,
    
    // Relative paths that look like resources (enhanced)
    /['"`](\/[^'"`]*\.(?:css|js|jsx|ts|tsx|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|otf|eot|mp3|mp4|webm|ogg|pdf|json|xml|wasm)[^'"`]*)['"`]/g,
    
    // Module imports and exports
    /(?:import|export)(?:\s+[^'"]*)?(?:\s+from)?\s+['"`]([^'"`]+)['"`]/g,
    
    // Dynamic imports
    /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    
    // Fetch calls and variations
    /(?:fetch|axios\.get|axios\.post|xhr\.open)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    
    // XMLHttpRequest URLs
    /\.open\s*\(\s*['"`][^'"`]*['"`]\s*,\s*['"`]([^'"`]+)['"`]/g,
    
    // jQuery load, get, post
    /\$\.(?:load|get|post|ajax)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    
    // Script tag sources in template strings
    /src\s*[:=]\s*['"`]([^'"`]+)['"`]/g,
    
    // CSS imports in JS
    /(?:import|require)\s*\(\s*['"`]([^'"`]*\.css[^'"`]*)['"`]\s*\)/g,
    
    // Asset imports (Webpack, Vite, etc.)
    /(?:import|require)\s*\(\s*['"`]([^'"`]*\.(?:png|jpg|jpeg|gif|svg|webp)[^'"`]*)['"`]\s*\)/g,
    
    // URL constructor calls
    /new\s+URL\s*\(\s*['"`]([^'"`]+)['"`]/g,
    
    // Modern ES modules with file extensions
    /['"`]([^'"`]*\/[^'"`]*\.(?:js|mjs|ts|tsx|jsx)[^'"`]*)['"`]/g,
    
    // CDN and external library URLs
    /['"`]((?:https?:)?\/\/(?:cdn\.|unpkg\.|jsdelivr\.|cdnjs\.|fonts\.googleapis\.)[^'"`]+)['"`]/g,
    
    // Data attributes and configuration objects
    /(?:url|src|href|path|file|asset|image|icon|background|stylesheet)\s*[:=]\s*['"`]([^'"`]+)['"`]/g,
    
    // MediaWiki/Wikipedia specific patterns (enhanced)
    /mw\.config\.get\s*\(\s*['"`]([^'"`]*(?:Script|Style|Image)Path[^'"`]*)['"`]\s*\)/g,
    /wgServer\s*\+\s*['"`]([^'"`]+)['"`]/g,
    /wgScriptPath\s*\+\s*['"`]([^'"`]+)['"`]/g,
    /wgLoadScript\s*\+\s*['"`]([^'"`]+)['"`]/g,
    /wgResourceBasePath\s*\+\s*['"`]([^'"`]+)['"`]/g,
    // MediaWiki load.php module URLs
    /\/load\.php\?[^'"`\s]+/g,
    // MediaWiki API calls
    /\/api\.php\?[^'"`\s]+/g,
    // MediaWiki skin resources
    /\/skins\/[^'"`\s]+\.(?:css|js|png|jpg|svg)/g,
    // MediaWiki extension resources
    /\/extensions\/[^'"`\s]+\.(?:css|js|png|jpg|svg)/g,
    
    // Template literals with URLs
    /`[^`]*(?:https?:\/\/|\/\/)[^`]*`/g,
    
    // Base64 check to avoid false positives, but capture real URLs
    /['"`](?!data:)([^'"`]*(?:\.(?:css|js|png|jpg|svg|woff)[^'"`]*)?\/[^'"`]+)['"`]/g
  ]
  
  for (const pattern of urlPatterns) {
    let match
    while ((match = pattern.exec(jsContent)) !== null) {
      let url = match[1]
      
      // Skip obviously invalid patterns
      if (!url || url.startsWith('data:') || url.startsWith('#') || url.includes('{{') || url.includes('<%') || url.length > 500) {
        continue
      }
      
      // Handle template literals
      if (url.includes('${')) continue
      
      try {
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
          url = 'https:' + url
        }
        
        if (url.startsWith('http') || url.startsWith('//') || url.startsWith('/')) {
          const absoluteUrl = new URL(url, baseUrl).href
          // Only add URLs that point to actual resources
          if (absoluteUrl.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|otf|eot|mp3|mp4|webm|ogg|pdf|json|xml|wasm)(\?|#|$)/i) || 
              absoluteUrl.includes('/api/') || absoluteUrl.includes('/load.php') || absoluteUrl.includes('/index.php')) {
            urls.push(absoluteUrl)
          }
        }
      } catch {
        // Skip invalid URLs
      }
    }
  }
  
  return Array.from(new Set(urls)) // Remove duplicates
}

// Helper function to update URLs in content to point to local files
function updateUrlsInContent(content: string, urlMap: Map<string, string>, baseUrl: string): string {
  let updatedContent = content
  
  // Enhanced URL replacement with comprehensive patterns
  const replacementPatterns = [
    // CSS url() references - handle all variants with different quotes and spacing
    {
      pattern: /url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi,
      replacement: (match: string, quote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? `url("${localPath}")` : match
        } catch { return match }
      }
    },
    
    // HTML attributes: src, href, action, poster, etc.
    {
      pattern: /((?:src|href|action|poster|data|content|background))\s*=\s*(['"])([^'"]+)\2/gi,
      replacement: (match: string, attr: string, quote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? `${attr}=${quote}${localPath}${quote}` : match
        } catch { return match }
      }
    },
    
    // CSS @import statements - handle all variants
    {
      pattern: /@import\s+(?:url\s*\(\s*)?(['"]?)([^'")\s;]+)\1(?:\s*\))?([^;]*);/gi,
      replacement: (match: string, quote: string, url: string, rest: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? `@import "${localPath}"${rest};` : match
        } catch { return match }
      }
    },
    
    // JavaScript ES6 imports
    {
      pattern: /import\s+[^'"]*from\s*(['"`])([^'"`]+)\1/gi,
      replacement: (match: string, quote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? match.replace(url, localPath) : match
        } catch { return match }
      }
    },
    
    // Dynamic imports
    {
      pattern: /import\s*\(\s*(['"`])([^'"`]+)\1\s*\)/gi,
      replacement: (match: string, quote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? match.replace(url, localPath) : match
        } catch { return match }
      }
    },
    
    // Fetch API calls
    {
      pattern: /fetch\s*\(\s*(['"`])([^'"`]+)\1/gi,
      replacement: (match: string, quote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? match.replace(url, localPath) : match
        } catch { return match }
      }
    },
    
    // XMLHttpRequest.open calls
    {
      pattern: /\.open\s*\(\s*(['"`])[^'"`]*\1\s*,\s*(['"`])([^'"`]+)\2/gi,
      replacement: (match: string, methodQuote: string, urlQuote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? match.replace(url, localPath) : match
        } catch { return match }
      }
    },
    
    // Data attributes containing URLs
    {
      pattern: /(data-[^=]*)\s*=\s*(['"])([^'"]*(?:https?:\/\/|\/)[^'"]*)\2/gi,
      replacement: (match: string, attr: string, quote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? `${attr}=${quote}${localPath}${quote}` : match
        } catch { return match }
      }
    },
    
    // CSS background-image, list-style-image, etc. properties
    {
      pattern: /(background-image|list-style-image|border-image|mask-image|content)\s*:\s*url\s*\(\s*(['"]?)([^'")\s]+)\2\s*\)/gi,
      replacement: (match: string, property: string, quote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? `${property}: url("${localPath}")` : match
        } catch { return match }
      }
    },
    
    // CSS variables containing URLs
    {
      pattern: /(--[^:]+)\s*:\s*url\s*\(\s*(['"]?)([^'")\s]+)\2\s*\)/gi,
      replacement: (match: string, variable: string, quote: string, url: string) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? `${variable}: url("${localPath}")` : match
        } catch { return match }
      }
    },
    
    // JSON containing URLs (for data attributes, config objects, etc.)
    {
      pattern: /(['"])([^'"]*(?:https?:\/\/|\/)[^'"]*\.[a-z]{2,4}(?:\/[^'"]*)?)\1/gi,
      replacement: (match: string, quote: string, url: string) => {
        // Only replace if it looks like a URL and not arbitrary text
        if (url.startsWith('data:') || url.startsWith('#') || !url.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|json|xml)/i)) return match
        try {
          const absoluteUrl = new URL(url, baseUrl).href
          const localPath = urlMap.get(absoluteUrl)
          return localPath ? `${quote}${localPath}${quote}` : match
        } catch { return match }
      }
    }
  ]
  
  // Apply all replacement patterns
  replacementPatterns.forEach(({ pattern, replacement }) => {
    updatedContent = updatedContent.replace(pattern, replacement as any)
  })
  
  return updatedContent
}

// Helper function to detect and enhance MediaWiki/Wikipedia sites
function isMediaWikiSite(content: string): boolean {
  return content.includes('mw.config') || 
         content.includes('wgServer') || 
         content.includes('/load.php') ||
         content.includes('mediawiki') ||
         content.includes('wgScriptPath')
}

// Helper function to extract MediaWiki configuration and generate additional resource URLs
function extractMediaWikiResources(content: string, baseUrl: string): string[] {
  const resources: string[] = []
  const urlObj = new URL(baseUrl)
  const baseWikiUrl = `${urlObj.protocol}//${urlObj.host}`
  
  // Extract common MediaWiki configuration values
  const wgScriptPath = content.match(/wgScriptPath["']\s*:\s*["']([^"']+)["']/)?.[1] || '/w'
  const wgServer = content.match(/wgServer["']\s*:\s*["']([^"']+)["']/)?.[1] || baseWikiUrl
  const wgResourceBasePath = content.match(/wgResourceBasePath["']\s*:\s*["']([^"']+)["']/)?.[1] || wgScriptPath
  
  // Common MediaWiki resources that are often missed
  const commonResources = [
    // Core MediaWiki styles
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=site.styles&only=styles`,
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=ext.cite.styles&only=styles`,
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=ext.uls.pt&only=styles`,
    
    // Vector skin (most common Wikipedia skin)
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=skins.vector.styles.legacy&only=styles`,
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=skins.vector.styles&only=styles`,
    
    // Core JavaScript modules
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=startup&only=scripts`,
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=jquery%2Cmediawiki.base&only=scripts`,
    
    // Common extension styles
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=ext.gadget.mainpage-styling&only=styles`,
    `${wgServer}${wgResourceBasePath}/load.php?lang=en&modules=ext.visualEditor.desktopArticleTarget.noscript&only=styles`,
    
    // Wiki-specific resources
    `${wgServer}${wgScriptPath}/skins/Vector/resources/common/images/arrow-down.svg`,
    `${wgServer}${wgScriptPath}/skins/Vector/resources/common/images/external-link-ltr-icon.svg`,
    `${wgServer}${wgScriptPath}/skins/Vector/resources/common/images/file-type-generic.svg`,
  ]
  
  // Add detected load.php URLs from the content
  const loadPhpRegex = /\/load\.php\?[^"'\s)]+/g
  let match
  while ((match = loadPhpRegex.exec(content)) !== null) {
    try {
      const fullUrl = new URL(match[0], baseUrl).href
      commonResources.push(fullUrl)
    } catch {
      // Skip invalid URLs
    }
  }
  
  return Array.from(new Set(commonResources))
}

// Function to use Playwright for complete browser rendering
async function fetchWithPlaywright(url: string, websiteDir: string, safeDirName: string) {
  let browser = null
  let page: Page | null = null
  
  try {
    console.log(`🚀 Launching Playwright browser...`)
    
    // Launch browser with optimized settings
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ],
      timeout: 60000
    })

    console.log(`✅ Browser launched successfully`)
    
    page = await browser.newPage()
    console.log(`📄 New page created`)
    
    // Set viewport to match our iframe size
    await page.setViewportSize({ width: 1600, height: 800 })
    
    // Track all resources
    const interceptedResources = new Map<string, { content: Buffer; contentType: string }>()
    const resourceUrls = new Set<string>()
    
    // Set user agent and other headers to appear more like a real browser
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    })
    
    page.on('response', async (response) => {
      try {
        const resourceUrl = response.url()
        const contentType = response.headers()['content-type'] || 'application/octet-stream'
        const status = response.status()
        
        // Skip data URLs, already processed resources, and failed requests
        if (resourceUrl.startsWith('data:') || 
            interceptedResources.has(resourceUrl) || 
            status >= 400 ||
            status === 204) { // No content
          return
        }
        
        // Skip redirect responses (they don't have accessible body)
        if (status >= 300 && status < 400) {
          console.log(`⚠️ Skipping redirect: ${resourceUrl} (${status})`)
          return
        }
        
        // Get the response body with timeout and better error handling
        let buffer: Buffer
        try {
          buffer = await Promise.race([
            response.body(),
            new Promise<Buffer>((_, reject) => 
              setTimeout(() => reject(new Error('Buffer timeout')), 30000)
            )
          ])
          
          // Validate buffer size (skip extremely large files that might cause issues)
          if (buffer.length > 50 * 1024 * 1024) { // 50MB limit
            console.log(`⚠️ Skipping large resource (${Math.round(buffer.length / 1024 / 1024)}MB): ${resourceUrl}`)
            return
          }
        } catch (bufferError) {
          console.log(`⚠️ Failed to get buffer for ${resourceUrl}:`, bufferError instanceof Error ? bufferError.message : String(bufferError))
          // If buffer fails, skip this resource but don't fail the whole process
          return
        }
        
        if (buffer && buffer.length > 0) {
          interceptedResources.set(resourceUrl, {
            content: buffer,
            contentType: contentType
          })
          resourceUrls.add(resourceUrl)
          console.log(`📦 Captured: ${resourceUrl} (${buffer.length} bytes)`)
        }
      } catch (error: any) {
        // Silently skip problematic resources instead of logging every error
        if (!error.message.includes('Target closed') && 
            !error.message.includes('redirect responses') &&
            !error.message.includes('Buffer timeout')) {
          console.log(`⚠️ Failed to capture resource: ${response.url()}`)
        }
      }
    })

    console.log(`🚀 Navigating to: ${url}`)
    
    // Set up content capture immediately when navigation starts
    let hasEarlyContent = false
    let earlyContentSaved = false
    
    // Start navigation with the most permissive settings
    console.log(`🚀 Starting navigation to: ${url}`)
    
    // Use a promise race approach to capture content as soon as possible
    const navigationPromise = page.goto(url, { 
      waitUntil: 'commit', // Just wait for navigation to start
      timeout: 30000 // Shorter timeout for initial commit
    }).catch(async (navError) => {
      console.log(`⚠️ Navigation commit failed: ${navError.message}`)
      // Even if navigation fails, try to get whatever content is there
      return null
    })
    
    // Set up early content capture as soon as any content loads
    const contentCapturePromise = new Promise(async (resolve) => {
      // Wait a short time for some content to load
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      try {
        if (page) {
          const earlyContent = await page.content()
          if (earlyContent && earlyContent.length > 500) {
            console.log(`📋 Early content captured (${earlyContent.length} chars)`)
            hasEarlyContent = true
            
            // Save early content immediately as backup
            const earlyTitle = await page.title() || url
            fs.writeFileSync(path.join(websiteDir, 'index.html'), earlyContent)
            earlyContentSaved = true
            console.log(`💾 Early content saved as backup`)
            
            resolve(earlyContent)
          }
        }
      } catch (error) {
        console.log(`⚠️ Early content capture failed:`, error)
      }
      resolve(null)
    })
    
    // Race between navigation and early content capture
    await Promise.race([navigationPromise, contentCapturePromise])
    
    // Try to wait for more complete loading if navigation succeeded
    try {
      console.log(`📄 Attempting to load more content...`)
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 })
      console.log(`📄 DOM content loaded`)
    } catch (domError) {
      console.log(`⚠️ DOM loading timeout, but continuing with early content`)
    }
    
    // Try for network idle with very short timeout
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 })
      console.log(`🌐 Network idle achieved`)
    } catch (networkError) {
      console.log(`⚠️ Network didn't reach idle, using captured content`)
    }
    
    console.log(`📄 Page loaded, waiting for dynamic content...`)
    
    // Wait for dynamic content with progressive timeouts
    try {
      await page.waitForTimeout(5000)
      console.log(`✅ Full wait completed, capturing resources...`)
    } catch (waitError) {
      console.log(`⚠️ Wait interrupted, but continuing to capture...`)
    }
    
    // Get the final rendered HTML (or use early content if it's better)
    let renderedHtml
    let pageTitle
    
    try {
      const finalContent = await page.content()
      const finalTitle = await page.title()
      
      // Use final content if it's substantially better than early content
      if (!hasEarlyContent || finalContent.length > (earlyContentSaved ? 1000 : 500)) {
        renderedHtml = finalContent
        pageTitle = finalTitle
        console.log(`📄 Using final HTML content (${renderedHtml.length} characters)`)
      } else {
        // Re-read the early content we saved
        renderedHtml = fs.readFileSync(path.join(websiteDir, 'index.html'), 'utf-8')
        pageTitle = await page.title() || url
        console.log(`📄 Using early captured HTML content (${renderedHtml.length} characters)`)
      }
    } catch (contentError) {
      if (earlyContentSaved) {
        // Fall back to early content if final capture fails
        renderedHtml = fs.readFileSync(path.join(websiteDir, 'index.html'), 'utf-8')
        pageTitle = url
        console.log(`📄 Using early content due to final capture failure`)
      } else {
        throw contentError
      }
    }
    
    console.log(`📋 Page title: "${pageTitle}"`)
    
    // Special handling for MediaWiki sites (like Wikipedia)
    if (isMediaWikiSite(renderedHtml)) {
      console.log(`📖 Detected MediaWiki site, fetching additional resources...`)
      
      const additionalResources = extractMediaWikiResources(renderedHtml, url)
      console.log(`🔗 Found ${additionalResources.length} additional MediaWiki resources`)
      
      // Fetch additional MediaWiki resources that might not have been intercepted
      for (const resourceUrl of additionalResources) {
        if (!interceptedResources.has(resourceUrl)) {
          try {
            console.log(`📥 Fetching additional resource: ${resourceUrl}`)
            
            const response = await page.evaluate(async (url) => {
              try {
                const resp = await fetch(url)
                if (resp.ok) {
                  const arrayBuffer = await resp.arrayBuffer()
                  return {
                    content: Array.from(new Uint8Array(arrayBuffer)),
                    contentType: resp.headers.get('content-type') || 'application/octet-stream'
                  }
                }
              } catch (error) {
                console.log(`Failed to fetch ${url}:`, error)
              }
              return null
            }, resourceUrl)
            
            if (response) {
              const content = Buffer.from(response.content)
              interceptedResources.set(resourceUrl, {
                content,
                contentType: response.contentType
              })
              console.log(`✅ Successfully fetched additional resource: ${resourceUrl}`)
            }
          } catch (error) {
            console.log(`⚠️ Failed to fetch additional resource ${resourceUrl}:`, error)
          }
        }
      }
    }
    
    // Save all intercepted resources
    const existingFiles = new Set<string>()
    const urlMap = new Map<string, string>()
    
    console.log(`🔄 Processing ${interceptedResources.size} intercepted resources...`)
    
    for (const [resourceUrl, { content, contentType }] of Array.from(interceptedResources)) {
      try {
        // Determine file extension based on content type and URL
        let fallbackExtension = getFileExtension(resourceUrl)
        if (contentType.includes('text/html')) fallbackExtension = '.html'
        else if (contentType.includes('text/css')) fallbackExtension = '.css'
        else if (contentType.includes('javascript')) fallbackExtension = '.js'
        else if (contentType.includes('image/png')) fallbackExtension = '.png'
        else if (contentType.includes('image/jpg') || contentType.includes('image/jpeg')) fallbackExtension = '.jpg'
        else if (contentType.includes('image/gif')) fallbackExtension = '.gif'
        else if (contentType.includes('image/svg')) fallbackExtension = '.svg'
        else if (contentType.includes('image/webp')) fallbackExtension = '.webp'
        else if (contentType.includes('image/ico')) fallbackExtension = '.ico'
        else if (contentType.includes('font/woff2')) fallbackExtension = '.woff2'
        else if (contentType.includes('font/woff')) fallbackExtension = '.woff'
        else if (contentType.includes('font/ttf')) fallbackExtension = '.ttf'
        else if (contentType.includes('font/otf')) fallbackExtension = '.otf'
        else if (contentType.includes('application/json')) fallbackExtension = '.json'
        
        // Get original filename and ensure it's unique
        const originalFileName = getSafeFileName(resourceUrl, fallbackExtension)
        const fileName = ensureUniqueFileName(originalFileName, existingFiles)
        const filePath = path.join(websiteDir, fileName)
        const localPath = `/api/serve-website/${safeDirName}/${fileName}`
        
        // Save the file
        fs.writeFileSync(filePath, content)
        urlMap.set(resourceUrl, localPath)
        
      } catch (error) {
        console.error(`Error saving resource ${resourceUrl}:`, error)
      }
    }
    
    // Update the rendered HTML to use local paths
    let updatedHtml = updateUrlsInContent(renderedHtml, urlMap, url)
    
    // Add comprehensive error handling and CORS fix script for all sites - IMMEDIATE EXECUTION
    const errorHandlingScript = `
      <script>
        (function() {
          // IMMEDIATE execution to prevent any other script from running first
          console.log('🛡️ IMMEDIATE: Initializing comprehensive error suppression...');
        
        // Global error catcher - catch ALL JavaScript errors
        window.addEventListener('error', function(e) {
          console.log('🚫 Global error suppressed:', e.message, e.filename, e.lineno);
          e.preventDefault();
          e.stopPropagation();
          return false;
        }, true);

        // Catch unhandled promise rejections
        window.addEventListener('unhandledrejection', function(e) {
          console.log('🚫 Unhandled rejection suppressed:', e.reason);
          e.preventDefault();
          e.stopPropagation();
          return false;
        }, true);

        // Override console.error to suppress specific error types
        const originalConsoleError = console.error;
        console.error = function(...args) {
          const message = args.join(' ');
          if (message.includes('CORS') || 
              message.includes('Network Error') || 
              message.includes('ERR_BLOCKED_BY_CLIENT') ||
              message.includes('ERR_FAILED') ||
              message.includes('Cannot read properties of null') ||
              message.includes('Cannot use \\'in\\' operator') ||
              message.includes('ontouchstart') ||
              message.includes('TypeError: Cannot')) {
            console.log('🚫 Console error suppressed:', message);
            return;
          }
          originalConsoleError.apply(console, args);
        };

        // Ultra-aggressive XMLHttpRequest override - block ALL external requests
        const OriginalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
          const xhr = new OriginalXHR();
          const originalOpen = xhr.open;
          const originalSend = xhr.send;
          
          xhr.open = function(method, url, ...args) {
            try {
              // Block ALL external requests (not from our local serve-website API)
              if (url && typeof url === 'string' && (
                url.startsWith('http') && !url.includes('/api/serve-website/') ||
                url.includes('adsbygoogle') ||
                url.includes('googlesyndication') ||
                url.includes('google-analytics') ||
                url.includes('googletagmanager') ||
                url.includes('doubleclick') ||
                url.includes('gw.m.163.com') ||
                url.includes('analytics') ||
                url.includes('tracking')
              )) {
                console.log('🚫 Blocked external/ad XHR:', url);
                // Immediately fake a successful response to prevent hanging
                Object.defineProperty(this, 'readyState', { value: 4, writable: false });
                Object.defineProperty(this, 'status', { value: 200, writable: false });
                Object.defineProperty(this, 'statusText', { value: 'OK', writable: false });
                Object.defineProperty(this, 'responseText', { value: '{}', writable: false });
                Object.defineProperty(this, 'response', { value: '{}', writable: false });
                
                // Immediately trigger completion events
                setTimeout(() => {
                  try {
                    if (this.onreadystatechange) this.onreadystatechange();
                    if (this.onload) this.onload();
                    if (this.onloadend) this.onloadend();
                  } catch (e) {
                    console.log('🚫 XHR event trigger error suppressed:', e);
                  }
                }, 0);
                return;
              }
              return originalOpen.apply(this, [method, url, ...args]);
            } catch (e) {
              console.log('🚫 XHR open error suppressed:', e);
            }
          };
          
          xhr.send = function(...args) {
            try {
              return originalSend.apply(this, args);
            } catch (e) {
              console.log('🚫 XHR send error suppressed:', e);
              // Immediately fake success to prevent hanging
              Object.defineProperty(this, 'readyState', { value: 4, writable: false });
              Object.defineProperty(this, 'status', { value: 200, writable: false });
              Object.defineProperty(this, 'statusText', { value: 'OK', writable: false });
              Object.defineProperty(this, 'responseText', { value: '{}', writable: false });
              Object.defineProperty(this, 'response', { value: '{}', writable: false });
              
              setTimeout(() => {
                try {
                  if (this.onreadystatechange) this.onreadystatechange();
                  if (this.onload) this.onload();
                  if (this.onloadend) this.onloadend();
                } catch (e) {
                  console.log('🚫 XHR send event error suppressed:', e);
                }
              }, 0);
            }
          };
          
          return xhr;
        };

        // Ultra-aggressive fetch override - block ALL external requests
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
          try {
            // Block ALL external requests
            if (typeof url === 'string' && (
              url.startsWith('http') && !url.includes('/api/serve-website/') ||
              url.includes('adsbygoogle') ||
              url.includes('googlesyndication') ||
              url.includes('google-analytics') ||
              url.includes('googletagmanager') ||
              url.includes('doubleclick') ||
              url.includes('gw.m.163.com') ||
              url.includes('analytics') ||
              url.includes('tracking')
            )) {
              console.log('🚫 Blocked external/ad fetch:', url);
              // Return immediate fake successful response
              return Promise.resolve(new Response('{}', {
                status: 200,
                statusText: 'OK',
                headers: { 'Content-Type': 'application/json' }
              }));
            }
            return originalFetch.apply(window, [url, options]);
          } catch (e) {
            console.log('🚫 Fetch error suppressed:', e);
            return Promise.resolve(new Response('{}', {
              status: 200,
              statusText: 'OK',
              headers: { 'Content-Type': 'application/json' }
            }));
          }
        };

        // Block dynamic script loading that could hang the page
        const originalCreateElement = document.createElement;
        document.createElement = function(tagName) {
          const element = originalCreateElement.call(this, tagName);
          
          if (tagName.toLowerCase() === 'script') {
            const originalSetSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
            if (originalSetSrc) {
              Object.defineProperty(element, 'src', {
                set: function(value) {
                  // Block external script sources that could hang
                  if (value && typeof value === 'string' && (
                    value.includes('adsbygoogle') ||
                    value.includes('googlesyndication') ||
                    value.includes('google-analytics') ||
                    value.includes('googletagmanager') ||
                    value.includes('doubleclick') ||
                    value.includes('gw.m.163.com') ||
                    value.includes('analytics') ||
                    value.includes('tracking') ||
                    (value.startsWith('http') && !value.includes('/api/serve-website/'))
                  )) {
                    console.log('🚫 Blocked external script:', value);
                    // Set to a safe local script instead
                    if (originalSetSrc.set) {
                      originalSetSrc.set.call(this, 'data:application/javascript,console.log("Script blocked");');
                    }
                    return;
                  }
                  if (originalSetSrc.set) {
                    originalSetSrc.set.call(this, value);
                  }
                },
                get: function() {
                  if (originalSetSrc.get) {
                    return originalSetSrc.get.call(this);
                  }
                }
              });
            }
          }
          
          return element;
        };

        // Comprehensive jQuery protection
        if (window.jQuery || window.$) {
          const $ = window.jQuery || window.$;
          
          // Override jQuery.ajax completely
          if ($.ajax) {
            const originalAjax = $.ajax;
            $.ajax = function(options) {
              if (typeof options === 'string') {
                options = { url: options };
              }
              
              options = options || {};
              
              // Block cross-origin requests
              if (options.url && typeof options.url === 'string' && options.url.startsWith('http') && !options.url.startsWith(window.location.origin)) {
                console.log('🚫 Blocked cross-origin jQuery AJAX:', options.url);
                // Call success handler immediately
                if (options.success) {
                  setTimeout(() => { 
                    try { options.success({}); } catch (e) { console.log('🚫 jQuery success error suppressed:', e); }
                  }, 0);
                }
                // Return a mock jqXHR object
                return {
                  done: function(fn) { setTimeout(() => { try { fn({}); } catch (e) {} }, 0); return this; },
                  fail: function() { return this; },
                  always: function(fn) { setTimeout(() => { try { fn(); } catch (e) {} }, 0); return this; },
                  abort: function() { return this; }
                };
              }
              
              // Wrap all handlers to prevent crashes
              const originalSuccess = options.success;
              const originalError = options.error;
              const originalComplete = options.complete;
              
              options.success = function(...args) {
                try {
                  if (originalSuccess) originalSuccess.apply(this, args);
                } catch (e) {
                  console.log('🚫 jQuery success handler error suppressed:', e);
                }
              };
              
              options.error = function(...args) {
                try {
                  console.log('🚫 jQuery AJAX error suppressed for:', options.url);
                  // Don't call original error handler
                } catch (e) {
                  console.log('🚫 jQuery error handler error suppressed:', e);
                }
              };
              
              options.complete = function(...args) {
                try {
                  if (originalComplete) originalComplete.apply(this, args);
                } catch (e) {
                  console.log('🚫 jQuery complete handler error suppressed:', e);
                }
              };
              
              try {
                return originalAjax.call(this, options);
              } catch (e) {
                console.log('🚫 jQuery.ajax call error suppressed:', e);
                return {
                  done: function(fn) { setTimeout(() => { try { fn({}); } catch (e) {} }, 0); return this; },
                  fail: function() { return this; },
                  always: function(fn) { setTimeout(() => { try { fn(); } catch (e) {} }, 0); return this; },
                  abort: function() { return this; }
                };
              }
            };
          }

          // Global AJAX error handler
          $(document).ajaxError(function(event, xhr, settings, error) {
            console.log('🚫 Global jQuery AJAX error suppressed:', settings.url, error);
            event.stopPropagation();
            event.preventDefault();
            return false;
          });
        }

        // Protect DOM access methods
        const protectMethod = (obj, methodName, fallbackReturn) => {
          if (obj && obj[methodName]) {
            const original = obj[methodName];
            obj[methodName] = function(...args) {
              try {
                return original.apply(this, args);
              } catch (e) {
                console.log(\`🚫 \${methodName} error suppressed:\`, e);
                return fallbackReturn;
              }
            };
          }
        };

        protectMethod(document, 'querySelector', null);
        protectMethod(document, 'querySelectorAll', []);
        protectMethod(document, 'getElementById', null);
        protectMethod(document, 'getElementsByClassName', []);
        protectMethod(document, 'getElementsByTagName', []);

        // Protect setTimeout and setInterval
        const originalSetTimeout = window.setTimeout;
        const originalSetInterval = window.setInterval;
        
        window.setTimeout = function(fn, delay, ...args) {
          return originalSetTimeout(() => {
            try {
              if (typeof fn === 'function') {
                fn.apply(this, args);
              }
            } catch (e) {
              console.log('🚫 setTimeout callback error suppressed:', e);
            }
          }, delay);
        };
        
        window.setInterval = function(fn, delay, ...args) {
          return originalSetInterval(() => {
            try {
              if (typeof fn === 'function') {
                fn.apply(this, args);
              }
            } catch (e) {
              console.log('🚫 setInterval callback error suppressed:', e);
            }
          }, delay);
        };

        // Protect against property access errors
        const originalHasOwnProperty = Object.prototype.hasOwnProperty;
        Object.prototype.hasOwnProperty = function(prop) {
          try {
            return originalHasOwnProperty.call(this, prop);
          } catch (e) {
            console.log('🚫 hasOwnProperty error suppressed:', e);
            return false;
          }
        };

        // Override the 'in' operator indirectly by protecting common property checks
        const originalObjectKeys = Object.keys;
        Object.keys = function(obj) {
          try {
            if (obj == null) return [];
            return originalObjectKeys(obj);
          } catch (e) {
            console.log('🚫 Object.keys error suppressed:', e);
            return [];
          }
        };

        // Prevent any script from clearing the document body or hiding content
        const originalInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        Object.defineProperty(document.body, 'innerHTML', {
          set: function(value) {
            if (!value || value.trim() === '') {
              console.log('🚫 Prevented body.innerHTML clearing');
              return;
            }
            if (originalInnerHTML && originalInnerHTML.set) {
              originalInnerHTML.set.call(this, value);
            }
          },
          get: function() {
            if (originalInnerHTML && originalInnerHTML.get) {
              return originalInnerHTML.get.call(this);
            }
          }
        });

        // Prevent document.body removal or replacement
        const originalReplaceChild = Node.prototype.replaceChild;
        Node.prototype.replaceChild = function(newChild, oldChild) {
          if (oldChild === document.body) {
            console.log('🚫 Prevented document.body replacement');
            return oldChild;
          }
          return originalReplaceChild.call(this, newChild, oldChild);
        };

        const originalRemoveChild = Node.prototype.removeChild;
        Node.prototype.removeChild = function(child) {
          if (child === document.body) {
            console.log('🚫 Prevented document.body removal');
            return child;
          }
          return originalRemoveChild.call(this, child);
        };

        // Prevent document.write from clearing content
        const originalDocumentWrite = document.write;
        document.write = function(content) {
          console.log('🚫 document.write call intercepted and blocked');
          // Don't call the original to prevent content clearing
        };

        const originalDocumentWriteln = document.writeln;
        document.writeln = function(content) {
          console.log('🚫 document.writeln call intercepted and blocked');
          // Don't call the original to prevent content clearing
        };

          console.log('🛡️ Comprehensive error suppression system activated!');
          console.log('🛡️ Content protection activated - page will stay visible!');
          
          // Force page completion after 10 seconds to prevent infinite loading
          setTimeout(() => {
            console.log('⏰ Forcing page completion after 10 seconds...');
            
            // Stop all pending requests by clearing browser caches
            try {
              // Force DOMContentLoaded if not already fired
              if (document.readyState === 'loading') {
                console.log('🔄 Manually triggering DOMContentLoaded...');
                const event = new Event('DOMContentLoaded', {
                  bubbles: true,
                  cancelable: true
                });
                document.dispatchEvent(event);
              }
              
              // Force window.onload if not already fired
              if (document.readyState !== 'complete') {
                console.log('🔄 Manually triggering window.onload...');
                Object.defineProperty(document, 'readyState', {
                  value: 'complete',
                  writable: false
                });
                
                const loadEvent = new Event('load', {
                  bubbles: false,
                  cancelable: false
                });
                window.dispatchEvent(loadEvent);
              }
              
              console.log('✅ Page completion forced successfully');
            } catch (e) {
              console.log('🚫 Error during force completion suppressed:', e);
            }
          }, 10000);
          
          // Monitor document body for changes
          let bodyCheckInterval = setInterval(() => {
            if (document.body) {
              const bodyContent = document.body.innerHTML;
              const bodyVisible = document.body.style.display !== 'none';
              const bodyHeight = document.body.scrollHeight;
              console.log('🔍 Body check:', {
                hasContent: bodyContent.length > 100,
                contentLength: bodyContent.length,
                visible: bodyVisible,
                height: bodyHeight,
                readyState: document.readyState,
                timestamp: new Date().toISOString()
              });
              
              // If body content is suspiciously empty, restore it
              if (bodyContent.length < 50 && window.originalBodyContent) {
                console.log('🚨 Body content disappeared! Attempting restore...');
                document.body.innerHTML = window.originalBodyContent;
              }
            } else {
              console.log('🚨 Document body is null!');
            }
          }, 1000);
          
          // Save original body content after a delay
          setTimeout(() => {
            if (document.body && document.body.innerHTML.length > 100) {
              window.originalBodyContent = document.body.innerHTML;
              console.log('💾 Saved original body content for backup');
            }
          }, 3000);
        })(); // IMMEDIATE execution
      </script>
    `
    
    // Special enhancements for MediaWiki sites
    if (isMediaWikiSite(renderedHtml)) {
      console.log(`🎨 Applying MediaWiki-specific CSS enhancements...`)
      
      // Add fallback CSS for better Wikipedia rendering
      const fallbackCSS = `
        <style>
          /* MediaWiki fallback styles for proper rendering */
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .mw-body { margin: 0; padding: 0; }
          .mw-content-ltr { direction: ltr; }
          .mw-parser-output { line-height: 1.6; }
          .infobox { float: right; clear: right; margin: 0 0 1em 1em; border: 1px solid #a2a9b1; background: #f8f9fa; }
          .navbox { border: 1px solid #a2a9b1; background: #f8f9fa; margin: 1em 0; }
          .thumb { margin: 0.5em 0; }
          .thumbinner { border: 1px solid #c8ccd1; background-color: #f8f9fa; }
          .gallery { margin: 2px; padding: 2px; display: block; }
          .mw-references-wrap { font-size: 90%; }
          .reference { font-size: 85%; }
          .mw-headline { font-weight: bold; }
          .tocnumber { color: #000; }
          .toc { background-color: #f8f9fa; border: 1px solid #a2a9b1; padding: 5px; }
          .catlinks { border: 1px solid #a2a9b1; background-color: #f8f9fa; margin-top: 1em; }
          /* Vector skin specific */
          .vector-legacy-sidebar { width: 176px; position: absolute; left: 0; top: 160px; }
          .vector-body { margin-left: 11em; padding: 1em; }
          .vector-header { position: relative; }
          .vector-main-menu { position: absolute; left: 0; top: 0; width: 176px; }
          /* Responsive fixes */
          @media screen and (max-width: 1000px) {
            .vector-body { margin-left: 0; }
            .vector-legacy-sidebar { display: none; }
          }
        </style>
      `
      
      // Insert the error handling script at the very beginning of HEAD, then fallback CSS
      if (updatedHtml.includes('<head>')) {
        updatedHtml = updatedHtml.replace('<head>', `<head>${errorHandlingScript}`)
      } else if (updatedHtml.includes('<head ')) {
        updatedHtml = updatedHtml.replace('<head ', `<head>${errorHandlingScript}<head `)
      } else {
        // If no head tag, insert after <html>
        updatedHtml = updatedHtml.replace('<html>', `<html><head>${errorHandlingScript}</head>`)
      }
      updatedHtml = updatedHtml.replace('</head>', `${fallbackCSS}</head>`)
    } else {
      // For non-MediaWiki sites, inject error handling script at the very beginning of HEAD
      if (updatedHtml.includes('<head>')) {
        updatedHtml = updatedHtml.replace('<head>', `<head>${errorHandlingScript}`)
      } else if (updatedHtml.includes('<head ')) {
        updatedHtml = updatedHtml.replace('<head ', `<head>${errorHandlingScript}<head `)
      } else {
        // If no head tag, insert after <html>
        updatedHtml = updatedHtml.replace('<html>', `<html><head>${errorHandlingScript}</head>`)
      }
    }
    
    // Save the main HTML file (only if we're not using early saved content)
    const htmlPath = path.join(websiteDir, 'index.html')
    if (!earlyContentSaved || updatedHtml.length > renderedHtml.length) {
      fs.writeFileSync(htmlPath, updatedHtml)
      console.log(`💾 Saved final HTML file`)
    } else {
      console.log(`💾 Keeping early saved HTML (was better than final)`)
    }
    
    console.log(`💾 Saved ${urlMap.size} resources and rendered HTML to: ${websiteDir}`)
    
    return {
      success: true,
      resourceCount: urlMap.size,
      method: 'playwright',
      title: pageTitle
    }
    
  } catch (criticalError: any) {
    console.error(`💥 Critical error in fetchWithPlaywright:`, criticalError)
    
    // Even if there's a critical error, try to save whatever content we have
    try {
      const content = await page?.content()
      if (content && content.length > 1000) { // Minimum content threshold
        console.log(`🆘 Saving emergency content despite critical error...`)
        
        const emergencyTitle = await page?.title() || url
        fs.writeFileSync(path.join(websiteDir, 'index.html'), content)
        
        return {
          success: true,
          resourceCount: 0,
          method: 'playwright-emergency',
          title: emergencyTitle
        }
      }
    } catch (emergencyError) {
      console.log(`⚠️ Emergency save also failed:`, emergencyError)
    }
    
    // Re-throw the error only if we couldn't save anything
    throw criticalError
    
  } finally {
    if (browser) {
      try {
        await browser.close()
        console.log(`🏁 Browser closed successfully`)
      } catch (error: any) {
        console.log(`⚠️ Error closing browser:`, error.message)
      }
    }
  }
}

// Helper function to escape regex special characters
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Extend the API route timeout for complex websites
export const config = {
  api: {
    responseLimit: false,
    externalResolver: true,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Check authentication
  const session = await getServerSession(req, res, authOptions)
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { url, forceRefresh } = req.body
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    const safeDirName = createSafeDirName(url)
    const websiteDir = path.join(process.cwd(), 'websites_images', safeDirName)
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(websiteDir)) {
      fs.mkdirSync(websiteDir, { recursive: true })
    }

    // Check if we already have this website cached (unless force refresh is requested)
    const indexPath = path.join(websiteDir, 'index.html')
    if (!forceRefresh && fs.existsSync(indexPath)) {
      // Extract title from cached HTML
      let cachedTitle = url
      try {
        const cachedHtml = fs.readFileSync(indexPath, 'utf-8')
        const titleMatch = cachedHtml.match(/<title[^>]*>([^<]*)<\/title>/i)
        if (titleMatch && titleMatch[1]) {
          cachedTitle = titleMatch[1].trim()
        }
      } catch (error) {
        console.log('Could not extract title from cached HTML:', error)
      }
      
      console.log('📦 Using cached content for:', url)
      return res.status(200).json({ 
        success: true, 
        path: safeDirName,
        cached: true,
        title: cachedTitle
      })
    }

    // If force refresh is requested, clear the existing cache
    if (forceRefresh && fs.existsSync(websiteDir)) {
      console.log('🗑️ Clearing cache for force refresh:', url)
      try {
        // Remove all files in the directory
        const files = fs.readdirSync(websiteDir)
        for (const file of files) {
          fs.unlinkSync(path.join(websiteDir, file))
        }
      } catch (error) {
        console.log('⚠️ Error clearing cache:', error)
      }
    }

    console.log(`🔧 Attempting Playwright browser rendering for: ${url}`)
    
    // Try Playwright first (full browser rendering)
    try {
      const result = await fetchWithPlaywright(url, websiteDir, safeDirName)
      
      console.log(`✅ Playwright succeeded with ${result.resourceCount} resources`)
      
      return res.status(200).json({
        success: true,
        path: safeDirName,
        cached: false,
        resourceCount: result.resourceCount,
        method: result.method,
        title: result.title
      })
      
    } catch (playwrightError) {
      console.error('❌ Playwright failed:', playwrightError)
      
      // Check if we managed to save any content despite the error
      const indexPath = path.join(websiteDir, 'index.html')
      if (fs.existsSync(indexPath)) {
        console.log('✅ Found Playwright-generated content despite error, using it!')
        
        // Count saved resources
        const files = fs.readdirSync(websiteDir)
        const resourceCount = files.length - 1 // minus index.html
        
        // Extract title from the saved HTML
        let savedTitle = url
        try {
          const savedHtml = fs.readFileSync(indexPath, 'utf-8')
          const titleMatch = savedHtml.match(/<title[^>]*>([^<]*)<\/title>/i)
          if (titleMatch && titleMatch[1]) {
            savedTitle = titleMatch[1].trim()
          }
        } catch (error) {
          console.log('Could not extract title from saved HTML:', error)
        }
        
        return res.status(200).json({
          success: true,
          path: safeDirName,
          cached: false,
          resourceCount: resourceCount,
          method: 'playwright-partial',
          title: savedTitle,
          note: 'Playwright completed with errors but content was saved'
        })
      }
      
      console.log('📦 Using fallback fetch method (Playwright failed completely)...')
      
      // Fallback to static fetching (simplified version)
      const { content: htmlContent } = await downloadFile(url, url)
      
      if (!htmlContent) {
        return res.status(500).json({ error: 'Failed to fetch website content' })
      }

      // Save basic HTML file
      fs.writeFileSync(path.join(websiteDir, 'index.html'), htmlContent as string)
      
      return res.status(200).json({
        success: true,
        path: safeDirName,
        cached: false,
        resourceCount: 1,
        method: 'fallback',
        title: url
      })
    }

  } catch (error) {
    console.error('Error in fetch-website:', error)
    res.status(500).json({ 
      error: 'Failed to fetch website',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
