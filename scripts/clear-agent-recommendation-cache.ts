#!/usr/bin/env tsx

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { 
  AgentRecommendationContentCache,
  closeDatabaseConnection
} from '../lib/models/AgentRecommendationContentCache'

/**
 * Clear all agent recommendation content cache data
 */
async function clearAgentRecommendationCache(): Promise<void> {
  try {
    console.log('🗑️ Clearing agent recommendation content cache...')
    
    // Get collection instance and delete all documents
    const collection = await AgentRecommendationContentCache.getCollectionInstance()
    const result = await collection.deleteMany({})
    
    console.log(`✅ Cleared ${result.deletedCount} documents from agent_recommendation_content collection`)
    
  } catch (error) {
    console.error('❌ Error clearing agent recommendation content cache:', error)
    throw error
  }
}

/**
 * Main function
 */
async function main() {
  // Check required environment variables
  if (!process.env.MONGODB_URI) {
    console.log('❌ Missing required environment variable: MONGODB_URI')
    console.log('Please add MONGODB_URI to your .env.local file')
    process.exit(1)
  }

  try {
    await clearAgentRecommendationCache()
    console.log('🎉 Agent recommendation content cache cleared successfully!')
    
  } catch (error) {
    console.error('\n❌ Failed to clear agent recommendation content cache:', error)
    process.exit(1)
  } finally {
    // Close database connections
    await closeDatabaseConnection()
    process.exit(0)
  }
}

// Run if called directly
if (require.main === module) {
  main()
}

export { clearAgentRecommendationCache }
