'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Bot, Calendar, BarChart3, Download, Eye, EyeOff, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedDomains, setExpandedDomains] = useState<{ [domain: string]: boolean }>({})
  const [expandedDimensions, setExpandedDimensions] = useState<{ [key: string]: boolean }>({})

  // Handle authentication loading
  if (status === 'loading') {
    return <LoadingSpinner />
  }

  // Load analysis from URL parameter on mount
  useEffect(() => {
    const urlParam = searchParams.get('brandUrl')
    if (urlParam) {
      setUrl(urlParam)
      loadAnalysisForBrand(urlParam)
    }
  }, [searchParams])

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

  const toggleDomain = (domain: string) => {
    setExpandedDomains(prev => ({
      ...prev,
      [domain]: !prev[domain]
    }))
  }

  const toggleDimension = (dimension: string) => {
    setExpandedDimensions(prev => ({
      ...prev,
      [dimension]: !prev[dimension]
    }))
  }

  const getSummaryStats = (analysis: AgentRecommendationContentDocument) => {
    const totalDomains = new Set(
      Object.values(analysis.websiteContent).flatMap(dimensionContent => Object.keys(dimensionContent))
    ).size
    
    const totalSnippets = Object.values(analysis.websiteContent).reduce((sum, dimensionContent) => 
      sum + Object.values(dimensionContent).reduce((dimSum, snippets) => 
        dimSum + snippets.length, 0), 0)
    
    const dimensionsWithContent = Object.keys(analysis.websiteContent).filter(
      dimension => Object.keys(analysis.websiteContent[dimension]).length > 0
    ).length

    return { totalDomains, totalSnippets, dimensionsWithContent }
  }

  const downloadAnalysis = () => {
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

  // Redirect to signin if not authenticated
  if (!session) {
    router.push('/auth/signin')
    return <LoadingSpinner />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        <SideNavigation />
        
        {/* Header */}
        <header className={`bg-white shadow-sm border-b transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                  <Bot className="w-8 h-8 text-purple-600" />
                  Agent Recommendation Content
                </h1>
                <p className="text-gray-600 mt-1">
                  Analyze AI agent recommendations and content insights for brands
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* URL Input Form */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Search Agent Recommendation Content</h2>
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <div className="flex items-center">
                      <div className="p-3 bg-purple-100 rounded-lg">
                        <Bot className="w-6 h-6 text-purple-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">Agent Platform</p>
                        <p className="text-lg font-bold text-gray-900">{analysis.agentPlatform}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <div className="flex items-center">
                      <div className="p-3 bg-blue-100 rounded-lg">
                        <BarChart3 className="w-6 h-6 text-blue-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">Total Snippets</p>
                        <p className="text-lg font-bold text-gray-900">{getSummaryStats(analysis).totalSnippets}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <div className="flex items-center">
                      <div className="p-3 bg-green-100 rounded-lg">
                        <BarChart3 className="w-6 h-6 text-green-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">Dimensions</p>
                        <p className="text-lg font-bold text-gray-900">{getSummaryStats(analysis).dimensionsWithContent}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <div className="flex items-center">
                      <div className="p-3 bg-orange-100 rounded-lg">
                        <Calendar className="w-6 h-6 text-orange-600" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">Analyzed</p>
                        <p className="text-lg font-bold text-gray-900">{formatDateTime(analysis.sampledTime)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Analysis Info */}
                <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-900">Analysis Information</h2>
                    <button
                      onClick={downloadAnalysis}
                      className="flex items-center space-x-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download JSON</span>
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <h3 className="font-semibold text-gray-700 mb-2">Brands Analyzed</h3>
                      <div className="space-y-1">
                        {analysis.brandNames.map((brandName, index) => (
                          <div key={index} className="text-sm text-gray-600">
                            <span className="font-medium">{brandName}</span>
                            <br />
                            <span className="text-xs text-gray-500">{analysis.normalizedBrandUrls[index]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="font-semibold text-gray-700 mb-2">Analysis Scope</h3>
                      <div className="space-y-1 text-sm text-gray-600">
                        <div>Total Prompts: <span className="font-medium">{analysis.totalPrompts}</span></div>
                        <div>Sampled Prompts: <span className="font-medium">{analysis.sampledPrompts}</span></div>
                        <div>Calls per Prompt: <span className="font-medium">{analysis.callsPerPrompt}</span></div>
                        <div>Total API Calls: <span className="font-medium">{analysis.sampledPrompts * analysis.callsPerPrompt}</span></div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="font-semibold text-gray-700 mb-2">Content Stats</h3>
                      <div className="space-y-1 text-sm text-gray-600">
                        <div>Domains: <span className="font-medium">{getSummaryStats(analysis).totalDomains}</span></div>
                        <div>Dimensions: <span className="font-medium">{getSummaryStats(analysis).dimensionsWithContent}</span></div>
                        <div>Total Snippets: <span className="font-medium">{getSummaryStats(analysis).totalSnippets}</span></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Content Dimensions */}
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-6">Content Dimensions Analysis</h2>
                  
                  <div className="space-y-4">
                    {Object.entries(analysis.websiteContent)
                      .filter(([dimension, content]) => Object.keys(content).length > 0)
                      .map(([dimension, content]) => (
                        <div key={dimension} className="border border-gray-200 rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggleDimension(dimension)}
                            className="w-full px-6 py-4 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors duration-200"
                          >
                            <div className="flex items-center space-x-3">
                              {expandedDimensions[dimension] ? 
                                <ChevronDown className="w-5 h-5 text-gray-500" /> :
                                <ChevronRight className="w-5 h-5 text-gray-500" />
                              }
                              <div className="text-left">
                                <h3 className="font-semibold text-gray-900">{dimension}</h3>
                                <p className="text-sm text-gray-600">
                                  {Object.keys(content).length} domains, {Object.values(content).reduce((sum, snippets) => sum + snippets.length, 0)} snippets
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  {CONTENT_DIMENSIONS_INFO[dimension as keyof typeof CONTENT_DIMENSIONS_INFO]}
                                </p>
                              </div>
                            </div>
                          </button>
                          
                          {expandedDimensions[dimension] && (
                            <div className="px-6 py-4 space-y-4">
                              {Object.entries(content).map(([domain, snippets]) => (
                                <div key={domain} className="border border-gray-100 rounded-lg overflow-hidden">
                                  <button
                                    onClick={() => toggleDomain(`${dimension}-${domain}`)}
                                    className="w-full px-4 py-3 bg-blue-50 hover:bg-blue-100 flex items-center justify-between transition-colors duration-200"
                                  >
                                    <div className="flex items-center space-x-2">
                                      {expandedDomains[`${dimension}-${domain}`] ? 
                                        <ChevronDown className="w-4 h-4 text-blue-600" /> :
                                        <ChevronRight className="w-4 h-4 text-blue-600" />
                                      }
                                      <span className="font-medium text-blue-900">{domain}</span>
                                      <span className="text-sm text-blue-700">({snippets.length} snippets)</span>
                                    </div>
                                  </button>
                                  
                                  {expandedDomains[`${dimension}-${domain}`] && (
                                    <div className="px-4 py-3 bg-white space-y-2">
                                      {snippets.map((snippet, index) => (
                                        <div key={index} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                          <p className="text-sm text-gray-700">{snippet}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    }
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
