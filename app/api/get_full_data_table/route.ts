import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { normalizeUrl } from '@/lib/models/PromptCache'

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Supported agentic platforms
const SUPPORTED_PLATFORMS = ['openai', 'google-ai'] as const
type AgenticPlatform = typeof SUPPORTED_PLATFORMS[number]

interface GeneratePromptSetResponse {
  success: boolean
  brandUrl: string
  brandName: string
  topics: string[]
  keywords: string[]
  totalPrompts: number
  prompts: string[]
}

interface AssistantResponse {
  text: string
}

interface AnalysisResult {
  normalizedBrandUrl: string
  agenticPlatform: AgenticPlatform
  prompt: string
  dateTime: string
  citationTimes: number
  totalCitationsOfAllBrands: number
  visibility: number
  emotion: 'positive' | 'negative' | 'neutral'
  otherBrands: string[]
  fullTextResponse: string
}

/**
 * Call the /generate_prompt_set API to get prompts and brand name
 */
async function getPromptSet(brandUrl: string): Promise<GeneratePromptSetResponse> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/generate_prompt_set?url=${encodeURIComponent(brandUrl)}`)
    
    if (!response.ok) {
      throw new Error(`Failed to get prompt set: ${response.status}`)
    }
    
    const data: GeneratePromptSetResponse = await response.json()
    
    if (!data.success) {
      throw new Error('Failed to generate prompt set')
    }
    
    return data
  } catch (error) {
    console.error('Error getting prompt set:', error)
    throw new Error(`Failed to get prompt set: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Call OpenAI with web search tool and return only text content
 */
