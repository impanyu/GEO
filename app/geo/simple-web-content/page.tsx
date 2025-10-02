'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { 
  Globe, 
  Search, 
  Calendar, 
  BarChart3, 
  ExternalLink, 
  ChevronDown, 
  ChevronRight,
  Lightbulb,
  Sparkles,
  Wand2
} from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'

// Interfaces matching the SimpleWebContentCache model
interface DomainContent {
  sentences: string[]
  visibility: number
  modifiedSentences?: string[]
  modifiedVisibility?: number
  modificationSuggestions?: string
}

interface WebsiteContent {
  [normalizedDomain: string]: DomainContent
}

interface SimpleWebContentAnalysis {
  _id?: string
  brandName?: string
  brandUrl: string
  normalizedBrandUrl: string
  sampledTime?: string
  websiteContent?: WebsiteContent
  // API response structure
  domainContent?: { [domain: string]: string[] }
  totalAnalyses?: number
  totalPromptsProcessed?: number
  uniqueDomains?: number
  totalSentences?: number
  metadata?: {
    agentPlatforms: string[]
    sampledTime: string
    totalPrompts: number
    sampledPrompts: number
  }
}

interface ModificationData {
  [domain: string]: {
    suggestions?: string
    modifiedSentences?: string[]
  }
}

