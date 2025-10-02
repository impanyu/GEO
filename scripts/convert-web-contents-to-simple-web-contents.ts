#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  FullWebContentCache,
  closeDatabaseConnection as closeFullWebConnection,
  type FullWebContentDocument,
  type ContentSnippets
} from '../lib/models/FullWebContentCache'
import { 
  SimpleWebContentCache,
  type SimpleWebContentDocument,
  type DomainContent
} from '../lib/models/SimpleWebContentCache'

/**
 * Convert a single FullWebContentDocument to SimpleWebContentDocument
 */
function convertToSimpleWebContent(fullDoc: FullWebContentDocument): SimpleWebContentDocument {
  const websiteContent: { [normalizedDomain: string]: DomainContent } = {}
  
  console.log(`🔄 Converting document for brand: ${fullDoc.brandName}`)
  console.log(`  📊 Original dimensions: ${Object.keys(fullDoc.websiteContent).length}`)
  
  // Iterate through all dimensions
  for (const [dimension, domains] of Object.entries(fullDoc.websiteContent)) {
    console.log(`    📂 Processing dimension: ${dimension}`)
    
    // Iterate through all domains in this dimension
    for (const [normalizedDomain, domainData] of Object.entries(domains)) {
      // Handle both old format (string[]) and new format (object)
      let sentences: string[] = []
      let visibility = 0
      let modifiedSentences: string[] = []
      let modifiedVisibility = 0
      let modificationSuggestions = ''
      
      if (Array.isArray(domainData)) {
        // Old format: just an array of sentences
        sentences = domainData
      } else {
        // New format: object with sentences, visibility, etc.
        sentences = domainData.sentences || []
        visibility = domainData.visibility || 0
        modifiedSentences = domainData.modifiedSentences || []
        modifiedVisibility = domainData.modifiedVisibility || 0
        modificationSuggestions = domainData.modificationSuggestions || ''
      }
      
      // Initialize domain entry if it doesn't exist
      if (!websiteContent[normalizedDomain]) {
        websiteContent[normalizedDomain] = {
          sentences: [],
          visibility: 0,
          modifiedSentences: [],
          modifiedVisibility: 0,
          modificationSuggestions: ''
        }
      }
      
      // Merge sentences (avoid duplicates)
      const existingSentences = new Set(websiteContent[normalizedDomain].sentences)
      for (const sentence of sentences) {
        if (!existingSentences.has(sentence)) {
          websiteContent[normalizedDomain].sentences.push(sentence)
          existingSentences.add(sentence)
        }
      }
      
      // Merge modified sentences (avoid duplicates)
      const existingModifiedSentences = new Set(websiteContent[normalizedDomain].modifiedSentences || [])
      for (const sentence of modifiedSentences) {
        if (!existingModifiedSentences.has(sentence)) {
          websiteContent[normalizedDomain].modifiedSentences!.push(sentence)
          existingModifiedSentences.add(sentence)
        }
      }
      
      // Take the maximum visibility scores
      websiteContent[normalizedDomain].visibility = Math.max(
        websiteContent[normalizedDomain].visibility,
        visibility
      )
      websiteContent[normalizedDomain].modifiedVisibility = Math.max(
        websiteContent[normalizedDomain].modifiedVisibility || 0,
        modifiedVisibility
      )
      
      // Concatenate modification suggestions (if both exist)
      if (modificationSuggestions) {
        if (websiteContent[normalizedDomain].modificationSuggestions) {
          websiteContent[normalizedDomain].modificationSuggestions += ' ' + modificationSuggestions
        } else {
          websiteContent[normalizedDomain].modificationSuggestions = modificationSuggestions
        }
      }
      
      console.log(`      🌐 Domain: ${normalizedDomain} - added ${sentences.length} sentences`)
    }
  }
  
  const totalDomains = Object.keys(websiteContent).length
  const totalSentences = Object.values(websiteContent).reduce(
    (sum, domainContent) => sum + domainContent.sentences.length,
    0
  )
  
  console.log(`  ✅ Converted to ${totalDomains} domains with ${totalSentences} total sentences`)
  
  return {
    brandName: fullDoc.brandName,
    brandUrl: fullDoc.brandUrl,
    normalizedBrandUrl: fullDoc.normalizedBrandUrl,
    sampledTime: fullDoc.sampledTime,
    websiteContent
  }
}

/**
 * Main conversion function
 */