async function callOpenAIAssistant(prompt: string): Promise<AssistantResponse> {
  try {
    console.log(`🔍 Making OpenAI call with web search for: "${prompt.substring(0, 50)}..."`)
    
    // Try using OpenAI's Responses API with web search tool
    try {
      const response = await openai.responses.create({
        model: 'gpt-4o',
        tools: [{ 
          type: 'web_search',
          search_context_size: 'high'
        }],
        input: prompt
      })
      
      console.log('🎯 OpenAI Responses API with web search successful')
      const textContent = (response as any).output_text || ''
      console.log('Response length:', textContent.length)
      
      return {
        text: textContent
      }
    } catch (responsesError) {
      console.log('⚠️ Responses API failed, falling back to chat completion with search instructions')
      
      // Fallback to chat completion with search-oriented prompting
      const chatResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant with access to current web information. Provide comprehensive, factual answers with current data from 2024-2025. Include specific brand names, companies, and detailed information when relevant.'
          },
          {
            role: 'user',
            content: `Please provide a detailed, comprehensive answer about: "${prompt}". Include current information, specific brand names, companies, and detailed examples. Focus on factual, up-to-date information.`
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
      
      const textContent = chatResponse.choices[0]?.message?.content || ''
      console.log('🎯 Chat completion fallback successful, response length:', textContent.length)
      
      return {
        text: textContent
      }
    }
  } catch (error) {
    console.error('Error calling OpenAI:', error)
    throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Call Google AI Assistant (placeholder)
 */
async function callGoogleAIAssistant(prompt: string): Promise<AssistantResponse> {
  throw new Error('Google AI integration not yet implemented. Please use "openai" platform.')
}

/**
 * Call the specified agentic platform
 */
async function callAgenticPlatform(platform: AgenticPlatform, prompt: string): Promise<AssistantResponse> {
  switch (platform) {
    case 'openai':
      return await callOpenAIAssistant(prompt)
    case 'google-ai':
      return await callGoogleAIAssistant(prompt)
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

/**
 * Use OpenAI with web search to analyze brand mentions, products, and trace to root brands
 */
async function analyzeBrandMentions(
  brandName: string,
  responseText: string
): Promise<{
  brandMentions: number
  totalCitationsOfAllBrands: number
  otherBrands: string[]
  emotion: 'positive' | 'negative' | 'neutral'
}> {
  try {
    console.log(`🔍 Analyzing brand mentions for: ${brandName}`)
    
    // Step 1: Use OpenAI with web search to identify all brands and find target brand match
    const brandAnalysisPrompt = `
Analyze the following text to identify ALL brand names, product names, and sub-brands mentioned, then trace them back to their root/umbrella brands. Also identify which root brand matches the target brand.

Target brand to find: "${brandName}"

Text to analyze:
${responseText}

Instructions:
1. Read through the text and find EVERY mention of:
   - Brand names (e.g., Apple, Samsung, Microsoft)
   - Product names (e.g., iPhone, Galaxy, MacBook, Windows)
   - Sub-brands (e.g., iOS, Android, Xbox)
   - Service names (e.g., iCloud, Google Drive, Office 365)

2. For each mention found, determine the ROOT/UMBRELLA brand that owns it:
   - iPhone, MacBook, iOS, iCloud → Apple
   - Galaxy, Android (Samsung version) → Samsung
   - Windows, Xbox, Office 365 → Microsoft
   - Chrome, Gmail, Google Drive → Google

3. Count the TOTAL mentions for each root brand (including all its products/sub-brands)

4. Do NOT count generic terms like "laptop", "smartphone", "computer", "software"

5. Identify which root brand (if any) matches the target brand "${brandName}".
   Consider variations like:
   - Different spellings or abbreviations
   - Parent company vs subsidiary names
   - Alternative brand names for the same company

Return ONLY a JSON object same as the following format:
{
  "rootBrandMentions": {
    "Apple": 5,
    "Samsung": 3,
    "Microsoft": 2
  },
  "targetBrandMatch": "Apple"
}

do not fabricate any information, only use the information provided in the provided text.
If there is no brand mentioned in the text, rootbrandmentions should be an empty object.

Set "targetBrandMatch" to the exact root brand name that matches "${brandName}", or null if no match.
`

    // Use web search to get accurate brand ownership information
    const brandAnalysisResponse = await openai.responses.create({
      model: 'gpt-4o',
      tools: [{ 
        type: 'web_search',
        search_context_size: 'high'
      }],
      input: brandAnalysisPrompt
    })

    console.log('🎯 Brand analysis with web search completed')
    
    // Extract response content
    let brandAnalysisText = ''
    const responseContent = (brandAnalysisResponse as any)
    
    if (responseContent.content && Array.isArray(responseContent.content)) {
      const outputTextItem = responseContent.content.find((item: any) => item.type === 'output_text')
      brandAnalysisText = outputTextItem?.text || ''
    } else {
      brandAnalysisText = responseContent.output_text || ''
    }

    console.log('Brand analysis response:', brandAnalysisText.substring(0, 500))

    // Parse the brand analysis results
    let rootBrandMentions: Record<string, number> = {}
    let targetBrandKey: string | null = null
    
    try {
      const cleanedResponse = brandAnalysisText.replace(/```json\n?|\n?```/g, '').trim()
      const parsed = JSON.parse(cleanedResponse)
      rootBrandMentions = parsed.rootBrandMentions || {}
      targetBrandKey = parsed.targetBrandMatch || null
    } catch (parseError) {
      console.error('Error parsing brand analysis response:', parseError)
      
      // Fallback: try to extract JSON from response
      const jsonMatch = brandAnalysisText.match(/\{[\s\S]*\}/g)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0])
          rootBrandMentions = parsed.rootBrandMentions || parsed || {}
          targetBrandKey = parsed.targetBrandMatch || null
        } catch (fallbackError) {
          console.error('Fallback parsing also failed:', fallbackError)
          
          // Final fallback: exact string matching
          const rootBrandKeys = Object.keys(rootBrandMentions)
          targetBrandKey = rootBrandKeys.find(
            brand => brand.toLowerCase() === brandName.toLowerCase()
          ) || null
        }
      }
    }

    console.log('Parsed root brand mentions:', rootBrandMentions)
    console.log(`Target brand matching result: "${brandName}" → "${targetBrandKey}"`)

    // Calculate metrics for the target brand
    const brandMentions = targetBrandKey ? rootBrandMentions[targetBrandKey] : 0

    // Calculate total mentions and other brands
    const totalMentionsAllBrands = Object.values(rootBrandMentions).reduce((sum, count) => sum + count, 0)
    const otherBrands = Object.keys(rootBrandMentions).filter(
      brand => brand !== targetBrandKey
    )

    console.log(`Target brand "${brandName}" mentions: ${brandMentions}`)
    console.log(`Total brand mentions: ${totalMentionsAllBrands}`)
    console.log(`Other brands found: ${otherBrands.join(', ')}`)

    // Step 2: Analyze emotion for the target brand
    const emotionPrompt = `
Analyze the following text for mentions of the brand "${brandName}" and its products/services.
Determine the overall emotion/sentiment when this brand is mentioned or discussed.

Text:
${responseText.substring(0, 2000)}

Return only one of these three emotions based on the overall sentiment:
- "positive" if the brand is mentioned favorably, with praise, or in a good context
- "negative" if the brand is mentioned unfavorably, with criticism, or in a bad context  
- "neutral" if the brand is mentioned factually without clear positive or negative sentiment

Return your answer in JSON format:
{"emotion": "positive|negative|neutral"}
`

    const emotionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: emotionPrompt }],
      temperature: 0.3,
      max_tokens: 100
    })

    let emotion: 'positive' | 'negative' | 'neutral' = 'neutral'
    try {
      const emotionText = emotionResponse.choices[0]?.message?.content?.trim() || '{"emotion": "neutral"}'
      const cleanedResponse = emotionText.replace(/```json\n?|\n?```/g, '')
      const parsed = JSON.parse(cleanedResponse)
      emotion = parsed.emotion || 'neutral'
    } catch {
      // Fallback parsing
      const emotionText = emotionResponse.choices[0]?.message?.content || ''
      if (emotionText.includes('positive')) emotion = 'positive'
      else if (emotionText.includes('negative')) emotion = 'negative'
      else emotion = 'neutral'
    }

    console.log(`Emotion analysis result: ${emotion}`)

    return {
      brandMentions,
      totalCitationsOfAllBrands: totalMentionsAllBrands,
      otherBrands,
      emotion
    }
  } catch (error) {
    console.error('Error analyzing brand mentions:', error)
    return {
      brandMentions: 0,
      totalCitationsOfAllBrands: 0,
      otherBrands: [],
      emotion: 'neutral'
    }
  }
}

