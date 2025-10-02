import { MongoClient, Db, Collection } from 'mongodb'

export interface PromptDomainSentencesVisibilityTrainingDataDocument {
  _id?: string
  prompt: string
  domain: string
  sentences: string[]
  visibility: number
  embedding: number[]  // Pre-computed concatenated embedding vector
  createdAt: Date
  updatedAt: Date
}

class PromptDomainSentencesVisibilityTrainingDataCacheClass {
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

  async getCollection(): Promise<Collection<PromptDomainSentencesVisibilityTrainingDataDocument>> {
    await this.connectToDatabase()
    if (!this.db) {
      throw new Error('Database connection not established')
    }
    return this.db.collection<PromptDomainSentencesVisibilityTrainingDataDocument>('prompt_domain_sentences_visibility_training_data')
  }

  async getCollectionInstance(): Promise<Collection<PromptDomainSentencesVisibilityTrainingDataDocument>> {
    return this.getCollection()
  }

  /**
   * Create a new training data entry
   */
  async create(
    prompt: string,
    domain: string,
    sentences: string[],
    visibility: number,
    embedding: number[]
  ): Promise<string> {
    const collection = await this.getCollection()
    
    const document: PromptDomainSentencesVisibilityTrainingDataDocument = {
      prompt,
      domain,
      sentences,
      visibility,
      embedding,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    const result = await collection.insertOne(document)
    return result.insertedId.toString()
  }

  /**
   * Create multiple training data entries in batch
   */
  async createMany(
    entries: Array<{
      prompt: string
      domain: string
      sentences: string[]
      visibility: number
      embedding: number[]
    }>
  ): Promise<string[]> {
    if (entries.length === 0) {
      return []
    }

    const collection = await this.getCollection()
    
    const documents: PromptDomainSentencesVisibilityTrainingDataDocument[] = entries.map(entry => ({
      prompt: entry.prompt,
      domain: entry.domain,
      sentences: entry.sentences,
      visibility: entry.visibility,
      embedding: entry.embedding,
      createdAt: new Date(),
      updatedAt: new Date()
    }))

    const result = await collection.insertMany(documents)
    return Object.values(result.insertedIds).map(id => id.toString())
  }

  /**
   * Find training data entries by prompt
   */
  async findByPrompt(prompt: string): Promise<PromptDomainSentencesVisibilityTrainingDataDocument[]> {
    const collection = await this.getCollection()
    return await collection.find({ prompt }).toArray()
  }

  /**
   * Find training data entries by domain
   */
  async findByDomain(domain: string): Promise<PromptDomainSentencesVisibilityTrainingDataDocument[]> {
    const collection = await this.getCollection()
    return await collection.find({ domain }).toArray()
  }

  /**
   * Find training data entries by prompt and domain
   */
  async findByPromptAndDomain(prompt: string, domain: string): Promise<PromptDomainSentencesVisibilityTrainingDataDocument | null> {
    const collection = await this.getCollection()
    return await collection.findOne({ prompt, domain })
  }

  /**
   * Get all training data entries
   */
  async findAll(limit?: number): Promise<PromptDomainSentencesVisibilityTrainingDataDocument[]> {
    const collection = await this.getCollection()
    const cursor = collection.find({})
    
    if (limit) {
      cursor.limit(limit)
    }
    
    return await cursor.toArray()
  }

  /**
   * Update a training data entry
   */
  async update(
    id: string,
    updates: Partial<{
      prompt: string
      domain: string
      sentences: string[]
      visibility: number
      embedding: number[]
    }>
  ): Promise<boolean> {
    const collection = await this.getCollection()
    
    const updateDoc = {
      ...updates,
      updatedAt: new Date()
    }

    const result = await collection.updateOne(
      { _id: id as any },
      { $set: updateDoc }
    )

    return result.modifiedCount > 0
  }

  /**
   * Delete a training data entry
   */
  async delete(id: string): Promise<boolean> {
    const collection = await this.getCollection()
    const result = await collection.deleteOne({ _id: id as any })
    return result.deletedCount > 0
  }

  /**
   * Delete all training data entries
   */
  async deleteAll(): Promise<number> {
    const collection = await this.getCollection()
    const result = await collection.deleteMany({})
    return result.deletedCount || 0
  }

  /**
   * Get statistics about the training data
   */
  async getStats(): Promise<{
    totalEntries: number
    uniquePrompts: number
    uniqueDomains: number
    averageVisibility: number
    averageSentencesPerEntry: number
  }> {
    const collection = await this.getCollection()
    
    const [
      totalEntries,
      uniquePrompts,
      uniqueDomains,
      avgVisibility,
      avgSentences
    ] = await Promise.all([
      collection.countDocuments(),
      collection.distinct('prompt').then(prompts => prompts.length),
      collection.distinct('domain').then(domains => domains.length),
      collection.aggregate([
        { $group: { _id: null, avgVisibility: { $avg: '$visibility' } } }
      ]).toArray().then(result => result[0]?.avgVisibility || 0),
      collection.aggregate([
        { $group: { _id: null, avgSentences: { $avg: { $size: '$sentences' } } } }
      ]).toArray().then(result => result[0]?.avgSentences || 0)
    ])

    return {
      totalEntries,
      uniquePrompts,
      uniqueDomains,
      averageVisibility: avgVisibility,
      averageSentencesPerEntry: avgSentences
    }
  }
}

// Create singleton instance
const PromptDomainSentencesVisibilityTrainingDataCache = new PromptDomainSentencesVisibilityTrainingDataCacheClass()

// Export the singleton and close function
export { PromptDomainSentencesVisibilityTrainingDataCache }

export async function closeDatabaseConnection(): Promise<void> {
  await PromptDomainSentencesVisibilityTrainingDataCache.closeDatabaseConnection()
}
