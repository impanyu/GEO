import { MongoClient, Db, Collection } from 'mongodb'

// Data model interfaces
export interface QueryResponse {
  output_text: string
  annotations: Array<{
    type: string
    title?: string
    url?: string
    location?: { start: number; end: number } | null  // OpenAI format: location object with start/end
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

class QueryResponseCacheClass {
  private client: MongoClient | null = null
  private db: Db | null = null

  async connectToDatabase(): Promise<void> {
    if (!this.client) {
      const mongoUri = process.env.MONGODB_URI
      if (!mongoUri) {
        throw new Error('MONGODB_URI environment variable is not set')
      }

      this.client = new MongoClient(mongoUri)
      await this.client.connect()
      this.db = this.client.db('springbrand-ai')
    }
  }

  async closeDatabaseConnection(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.db = null
    }
  }

  async getCollection(): Promise<Collection<QueryResponseDocument>> {
    await this.connectToDatabase()
    if (!this.db) {
      throw new Error('Database connection not established')
    }
    return this.db.collection<QueryResponseDocument>('query_responses')
  }

  async getCollectionInstance(): Promise<Collection<QueryResponseDocument>> {
    return this.getCollection()
  }

  /**
   * Create a new query response document
   */
  async create(
    prompt: string,
    responses: QueryResponse[],
    agenticPlatform: string,
    queryDatetime?: Date
  ): Promise<string> {
    const collection = await this.getCollection()
    
    const document: QueryResponseDocument = {
      prompt,
      responses,
      queryDatetime: queryDatetime || new Date(),
      agenticPlatform,
      createdDatetime: new Date()
    }

    const result = await collection.insertOne(document)
    return result.insertedId.toString()
  }

  /**
   * Create multiple query response documents in batch
   */
  async createMany(
    documents: Array<{
      prompt: string
      responses: QueryResponse[]
      agenticPlatform: string
      queryDatetime?: Date
    }>
  ): Promise<string[]> {
    if (documents.length === 0) {
      return []
    }

    const collection = await this.getCollection()
    
    const queryResponseDocuments: QueryResponseDocument[] = documents.map(doc => ({
      prompt: doc.prompt,
      responses: doc.responses,
      queryDatetime: doc.queryDatetime || new Date(),
      agenticPlatform: doc.agenticPlatform,
      createdDatetime: new Date()
    }))

    const result = await collection.insertMany(queryResponseDocuments)
    return Object.values(result.insertedIds).map(id => id.toString())
  }

  /**
   * Find query response documents by prompt
   */
  async findByPrompt(prompt: string): Promise<QueryResponseDocument[]> {
    const collection = await this.getCollection()
    return await collection.find({ prompt }).toArray()
  }

  /**
   * Find query response documents by agentic platform
   */
  async findByPlatform(agenticPlatform: string): Promise<QueryResponseDocument[]> {
    const collection = await this.getCollection()
    return await collection.find({ agenticPlatform }).toArray()
  }

  /**
   * Find query response documents by prompt and platform
   */
  async findByPromptAndPlatform(prompt: string, agenticPlatform: string): Promise<QueryResponseDocument | null> {
    const collection = await this.getCollection()
    return await collection.findOne({ prompt, agenticPlatform })
  }

  /**
   * Get all query response documents
   */
  async findAll(limit?: number): Promise<QueryResponseDocument[]> {
    const collection = await this.getCollection()
    const cursor = collection.find({})
    
    if (limit) {
      cursor.limit(limit)
    }
    
    return await cursor.toArray()
  }

  /**
   * Find query responses within a date range
   */
  async findByDateRange(startDate: Date, endDate: Date): Promise<QueryResponseDocument[]> {
    const collection = await this.getCollection()
    return await collection.find({
      queryDatetime: {
        $gte: startDate,
        $lte: endDate
      }
    }).toArray()
  }

  /**
   * Update a query response document
   */
  async update(
    id: string,
    updates: Partial<{
      prompt: string
      responses: QueryResponse[]
      queryDatetime: Date
      agenticPlatform: string
    }>
  ): Promise<boolean> {
    const collection = await this.getCollection()
    
    const result = await collection.updateOne(
      { _id: id as any },
      { $set: updates }
    )

    return result.modifiedCount > 0
  }

  /**
   * Add a response to an existing query document
   */
  async addResponse(id: string, response: QueryResponse): Promise<boolean> {
    const collection = await this.getCollection()
    
    const result = await collection.updateOne(
      { _id: id as any },
      { $push: { responses: response } }
    )

    return result.modifiedCount > 0
  }

  /**
   * Delete a query response document
   */
  async delete(id: string): Promise<boolean> {
    const collection = await this.getCollection()
    const result = await collection.deleteOne({ _id: id as any })
    return result.deletedCount > 0
  }

  /**
   * Delete all query response documents
   */
  async deleteAll(): Promise<number> {
    const collection = await this.getCollection()
    const result = await collection.deleteMany({})
    return result.deletedCount || 0
  }

  /**
   * Delete query responses by platform
   */
  async deleteByPlatform(agenticPlatform: string): Promise<number> {
    const collection = await this.getCollection()
    const result = await collection.deleteMany({ agenticPlatform })
    return result.deletedCount || 0
  }

  /**
   * Get statistics about query responses
   */
  async getStats(): Promise<{
    totalDocuments: number
    totalResponses: number
    uniquePrompts: number
    uniquePlatforms: number
    averageResponsesPerDocument: number
    dateRange: {
      earliest: Date | null
      latest: Date | null
    }
  }> {
    const collection = await this.getCollection()
    
    const [
      totalDocuments,
      uniquePrompts,
      uniquePlatforms,
      totalResponsesResult,
      dateRangeResult
    ] = await Promise.all([
      collection.countDocuments(),
      collection.distinct('prompt').then(prompts => prompts.length),
      collection.distinct('agenticPlatform').then(platforms => platforms.length),
      collection.aggregate([
        { $group: { _id: null, totalResponses: { $sum: { $size: '$responses' } } } }
      ]).toArray(),
      collection.aggregate([
        { 
          $group: { 
            _id: null, 
            earliest: { $min: '$queryDatetime' },
            latest: { $max: '$queryDatetime' }
          } 
        }
      ]).toArray()
    ])

    const totalResponses = totalResponsesResult[0]?.totalResponses || 0
    const averageResponsesPerDocument = totalDocuments > 0 ? totalResponses / totalDocuments : 0
    const dateRange = dateRangeResult[0] || { earliest: null, latest: null }

    return {
      totalDocuments,
      totalResponses,
      uniquePrompts,
      uniquePlatforms,
      averageResponsesPerDocument,
      dateRange: {
        earliest: dateRange.earliest,
        latest: dateRange.latest
      }
    }
  }

  /**
   * Search query responses by text content
   */
  async searchByContent(searchText: string, limit: number = 50): Promise<QueryResponseDocument[]> {
    const collection = await this.getCollection()
    
    const regex = new RegExp(searchText, 'i')
    
    return await collection.find({
      $or: [
        { prompt: { $regex: regex } },
        { 'responses.output_text': { $regex: regex } },
        { 'responses.annotations.title': { $regex: regex } },
        { 'responses.annotations.url': { $regex: regex } }
      ]
    }).limit(limit).toArray()
  }
}

// Create singleton instance
const QueryResponseCache = new QueryResponseCacheClass()

// Export the singleton and close function
export { QueryResponseCache }

export async function closeDatabaseConnection(): Promise<void> {
  await QueryResponseCache.closeDatabaseConnection()
}
