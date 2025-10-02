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
 * Call the get_visibility_for_brand_and_topic API to get brand visibility metrics
 */
async function getBrandVisibility(brandUrl: string, topic: string): Promise<any> {
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const response = await fetch(`${baseUrl}/api/get_visibility_for_brand_and_topic?brandUrl=${encodeURIComponent(brandUrl)}&topic=${encodeURIComponent(topic)}`)
    
    if (!response.ok) {
      throw new Error(`Failed to get brand visibility: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (!data.success) {
      throw new Error('Failed to retrieve brand visibility')
    }
    
    return data.data
  } catch (error) {
    console.error('Error calling get_visibility_for_brand_and_topic API:', error)
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
  recommendationContent: any,
  visibilityData: any
): Promise<string> {
  try {
    console.log(`🤖 Generating policy analysis for ${brandUrl} on topic: ${topic}`)
    
    // Extract brand name from URL
    const brandName = new URL(brandUrl).hostname.replace('www.', '').split('.')[0]
    const capitalizedBrandName = brandName.charAt(0).toUpperCase() + brandName.slice(1)
    
    const analysisPrompt = `
You are a digital marketing strategist specializing in brand visibility optimization. You must generate a policy report in STRICT MARKDOWN FORMAT.

**BRAND**: ${capitalizedBrandName} (${brandUrl})
**TOPIC**: ${topic}

**CURRENT BRAND CONTENT** (from SimpleWebContentCache):
${JSON.stringify(currentContent, null, 2)}

**AI AGENT RECOMMENDATIONS** (from merged prompt responses):
${JSON.stringify(recommendationContent, null, 2)}

**BRAND VISIBILITY METRICS** (calculated from AI agent responses):
${JSON.stringify(visibilityData, null, 2)}

**CRITICAL FORMATTING REQUIREMENTS**:
1. Use ONLY standard markdown syntax
2. Headers must start with # (no spaces before #)
3. Use - for bullet points (not * or +)
4. Bold text must use **text** format
5. Each section must be separated by exactly one blank line
6. Do NOT wrap the response in code blocks
7. Do NOT use any HTML tags
8. Start directly with the main header

**REQUIRED STRUCTURE** (follow this EXACT format):

# Brand Visibility Policy Report: ${capitalizedBrandName}

## 1. Brand Analysis

- **Overall Performance**: [Use the BRAND VISIBILITY METRICS data - report the actual visibility percentage, brand appearances, and filtered prompts. Compare with industry benchmarks]
- **Topic Analysis**: [Examine the actual topics/themes in the brand's existing websiteContent data]
- **Channel Analysis**: [List the specific domains from the current content data with sentence counts]

## 2. Competitor Analysis

- **Average Competitor Performance**: [Analyze competitor brands mentioned in the recommendation content - identify competing companies and their visibility metrics]
- **Topic Analysis**: [Examine what topics and themes competitors are covering based on the recommendation sentences]
- **Channel Analysis**: [List the domains and channels where competitors have strong presence based on the recommendation data]

## 3. Gap Analysis

- **Topic Gaps**: [Compare actual content themes between current vs recommendation data]
- **Channel Gaps**: [List specific domains present in recommendations but missing from current content]
- **Content Quality Gaps**: [Compare sentence quality and quantity between the two datasets]

## 4. Strategy Recommendations (Prioritized)

### On-page

1. **New Content**: [Analyze recommendationContent to identify HIGH-VISIBILITY content styles, sentence structures, and sub-topics for "${topic}". Create 3-5 NEW sentences about ${capitalizedBrandName} that MIMIC these high-performing styles and address high-visibility sub-topics. Focus on ${capitalizedBrandName} and "${topic}" using proven visibility patterns from the data]
2. **Content Optimization**: [Identify high-visibility sentence styles and sub-topics in recommendationContent for "${topic}". Rewrite 3-5 existing ${capitalizedBrandName} sentences to match these high-performing patterns, showing before/after examples that adopt successful visibility strategies while promoting ${capitalizedBrandName}]

### Off-page

1. **Reddit**: [Recommend reddit subreddits that are relevant to "${topic}". Create 2-3 NEW posts about ${capitalizedBrandName} and "${topic}" that adopt these successful visibility strategies while promoting ${capitalizedBrandName} for "${topic}" use cases]
2. **Outreach**: [PRIORITY ORDER based on VISIBILITY INTELLIGENCE: 1) Target public media domains in recommendationContent(ignore those that are company-specific), 2) Consider LARGE_SITE_LIST domains, 3) Suggest additional high-visibility public media. Create 2-3 ${capitalizedBrandName} article pitches about "${topic}" using high-performing content styles from recommendationContent]
3. **Other Public Channels**: [Prioritize public media platforms in recommendationContent (ignore those that are company-specific). For each platform, suggest ${capitalizedBrandName} content about "${topic}" that mimics successful sentence structures and sub-topics from the visibility data]

## 5. Implementation Priority

1. [Your #1 priority based on data analysis with specific reasoning]
2. [Your #2 priority based on data analysis with specific reasoning]
3. [Your #3 priority based on data analysis with specific reasoning]
4. [Your #4 priority based on data analysis with specific reasoning]
5. [Your #5 priority based on data analysis with specific reasoning]

## 6. Success Metrics

- [Specific metric based on current content gaps]
- [Specific metric based on domain expansion opportunities]
- [Specific metric based on content quality improvements]
- [Specific metric based on topic coverage gaps]
- [Specific metric based on channel diversification needs]

**CRITICAL ANALYSIS INSTRUCTIONS**:
- ANALYZE the actual data provided - do NOT copy template text
- USE the BRAND VISIBILITY METRICS for overall performance analysis - report the exact visibility percentage
- CALCULATE real metrics from the currentContent and recommendationContent data structures
- COMPARE the two datasets to identify genuine gaps and opportunities
- EXTRACT specific domain names, sentence counts, and content themes from the data
- IDENTIFY competitor brand names mentioned in the recommendation content sentences
- GENERATE your own insights based on data differences, not generic advice
- FOCUS EXCLUSIVELY on the topic "${topic}" when analyzing content relevance - ignore unrelated themes
- PROVIDE concrete numbers and percentages from the actual data provided
- CREATE actionable recommendations based on your data analysis findings
- USE recommendationContent as VISIBILITY INTELLIGENCE: identify which domains have most sentences (high visibility), which content styles appear frequently (proven patterns), which sub-topics get coverage (successful themes)
- ALWAYS CREATE NEW CONTENT ABOUT ${capitalizedBrandName} AND "${topic}" ONLY - DO NOT copy sentences from recommendationContent
- MIMIC HIGH-PERFORMING PATTERNS from recommendationContent: sentence structures, content styles, sub-topics that show strong visibility
- PRIORITIZE domains and platforms based on their visibility performance in recommendationContent data
- TARGET ONLY PUBLIC MEDIA AND PLATFORMS for outreach - avoid company-specific websites
- ENSURE ALL RECOMMENDATIONS promote ${capitalizedBrandName} for "${topic}" using proven visibility strategies from the data

**DATA TO ANALYZE**:
- visibilityData: Contains actual brand visibility percentage, brand appearances, filtered prompts, and brand names
- currentContent.websiteContent: Contains domains and their sentence arrays
- recommendationContent.domainContent: Contains domains and their sentence arrays  
- For competitor analysis: Look for competitor brand names mentioned in the recommendation sentences
- Compare these structures to find gaps, overlaps, and opportunities
- LARGE_SITE_LIST for outreach prioritization: wikipedia.org, youtube.com, reddit.com, quora.com, instagram.com, tiktok.com, x.com, linkedin.com, forbes.com, medium.com, g2.com

**CONTENT CREATION METHODOLOGY**:
1. **Visibility Intelligence Analysis**: Analyze recommendationContent to identify:
   - Domains with highest sentence counts (proven high visibility)
   - Most frequent content styles and sentence structures (successful patterns)
   - Common sub-topics and themes (high-performing content areas)
   - Successful content formats and approaches
2. **Brand-Topic Creation**: Write NEW content about ${capitalizedBrandName} specifically for "${topic}" that adopts these high-visibility patterns
3. **Pattern Adoption**: Use proven sentence structures, content styles, and sub-topic approaches from recommendationContent but focus ONLY on ${capitalizedBrandName} and "${topic}"
4. **Channel Prioritization**: For outreach recommendations, prioritize based on VISIBILITY PERFORMANCE:
   - FIRST: Domains with highest sentence counts in recommendationContent (proven visibility)
   - SECOND: LARGE_SITE_LIST domains with visibility potential
   - THIRD: Additional high-visibility public media platforms
5. **Visibility-Driven Promotion**: Every recommendation must promote ${capitalizedBrandName} for "${topic}" using proven high-visibility content strategies
6. **Strategic Content Creation**: Never copy sentences from recommendationContent - create original ${capitalizedBrandName} and "${topic}" content using successful visibility patterns
7. **Performance-Based Boundaries**: Stay within "${topic}" scope while adopting high-performing content strategies from the visibility data

RESPOND WITH ONLY THE MARKDOWN CONTENT - NO EXPLANATIONS, NO CODE BLOCKS, NO ADDITIONAL TEXT.
`

    let markdownReport = ''
    let attempt = 1
    const maxAttempts = 2
    
    while (attempt <= maxAttempts) {
      console.log(`🤖 Generating policy analysis (attempt ${attempt}/${maxAttempts})...`)
      
      const response = await getOpenRouter().chat.completions.create({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: analysisPrompt }],
        temperature: attempt === 1 ? 0.1 : 0.3, // Lower temperature for first attempt
        max_tokens: 3000
      })

      markdownReport = response.choices[0].message.content || ''
      
      // Clean the markdown content to ensure proper parsing
      markdownReport = markdownReport
        .replace(/^```markdown\s*\n?/i, '') // Remove opening markdown code block
        .replace(/^```\s*\n?/i, '') // Remove opening code block
        .replace(/\n?```\s*$/i, '') // Remove closing code block
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/\r/g, '\n') // Convert remaining \r to \n
        .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines to max 2
        .trim()
      
      // Comprehensive markdown validation
      const hasMainHeader = /^# Brand Visibility Policy Report:/m.test(markdownReport)
      const hasSubHeaders = /^## \d+\./m.test(markdownReport)
      const hasListItems = /^[-*+]\s/m.test(markdownReport)
      const hasBoldText = /\*\*.*?\*\*/m.test(markdownReport)
      const hasNumberedLists = /^\d+\.\s/m.test(markdownReport)
      const startsCorrectly = markdownReport.startsWith('# Brand Visibility Policy Report:')
      const hasRequiredSections = [
        'Brand Analysis',
        'Competitor Analysis', 
        'Gap Analysis',
        'Strategy Recommendations',
        'Implementation Priority',
        'Success Metrics'
      ].every(section => markdownReport.includes(section))
      
      const validationScore = [
        hasMainHeader,
        hasSubHeaders,
        hasListItems,
        hasBoldText,
        hasNumberedLists,
        startsCorrectly,
        hasRequiredSections
      ].filter(Boolean).length
      
      console.log(`📝 Markdown validation (attempt ${attempt}):`)
      console.log(`  - Main header: ${hasMainHeader}`)
      console.log(`  - Sub headers: ${hasSubHeaders}`)
      console.log(`  - List items: ${hasListItems}`)
      console.log(`  - Bold text: ${hasBoldText}`)
      console.log(`  - Numbered lists: ${hasNumberedLists}`)
      console.log(`  - Starts correctly: ${startsCorrectly}`)
      console.log(`  - Required sections: ${hasRequiredSections}`)
      console.log(`  - Validation score: ${validationScore}/7`)
      console.log(`  - Content length: ${markdownReport.length} characters`)
      
      // If validation passes or we're on the last attempt, use this result
      if (validationScore >= 5 || attempt === maxAttempts) {
        if (validationScore >= 5) {
          console.log(`✅ Markdown validation passed on attempt ${attempt}`)
        } else {
          console.warn(`⚠️ Using result from attempt ${attempt} despite validation issues`)
        }
        break
      }
      
      console.log(`❌ Markdown validation failed on attempt ${attempt}, retrying...`)
      attempt++
    }
    
    console.log(`📝 Final report preview: ${markdownReport.substring(0, 200)}...`)
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
    
    // Step 3: Get brand visibility metrics
    console.log(`📊 Step 3: Calculating brand visibility metrics...`)
    let visibilityData = null
    
    try {
      visibilityData = await getBrandVisibility(brandUrl, topic)
      console.log(`✅ Brand visibility: ${(visibilityData.visibility * 100).toFixed(2)}% (${visibilityData.brandAppearances}/${visibilityData.filteredPrompts} prompts)`)
    } catch (error) {
      console.log(`⚠️ Error retrieving brand visibility: ${error}`)
      // Continue without visibility data - it's not critical for policy generation
      visibilityData = {
        visibility: 0,
        totalPrompts: 0,
        filteredPrompts: 0,
        brandAppearances: 0,
        brandNames: []
      }
    }
    
    // Step 4: Generate policy analysis using GPT-4o
    console.log(`📝 Step 4: Generating policy analysis...`)
    const policyReport = await generatePolicyAnalysis(
      brandUrl,
      topic,
      currentContent,
      recommendationContent,
      visibilityData
    )
    
    // Step 5: Prepare comprehensive response
    const responseData = {
      brandUrl,
      normalizedBrandUrl,
      topic,
      analysisTimestamp: new Date().toISOString(),
      visibilityMetrics: {
        visibility: visibilityData.visibility,
        visibilityPercentage: (visibilityData.visibility * 100).toFixed(2),
        brandAppearances: visibilityData.brandAppearances,
        filteredPrompts: visibilityData.filteredPrompts,
        totalPrompts: visibilityData.totalPrompts,
        brandNames: visibilityData.brandNames
      },
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
          domain => !currentContent.websiteContent || !(currentContent.websiteContent as any)[domain]
        ),
        commonDomains: Object.keys(recommendationContent.domainContent).filter(
          domain => currentContent.websiteContent && (currentContent.websiteContent as any)[domain]
        ),
        currentOnlyDomains: currentContent.websiteContent ? Object.keys(currentContent.websiteContent).filter(
          domain => !recommendationContent.domainContent[domain]
        ) : []
      },
      policyReport: policyReport
    }
    
    console.log(`✅ Policy analysis complete!`)
    console.log(`📊 Brand Visibility Summary:`)
    console.log(`  - Brand visibility: ${responseData.visibilityMetrics.visibilityPercentage}%`)
    console.log(`  - Brand appearances: ${responseData.visibilityMetrics.brandAppearances}/${responseData.visibilityMetrics.filteredPrompts} prompts`)
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
