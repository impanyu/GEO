import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { PromptCache, normalizeUrl, closeDatabaseConnection, type PromptData } from '@/lib/models/PromptCache'

// Global array to track generated keyphrases (preserving duplicates for debugging)
let generatedKeyphrases: string[] = []


interface ExaResponse {
  results: Array<{
    title: string
    url: string
    text: string
    summary?: string
  }>
}

interface TopicExtractionResponse {
  topics: string[]
}

interface KeywordGenerationResponse {
  keywords: string[]
}

interface KeywordPromptsResponse {
  prompts: string[]
}

interface BrandNameResponse {
  brandName: string
}


// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})


// Exa.ai API configuration
const EXA_API_KEY = process.env.EXA_API_KEY
const EXA_BASE_URL = 'https://api.exa.ai'


/**
 * Fetch content from a URL using Exa.ai API
 */
async function getContentFromExa(url: string): Promise<string> {
  try {
    const response = await fetch(`${EXA_BASE_URL}/contents`, {
      method: 'POST',
      headers: {
        'x-api-key': EXA_API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        urls: [url],
        text: true,
        summary: true
      })
    })

    if (!response.ok) {
      throw new Error(`Exa API error: ${response.status}`)
    }

    const data: ExaResponse = await response.json()
    
    if (data.results && data.results.length > 0) {
      const result = data.results[0]
      // Combine text and summary for better context
      return `${result.title}\n\n${result.text}\n\n${result.summary || ''}`
    }
    
    throw new Error('No content found from Exa API')
  } catch (error) {
    console.error('Error fetching from Exa:', error)
    throw new Error(`Failed to fetch content: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Extract brand name from content using OpenAI
 */
async function extractBrandName(content: string): Promise<string> {
  try {
    const prompt = `
Analyze the following brand content and extract the main brand name. This should be the primary company or organization name that this content represents.

Requirements:
- Return only the brand name, no additional text
- If multiple brands are mentioned, return the primary/main one
- Return a clean, simple brand name (e.g., "Apple", "Microsoft", "Tesla")
- If no clear brand name can be identified, return "Unknown Brand"

Brand content:
${content.substring(0, 2000)} // Limit content to avoid token limits

Return the brand name in JSON format:
{"brandName": "Brand Name"}
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 200
    })

    const responseText = response.choices[0]?.message?.content
    if (!responseText) {
      return 'Unknown Brand'
    }

    // Clean and parse JSON response
    let cleanedResponse = responseText.trim()
    // Remove markdown code blocks if present
    cleanedResponse = cleanedResponse.replace(/```json\n?|\n?```/g, '')
    
    const parsed: BrandNameResponse = JSON.parse(cleanedResponse)
    return parsed.brandName || 'Unknown Brand'
  } catch (error) {
    console.error('Error extracting brand name:', error)
    return 'Unknown Brand'
  }
}

/**
 * Extract 4-6 main topics from brand content using OpenAI
 */
