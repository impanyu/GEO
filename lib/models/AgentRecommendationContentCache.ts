import { MongoClient, Db, Collection } from 'mongodb'

// Database connection (reuse the same connection logic)
let client: MongoClient | null = null
let db: Db | null = null

async function connectToDatabase(): Promise<Db> {
  if (db) {
    return db
  }

  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI!)
  }

  await client.connect()
  db = client.db('springbrand-ai')
  return db
}

export async function closeDatabaseConnection(): Promise<void> {
  if (client) {
    await client.close()
    client = null
    db = null
  }
}

// Data model interfaces - simplified without dimensions
export interface ContentSnippets {
  [normalizedDomain: string]: string[] // domain -> list of snippets
}

export interface PromptContent {
  prompt: string
  contentSnippets: ContentSnippets // domain -> snippets[]
}

export interface AgentRecommendationContentDocument {
  _id?: string
  brandNames: string[]
  normalizedBrandUrls: string[]
  agentPlatform: string
  sampledTime: Date
  totalPrompts: number
  sampledPrompts: number
  callsPerPrompt: number
  promptsContent: PromptContent[] // array of prompts with their content snippets
}

// AgentRecommendationContentCache model class
export class AgentRecommendationContentCache {
  private static async getCollection(): Promise<Collection<AgentRecommendationContentDocument>> {
    const database = await connectToDatabase()
    return database.collection<AgentRecommendationContentDocument>('agent_recommendation_content')
  }

  /**
   * Get the MongoDB collection (for external use)
   */
  static async getCollectionInstance(): Promise<Collection<AgentRecommendationContentDocument>> {
    return this.getCollection()
  }

  /**
   * Store agent recommendation content analysis
   */
  static async create(
    brandNames: string[],
    normalizedBrandUrls: string[],
    agentPlatform: string,
    totalPrompts: number,
    sampledPrompts: number,
    callsPerPrompt: number,
    promptsContent: PromptContent[]
  ): Promise<string | null> {
    try {
      const collection = await this.getCollection()
      const now = new Date()
      
      const document: AgentRecommendationContentDocument = {
        brandNames,
        normalizedBrandUrls,
        agentPlatform,
        sampledTime: now,
        totalPrompts,
        sampledPrompts,
        callsPerPrompt,
        promptsContent
      }

      const result = await collection.insertOne(document)
      if (result.acknowledged) {
        console.log(`✅ Stored agent recommendation content analysis for brands: ${brandNames.join(', ')}`)
        return result.insertedId.toString()
      }
      
      return null
    } catch (error) {
      console.error('❌ Error storing agent recommendation content analysis:', error)
      return null
    }
  }

  /**
   * Find agent recommendation content analysis by normalized brand URLs
   */
  static async findByBrandUrls(normalizedBrandUrls: string[]): Promise<AgentRecommendationContentDocument[]> {
    try {
      const collection = await this.getCollection()
      return await collection.find({ 
        normalizedBrandUrls: { $in: normalizedBrandUrls } 
      }).toArray()
    } catch (error) {
      console.error('❌ Error finding agent recommendation content analysis:', error)
      return []
    }
  }

  /**
   * Find agent recommendation content analysis by agent platform
   */
  static async findByAgentPlatform(agentPlatform: string): Promise<AgentRecommendationContentDocument[]> {
    try {
      const collection = await this.getCollection()
      return await collection.find({ agentPlatform }).toArray()
    } catch (error) {
      console.error('❌ Error finding agent recommendation content analysis by platform:', error)
      return []
    }
  }

  /**
   * Find agent recommendation content analysis by ID
   */
  static async findById(id: string): Promise<AgentRecommendationContentDocument | null> {
    try {
      const collection = await this.getCollection()
      const { ObjectId } = require('mongodb')
      return await collection.findOne({ _id: new ObjectId(id) })
    } catch (error) {
      console.error('❌ Error finding agent recommendation content analysis by ID:', error)
      return null
    }
  }

  /**
   * Get all agent recommendation content analyses with pagination
   */
  static async findAll(
    skip: number = 0, 
    limit: number = 50
  ): Promise<{ items: AgentRecommendationContentDocument[], total: number }> {
    try {
      const collection = await this.getCollection()
      
      const [items, total] = await Promise.all([
        collection
          .find({})
          .sort({ sampledTime: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        collection.countDocuments({})
      ])

      return { items, total }
    } catch (error) {
      console.error('❌ Error finding all agent recommendation content analyses:', error)
      return { items: [], total: 0 }
    }
  }

  /**
   * Delete agent recommendation content analysis by normalized brand URLs
   */
  static async deleteByBrandUrls(normalizedBrandUrls: string[]): Promise<boolean> {
    try {
      const collection = await this.getCollection()
      const result = await collection.deleteMany({ 
        normalizedBrandUrls: { $in: normalizedBrandUrls } 
      })
      return result.deletedCount > 0
    } catch (error) {
      console.error('❌ Error deleting agent recommendation content analysis:', error)
      return false
    }
  }

  /**
   * Update agent recommendation content analysis
   */
  static async update(
    id: string,
    updateData: Partial<{
      totalPrompts: number
      sampledPrompts: number
      callsPerPrompt: number
      promptsContent: PromptContent[]
      sampledTime: Date
    }>
  ): Promise<boolean> {
    try {
      const collection = await this.getCollection()
      const { ObjectId } = require('mongodb')
      
      // Always update sampledTime if not provided
      const updateFields = {
        ...updateData,
        sampledTime: updateData.sampledTime || new Date()
      }
      
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateFields }
      )
      return result.acknowledged && result.modifiedCount > 0
    } catch (error) {
      console.error('❌ Error updating agent recommendation content analysis:', error)
      return false
    }
  }

  /**
   * Get collection statistics
   */
  static async getStats(): Promise<{
    totalAnalyses: number
    uniqueBrandCombinations: number
    uniquePlatforms: number
    oldestAnalysis: Date | null
    newestAnalysis: Date | null
  }> {
    try {
      const collection = await this.getCollection()
      
      const [totalAnalyses, uniqueBrandsAgg, uniquePlatformsAgg, oldestDoc, newestDoc] = await Promise.all([
        collection.countDocuments({}),
        collection.aggregate([
          { $group: { _id: '$normalizedBrandUrls' } },
          { $count: "uniqueBrandCombinations" }
        ]).toArray(),
        collection.aggregate([
          { $group: { _id: '$agentPlatform' } },
          { $count: "uniquePlatforms" }
        ]).toArray(),
        collection.findOne({}, { sort: { sampledTime: 1 } }),
        collection.findOne({}, { sort: { sampledTime: -1 } })
      ])

      const uniqueBrandCombinations = uniqueBrandsAgg.length > 0 ? uniqueBrandsAgg[0].uniqueBrandCombinations : 0
      const uniquePlatforms = uniquePlatformsAgg.length > 0 ? uniquePlatformsAgg[0].uniquePlatforms : 0

      return {
        totalAnalyses,
        uniqueBrandCombinations,
        uniquePlatforms,
        oldestAnalysis: oldestDoc?.sampledTime || null,
        newestAnalysis: newestDoc?.sampledTime || null
      }
    } catch (error) {
      console.error('❌ Error getting agent recommendation content analysis stats:', error)
      return {
        totalAnalyses: 0,
        uniqueBrandCombinations: 0,
        uniquePlatforms: 0,
        oldestAnalysis: null,
        newestAnalysis: null
      }
    }
  }
}
