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
export interface ContentSnippet {
  [snippet: string]: number // snippet text -> frequency
}

export interface ContentDimension {
  [dimension: string]: ContentSnippet
}

export interface WebsiteContent {
  [websiteUrl: string]: ContentDimension
}

export interface FullWebContentDocument {
  _id?: string
  brandName: string
  brandUrl: string
  sampledTime: Date
  websiteContent: WebsiteContent
}

// FullWebContentCache model class
export class FullWebContentCache {
  private static async getCollection(): Promise<Collection<FullWebContentDocument>> {
    const database = await connectToDatabase()
    return database.collection<FullWebContentDocument>('full_web_content')
  }

  /**
   * Store full web content analysis
   */
  static async create(
    brandName: string,
    brandUrl: string,
    websiteContent: WebsiteContent
  ): Promise<string | null> {
    try {
      const collection = await this.getCollection()
      const now = new Date()
      
      const document: FullWebContentDocument = {
        brandName,
        brandUrl,
        sampledTime: now,
        websiteContent
      }

      const result = await collection.insertOne(document)
      if (result.acknowledged) {
        console.log(`✅ Stored web content analysis for ${brandName}`)
        return result.insertedId.toString()
      }
      
      return null
    } catch (error) {
      console.error('❌ Error storing web content analysis:', error)
      return null
    }
  }

  /**
   * Find web content analysis by brand URL
   */
  static async findByBrandUrl(brandUrl: string): Promise<FullWebContentDocument | null> {
    try {
      const collection = await this.getCollection()
      return await collection.findOne({ brandUrl })
    } catch (error) {
      console.error('❌ Error finding web content analysis:', error)
      return null
    }
  }

  /**
   * Find web content analysis by brand name
   */
  static async findByBrandName(brandName: string): Promise<FullWebContentDocument[]> {
    try {
      const collection = await this.getCollection()
      return await collection.find({ brandName }).toArray()
    } catch (error) {
      console.error('❌ Error finding web content analysis by brand name:', error)
      return []
    }
  }

  /**
   * Find web content analysis by ID
   */
  static async findById(id: string): Promise<FullWebContentDocument | null> {
    try {
      const collection = await this.getCollection()
      const { ObjectId } = require('mongodb')
      return await collection.findOne({ _id: new ObjectId(id) })
    } catch (error) {
      console.error('❌ Error finding web content analysis by ID:', error)
      return null
    }
  }

  /**
   * Get all web content analyses with pagination
   */
  static async findAll(
    skip: number = 0, 
    limit: number = 50
  ): Promise<{ items: FullWebContentDocument[], total: number }> {
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
      console.error('❌ Error finding all web content analyses:', error)
      return { items: [], total: 0 }
    }
  }

  /**
   * Delete web content analysis by brand URL
   */
  static async deleteByBrandUrl(brandUrl: string): Promise<boolean> {
    try {
      const collection = await this.getCollection()
      const result = await collection.deleteOne({ brandUrl })
      return result.deletedCount > 0
    } catch (error) {
      console.error('❌ Error deleting web content analysis:', error)
      return false
    }
  }

  /**
   * Update web content analysis
   */
  static async update(
    id: string,
    websiteContent: WebsiteContent
  ): Promise<boolean> {
    try {
      const collection = await this.getCollection()
      const { ObjectId } = require('mongodb')
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            websiteContent,
            sampledTime: new Date()
          }
        }
      )
      return result.acknowledged && result.modifiedCount > 0
    } catch (error) {
      console.error('❌ Error updating web content analysis:', error)
      return false
    }
  }

  /**
   * Get collection statistics
   */
  static async getStats(): Promise<{
    totalAnalyses: number
    uniqueBrands: number
    oldestAnalysis: Date | null
    newestAnalysis: Date | null
  }> {
    try {
      const collection = await this.getCollection()
      
      const [totalAnalyses, uniqueBrandsAgg, oldestDoc, newestDoc] = await Promise.all([
        collection.countDocuments({}),
        collection.aggregate([
          { $group: { _id: '$brandName' } },
          { $count: "uniqueBrands" }
        ]).toArray(),
        collection.findOne({}, { sort: { sampledTime: 1 } }),
        collection.findOne({}, { sort: { sampledTime: -1 } })
      ])

      const uniqueBrands = uniqueBrandsAgg.length > 0 ? uniqueBrandsAgg[0].uniqueBrands : 0

      return {
        totalAnalyses,
        uniqueBrands,
        oldestAnalysis: oldestDoc?.sampledTime || null,
        newestAnalysis: newestDoc?.sampledTime || null
      }
    } catch (error) {
      console.error('❌ Error getting web content analysis stats:', error)
      return {
        totalAnalyses: 0,
        uniqueBrands: 0,
        oldestAnalysis: null,
        newestAnalysis: null
      }
    }
  }
}