async function extractTopics(content: string): Promise<string[]> {
  try {
    const prompt = `
Analyze the following brand content and extract 4-6 main topics that best represent the major domains or themes, which are likely to appear in SEO searches.
Pay attention: 
- Do not include any brand name or any words related to any brand in the topics
- Only include topics relvant to the domain, industry, or products which the brand belongs to

Requirements:
- Each topic should be 1-4 words
- Topics should be broad enough to represent major domains or themes related to the brand and its products
- Focus on topics that would be searched for in SEO
- Return only the topics, one per line

Brand content:
${content.substring(0, 4000)} // Limit content to avoid token limits

Return the topics in JSON format:
{"topics": ["topic1", "topic2", "topic3", "topic4", "topic5", "topic6"]}
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500
    })

    const responseText = response.choices[0]?.message?.content
    if (!responseText) {
      throw new Error('No response from OpenAI')
    }

    // Clean and parse JSON response
    let cleanedResponse = responseText.trim()
    // Remove markdown code blocks if present
    cleanedResponse = cleanedResponse.replace(/```json\n?|\n?```/g, '')
    
    const parsed: TopicExtractionResponse = JSON.parse(cleanedResponse)
    return parsed.topics.slice(0, 6) // Ensure max 6 topics
  } catch (error) {
    console.error('Error extracting topics:', error)
    throw new Error(`Failed to extract topics: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Generate 10-15 SEO keywords for a given topic using OpenAI
 */
async function generateKeywordsForTopic(topic: string): Promise<string[]> {
  try {
    const prompt = `
Generate 10-15 SEO-style keywords or keyphrases relevant to the topic: "${topic}"

Requirements:
- Each keyword/keyphrase should be 1-3 words
- Do not include any brand name or any words related to any brand in the keywords
- Focus on terms people would actually search for
- Include variations, synonyms, and related terms
- Make them SEO-friendly and commercially relevant
- No duplicates
- Current year is 2025

Return the keywords in JSON format:
{"keywords": ["keyword1", "keyword2", ...]}
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 800
    })

    const responseText = response.choices[0]?.message?.content
    if (!responseText) {
      throw new Error('No response from OpenAI')
    }

    // Clean and parse JSON response
    let cleanedResponse = responseText.trim()
    // Remove markdown code blocks if present
    cleanedResponse = cleanedResponse.replace(/```json\n?|\n?```/g, '')
    
    const parsed: KeywordGenerationResponse = JSON.parse(cleanedResponse)
    return parsed.keywords
  } catch (error) {
    console.error('Error generating keywords:', error)
    throw new Error(`Failed to generate keywords for topic ${topic}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Generate prompts for multiple keywords in a single API call (batch processing)
 */
async function expandKeywordsToPrompts(keywords: string[]): Promise<string[]> {
  try {
    const keywordList = keywords.slice(0, 10).map((kw, i) => `${i + 1}. "${kw}"`).join('\n')
    
    const prompt = `
For each of the following keywords, generate 5 prompts that contain the keyword. The prompts should vary in length from the original keyword length to the original keyword length + 20 words.

Keywords:
${keywordList}

Pay attention:
- when you expand keywords to format the prompts, you should consider expand in the following directions:
- informational: using words such as how, what, who, where, why, guide, tutorial, resource, tips, examples, etc.
- commercial: using words such as best, vs, review, top, comparison, etc.
- transactional: using words such as buy, sale, order, purchase, shop, cheap, coupon, price, discount, product name, etc.




Requirements for each keyword:
- Include the original keyword as one of the prompts
- Each prompt should naturally include the keyword
- Make them realistic search queries or content prompts
- Vary from simple keyword to detailed descriptive phrases
- Keep prompts natural and searchable
- each keyword should be expanded to exactly 5 prompts including the original keyword
- Current year is 2025

Return ALL prompts as a simple JSON array (no nested structure):
{"prompts": ["keyword1", "expanded keyword1 version", "longer keyword1 search query", "keyword2", "keyword2 services", ...]}
`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 2000
    })

    const responseText = response.choices[0]?.message?.content
    if (!responseText) {
      return []
    }

    // Clean and parse JSON response
    let cleanedResponse = responseText.trim()
    // Remove markdown code blocks if present
    cleanedResponse = cleanedResponse.replace(/```json\n?|\n?```/g, '')
    
    const parsed = JSON.parse(cleanedResponse)
    return parsed.prompts || []
  } catch (error) {
    console.error('Error expanding keywords to prompts:', error)
    return [] // Return empty array on error to continue processing
  }
}


/**
 * Main API handler
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Reset global array for each request
    generatedKeyphrases = []
    
    // Extract URL parameter
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('url')
    
    if (!brandUrl) {
      return NextResponse.json({
        error: 'Missing required parameter: url'
      }, { status: 400 })
    }
    
    // Validate URL format
    try {
      new URL(brandUrl)
    } catch {
      return NextResponse.json({
        error: 'Invalid URL format'
      }, { status: 400 })
    }

    console.log('Starting prompt set generation for:', brandUrl)
    
    // Normalize URL for caching
    const normalizedUrl = normalizeUrl(brandUrl)
    console.log('Normalized URL:', normalizedUrl)
    
    // Check cache first
    console.log('Checking cache for existing prompts...')
    const cachedPrompts = await PromptCache.findByUrl(normalizedUrl)
    
    if (cachedPrompts) {
      console.log('Found cached prompts, returning cached data')
      return NextResponse.json(cachedPrompts.data, { status: 200 })
    }
    
    console.log('No cached data found, generating new prompts...')
    
    // Check for required API keys
    if (!EXA_API_KEY) {
      return NextResponse.json({
        error: 'Exa API key not configured'
      }, { status: 500 })
    }
    
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        error: 'OpenAI API key not configured'
      }, { status: 500 })
    }
    
    console.log(`Starting prompt set generation for: ${brandUrl}`)
    
    // Step 1: Get content from Exa.ai
    console.log('Step 1: Fetching content from Exa.ai...')
    const content = await getContentFromExa(brandUrl)
    
    // Step 2: Extract brand name
    console.log('Step 2: Extracting brand name...')
    const brandName = await extractBrandName(content)
    console.log(`Extracted brand name: ${brandName}`)
    
    // Step 3: Extract topics using OpenAI
    console.log('Step 3: Extracting topics...')
    const topics = await extractTopics(content)
    console.log(`Extracted ${topics.length} topics:`, topics)
    
    // Step 4: Generate keywords for each topic
    console.log('Step 4: Generating keywords for each topic...')
    const allKeywords: string[] = []
    
    for (const topic of topics) {
      try {
        console.log(`Generating keywords for topic: "${topic}"`)
        const keywords = await generateKeywordsForTopic(topic)
        allKeywords.push(...keywords)
        console.log(`Generated ${keywords.length} keywords for topic "${topic}":`, keywords.slice(0, 5))
      } catch (error) {
        console.error(`Failed to generate keywords for topic "${topic}":`, error)
        // Continue with other topics
      }
    }
    
    console.log(`Total initial keywords: ${allKeywords.length}`)
    
    // Step 5: Generate prompts for keywords in batches
    console.log('Step 5: Generating prompts for keywords in batches...')
    
    const batchSize = 10 // Process 10 keywords at a time
    
    for (let i = 0; i < allKeywords.length; i += batchSize) {
      const batch = allKeywords.slice(i, i + batchSize)
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}: ${batch.length} keywords`)
      console.log('Keywords:', batch.slice(0, 3), '...')
      
      try {
        const prompts = await expandKeywordsToPrompts(batch)
        console.log(`Generated ${prompts.length} prompts for batch`)
        
        // Add all prompts to the array
        prompts.forEach(prompt => {
          generatedKeyphrases.push(prompt)
        })
        
        console.log(`Current total prompts: ${generatedKeyphrases.length}`)
        
        // Small delay between batches to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        console.error(`Error processing batch:`, error)
        // Continue with next batch
      }
    }
    
    // Remove duplicates and convert to final array
    const finalPrompts = Array.from(new Set(generatedKeyphrases))
    
    console.log(`Total generated prompts (with duplicates): ${generatedKeyphrases.length}`)
    console.log(`Unique prompts after deduplication: ${finalPrompts.length}`)
    
    console.log(`Final result: ${finalPrompts.length} unique prompts generated`)
    
    // Prepare response data
    const responseData: PromptData = {
      success: true,
      brandUrl,
      brandName,
      topics,
      keywords: allKeywords,
      totalPrompts: finalPrompts.length,
      prompts: finalPrompts
    }
    
    // Cache the result for future requests
    await PromptCache.upsert(normalizedUrl, brandUrl, responseData)
    
    return NextResponse.json(responseData, { status: 200 })
    
  } catch (error) {
    console.error('Error in generate_prompt_set API:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  } finally {
    // Close MongoDB connection
    await closeDatabaseConnection()
  }
}
