'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Globe, Calendar, BarChart3, Download, Eye, EyeOff, ChevronDown, ChevronRight, RefreshCw, Wand2, Lightbulb, Sparkles } from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import LoadingSpinner from '@/components/LoadingSpinner'

// Type definitions
interface ContentSnippets {
  [normalizedDomain: string]: {
    sentences: string[] // list of original sentences
    visibility: number  // floating number, default 0
    modifiedSentences?: string[] // list of modified sentences (for training)
    modifiedVisibility?: number  // floating number, default 0 (for modified sentences)
    modificationSuggestions?: string // modification suggestions from policy model
  } | string[] // Backward compatibility: old format was just string[]
}

interface WebsiteContent {
  [dimension: string]: ContentSnippets // dimension -> websites with content snippets
}

interface FullWebContentDocument {
  _id?: string
  brandName: string
  brandUrl: string
  normalizedBrandUrl: string
  sampledTime: string | Date
  websiteContent: WebsiteContent
}

interface ApiResponse {
  success: boolean
  data?: FullWebContentDocument
  error?: string
  message?: string
}

interface AllWebContentResponse {
  success: boolean
  data?: FullWebContentDocument[]
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

export default function FullWebContentPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isCollapsed } = useNavigation()
  
  const [url, setUrl] = useState('')
  const [analysis, setAnalysis] = useState<FullWebContentDocument | null>(null)
  const [availableAnalyses, setAvailableAnalyses] = useState<FullWebContentDocument[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [error, setError] = useState('')
  const [expandedWebsites, setExpandedWebsites] = useState<{ [website: string]: boolean }>({})
  const [expandedDimensions, setExpandedDimensions] = useState<{ [key: string]: boolean }>({})
  const [selectedBrandUrl, setSelectedBrandUrl] = useState<string>('')
  const [showModifications, setShowModifications] = useState<{ [key: string]: boolean }>({})
  const [loadingModifications, setLoadingModifications] = useState<{ [key: string]: boolean }>({})
  const [modificationData, setModificationData] = useState<{ [key: string]: { suggestions: string, modifiedSentences: string[] } }>({})

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
      console.log('🔄 Loading available web content analyses...')
      
      const response = await fetch('/api/get_all_web_content')
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data: AllWebContentResponse = await response.json()
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch analyses')
      }

      console.log(`✅ Loaded ${data.data?.length || 0} analyses`)
      setAvailableAnalyses(data.data || [])
      
    } catch (error) {
      console.error('❌ Error loading analyses:', error)
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
      console.log('🔍 Fetching analysis for:', brandUrl)
      
      const response = await fetch(`/api/get_full_web_content?url=${encodeURIComponent(brandUrl)}`)
      
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

  const generateModifications = async (sentences: string[], dimension: string, domain: string, brandName: string) => {
    const key = `${dimension}-${domain}`
    
    // Check if we already have the data stored in the database
    if (analysis?.websiteContent[dimension]?.[domain] && !Array.isArray(analysis.websiteContent[dimension][domain])) {
      const domainData = analysis.websiteContent[dimension][domain] as any
      if (domainData.modificationSuggestions && domainData.modifiedSentences) {
        setModificationData(prev => ({
          ...prev,
          [key]: {
            suggestions: domainData.modificationSuggestions,
            modifiedSentences: domainData.modifiedSentences
          }
        }))
        setShowModifications(prev => ({ ...prev, [key]: true }))
        return
      }
    }
    
    setLoadingModifications(prev => ({ ...prev, [key]: true }))
    
    try {
      // Call the inference API to generate modifications
      const response = await fetch('/api/inference', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'generate',
          sentences: sentences,
          dimension: dimension,
          domain: domain,
          brand_name: brandName
        })
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to generate modifications')
      }
      
      // Store the modification data
      setModificationData(prev => ({
        ...prev,
        [key]: {
          suggestions: data.suggestions || 'No suggestions generated',
          modifiedSentences: data.modifiedSentences || sentences
        }
      }))
      
      // Show the modifications
      setShowModifications(prev => ({ ...prev, [key]: true }))
      
    } catch (error) {
      console.error('Error generating modifications:', error)
      // Show error state but still allow toggling
      setModificationData(prev => ({
        ...prev,
        [key]: {
          suggestions: `Error generating suggestions: ${error instanceof Error ? error.message : 'Unknown error'}`,
          modifiedSentences: sentences
        }
      }))
      setShowModifications(prev => ({ ...prev, [key]: true }))
    } finally {
      setLoadingModifications(prev => ({ ...prev, [key]: false }))
    }
  }

  const toggleModifications = (dimension: string, domain: string, sentences: string[], brandName: string) => {
    const key = `${dimension}-${domain}`
    
    if (showModifications[key]) {
      // Hide modifications
      setShowModifications(prev => ({ ...prev, [key]: false }))
    } else {
      // Show modifications - generate if not already available
      if (!modificationData[key]) {
        generateModifications(sentences, dimension, domain, brandName)
      } else {
        setShowModifications(prev => ({ ...prev, [key]: true }))
      }
    }
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
    
    const allDomains = new Set<string>()
    const allDimensions = new Set<string>()
    let totalSentences = 0
    
    // Structure: dimension -> {domain -> {sentences: [], visibility: number} | string[]} (with backward compatibility)
    Object.entries(analysis.websiteContent).forEach(([dimension, domains]) => {
      allDimensions.add(dimension)
      Object.entries(domains).forEach(([domain, domainData]) => {
        allDomains.add(domain)
        // Handle both old (string[]) and new ({sentences: [], visibility: number}) formats
        if (Array.isArray(domainData)) {
          totalSentences += domainData.length
        } else {
          totalSentences += domainData.sentences?.length || 0
        }
      })
    })
    
    return {
      totalWebsites: allDomains.size,
      totalDimensions: allDimensions.size,
      totalSnippets: totalSentences,
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-3 text-gray-600">Loading analyses...</span>
              </div>
            ) : availableAnalyses.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableAnalyses.map((analysisItem) => (
                  <div
                    key={analysisItem._id}
                    className={`border-2 rounded-lg p-4 cursor-pointer transition-all duration-200 ${
                      selectedBrandUrl === analysisItem.brandUrl
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                    }`}
                    onClick={() => handleBrandSelect(analysisItem.brandUrl)}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <Globe className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{analysisItem.brandName}</h3>
                        <p className="text-sm text-gray-600 truncate">{analysisItem.brandUrl}</p>
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
                <Globe className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Analyses Available</h3>
                <p className="text-gray-600">
                  Run the analyze-web-content script to generate brand analysis data.
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
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      disabled={isLoading}
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

            {/* Content Dimensions Display */}
            <div className="space-y-6">
              {Object.entries(analysis.websiteContent).map(([dimension, domains]) => {
                const isDimensionExpanded = expandedWebsites[dimension]
                const domainCount = Object.keys(domains).length
                const sentenceCount = Object.values(domains).reduce((sum, domainData) => {
                  // Handle both old (string[]) and new ({sentences: [], visibility: number}) formats
                  if (Array.isArray(domainData)) {
                    return sum + domainData.length
                  } else {
                    return sum + (domainData.sentences?.length || 0)
                  }
                }, 0)
                
                return (
                  <div key={dimension} className="bg-white rounded-xl shadow-lg overflow-hidden">
                    {/* Dimension Header */}
                    <div 
                      className="p-6 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                      onClick={() => toggleWebsite(dimension)}
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
                          {Object.entries(domains).map(([domain, domainData]) => {
                            const domainDimensionKey = `${dimension}-${domain}`
                            const isDomainExpanded = expandedDimensions[domainDimensionKey]
                            
                            // Handle both old (string[]) and new ({sentences: [], visibility: number}) formats
                            const isOldFormat = Array.isArray(domainData)
                            const sentences = isOldFormat ? domainData : domainData.sentences
                            const visibility = isOldFormat ? 0 : domainData.visibility
                            const modifiedSentences = isOldFormat ? [] : (domainData.modifiedSentences || [])
                            const modifiedVisibility = isOldFormat ? 0 : (domainData.modifiedVisibility || 0)
                            const modificationSuggestions = isOldFormat ? '' : (domainData.modificationSuggestions || '')
                            
                            const modificationKey = `${dimension}-${domain}`
                            const isModificationLoading = loadingModifications[modificationKey]
                            const isModificationVisible = showModifications[modificationKey]
                            const hasStoredModifications = modificationSuggestions && modifiedSentences.length > 0
                            const currentModificationData = modificationData[modificationKey]
                            
                            return (
                              <div key={domain} className="border border-gray-200 rounded-lg overflow-hidden">
                                {/* Domain Header */}
                                <div className="p-4 bg-gray-50">
                                  <div className="flex items-center justify-between">
                                    <div 
                                      className="flex items-center space-x-3 cursor-pointer hover:bg-gray-100 rounded-lg p-2 -m-2 transition-colors duration-200 flex-1"
                                      onClick={() => toggleDimension(domainDimensionKey)}
                                    >
                                      <div className="p-2 bg-blue-100 rounded-lg">
                                        <Globe className="w-4 h-4 text-blue-600" />
                                      </div>
                                      <div className="flex-1">
                                        <h4 className="font-semibold text-gray-900">{domain}</h4>
                                        <p className="text-xs text-gray-500 mt-1">
                                          {sentences.length} sentences{!isOldFormat && ` • Visibility: ${(visibility * 100).toFixed(1)}%`}
                                          {isOldFormat && ' • Legacy format (no visibility data)'}
                                          {hasStoredModifications && ` • Has modifications`}
                                        </p>
                                      </div>
                                      {isDomainExpanded ? (
                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                      ) : (
                                        <ChevronRight className="w-4 h-4 text-gray-400" />
                                      )}
                                    </div>
                                    
                                    {/* Modification Button */}
                                    {sentences.length > 0 && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          toggleModifications(dimension, domain, sentences, analysis?.brandName || 'Unknown Brand')
                                        }}
                                        disabled={isModificationLoading}
                                        className={`ml-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                                          isModificationVisible
                                            ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                                      >
                                        {isModificationLoading ? (
                                          <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                                            <span>Generating...</span>
                                          </>
                                        ) : isModificationVisible ? (
                                          <>
                                            <EyeOff className="w-4 h-4" />
                                            <span>Hide Modifications</span>
                                          </>
                                        ) : (
                                          <>
                                            <Wand2 className="w-4 h-4" />
                                            <span>Show Modifications</span>
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Sentences Content */}
                                {isDomainExpanded && (
                                  <div className="p-4 space-y-4">
                                    {/* Original Sentences Panel */}
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                      <div className="flex items-center space-x-2 mb-3">
                                        <Globe className="w-4 h-4 text-blue-600" />
                                        <h5 className="font-semibold text-blue-900">Original Sentences</h5>
                                        {!isOldFormat && (
                                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                                            Visibility: {(visibility * 100).toFixed(1)}%
                                          </span>
                                        )}
                                      </div>
                                      <div className="space-y-2">
                                        {sentences.map((sentence, index) => (
                                          <div key={index} className="p-3 bg-white rounded-lg border border-blue-100">
                                            <p className="text-sm text-gray-900">{sentence}</p>
                                          </div>
                                        ))}
                                        {sentences.length === 0 && !isOldFormat && visibility > 0 && (
                                          <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                                            <p className="text-sm text-yellow-700">
                                              No sentences from web content, but has visibility: {(visibility * 100).toFixed(1)}% 
                                              (calculated from agent recommendation data)
                                            </p>
                                          </div>
                                        )}
                                        {sentences.length === 0 && (isOldFormat || visibility === 0) && (
                                          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                            <p className="text-sm text-gray-700">No sentences found for this domain</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Modification Suggestions and Modified Sentences */}
                                    {isModificationVisible && (
                                      <>
                                        {/* Modification Suggestions Panel */}
                                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                          <div className="flex items-center space-x-2 mb-3">
                                            <Lightbulb className="w-4 h-4 text-yellow-600" />
                                            <h5 className="font-semibold text-yellow-900">Modification Suggestions</h5>
                                          </div>
                                          <div className="p-3 bg-white rounded-lg border border-yellow-100">
                                            <p className="text-sm text-gray-900">
                                              {hasStoredModifications 
                                                ? modificationSuggestions 
                                                : currentModificationData?.suggestions || 'Loading suggestions...'}
                                            </p>
                                          </div>
                                        </div>

                                        {/* Modified Sentences Panel */}
                                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                          <div className="flex items-center space-x-2 mb-3">
                                            <Sparkles className="w-4 h-4 text-green-600" />
                                            <h5 className="font-semibold text-green-900">Modified Sentences</h5>
                                            {!isOldFormat && modifiedVisibility > 0 && (
                                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                                                Visibility: {(modifiedVisibility * 100).toFixed(1)}%
                                              </span>
                                            )}
                                          </div>
                                          <div className="space-y-2">
                                            {(hasStoredModifications ? modifiedSentences : currentModificationData?.modifiedSentences || []).map((sentence, index) => (
                                              <div key={index} className="p-3 bg-white rounded-lg border border-green-100">
                                                <p className="text-sm text-gray-900">{sentence}</p>
                                              </div>
                                            ))}
                                            {(!hasStoredModifications && (!currentModificationData?.modifiedSentences || currentModificationData.modifiedSentences.length === 0)) && (
                                              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                                <p className="text-sm text-gray-700">No modified sentences generated</p>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </>
                                    )}
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
