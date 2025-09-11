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

// Data model interfaces
export interface QueryResponse {
  output_text: string
  annotations: Array<{
    type: string
    title?: string
    url?: string
    index?: number | null
  }>
}

export interface QueryResponseDocument {
  _id?: string
  prompt: string
  responses: QueryResponse[]
  queryDatetime: Date
  agenticPlatform: string
  createdDatetime: Date
}

export interface BrandAnalysis {
  brandName: string
  totalAppearancesAcrossResponses: number // Count of responses where brand appears (configurable queries per prompt)
  avgAppearancesPerResponse: number
  avgRank: number
}

export interface DataTableResult {
  normalizedBrandUrl: string
  brandName: string
  agenticPlatform: string
  prompt: string
  topic: string // Topic that generated this prompt
  datetime: Date
  brandAnalysis: BrandAnalysis // Single brand analysis instead of array
  totalCitationsOfAllBrands: number // number of responses
  queryResponseDocumentId: string // Reference to QueryResponseDocument
}

export interface DataTableCacheDocument {
  _id?: string
  normalizedUrl: string
  originalUrl: string
  brandName: string
  agenticPlatform: string
  results: DataTableResult[]
  createdDatetime: Date
  updatedDatetime: Date
}

// QueryResponse model class
export class QueryResponseCache {
  private static async getCollection(): Promise<Collection<QueryResponseDocument>> {
    const database = await connectToDatabase()
    return database.collection<QueryResponseDocument>('query_responses')
  }

  /**
   * Store query responses
   */
  static async create(
    prompt: string,
    responses: QueryResponse[],
    agenticPlatform: string
  ): Promise<string | null> {
    try {
      const collection = await this.getCollection()
      const now = new Date()
      
      const document: QueryResponseDocument = {
        prompt,
        responses,
        queryDatetime: now,
        agenticPlatform,
        createdDatetime: now
      }

      const result = await collection.insertOne(document)
      if (result.acknowledged) {
        console.log(`Stored query responses for prompt: "${prompt.substring(0, 50)}..."`)
        return result.insertedId.toString()
      }
      
      return null
    } catch (error) {
      console.error('Error storing query responses:', error)
      return null
    }
  }

  /**
   * Find query responses by ID
   */
  static async findById(id: string): Promise<QueryResponseDocument | null> {
    try {
      const collection = await this.getCollection()
      const { ObjectId } = require('mongodb')
      return await collection.findOne({ _id: new ObjectId(id) })
    } catch (error) {
      console.error('Error finding query responses:', error)
      return null
    }
  }
}

// DataTableCache model class
export class DataTableCache {
  private static async getCollection(): Promise<Collection<DataTableCacheDocument>> {
    const database = await connectToDatabase()
    return database.collection<DataTableCacheDocument>('data_table_cache')
  }

  /**
   * Find cached data table by normalized URL and platform
   */
  static async findByUrlAndPlatform(
    normalizedUrl: string, 
    agenticPlatform: string
  ): Promise<DataTableCacheDocument | null> {
    try {
      const collection = await this.getCollection()
      // Return the most recent document for this URL and platform
      return await collection.findOne(
        { normalizedUrl, agenticPlatform },
        { sort: { createdDatetime: -1 } }
      )
    } catch (error) {
      console.error('Error finding cached data table:', error)
      return null
    }
  }

  /**
   * Find all cached data tables by normalized URL and platform
   */
  static async findAllByUrlAndPlatform(
    normalizedUrl: string, 
    agenticPlatform: string
  ): Promise<DataTableCacheDocument[]> {
    try {
      const collection = await this.getCollection()
      // Return all documents for this URL and platform, sorted by most recent first
      return await collection.find(
        { normalizedUrl, agenticPlatform },
        { sort: { createdDatetime: -1 } }
      ).toArray()
    } catch (error) {
      console.error('Error finding cached data tables:', error)
      return []
    }
  }