export default function SimpleWebContentPage() {
  const { isCollapsed } = useNavigation()
  
  const [analyses, setAnalyses] = useState<SimpleWebContentAnalysis[]>([])
  const [selectedAnalysis, setSelectedAnalysis] = useState<SimpleWebContentAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set())
  const [showModifications, setShowModifications] = useState<Set<string>>(new Set())
  const [modificationData, setModificationData] = useState<ModificationData>({})

  // Helper function to normalize analysis data structure
  const getWebsiteContent = useCallback((analysis: SimpleWebContentAnalysis): WebsiteContent => {
    if (analysis.websiteContent) {
      return analysis.websiteContent
    }
    
    if (analysis.domainContent) {
      // Convert domainContent to websiteContent format
      const websiteContent: WebsiteContent = {}
      for (const [domain, sentences] of Object.entries(analysis.domainContent)) {
        websiteContent[domain] = {
          sentences: sentences || [],
          visibility: 0,
          modifiedSentences: [],
          modifiedVisibility: 0,
          modificationSuggestions: ''
        }
      }
      return websiteContent
    }
    
    return {}
  }, [])

  // Load all analyses
  const loadAnalyses = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/get_all_simple_web_content?limit=100')
      const result = await response.json()
      
      if (result.success) {
        setAnalyses(result.data)
      } else {
        console.error('Failed to load analyses:', result.error)
      }
    } catch (error) {
      console.error('Error loading analyses:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load specific analysis
  const loadAnalysis = useCallback(async (brandUrl: string) => {
    try {
      setLoading(true)
      const response = await fetch(`/api/get_simple_web_content?brandUrl=${encodeURIComponent(brandUrl)}`)
      const result = await response.json()
      
      if (result.success) {
        setSelectedAnalysis(result.data)
      } else {
        console.error('Failed to load analysis:', result.error)
        setSelectedAnalysis(null)
      }
    } catch (error) {
      console.error('Error loading analysis:', error)
      setSelectedAnalysis(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load stored modifications from MongoDB data
  const loadStoredModifications = useCallback((domain: string, domainData: DomainContent) => {
    const modifications: { suggestions?: string; modifiedSentences?: string[] } = {}
    
    if (domainData.modificationSuggestions) {
      modifications.suggestions = domainData.modificationSuggestions
    }
    
    if (domainData.modifiedSentences && domainData.modifiedSentences.length > 0) {
      modifications.modifiedSentences = domainData.modifiedSentences
    }
    
    if (modifications.suggestions || modifications.modifiedSentences) {
      setModificationData(prev => ({
        ...prev,
        [domain]: modifications
      }))
    } else {
      setModificationData(prev => ({
        ...prev,
        [domain]: { suggestions: 'No stored modification data available for this domain.' }
      }))
    }
  }, [])

  // Toggle domain expansion
  const toggleDomain = useCallback((domain: string) => {
    setExpandedDomains(prev => {
      const newSet = new Set(prev)
      if (newSet.has(domain)) {
        newSet.delete(domain)
      } else {
        newSet.add(domain)
      }
      return newSet
    })
  }, [])

  // Toggle modifications display
  const toggleModifications = useCallback((domain: string, domainData: DomainContent) => {
    setShowModifications(prev => {
      const newSet = new Set(prev)
      if (newSet.has(domain)) {
        newSet.delete(domain)
      } else {
        newSet.add(domain)
        // Load modifications if not already loaded
        if (!modificationData[domain]) {
          loadStoredModifications(domain, domainData)
        }
      }
      return newSet
    })
  }, [modificationData, loadStoredModifications])

  // Filter analyses based on search term
  const filteredAnalyses = analyses.filter(analysis =>
    (String(analysis.brandName || '').toLowerCase()).includes(searchTerm.toLowerCase()) ||
    analysis.brandUrl.toLowerCase().includes(searchTerm.toLowerCase())
  )

  useEffect(() => {
    loadAnalyses()
  }, [loadAnalyses])

  if (loading && !selectedAnalysis) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <SideNavigation />
        <div className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'} flex items-center justify-center`}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 text-lg">Loading simple web content analyses...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <SideNavigation />
      <div className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <Globe className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">Simple Web Content Analysis</h1>
            </div>
            {selectedAnalysis && (
              <button
                onClick={() => setSelectedAnalysis(null)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                ← Back to List
              </button>
            )}
          </div>

          {!selectedAnalysis && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search brands..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}
        </div>

        {selectedAnalysis ? (
          /* Detailed Analysis View */
          <div className="space-y-6">
            {/* Analysis Header */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    {String(selectedAnalysis.brandName || selectedAnalysis.brandUrl)}
                  </h2>
                  <div className="flex items-center space-x-4 text-sm text-gray-600">
                    <div className="flex items-center space-x-1">
                      <ExternalLink className="h-4 w-4" />
                      <a 
                        href={selectedAnalysis.brandUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="hover:text-blue-600 transition-colors"
                      >
                        {selectedAnalysis.brandUrl}
                      </a>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Calendar className="h-4 w-4" />
                      <span>
                        {selectedAnalysis.sampledTime 
                          ? new Date(selectedAnalysis.sampledTime).toLocaleDateString()
                          : selectedAnalysis.metadata?.sampledTime 
                            ? new Date(String(selectedAnalysis.metadata.sampledTime)).toLocaleDateString()
                            : 'N/A'
                        }
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600">Domains</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {Object.keys(getWebsiteContent(selectedAnalysis)).length}
                  </div>
                </div>
              </div>
            </div>

            {/* Domains */}
            <div className="space-y-4">
              {Object.entries(getWebsiteContent(selectedAnalysis))
                .sort(([, a], [, b]) => b.sentences.length - a.sentences.length)
                .map(([domain, domainData]) => {
                  const isExpanded = expandedDomains.has(domain)
                  const isModificationVisible = showModifications.has(domain)
                  const sentences = domainData.sentences || []
                  const visibility = domainData.visibility || 0
                  const modifiedVisibility = domainData.modifiedVisibility || 0

                  if (!domainData) {
                    return null
                  }

                  if (!Array.isArray(sentences)) {
                    return null
                  }

                  return (
                    <div key={domain} className="bg-white rounded-xl shadow-lg overflow-hidden">
                      {/* Domain Header */}
                      <div 
                        className="p-6 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleDomain(domain)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-gray-400" />
                            )}
                            <Globe className="h-5 w-5 text-blue-600" />
                            <div>
                              <h3 className="font-semibold text-gray-900">{domain}</h3>
                              <p className="text-sm text-gray-600">{sentences.length} content items</p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4">
                            <div className="text-right">
                              <div className="text-xs text-gray-500">Visibility</div>
                              <div className="text-sm font-medium text-blue-600">
                                {(visibility * 100).toFixed(1)}%
                              </div>
                            </div>
                            <BarChart3 className="h-5 w-5 text-gray-400" />
                          </div>
                        </div>
                      </div>

                      {/* Domain Content */}
                      {isExpanded && (
                        <div className="p-6 space-y-4">
                          {/* Show Modifications Button */}
                          <div className="flex justify-between items-center">
                            <h4 className="font-medium text-gray-900">Content Analysis</h4>
                            <button
                              onClick={() => toggleModifications(domain, domainData)}
                              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                                isModificationVisible
                                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              }`}
                            >
                              <Wand2 className="h-4 w-4" />
                              <span>{isModificationVisible ? 'Hide Modifications' : 'Show Modifications'}</span>
                            </button>
                          </div>

                          {/* Original Content Panel */}
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center space-x-2">
                                <Globe className="h-4 w-4 text-blue-600" />
                                <h5 className="font-medium text-blue-900">Original Content</h5>
                              </div>
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                                Visibility: {(visibility * 100).toFixed(1)}%
                              </span>
                            </div>
                            {sentences.length > 0 ? (
                              <div className="space-y-3">
                                {sentences.map((sentence, index) => (
                                  <div key={index} className="bg-white border border-blue-200 rounded-lg p-3 shadow-sm">
                                    <p className="text-sm text-blue-900 leading-relaxed">{sentence}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-blue-600 italic">No content available</p>
                            )}
                          </div>

                          {/* Modification Panels */}
                          {isModificationVisible && (
                            <div className="space-y-4">
                              {/* Modification Suggestions */}
                              {modificationData[domain]?.suggestions && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                  <div className="flex items-center space-x-2 mb-3">
                                    <Lightbulb className="h-4 w-4 text-yellow-600" />
                                    <h5 className="font-medium text-yellow-900">Modification Suggestions</h5>
                                  </div>
                                  <p className="text-sm text-yellow-800 leading-relaxed">
                                    {modificationData[domain].suggestions}
                                  </p>
                                </div>
                              )}

                              {/* Modified Content */}
                              {modificationData[domain]?.modifiedSentences && (
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center space-x-2">
                                      <Sparkles className="h-4 w-4 text-green-600" />
                                      <h5 className="font-medium text-green-900">Modified Content</h5>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      {modifiedVisibility > 0 && (
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                                          Visibility: {(modifiedVisibility * 100).toFixed(1)}%
                                        </span>
                                      )}
                                      {visibility > 0 && modifiedVisibility > visibility && (
                                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium">
                                          +{((modifiedVisibility - visibility) * 100).toFixed(1)}%
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    {modificationData[domain].modifiedSentences!.map((sentence, index) => (
                                      <div key={index} className="bg-white border border-green-200 rounded-lg p-3 shadow-sm">
                                        <p className="text-sm text-green-900 leading-relaxed">{sentence}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* No Modifications Available */}
                              {!modificationData[domain]?.suggestions && !modificationData[domain]?.modifiedSentences && (
                                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                  <p className="text-sm text-gray-600 italic">
                                    No modification data available for this domain.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        ) : (
          /* Analysis List View */
          <div className="grid gap-6">
            {filteredAnalyses.length > 0 ? (
              filteredAnalyses.map((analysis) => {
                const websiteContent = getWebsiteContent(analysis)
                const totalDomains = Object.keys(websiteContent).length
                const totalSentences = Object.values(websiteContent).reduce(
                  (sum, domainContent) => sum + domainContent.sentences.length, 
                  0
                )

                return (
                  <div 
                    key={analysis._id || analysis.brandUrl} 
                    className="bg-white rounded-xl shadow-lg p-6 cursor-pointer hover:shadow-xl transition-shadow"
                    onClick={() => loadAnalysis(analysis.brandUrl)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-xl font-bold text-gray-900 mb-2">
                          {String(analysis.brandName || analysis.brandUrl)}
                        </h3>
                        <div className="flex items-center space-x-4 text-sm text-gray-600 mb-4">
                          <div className="flex items-center space-x-1">
                            <ExternalLink className="h-4 w-4" />
                            <span>{analysis.brandUrl}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <Calendar className="h-4 w-4" />
                            <span>
                              {analysis.sampledTime 
                                ? new Date(analysis.sampledTime).toLocaleDateString()
                                : analysis.metadata?.sampledTime 
                                  ? new Date(String(analysis.metadata.sampledTime)).toLocaleDateString()
                                  : 'N/A'
                              }
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-6">
                          <div className="flex items-center space-x-2">
                            <Globe className="h-4 w-4 text-blue-600" />
                            <span className="text-sm text-gray-700">{totalDomains} domains</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <BarChart3 className="h-4 w-4 text-green-600" />
                            <span className="text-sm text-gray-700">{totalSentences} sentences</span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-400 mt-1" />
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                <Globe className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No Analyses Found</h3>
                <p className="text-gray-600">
                  {searchTerm ? 'No analyses match your search criteria.' : 'No simple web content analyses available yet.'}
                </p>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