async function convertWebContentsToSimpleWebContents(): Promise<void> {
  try {
    console.log(`🚀 Starting conversion from FullWebContentCache to SimpleWebContentCache`)
    
    // Step 1: Load all FullWebContentDocuments
    console.log(`\n📥 Step 1: Loading all FullWebContentDocuments...`)
    const fullWebResult = await FullWebContentCache.findAll()
    const fullWebDocs = fullWebResult.items
    
    console.log(`✅ Found ${fullWebDocs.length} full web content documents`)
    
    if (fullWebDocs.length === 0) {
      console.log(`❌ No full web content documents found. Exiting.`)
      return
    }
    
    // Step 2: Convert each document
    console.log(`\n🔄 Step 2: Converting documents...`)
    const convertedDocs: SimpleWebContentDocument[] = []
    
    for (let i = 0; i < fullWebDocs.length; i++) {
      const fullDoc = fullWebDocs[i]
      console.log(`\n📄 Converting document ${i + 1}/${fullWebDocs.length}`)
      console.log(`  🏢 Brand: ${fullDoc.brandName} (${fullDoc.brandUrl})`)
      
      try {
        const simpleDoc = convertToSimpleWebContent(fullDoc)
        convertedDocs.push(simpleDoc)
        console.log(`  ✅ Successfully converted`)
      } catch (error) {
        console.error(`  ❌ Error converting document for ${fullDoc.brandName}:`, error)
      }
    }
    
    console.log(`\n📊 Conversion summary:`)
    console.log(`  📄 Total documents processed: ${fullWebDocs.length}`)
    console.log(`  ✅ Successfully converted: ${convertedDocs.length}`)
    console.log(`  ❌ Failed conversions: ${fullWebDocs.length - convertedDocs.length}`)
    
    // Step 3: Store converted documents
    console.log(`\n💾 Step 3: Storing converted documents...`)
    
    let storedCount = 0
    let updatedCount = 0
    let errorCount = 0
    
    for (let i = 0; i < convertedDocs.length; i++) {
      const simpleDoc = convertedDocs[i]
      
      try {
        // Check if document already exists
        const existingDoc = await SimpleWebContentCache.findByBrandUrl(simpleDoc.normalizedBrandUrl)
        
        if (existingDoc) {
          // Update existing document
          await SimpleWebContentCache.update(simpleDoc.normalizedBrandUrl, simpleDoc.websiteContent)
          updatedCount++
          console.log(`  🔄 Updated: ${simpleDoc.brandName}`)
        } else {
          // Create new document
          await SimpleWebContentCache.create(
            String(simpleDoc.brandName), 
            String(simpleDoc.brandUrl), 
            String(simpleDoc.normalizedBrandUrl), 
            simpleDoc.websiteContent
          )
          storedCount++
          console.log(`  ➕ Created: ${String(simpleDoc.brandName)}`)
        }
        
        const progress = ((i + 1) / convertedDocs.length * 100).toFixed(1)
        console.log(`    📊 Progress: ${progress}% (${i + 1}/${convertedDocs.length})`)
        
      } catch (error) {
        errorCount++
        console.error(`  ❌ Error storing ${simpleDoc.brandName}:`, error)
      }
    }
    
    console.log(`\n📈 Storage Results:`)
    console.log(`  ➕ New documents created: ${storedCount}`)
    console.log(`  🔄 Existing documents updated: ${updatedCount}`)
    console.log(`  ❌ Storage errors: ${errorCount}`)
    console.log(`  ✅ Total successful operations: ${storedCount + updatedCount}`)
    
    // Step 4: Generate statistics
    console.log(`\n📊 Step 4: Generating final statistics...`)
    const stats = await SimpleWebContentCache.getStats()
    
    console.log(`\n📈 SimpleWebContentCache Statistics:`)
    console.log(`  📄 Total documents: ${stats.totalDocuments}`)
    console.log(`  🌐 Total domains: ${stats.totalDomains}`)
    console.log(`  📝 Total sentences: ${stats.totalSentences}`)
    console.log(`  📊 Average domains per brand: ${stats.averageDomainsPerBrand.toFixed(1)}`)
    console.log(`  📊 Average sentences per brand: ${stats.averageSentencesPerBrand.toFixed(1)}`)
    console.log(`  📊 Average sentences per domain: ${stats.averageSentencesPerDomain.toFixed(1)}`)
    
    console.log(`\n✅ Conversion completed successfully!`)
    
  } catch (error) {
    console.error('❌ Error during conversion:', error)
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
    await convertWebContentsToSimpleWebContents()
  } catch (error) {
    console.error('\n❌ Conversion failed:', error)
    process.exit(1)
  } finally {
    // Close database connections
    await closeFullWebConnection()

    process.exit(0)
  }
}

// Export for use as module
export { convertWebContentsToSimpleWebContents }

// Run CLI if called directly
if (require.main === module) {
  main()
}