  /**
   * Add new results to existing data table cache document, or create if not exists
   */
  static async upsert(
    normalizedUrl: string,
    originalUrl: string,
    brandName: string,
    agenticPlatform: string,
    results: DataTableResult[]
  ): Promise<DataTableCacheDocument | null> {
    try {
      const collection = await this.getCollection()
      const now = new Date()
      
      // Try to find existing document
      const existingDoc = await collection.findOne({ normalizedUrl, agenticPlatform })
      
      if (existingDoc) {
        // Append new results to existing document
        const updatedResults = [...existingDoc.results, ...results]
        
        const updateResult = await collection.updateOne(
          { normalizedUrl, agenticPlatform },
          {
            $set: {
              results: updatedResults,
              updatedDatetime: now,
              // Update other fields if they've changed
              originalUrl,
              brandName
            }
          }
        )
        
        if (updateResult.acknowledged) {
          console.log(`Updated data table cache for URL: ${normalizedUrl}, Platform: ${agenticPlatform} (added ${results.length} new results)`)
          // Return updated document
          return {
            ...existingDoc,
            results: updatedResults,
            updatedDatetime: now,
            originalUrl,
            brandName
          }
        }
      } else {
        // Create new document if none exists
        const document: DataTableCacheDocument = {
          normalizedUrl,
          originalUrl,
          brandName,
          agenticPlatform,
          results,
          createdDatetime: now,
          updatedDatetime: now
        }

        const insertResult = await collection.insertOne(document)

        if (insertResult.acknowledged) {
          console.log(`Created new data table cache for URL: ${normalizedUrl}, Platform: ${agenticPlatform}`)
          return document
        }
      }
      
      return null
    } catch (error) {
      console.error('Error upserting cached data table:', error)
      return null
    }
  }

  /**
   * Get all cached entries with pagination
   */
  static async findAll(
    skip: number = 0, 
    limit: number = 50
  ): Promise<{ items: DataTableCacheDocument[], total: number }> {
    try {
      const collection = await this.getCollection()
      
      const [items, total] = await Promise.all([
        collection
          .find({})
          .sort({ updatedDatetime: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        collection.countDocuments({})
      ])

      return { items, total }
    } catch (error) {
      console.error('Error finding all cached data tables:', error)
      return { items: [], total: 0 }
    }
  }

  /**
   * Delete cached entry by URL and platform
   */
  static async deleteByUrlAndPlatform(
    normalizedUrl: string, 
    agenticPlatform: string
  ): Promise<boolean> {
    try {
      const collection = await this.getCollection()
      const result = await collection.deleteOne({ normalizedUrl, agenticPlatform })
      return result.deletedCount > 0
    } catch (error) {
      console.error('Error deleting cached data table:', error)
      return false
    }
  }

  /**
   * Get cache statistics
   */
  static async getStats(): Promise<{
    totalEntries: number
    platforms: { [platform: string]: number }
    oldestEntry: Date | null
    newestEntry: Date | null
  }> {
    try {
      const collection = await this.getCollection()
      
      const [totalEntries, platformAgg, oldestDoc, newestDoc] = await Promise.all([
        collection.countDocuments({}),
        collection.aggregate([
          { $group: { _id: '$agenticPlatform', count: { $sum: 1 } } }
        ]).toArray(),
        collection.findOne({}, { sort: { createdDatetime: 1 } }),
        collection.findOne({}, { sort: { createdDatetime: -1 } })
      ])

      const platforms: { [platform: string]: number } = {}
      platformAgg.forEach((item: any) => {
        platforms[item._id] = item.count
      })

      return {
        totalEntries,
        platforms,
        oldestEntry: oldestDoc?.createdDatetime || null,
        newestEntry: newestDoc?.createdDatetime || null
      }
    } catch (error) {
      console.error('Error getting cache stats:', error)
      return {
        totalEntries: 0,
        platforms: {},
        oldestEntry: null,
        newestEntry: null
      }
    }
  }
}
