#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  FullWebContentCache,
  closeDatabaseConnection,
  type WebsiteContent,
  type ContentSnippets
} from '../lib/models/FullWebContentCache'
import { normalizeUrl } from '../lib/models/PromptCache'

// 15 Content Dimensions for Brand Analysis
const CONTENT_DIMENSIONS = [
  'Functionality',
  'Quality', 
  'Performance / Reliability',
  'Design & Aesthetic / Visual Identity',
  'Price / Value Proposition',
  'Innovation / Technology',
  'Safety / Security / Privacy',
  'Sustainability / Ethical Practices',
  'Trustworthiness / Credibility',
  'Core Values / Mission / Purpose',
  'Story / Origin / Anecdote',
  'Emotional Connection / Personality',
  'Differentiation / Unique Selling Proposition (USP)',
  'User / Audience Identity & Experience',
  'After-Sales Support / Community / Loyalty'
]

const LARGE_SITE_LIST = [
  'wikipedia.org',
  'youtube.com',
  'reddit.com',
  'quora.com',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'linkedin.com',
  'forbes.com',
  'medium.com',
  'g2.com'
]

/**
 * Update existing FullWebContentCache documents to include large sites structure
 */
async function updateFullWebContentCacheStructure(): Promise<void> {
  try {
    console.log('🚀 Starting FullWebContentCache structure update...')
    
    // Get all existing documents
    const allDocuments = await FullWebContentCache.findAll()
    console.log(`📊 Found ${allDocuments.items.length} existing documents to update`)
    
    if (allDocuments.items.length === 0) {
      console.log('ℹ️ No documents found to update')
      return
    }
    
    // Process each document
    for (let docIndex = 0; docIndex < allDocuments.items.length; docIndex++) {
      const document = allDocuments.items[docIndex]
      console.log(`\n📄 Processing document ${docIndex + 1}/${allDocuments.items.length}: ${document.brandName}`)
      
      // Get the current website content
      const websiteContent: WebsiteContent = document.websiteContent || {}
      let hasChanges = false
      
      // Ensure all dimensions exist and have large sites pre-populated
      CONTENT_DIMENSIONS.forEach(dimension => {
        // Initialize dimension if it doesn't exist
        if (!websiteContent[dimension]) {
          websiteContent[dimension] = {}
          hasChanges = true
          console.log(`  ➕ Added missing dimension: ${dimension}`)
        }
        
        // Pre-initialize all large sites with empty sentence arrays
        LARGE_SITE_LIST.forEach(largeSite => {
          const normalizedLargeSite = normalizeUrl(`https://${largeSite}`)
          
          if (!websiteContent[dimension][normalizedLargeSite]) {
            // Add new entry with all fields
            websiteContent[dimension][normalizedLargeSite] = {
              sentences: [],
              visibility: 0,
              modifiedSentences: [],
              modifiedVisibility: 0
            }
            hasChanges = true
            console.log(`    ➕ Added ${largeSite} to ${dimension}`)
          } else {
            // Update existing entries to include new fields if they don't exist
            let entryUpdated = false
            if (!websiteContent[dimension][normalizedLargeSite].hasOwnProperty('modifiedSentences')) {
              websiteContent[dimension][normalizedLargeSite].modifiedSentences = []
              entryUpdated = true
            }
            if (!websiteContent[dimension][normalizedLargeSite].hasOwnProperty('modifiedVisibility')) {
              websiteContent[dimension][normalizedLargeSite].modifiedVisibility = 0
              entryUpdated = true
            }
            if (entryUpdated) {
              hasChanges = true
              console.log(`    🔄 Updated ${largeSite} in ${dimension} with new fields`)
            }
          }
        })
        
        // Also update any existing domains that aren't in the large site list
        Object.keys(websiteContent[dimension]).forEach(existingDomain => {
          const domainData = websiteContent[dimension][existingDomain]
          let entryUpdated = false
          
          if (!domainData.hasOwnProperty('modifiedSentences')) {
            domainData.modifiedSentences = []
            entryUpdated = true
          }
          if (!domainData.hasOwnProperty('modifiedVisibility')) {
            domainData.modifiedVisibility = 0
            entryUpdated = true
          }
          
          if (entryUpdated) {
            hasChanges = true
            console.log(`    🔄 Updated existing domain ${existingDomain} in ${dimension} with new fields`)
          }
        })
      })
      
      // Update the document if there were changes
      if (hasChanges) {
        const success = await FullWebContentCache.updateVisibility(
          document.normalizedBrandUrl,
          websiteContent
        )
        
        if (success) {
          console.log(`  ✅ Updated document for ${document.brandName}`)
          
          // Count the updates
          const totalDomains = new Set(
            Object.values(websiteContent).flatMap(dimensionContent => Object.keys(dimensionContent))
          ).size
          const totalSentences = Object.values(websiteContent).reduce((sum, dimensionContent) => 
            sum + Object.values(dimensionContent).reduce((dimSum, domainData) => 
              dimSum + domainData.sentences.length, 0), 0)
          
          console.log(`    📊 Structure: ${CONTENT_DIMENSIONS.length} dimensions, ${totalDomains} domains, ${totalSentences} sentences`)
        } else {
          console.error(`  ❌ Failed to update document for ${document.brandName}`)
        }
      } else {
        console.log(`  ℹ️ No changes needed for ${document.brandName}`)
      }
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    console.log(`\n🎉 Structure update completed for ${allDocuments.items.length} documents!`)
    
  } catch (error) {
    console.error('❌ Error updating FullWebContentCache structure:', error)
    throw error
  }
}

/**
 * CLI interface
 */
async function main() {
  // Check required environment variables
  if (!process.env.MONGODB_URI) {
    console.log('❌ Missing required environment variable: MONGODB_URI')
    console.log('Please add it to your .env.local file')
    process.exit(1)
  }

  try {
    console.log(`🎯 Configuration:`)
    console.log(`  📏 Content dimensions: ${CONTENT_DIMENSIONS.length}`)
    console.log(`  🌐 Large sites: ${LARGE_SITE_LIST.length}`)
    console.log(`  📊 Total entries to add per brand: ${CONTENT_DIMENSIONS.length * LARGE_SITE_LIST.length}`)

    await updateFullWebContentCacheStructure()
    
  } catch (error) {
    console.error('\n❌ Update failed:', error)
    process.exit(1)
  } finally {
    // Close database connections
    await closeDatabaseConnection()
    process.exit(0)
  }
}

// Export for use as module
export { updateFullWebContentCacheStructure }

// Run CLI if called directly
if (require.main === module) {
  main()
}
