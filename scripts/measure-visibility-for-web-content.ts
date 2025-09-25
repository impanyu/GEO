#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  FullWebContentCache,
  closeDatabaseConnection as closeFullWebContentConnection,
  type FullWebContentDocument,
  type WebsiteContent as FullWebsiteContent,
  type ContentSnippets as FullContentSnippets
} from '../lib/models/FullWebContentCache'
import { 
  AgentRecommendationContentCache,
  closeDatabaseConnection as closeAgentRecommendationConnection,
  type AgentRecommendationContentDocument,
  type WebsiteContent as AgentWebsiteContent,
  type ContentSnippets as AgentContentSnippets
} from '../lib/models/AgentRecommendationContentCache'
import { normalizeUrl } from '../lib/models/PromptCache'

/**
 * Calculate brand visibility for each domain by checking brand mentions in agent recommendation content
 */
async function measureVisibilityForBrands(brandUrls: string[]): Promise<void> {
  try {
    console.log(`🚀 Starting visibility measurement for ${brandUrls.length} brands`)
    console.log(`URLs: ${brandUrls.join(', ')}`)
    
    // Normalize all brand URLs
    const normalizedBrandUrls = brandUrls.map(url => normalizeUrl(url))
    console.log(`Normalized URLs: ${normalizedBrandUrls.join(', ')}`)
    
    for (let i = 0; i < brandUrls.length; i++) {
      const brandUrl = brandUrls[i]
      const normalizedBrandUrl = normalizedBrandUrls[i]
      
      console.log(`\n📊 Processing brand ${i + 1}/${brandUrls.length}: ${brandUrl}`)
      console.log(`🔍 Normalized URL: ${normalizedBrandUrl}`)
      
      try {
        // Step 1: Retrieve FullWebContentCache by normalized URL
        console.log(`📖 Retrieving full web content cache...`)
        const fullWebContent = await FullWebContentCache.findByBrandUrl(normalizedBrandUrl)
        
        if (!fullWebContent) {
          console.log(`❌ No full web content found for: ${normalizedBrandUrl}`)
          console.log(`   Please run analyze-web-content script first for this brand`)
          continue
        }
        
        console.log(`✅ Found full web content for brand: ${fullWebContent.brandName}`)
        
        // Step 2: Retrieve AgentRecommendationContent that contains this normalized URL
        console.log(`🤖 Retrieving agent recommendation content...`)
        const agentRecommendationContent = await AgentRecommendationContentCache.findByBrandUrls([normalizedBrandUrl])
        
        if (!agentRecommendationContent || agentRecommendationContent.length === 0) {
          console.log(`❌ No agent recommendation content found for: ${normalizedBrandUrl}`)
          console.log(`   Please run analyze-agent-recommendation script first for this brand`)
          continue
        }
        
        // Use the first matching document (there should typically be only one)
        const agentContent = agentRecommendationContent[0]
        console.log(`✅ Found agent recommendation content for brands: ${agentContent.brandNames.join(', ')}`)
        
        // Step 3: Create a copy of the full web content to modify
        const updatedWebsiteContent: FullWebsiteContent = JSON.parse(JSON.stringify(fullWebContent.websiteContent))
        
        // Get the brand name for visibility calculation
        const brandName = fullWebContent.brandName
        console.log(`🏷️ Brand name for visibility calculation: ${brandName}`)
        
        // Step 4: Process each content dimension
        console.log(`🔄 Processing content dimensions...`)
        const dimensionsProcessed = new Set<string>()
        
        // Get all unique dimensions from both sources
        const fullWebDimensions = Object.keys(fullWebContent.websiteContent)
        const agentDimensions = Object.keys(agentContent.websiteContent)
        const allDimensions = Array.from(new Set([...fullWebDimensions, ...agentDimensions]))
        
        console.log(`📏 Found ${allDimensions.length} total dimensions to process`)
        
        for (const dimension of allDimensions) {
          console.log(`\n  🎯 Processing dimension: ${dimension}`)
          
          // Initialize dimension if it doesn't exist in full web content
          if (!updatedWebsiteContent[dimension]) {
            updatedWebsiteContent[dimension] = {}
          }
          
          // Get domains from both sources
          const fullWebDomains = Object.keys(fullWebContent.websiteContent[dimension] || {})
          const agentDomains = Object.keys(agentContent.websiteContent[dimension] || {})
          const mergedDomains = Array.from(new Set([...fullWebDomains, ...agentDomains]))
          
          console.log(`    🌐 Found ${mergedDomains.length} domains in dimension "${dimension}"`)
          console.log(`    📊 Full web domains: ${fullWebDomains.length}, Agent domains: ${agentDomains.length}`)
          
          // Process each domain
          for (const domain of mergedDomains) {
            let visibility = 0
            
            // Check if domain exists in agent recommendation content
            if (agentContent.websiteContent[dimension] && agentContent.websiteContent[dimension][domain]) {
              const agentSentences = agentContent.websiteContent[dimension][domain]
              
              // Count sentences that mention the brand (case-insensitive)
              const brandMentions = agentSentences.filter(sentence => 
                sentence.toLowerCase().includes(brandName.toLowerCase())
              ).length
              
              // Calculate visibility as ratio of brand mentions to total sentences
              visibility = agentSentences.length > 0 ? brandMentions / agentSentences.length : 0
              
              console.log(`      🔍 Domain "${domain}": ${brandMentions}/${agentSentences.length} sentences mention brand → visibility: ${visibility.toFixed(4)}`)
            } else {
              console.log(`      ⚪ Domain "${domain}": not in agent content → visibility: 0`)
            }
            
            // Update or create domain entry in full web content
            if (!updatedWebsiteContent[dimension][domain]) {
              // Create new domain entry with empty sentences and calculated visibility
              updatedWebsiteContent[dimension][domain] = {
                sentences: [],
                visibility: visibility
              }
              console.log(`      ➕ Created new domain entry for "${domain}"`)
            } else {
              // Update existing domain with new visibility
              updatedWebsiteContent[dimension][domain].visibility = visibility
              console.log(`      🔄 Updated visibility for existing domain "${domain}"`)
            }
          }
          
          dimensionsProcessed.add(dimension)
        }
        
        // Step 5: Update the full web content cache with new visibility data
        console.log(`\n💾 Updating full web content cache with visibility data...`)
        const updateSuccess = await FullWebContentCache.updateVisibility(normalizedBrandUrl, updatedWebsiteContent)
        
        if (updateSuccess) {
          console.log(`✅ Successfully updated visibility data for brand: ${brandName}`)
          
          // Calculate and display summary statistics
          const totalDomains = new Set(
            Object.values(updatedWebsiteContent).flatMap(dimensionContent => Object.keys(dimensionContent))
          ).size
          
          const totalVisibilityEntries = Object.values(updatedWebsiteContent).reduce((sum, dimensionContent) => 
            sum + Object.keys(dimensionContent).length, 0)
          
          const nonZeroVisibilityCount = Object.values(updatedWebsiteContent).reduce((sum, dimensionContent) => 
            sum + Object.values(dimensionContent).filter(domainData => domainData.visibility > 0).length, 0)
          
          console.log(`📊 Visibility Summary:`)
          console.log(`  🌐 Total unique domains: ${totalDomains}`)
          console.log(`  📈 Total visibility entries: ${totalVisibilityEntries}`)
          console.log(`  ✨ Non-zero visibility entries: ${nonZeroVisibilityCount}`)
          console.log(`  📏 Dimensions processed: ${dimensionsProcessed.size}`)
        } else {
          console.error(`❌ Failed to update visibility data for brand: ${brandName}`)
        }
        
      } catch (error) {
        console.error(`❌ Error processing brand ${brandUrl}:`, error)
      }
      
      // Delay between brands
      if (i < brandUrls.length - 1) {
        console.log(`⏳ Waiting before processing next brand...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    
    console.log(`\n🎉 Visibility measurement completed for all brands!`)
    
  } catch (error) {
    console.error('❌ Error in visibility measurement:', error)
    throw error
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.length === 0) {
    console.log('Usage: tsx scripts/measure-visibility-for-web-content.ts <brand-url1> <brand-url2> ...')
    console.log('Example: tsx scripts/measure-visibility-for-web-content.ts https://apple.com https://microsoft.com')
    process.exit(1)
  }
  
  // Validate all URLs
  const brandUrls: string[] = []
  for (const url of args) {
    try {
      new URL(url)
      brandUrls.push(url)
    } catch {
      console.log(`❌ Invalid URL format: ${url}`)
      process.exit(1)
    }
  }

  // Check required environment variables
  const requiredEnvVars = ['MONGODB_URI']
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName])
  
  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:')
    missingVars.forEach(varName => console.log(`  - ${varName}`))
    console.log('\nPlease add these to your .env.local file')
    process.exit(1)
  }

  try {
    console.log(`🎯 Configuration:`)
    console.log(`  🌐 Brand URLs: ${brandUrls.length}`)
    console.log(`  🔗 URLs: ${brandUrls.join(', ')}`)

    await measureVisibilityForBrands(brandUrls)
    
  } catch (error) {
    console.error('\n❌ Visibility measurement failed:', error)
    process.exit(1)
  } finally {
    // Close database connections
    await closeFullWebContentConnection()
    await closeAgentRecommendationConnection()
    process.exit(0)
  }
}

// Export for use as module
export { measureVisibilityForBrands }

// Run CLI if called directly
if (require.main === module) {
  main()
}
