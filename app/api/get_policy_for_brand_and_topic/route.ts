import { NextRequest, NextResponse } from 'next/server'
import { SimpleWebContentCache } from '../../../lib/models/SimpleWebContentCache'
import { normalizeUrl } from '../../../lib/models/PromptCache'
import OpenAI from 'openai'

// Initialize OpenRouter client
let openrouter: OpenAI

function getOpenRouter(): OpenAI {
  if (!openrouter) {
    openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/your-repo",
        "X-Title": "GEO Policy Analysis API",
      }
    })
  }
  return openrouter
}

/**
 * Call the get_simple_web_content API to get merged domain content
 */
async function getSimpleWebContent(brandUrl: string): Promise<any> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/get_simple_web_content?brandUrl=${encodeURIComponent(brandUrl)}`)
    
    if (!response.ok) {
      throw new Error(`Failed to get simple web content: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (!data.success) {
      throw new Error('Failed to retrieve simple web content')
    }
    
    return data.data
  } catch (error) {
    console.error('Error calling get_simple_web_content API:', error)
    throw error
  }
}

/**
 * Generate policy analysis using OpenRouter GPT-4o
 */
async function generatePolicyAnalysis(
  brandUrl: string,
  topic: string,
  currentContent: any,
  recommendationContent: any
): Promise<string> {
  try {
    console.log(`🤖 Generating policy analysis for ${brandUrl} on topic: ${topic}`)
    
    // Extract brand name from URL
    const brandName = new URL(brandUrl).hostname.replace('www.', '').split('.')[0]
    const capitalizedBrandName = brandName.charAt(0).toUpperCase() + brandName.slice(1)
    
    const analysisPrompt = `
You are a digital marketing strategist specializing in brand visibility optimization. Analyze the following data to create a comprehensive policy report.

**BRAND**: ${capitalizedBrandName} (${brandUrl})
**TOPIC**: ${topic}

**CURRENT BRAND CONTENT** (from SimpleWebContentCache):
${JSON.stringify(currentContent, null, 2)}

**AI AGENT RECOMMENDATIONS** (from merged prompt responses):
${JSON.stringify(recommendationContent, null, 2)}

**TASK**: Generate a comprehensive policy report in markdown format following this exact structure:

# Brand Visibility Policy Report: ${capitalizedBrandName}

## 1. Brand Analysis
- **Overall Performance**: Analyze current visibility based on the content data. Estimate visibility percentage and compare to industry standards.
- **Topic Analysis**: Identify the main topics/themes the brand's existing content covers related to "${topic}".
- **Channel Analysis**: Analyze which domains/channels the brand currently has presence on based on the current content data.

## 2. Competitor Analysis  
- **Average Competitor Performance**: Based on the AI agent recommendations, estimate competitor visibility levels.
- **Topic Analysis**: Analyze what topics competitors are covering based on the recommendation content.
- **Channel Analysis**: Identify which channels/domains competitors are using based on the recommendation data.

## 3. Gap Analysis
- **Topic Gaps**: Compare current content vs recommendations to identify missing themes under "${topic}".
- **Channel Gaps**: Identify domains/channels present in recommendations but missing from current content.
- **Content Quality Gaps**: Identify where current content is weak compared to what AI agents recommend.

## 4. Strategy Recommendations (Prioritized)

### On-page
1. **New Content**: Suggest 3 specific new topics/content types based on gaps identified.
2. **Content Optimization**: Suggest 3 specific improvements to existing content.

### Off-page  
1. **Reddit**: Identify 3 specific Reddit opportunities based on recommendation data.
2. **Outreach**: Suggest 3 target domains/publications for collaboration based on recommendation channels.
3. **Other Public Channels**: Suggest 3 additional channel opportunities (Quora, Twitter, LinkedIn, etc.).

## 5. Implementation Priority
Rank the top 5 recommendations by impact and feasibility.

## 6. Success Metrics
Define specific KPIs to measure the success of these recommendations.

**IMPORTANT GUIDELINES**:
- Be specific and actionable in all recommendations
- Use actual data from the provided content structures
- Focus on the specified topic: "${topic}"
- Provide realistic percentage estimates based on content volume and quality
- Identify specific domains, content types, and opportunities
- Make recommendations data-driven based on the comparison between current and recommended content

Generate the complete markdown report now:
`

    const response = await getOpenRouter().chat.completions.create({
      model: 'openai/gpt-4o',
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.3,
      max_tokens: 3000
    })

    const markdownReport = response.choices[0].message.content || ''
    console.log(`✅ Generated policy analysis (${markdownReport.length} characters)`)
    
    return markdownReport
    
  } catch (error) {
    console.error('❌ Error generating policy analysis:', error)
    throw error
  }
}

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 API Request - Get Policy for Brand and Topic')
    
    const { searchParams } = new URL(request.url)
    const brandUrl = searchParams.get('brandUrl')
    const topic = searchParams.get('topic') || 'all'
    
    if (!brandUrl) {
      console.log('❌ Missing brandUrl parameter')
      return NextResponse.json(
        { error: 'brandUrl parameter is required' },
        { status: 400 }
      )
    }

    console.log(`🎯 Generating policy analysis for brand: ${brandUrl}`)
    console.log(`🏷️ Topic focus: ${topic}`)
    
    // Normalize the brand URL for consistent lookup
    const normalizedBrandUrl = normalizeUrl(brandUrl)
    console.log(`🔍 Searching for normalized URL: ${normalizedBrandUrl}`)
    
    // Step 1: Get current brand content from SimpleWebContentCache
    console.log(`📊 Step 1: Retrieving current brand content...`)
    let currentContent = null
    
    try {
      const currentAnalysis = await SimpleWebContentCache.findByBrandUrl(normalizedBrandUrl)
      if (currentAnalysis) {
        currentContent = {
          brandName: currentAnalysis.brandName,
          websiteContent: currentAnalysis.websiteContent,
          totalDomains: Object.keys(currentAnalysis.websiteContent).length,
          totalSentences: Object.values(currentAnalysis.websiteContent).reduce(
            (sum, domainContent) => sum + domainContent.sentences.length, 
            0
          ),
          sampledTime: currentAnalysis.sampledTime
        }
        console.log(`✅ Found current content: ${currentContent.totalDomains} domains, ${currentContent.totalSentences} sentences`)
      } else {
        console.log(`⚠️ No current brand content found in SimpleWebContentCache`)
        currentContent = {
          brandName: brandUrl,
          websiteContent: {},
          totalDomains: 0,
          totalSentences: 0,
          sampledTime: null
        }
      }
    } catch (error) {
      console.log(`⚠️ Error retrieving current content: ${error}`)
      currentContent = {
        brandName: brandUrl,
        websiteContent: {},
        totalDomains: 0,
        totalSentences: 0,
        sampledTime: null
      }
    }
    
    // Step 2: Get AI agent recommendations via get_simple_web_content API
    console.log(`🤖 Step 2: Retrieving AI agent recommendations...`)
    let recommendationContent = null
    
    try {
      recommendationContent = await getSimpleWebContent(brandUrl)
      console.log(`✅ Found recommendation content: ${recommendationContent.uniqueDomains} domains, ${recommendationContent.totalSentences} sentences`)
    } catch (error) {
      console.log(`❌ Error retrieving recommendation content: ${error}`)
      return NextResponse.json(
        { error: 'Failed to retrieve AI agent recommendations for this brand' },
        { status: 404 }
      )
    }
    
    // Step 3: Generate policy analysis using GPT-4o
    console.log(`📝 Step 3: Generating policy analysis...`)
    const policyReport = await generatePolicyAnalysis(
      brandUrl,
      topic,
      currentContent,
      recommendationContent
    )
    
    // Step 4: Prepare comprehensive response
    const responseData = {
      brandUrl,
      normalizedBrandUrl,
      topic,
      analysisTimestamp: new Date().toISOString(),
      currentContent: {
        totalDomains: currentContent.totalDomains,
        totalSentences: currentContent.totalSentences,
        domains: Object.keys(currentContent.websiteContent),
        sampledTime: currentContent.sampledTime
      },
      recommendationContent: {
        totalDomains: recommendationContent.uniqueDomains,
        totalSentences: recommendationContent.totalSentences,
        domains: Object.keys(recommendationContent.domainContent),
        totalPromptsProcessed: recommendationContent.totalPromptsProcessed
      },
      gapAnalysis: {
        missingDomains: Object.keys(recommendationContent.domainContent).filter(
          domain => !currentContent.websiteContent[domain]
        ),
        commonDomains: Object.keys(recommendationContent.domainContent).filter(
          domain => currentContent.websiteContent[domain]
        ),
        currentOnlyDomains: Object.keys(currentContent.websiteContent).filter(
          domain => !recommendationContent.domainContent[domain]
        )
      },
      policyReport: policyReport
    }
    
    console.log(`✅ Policy analysis complete!`)
    console.log(`📊 Gap Analysis Summary:`)
    console.log(`  - Missing domains: ${responseData.gapAnalysis.missingDomains.length}`)
    console.log(`  - Common domains: ${responseData.gapAnalysis.commonDomains.length}`)
    console.log(`  - Current-only domains: ${responseData.gapAnalysis.currentOnlyDomains.length}`)
    
    return NextResponse.json({
      success: true,
      data: responseData
    })

  } catch (error) {
    console.error('❌ Error generating policy analysis:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
