'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Bot, Calendar, BarChart3, Download, Eye, EyeOff, ChevronDown, ChevronRight, RefreshCw, Globe } from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import LoadingSpinner from '@/components/LoadingSpinner'

// Type definitions
interface ContentSnippets {
  [normalizedDomain: string]: string[] // domain -> list of sentences
}

interface WebsiteContent {
  [dimension: string]: ContentSnippets // dimension -> websites with content snippets
}

interface AgentRecommendationContentDocument {
  _id?: string
  brandNames: string[]
  normalizedBrandUrls: string[]
  agentPlatform: string
  sampledTime: string | Date
  totalPrompts: number
  sampledPrompts: number
  callsPerPrompt: number
  websiteContent: WebsiteContent
}

interface ApiResponse {
  success: boolean
  data?: AgentRecommendationContentDocument
  error?: string
  message?: string
}

interface AllAgentRecommendationResponse {
  success: boolean
  data?: AgentRecommendationContentDocument[]
  error?: string
  total?: number
}

// Content dimensions with descriptions for better understanding
const CONTENT_DIMENSIONS_INFO = {
  'Functionality': 'What the product or brand does. Its core functions, features, what problem it solves.',
  'Quality': 'The standard or grade of the product: materials, build, craftsmanship, durability, excellence in execution.',
  'Performance / Reliability': 'How well the product delivers in real use: consistent performance, uptime, stability, dependability.',
  'Design & Aesthetic / Visual Identity': 'The visual look and style: form, color, shape, packaging, UI/UX style, art direction.',
  'Price / Value Proposition': 'What the customer gets for the price: cost-vs-benefits, whether premium, mid-tier, budget, value for money.',
  'Innovation / Technology': 'Novel aspects: what\'s new, what\'s advanced, technological edge, R&D, patents, first-mover, unique mechanism.',
  'Safety / Security / Privacy': 'How safe or secure the product or brand is: physical safety, data protection, privacy policies, compliance.',
  'Sustainability / Ethical Practices': 'Environmental friendliness, socially ethical sourcing, carbon footprint, fair trade, cruelty-free, community impact.',
  'Trustworthiness / Credibility': 'Evidence of trust: certifications, guarantees, third-party reviews, awards, endorsements, brand reputation.',
  'Core Values / Mission / Purpose': 'What the brand stands for: its raison d\'être, belief system, social mission, cultural or moral stance.',
  'Story / Origin / Anecdote': 'The narrative behind the brand: founder\'s story, how it started, pivotal moments, anecdotes that humanize the brand.',
  'Emotional Connection / Personality': 'The emotional tone, the "personality" of the brand: friendly, bold, compassionate, adventurous; how people feel about it.',
  'Differentiation / Unique Selling Proposition (USP)': 'What sets this brand/product apart from competitors: special features, niche focus, unique benefit no one else offers.',
  'User / Audience Identity & Experience': 'Who uses this product and how: user lifestyle, demographics, how it fits into their daily lives; UX, ease of use.',
  'After-Sales Support / Community / Loyalty': 'What happens after purchase: warranty/support, customer service, community building, loyalty programs, repeat engagement.'
}

