'use client'

import { useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Search, Globe, Calendar, BarChart3, Download, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import LoadingSpinner from '@/components/LoadingSpinner'

// Type definitions
interface ContentSnippet {
  [snippet: string]: number
}

interface ContentDimension {
  [dimension: string]: ContentSnippet
}

interface WebsiteContent {
  [websiteUrl: string]: ContentDimension
}

interface FullWebContentDocument {
  _id?: string
  brandName: string
  brandUrl: string
  sampledTime: string | Date
  websiteContent: WebsiteContent
}

interface ApiResponse {
  success: boolean
  data?: FullWebContentDocument
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

export default function FullWebContentPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isCollapsed } = useNavigation()
  
  const [url, setUrl] = useState('')
  const [analysis, setAnalysis] = useState<FullWebContentDocument | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedWebsites, setExpandedWebsites] = useState<{ [website: string]: boolean }>({})
  const [expandedDimensions, setExpandedDimensions] = useState<{ [key: string]: boolean }>({})

  // Handle authentication loading
  if (status === 'loading') {
    return <LoadingSpinner />
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

    setIsLoading(true)
    setError('')
    setAnalysis(null)

    try {
      console.log('🔍 Fetching full web content for:', url)
      
      const response = await fetch(`/api/get_full_web_content?url=${encodeURIComponent(url.trim())}`)
      
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

      console.log('✅ Analysis retrieved successfully')
      setAnalysis(data.data)
      
    } catch (error) {
      console.error('❌ Error fetching analysis:', error)
      setError(error instanceof Error ? error.message : 'Failed to fetch analysis')
    } finally {
      setIsLoading(false)
    }
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
    link.download = `full-web-content-${analysis.brandName}-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Calculate summary statistics
  const getSummaryStats = () => {
    if (!analysis) return null
    
    const totalWebsites = Object.keys(analysis.websiteContent).length
    const allDimensions = new Set<string>()
    let totalSnippets = 0
    
    Object.values(analysis.websiteContent).forEach(site => {
      Object.keys(site).forEach(dimension => allDimensions.add(dimension))
      Object.values(site).forEach(dimension => {
        totalSnippets += Object.keys(dimension).length
      })
    })
    
    return {
      totalWebsites,
      totalDimensions: allDimensions.size,
      totalSnippets,
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
              <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl">
                <Globe className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Full Web Content Analysis</h1>
                <p className="text-gray-600 mt-1">Comprehensive brand analysis across 25+ websites and 15 content dimensions</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* URL Input Form */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
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
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    disabled={isLoading}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-all duration-200"
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
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Globe className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{summaryStats?.totalWebsites || 0}</div>
                    <div className="text-sm text-gray-600">Websites Analyzed</div>
                  </div>
                </div>
              </div>
              
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-purple-600" />
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
                    <div className="text-lg font-bold text-gray-900">{analysis.brandName}</div>
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

            {/* Website Content Display */}
            <div className="space-y-6">
              {Object.entries(analysis.websiteContent).map(([website, dimensions]) => {
                const isWebsiteExpanded = expandedWebsites[website]
                const dimensionCount = Object.keys(dimensions).length
                const snippetCount = Object.values(dimensions).reduce((sum, dim) => sum + Object.keys(dim).length, 0)
                
                return (
                  <div key={website} className="bg-white rounded-xl shadow-lg overflow-hidden">
                    {/* Website Header */}
                    <div 
                      className="p-6 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                      onClick={() => toggleWebsite(website)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-blue-100 rounded-lg">
                            <Globe className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-gray-900">{website}</h3>
                            <p className="text-sm text-gray-600">{dimensionCount} dimensions • {snippetCount} snippets</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {isWebsiteExpanded ? (
                            <EyeOff className="w-5 h-5 text-gray-400" />
                          ) : (
                            <Eye className="w-5 h-5 text-gray-400" />
                          )}
                          {isWebsiteExpanded ? (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Website Content */}
                    {isWebsiteExpanded && (
                      <div className="p-6">
                        <div className="space-y-4">
                          {Object.entries(dimensions).map(([dimension, snippets]) => {
                            const websiteDimensionKey = `${website}-${dimension}`
                            const isDimensionExpanded = expandedDimensions[websiteDimensionKey]
                            const snippetCount = Object.keys(snippets).length
                            const totalFrequency = Object.values(snippets).reduce((sum, freq) => sum + freq, 0)
                            
                            return (
                              <div key={dimension} className="border border-gray-200 rounded-lg overflow-hidden">
                                {/* Dimension Header */}
                                <div 
                                  className="p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors duration-200"
                                  onClick={() => toggleDimension(websiteDimensionKey)}
                                >
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <h4 className="font-semibold text-gray-900">{dimension}</h4>
                                      <p className="text-sm text-gray-600 mt-1">
                                        {CONTENT_DIMENSIONS_INFO[dimension as keyof typeof CONTENT_DIMENSIONS_INFO] || 'Content dimension analysis'}
                                      </p>
                                      <p className="text-xs text-gray-500 mt-1">
                                        {snippetCount} snippets • {totalFrequency} total frequency
                                      </p>
                                    </div>
                                    {isDimensionExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-gray-400" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-gray-400" />
                                    )}
                                  </div>
                                </div>

                                {/* Dimension Content */}
                                {isDimensionExpanded && (
                                  <div className="p-4">
                                    <div className="space-y-2">
                                      {Object.entries(snippets)
                                        .sort(([,a], [,b]) => b - a) // Sort by frequency descending
                                        .map(([snippet, frequency]) => (
                                        <div key={snippet} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                          <div className="flex-1 mr-4">
                                            <p className="text-sm text-gray-900">{snippet}</p>
                                          </div>
                                          <div className="flex-shrink-0">
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                              {frequency}x
                                            </span>
                                          </div>
                                        </div>
                                      ))}
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
                <Globe className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Content Found</h3>
                <p className="text-gray-600">
                  The analysis exists but contains no website content data.
                </p>
              </div>
            )}
          </>
        )}

        {/* Empty State */}
        {!analysis && !isLoading && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <Globe className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Enter a Brand URL</h3>
            <p className="text-gray-600">
              Enter a brand URL above to view its comprehensive web content analysis across 25+ websites and 15 content dimensions.
            </p>
          </div>
        )}
        </main>
      </div>
    </div>
  )
}
