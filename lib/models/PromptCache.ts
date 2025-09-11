import { MongoClient, Db, Collection } from 'mongodb'

// Database connection
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

// Data model interfaces
export interface PromptData {
  success: boolean
  brandUrl: string
  brandName: string
  topics: string[]
  keywords: string[]
  totalPrompts: number
  prompts: string[]
  keywordToTopic: { [keyword: string]: string }  // Maps each keyword to its generating topic
  promptToKeyword: { [prompt: string]: string }  // Maps each prompt to its generating keyword
}

export interface PromptCacheDocument {
  _id?: string
  normalizedUrl: string
  originalUrl: string
  data: PromptData
  createdAt: Date
  updatedAt: Date
}

// PromptCache model class
export class PromptCache {
  private static async getCollection(): Promise<Collection<PromptCacheDocument>> {
    const database = await connectToDatabase()
    return database.collection<PromptCacheDocument>('prompt_cache')
  }

  /**
   * Find cached prompts by normalized URL
   */
  static async findByUrl(normalizedUrl: string): Promise<PromptCacheDocument | null> {
    try {
      const collection = await this.getCollection()
      return await collection.findOne({ normalizedUrl })
    } catch (error) {
      console.error('Error finding cached prompts:', error)
      return null
    }
  }

  /**
   * Create or update cached prompts
   */
  static async upsert(
    normalizedUrl: string, 
    originalUrl: string, 
    data: PromptData
  ): Promise<PromptCacheDocument | null> {
    try {
      const collection = await this.getCollection()
      const now = new Date()
      
      const document: PromptCacheDocument = {
        normalizedUrl,
        originalUrl,
        data,
        createdAt: now,
        updatedAt: now
      }

      // Use upsert to update if exists, insert if new
      const result = await collection.replaceOne(
        { normalizedUrl },
        document,
        { upsert: true }
      )

      if (result.acknowledged) {
        console.log(`Cached prompts for URL: ${normalizedUrl}`)
        return document
      }
      
      return null
    } catch (error) {
      console.error('Error upserting cached prompts:', error)
      return null
    }
  }

  /**
   * Get all cached entries with pagination
   */
  static async findAll(
    skip: number = 0, 
    limit: number = 50
  ): Promise<{ items: PromptCacheDocument[], total: number }> {
    try {
      const collection = await this.getCollection()
      
      const [items, total] = await Promise.all([
        collection
          .find({})
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        collection.countDocuments({})
      ])

      return { items, total }
    } catch (error) {
      console.error('Error finding all cached prompts:', error)
      return { items: [], total: 0 }
    }
  }

  /**
   * Delete cached entry by URL
   */
  static async deleteByUrl(normalizedUrl: string): Promise<boolean> {
    try {
      const collection = await this.getCollection()
      const result = await collection.deleteOne({ normalizedUrl })
      return result.deletedCount > 0
    } catch (error) {
      console.error('Error deleting cached prompts:', error)
      return false
    }
  }

  /**
   * Get cache statistics
   */
  static async getStats(): Promise<{
    totalEntries: number
    oldestEntry: Date | null
    newestEntry: Date | null
  }> {
    try {
      const collection = await this.getCollection()
      
      const [totalEntries, oldestDoc, newestDoc] = await Promise.all([
        collection.countDocuments({}),
        collection.findOne({}, { sort: { createdAt: 1 } }),
        collection.findOne({}, { sort: { createdAt: -1 } })
      ])

      return {
        totalEntries,
        oldestEntry: oldestDoc?.createdAt || null,
        newestEntry: newestDoc?.createdAt || null
      }
    } catch (error) {
      console.error('Error getting cache stats:', error)
      return {
        totalEntries: 0,
        oldestEntry: null,
        newestEntry: null
      }
    }
  }
}

// URL normalization utility
export function normalizeUrl(url: string): string {
  // Remove protocol if present
  let normalized = url.replace(/^https?:\/\//, '')
  
  // Remove www. if present
  normalized = normalized.replace(/^www\./, '')
  
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '')
  
  // Convert to lowercase for consistent comparison
  return normalized.toLowerCase()
}