export default function AgentRecommendationContentPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isCollapsed } = useNavigation()
  
  const [url, setUrl] = useState('')
  const [analysis, setAnalysis] = useState<AgentRecommendationContentDocument | null>(null)
  const [availableAnalyses, setAvailableAnalyses] = useState<AgentRecommendationContentDocument[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [error, setError] = useState('')
  const [expandedWebsites, setExpandedWebsites] = useState<{ [website: string]: boolean }>({})
  const [expandedDimensions, setExpandedDimensions] = useState<{ [key: string]: boolean }>({})
  const [selectedBrandUrl, setSelectedBrandUrl] = useState<string>('')

  // Handle authentication loading
  if (status === 'loading') {
    return <LoadingSpinner />
  }

  // Load available analyses on component mount
  useEffect(() => {
    loadAvailableAnalyses()
    
    // Check if there's a brandUrl parameter in the URL
    const urlParam = searchParams.get('brandUrl')
    if (urlParam) {
      setSelectedBrandUrl(urlParam)
      loadAnalysisForBrand(urlParam)
    }
  }, [searchParams])

  const loadAvailableAnalyses = async () => {
    setIsLoadingList(true)
    try {
      console.log('🔄 Loading available agent recommendation analyses...')
      
      const response = await fetch('/api/get_all_agent_recommendation_content')
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data: AllAgentRecommendationResponse = await response.json()
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch analyses')
      }

      console.log(`✅ Loaded ${data.data?.length || 0} agent recommendation analyses`)
      setAvailableAnalyses(data.data || [])
      
    } catch (error) {
      console.error('❌ Error loading agent recommendation analyses:', error)
      setError(error instanceof Error ? error.message : 'Failed to load analyses')
    } finally {
      setIsLoadingList(false)
    }
  }

  const loadAnalysisForBrand = async (brandUrl: string) => {
    setIsLoading(true)
    setError('')
    setAnalysis(null)

    try {
      console.log('🔍 Fetching agent recommendation content for:', brandUrl)
      
      const response = await fetch(`/api/get_agent_recommendation_content?url=${encodeURIComponent(brandUrl)}`)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data: ApiResponse = await response.json()
      
      if (!data.success) {
        throw new Error(data.error || data.message || 'Failed to fetch analysis')
      }

      if (!data.data) {
        throw new Error('No analysis data returned')
      }

      console.log('✅ Agent recommendation content retrieved successfully')
      setAnalysis(data.data)
      
      // Update URL parameters
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.set('brandUrl', brandUrl)
      window.history.pushState({}, '', newUrl.toString())
      
    } catch (error) {
      console.error('❌ Error fetching analysis:', error)
      setError(error instanceof Error ? error.message : 'Failed to fetch analysis')
    } finally {
      setIsLoading(false)
    }
  }

  const formatDateTime = useCallback((dateTime: string | Date | undefined): string => {
    if (!dateTime) return 'N/A'
    try {
      const date = typeof dateTime === 'string' ? new Date(dateTime) : dateTime
      if (isNaN(date.getTime())) return 'N/A'
      return date.toLocaleString()
    } catch {
      return 'N/A'
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!url.trim()) {
      setError('Please enter a brand URL')
      return
    }

    await loadAnalysisForBrand(url.trim())
  }

  const handleBrandSelect = (brandUrl: string) => {
    setSelectedBrandUrl(brandUrl)
    setUrl(brandUrl)
    loadAnalysisForBrand(brandUrl)
  }

  const toggleWebsite = (website: string) => {
    setExpandedWebsites(prev => ({
      ...prev,
      [website]: !prev[website]
    }))
  }

  const toggleDimension = (websiteDimensionKey: string) => {
    setExpandedDimensions(prev => ({
      ...prev,
      [websiteDimensionKey]: !prev[websiteDimensionKey]
    }))
  }

  const downloadData = () => {
    if (!analysis) return
    
    const dataStr = JSON.stringify(analysis, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `agent-recommendation-${analysis.brandNames.join('-')}-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Calculate summary statistics
  const getSummaryStats = () => {
    if (!analysis) return null
    
    const allDomains = new Set<string>()
    const allDimensions = new Set<string>()
    let totalSnippets = 0
    
    // Structure: dimension -> {domain -> snippets[]}
    Object.entries(analysis.websiteContent).forEach(([dimension, domains]) => {
      allDimensions.add(dimension)
      Object.entries(domains).forEach(([domain, snippetsData]) => {
        allDomains.add(domain)
        // Ensure snippets is an array before calling .length
        const snippets = Array.isArray(snippetsData) ? snippetsData : []
        totalSnippets += snippets.length
        
        // Debug logging for data structure issues
        if (!Array.isArray(snippetsData) && snippetsData !== undefined) {
          console.log(`⚠️ Unexpected snippets data in getSummaryStats for ${domain}:`, typeof snippetsData, snippetsData)
        }
      })
    })
    
    return {
      totalWebsites: allDomains.size,
      totalDimensions: allDimensions.size,
      totalSnippets: totalSnippets,
      dimensions: Array.from(allDimensions)
    }
  }

  const summaryStats = getSummaryStats()

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <SideNavigation />
      <div className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-3 py-6">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Agent Recommendation Content</h1>
                <p className="text-gray-600 mt-1">AI agent recommendations and content insights across 15 content dimensions</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Available Analyses Section */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Available Analyses</h2>
              <button
                onClick={loadAvailableAnalyses}
                disabled={isLoadingList}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingList ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
            
            {isLoadingList ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                <span className="ml-3 text-gray-600">Loading analyses...</span>
              </div>
            ) : availableAnalyses.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableAnalyses.map((analysisItem) => (
                  <div
                    key={analysisItem._id}
                    className={`border-2 rounded-lg p-4 cursor-pointer transition-all duration-200 ${
                      selectedBrandUrl === analysisItem.normalizedBrandUrls[0]
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                    }`}
                    onClick={() => handleBrandSelect(analysisItem.normalizedBrandUrls[0])}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <Bot className="w-5 h-5 text-purple-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{analysisItem.brandNames.join(', ')}</h3>
                        <p className="text-sm text-gray-600 truncate">{analysisItem.agentPlatform}</p>
                        <p className="text-xs text-gray-500">
                          {formatDateTime(analysisItem.sampledTime)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Analyses Available</h3>
                <p className="text-gray-600">
                  Run the analyze-agent-recommendation script to generate agent recommendation data.
                </p>
              </div>
            )}
          </div>

          {/* Manual URL Input Form */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Or Search by URL</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
                  Brand URL
                </label>
                <div className="flex space-x-3">
                  <div className="flex-1">
                    <input
                      type="url"
                      id="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                      disabled={isLoading}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-all duration-200"
                  >
                    {isLoading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                    <span>{isLoading ? 'Loading...' : 'Get Analysis'}</span>
                  </button>
                </div>
              </div>
              
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}
            </form>
          </div>

        {/* Analysis Results */}
        {analysis && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Bot className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{summaryStats?.totalWebsites || 0}</div>
                    <div className="text-sm text-gray-600">Domains Analyzed</div>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{summaryStats?.totalDimensions || 0}</div>
                    <div className="text-sm text-gray-600">Content Dimensions</div>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Search className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{summaryStats?.totalSnippets || 0}</div>
                    <div className="text-sm text-gray-600">Content Snippets</div>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Calendar className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-900">{analysis.brandNames.join(', ')}</div>
                    <div className="text-sm text-gray-600">Analyzed: {formatDateTime(analysis.sampledTime)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Content Analysis Results</h2>
                <button
                  onClick={downloadData}
                  className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
                >
                  <Download className="w-4 h-4" />
                  <span>Download JSON</span>
                </button>
              </div>
            </div>

            {/* Content Dimensions Display */}
            <div className="space-y-6">
              {Object.entries(analysis.websiteContent).map(([dimension, domains]) => {
                const isDimensionExpanded = expandedDimensions[dimension]
                const domainCount = Object.keys(domains).length
                const sentenceCount = Object.values(domains).reduce((sum, snippetsData) => {
                  // Ensure snippets is always an array
                  const snippets = Array.isArray(snippetsData) ? snippetsData : []
                  return sum + snippets.length
                }, 0)
                
                return (
                  <div key={dimension} className="bg-white rounded-xl shadow-lg overflow-hidden">
                    {/* Dimension Header */}
                    <div 
                      className="p-6 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                      onClick={() => toggleDimension(dimension)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-purple-100 rounded-lg">
                            <BarChart3 className="w-5 h-5 text-purple-600" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-gray-900">{dimension}</h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {CONTENT_DIMENSIONS_INFO[dimension as keyof typeof CONTENT_DIMENSIONS_INFO] || 'Content dimension analysis'}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">{domainCount} domains • {sentenceCount} sentences</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {isDimensionExpanded ? (
                            <EyeOff className="w-5 h-5 text-gray-400" />
                          ) : (
                            <Eye className="w-5 h-5 text-gray-400" />
                          )}
                          {isDimensionExpanded ? (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Domain Content */}
                    {isDimensionExpanded && (
                      <div className="p-6">
                        <div className="space-y-4">
                          {Object.entries(domains).map(([domain, snippetsData]) => {
                            const domainDimensionKey = `${dimension}-${domain}`
                            const isDomainExpanded = expandedDimensions[domainDimensionKey]
                            
                            // Ensure snippets is always an array
                            const snippets = Array.isArray(snippetsData) ? snippetsData : []
                            
                            // Debug logging for data structure issues
                            if (!Array.isArray(snippetsData) && snippetsData !== undefined) {
                              console.log(`⚠️ Unexpected snippets data for ${domain}:`, typeof snippetsData, snippetsData)
                            }
                            
                            return (
                              <div key={domain} className="border border-gray-200 rounded-lg overflow-hidden">
                                {/* Domain Header */}
                                <div 
                                  className="p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors duration-200"
                                  onClick={() => toggleDimension(domainDimensionKey)}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-3">
                                      <div className="p-2 bg-blue-100 rounded-lg">
                                        <Globe className="w-4 h-4 text-blue-600" />
                                      </div>
                                      <div>
                                        <h4 className="font-semibold text-gray-900">{domain}</h4>
                                        <p className="text-xs text-gray-500 mt-1">
                                          {snippets.length} sentences
                                        </p>
                                      </div>
                                    </div>
                                    {isDomainExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-gray-400" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-gray-400" />
                                    )}
                                  </div>
                                </div>

                                {/* Sentences Content */}
                                {isDomainExpanded && (
                                  <div className="p-4">
                                    <div className="space-y-2">
                                      {snippets.map((snippet, index) => (
                                        <div key={index} className="p-3 bg-gray-50 rounded-lg">
                                          <p className="text-sm text-gray-900">{snippet}</p>
                                        </div>
                                      ))}
                                      {snippets.length === 0 && (
                                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                          <p className="text-sm text-gray-700">No sentences found for this domain</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {Object.keys(analysis.websiteContent).length === 0 && (
              <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Content Found</h3>
                <p className="text-gray-600">
                  The analysis exists but contains no agent recommendation content data.
                </p>
              </div>
            )}
          </>
        )}

        {/* Empty State */}
        {!analysis && !isLoading && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Enter a Brand URL</h3>
            <p className="text-gray-600">
              Enter a brand URL above to view AI agent recommendations across 15 content dimensions.
            </p>
          </div>
        )}
        </main>
      </div>
    </div>
  )
}