/**
 * Main API handler
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Extract URL parameter
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('url')
    const agenticPlatform = searchParams.get('platform') || 'openai'
    
    if (!brandUrl) {
      return NextResponse.json({
        error: 'Missing required parameter: url'
      }, { status: 400 })
    }
    
    // Validate platform
    if (!SUPPORTED_PLATFORMS.includes(agenticPlatform as AgenticPlatform)) {
      return NextResponse.json({
        error: `Unsupported platform: ${agenticPlatform}. Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`
      }, { status: 400 })
    }
    
    console.log(`Starting full data table generation for: ${brandUrl} with platform: ${agenticPlatform}`)
    
    // Step 1: Get prompts and brand name
    console.log('Step 1: Getting prompt set...')
    const promptSet = await getPromptSet(brandUrl)
    const { brandName, prompts } = promptSet
    
    console.log(`Retrieved ${prompts.length} prompts for brand: ${brandName}`)
    
    // Step 2: Randomly sample 5 prompts
    const selectedPrompts = prompts.length <= 5 
      ? prompts 
      : prompts.sort(() => Math.random() - 0.5).slice(0, 5)
    console.log(`Randomly selected ${selectedPrompts.length} prompts for analysis`)
    
    // Step 3: Analyze each prompt
    const results: AnalysisResult[] = []
    const normalizedBrandUrl = normalizeUrl(brandUrl)
    
    for (let i = 0; i < selectedPrompts.length; i++) {
      const prompt = selectedPrompts[i]
      console.log(`Processing prompt ${i + 1}/${selectedPrompts.length}: "${prompt.substring(0, 50)}..."`)
      
      try {
        // Call agentic platform
        const assistantResponse = await callAgenticPlatform(agenticPlatform as AgenticPlatform, prompt)
        
        // Analyze brand mentions and emotion
        const analysis = await analyzeBrandMentions(brandName, assistantResponse.text)
        
        // Calculate visibility ratio
        const visibility = analysis.totalCitationsOfAllBrands > 0 
          ? analysis.brandMentions / analysis.totalCitationsOfAllBrands 
          : 0
        
        const result: AnalysisResult = {
          normalizedBrandUrl,
          agenticPlatform: agenticPlatform as AgenticPlatform,
          prompt,
          dateTime: new Date().toISOString(),
          citationTimes: analysis.brandMentions,
          totalCitationsOfAllBrands: analysis.totalCitationsOfAllBrands,
          visibility: Math.round(visibility * 10000) / 10000, // Round to 4 decimal places
          emotion: analysis.emotion,
          otherBrands: analysis.otherBrands,
          fullTextResponse: assistantResponse.text
        }
        
        results.push(result)
        console.log(`Completed analysis for prompt ${i + 1}: ${analysis.brandMentions} brand mentions, ${analysis.emotion} emotion`)
        
        // Small delay between requests to avoid rate limiting
        if (i < selectedPrompts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
        
      } catch (error) {
        console.error(`Error processing prompt ${i + 1}:`, error)
        
        // Create a fallback result
        const fallbackResult: AnalysisResult = {
          normalizedBrandUrl,
          agenticPlatform: agenticPlatform as AgenticPlatform,
          prompt,
          dateTime: new Date().toISOString(),
          citationTimes: 0,
          totalCitationsOfAllBrands: 0,
          visibility: 0,
          emotion: 'neutral',
          otherBrands: [],
          fullTextResponse: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
        
        results.push(fallbackResult)
      }
    }
    
    console.log(`Completed analysis of ${results.length} prompts`)
    
    return NextResponse.json(results, { status: 200 })
    
  } catch (error) {
    console.error('Error in get_full_data_table API:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
