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
export interface DomainContent {
  sentences: string[] // list of original sentences
  visibility: number  // floating number, default 0
  modifiedSentences?: string[] // list of modified sentences (for training)
  modifiedVisibility?: number  // floating number, default 0 (for modified sentences)
  modificationSuggestions?: string // modification suggestions from policy model
}

export interface WebsiteContent {
  [normalizedDomain: string]: DomainContent // domain -> content
}

export interface SimpleWebContentDocument {
  _id?: string
  brandName: string
  brandUrl: string
  normalizedBrandUrl: string
  sampledTime: Date
  websiteContent: WebsiteContent // domain -> sentences[]
}

// SimpleWebContentCache model class
export class SimpleWebContentCache {
  private static async getCollection(): Promise<Collection<SimpleWebContentDocument>> {
    const database = await connectToDatabase()
    return database.collection<SimpleWebContentDocument>('simple_web_content')
  }

  /**
   * Get the MongoDB collection (for external use)
   */
  static async getCollectionInstance(): Promise<Collection<SimpleWebContentDocument>> {
    return this.getCollection()
  }

  /**
   * Store simple web content analysis
   */
  static async create(
    brandName: string,
    brandUrl: string,
    normalizedBrandUrl: string,
    websiteContent: WebsiteContent
  ): Promise<string | null> {
    try {
      const collection = await this.getCollection()
      const now = new Date()
      
      const document: SimpleWebContentDocument = {
        brandName,
        brandUrl,
        normalizedBrandUrl,
        sampledTime: now,
        websiteContent
      }

      // Use replaceOne with upsert to prevent duplicates
      const result = await collection.replaceOne(
        { normalizedBrandUrl }, // Filter by normalized brand URL
        document,
        { upsert: true }
      )
      
      if (result.acknowledged) {
        if (result.upsertedId) {
          console.log(`✅ Created new simple web content analysis for ${brandName}`)
          return result.upsertedId.toString()
        } else {
          console.log(`✅ Updated existing simple web content analysis for ${brandName}`)
          // Find the document to get its ID
          const existingDoc = await collection.findOne({ normalizedBrandUrl })
          return existingDoc?._id?.toString() || null
        }
      }
      
      return null
    } catch (error) {
      console.error('❌ Error storing simple web content analysis:', error)
      return null
    }
  }

  /**
   * Find simple web content analysis by normalized brand URL
   */
  static async findByBrandUrl(normalizedBrandUrl: string): Promise<SimpleWebContentDocument | null> {
    try {
      const collection = await this.getCollection()
      return await collection.findOne({ normalizedBrandUrl })
    } catch (error) {
      console.error('❌ Error finding simple web content analysis:', error)
      return null
    }
  }

  /**
   * Find simple web content analysis by brand name
   */
  static async findByBrandName(brandName: string): Promise<SimpleWebContentDocument[]> {
    try {
      const collection = await this.getCollection()
      return await collection.find({ brandName }).toArray()
    } catch (error) {
      console.error('❌ Error finding simple web content analysis by brand name:', error)
      return []
    }
  }

  /**
   * Find simple web content analysis by ID
   */
  static async findById(id: string): Promise<SimpleWebContentDocument | null> {
    try {
      const collection = await this.getCollection()
      const { ObjectId } = require('mongodb')
      return await collection.findOne({ _id: new ObjectId(id) })
    } catch (error) {
      console.error('❌ Error finding simple web content analysis by ID:', error)
      return null
    }
  }

  /**
   * Get all simple web content analyses with pagination
   */
  static async findAll(
    skip: number = 0, 
    limit: number = 50
  ): Promise<{ items: SimpleWebContentDocument[], total: number }> {
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
      console.error('❌ Error finding all simple web content analyses:', error)
      return { items: [], total: 0 }
    }
  }

  /**
   * Delete simple web content analysis by normalized brand URL
   */
  static async deleteByBrandUrl(normalizedBrandUrl: string): Promise<boolean> {
    try {
      const collection = await this.getCollection()
      const result = await collection.deleteOne({ normalizedBrandUrl })
      return result.deletedCount > 0
    } catch (error) {
      console.error('❌ Error deleting simple web content analysis:', error)
      return false
    }
  }

  /**
   * Update simple web content analysis
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
      console.error('❌ Error updating simple web content analysis:', error)
      return false
    }
  }

  /**
   * Update visibility for simple web content analysis by normalized brand URL
   */
  static async updateVisibility(
    normalizedBrandUrl: string,
    websiteContent: WebsiteContent
  ): Promise<boolean> {
    try {
      const collection = await this.getCollection()
      const result = await collection.updateOne(
        { normalizedBrandUrl },
        { 
          $set: { 
            websiteContent,
            sampledTime: new Date()
          }
        }
      )
      return result.acknowledged && result.modifiedCount > 0
    } catch (error) {
      console.error('❌ Error updating simple web content visibility:', error)
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
      console.error('❌ Error getting simple web content analysis stats:', error)
      return {
        totalAnalyses: 0,
        uniqueBrands: 0,
        oldestAnalysis: null,
        newestAnalysis: null
      }
    }
  }
}
