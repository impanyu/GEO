'use client'

import React, { useState, useCallback } from 'react'
import { 
  Bot, 
  Search, 
  Calendar, 
  BarChart3, 
  ExternalLink, 
  ChevronDown, 
  ChevronRight,
  Globe,
  MessageSquare,
  Target,
  Loader2
} from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'

// Interfaces
interface DomainContent {
  [domain: string]: string[]
}

interface AgentRecommendationData {
  brandUrl: string
  normalizedBrandUrl: string
  topic: string
  totalAnalyses: number
  totalPromptsProcessed: number
  domainContent: DomainContent
  statistics: {
    totalDomains: number
    totalSentences: number
    averageSentencesPerDomain: number
  }
  metadata: {
    agentPlatforms: string[]
    sampledTime: string
  }
}

interface ApiResponse {
  success: boolean
  data?: AgentRecommendationData
  error?: string
}

export default function AgentRecommendationSimplePage() {
  const { isCollapsed } = useNavigation()
  
  const [brandUrl, setBrandUrl] = useState('')
  const [topic, setTopic] = useState('all')
  const [data, setData] = useState<AgentRecommendationData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set())

  // Load agent recommendation content
  const loadContent = useCallback(async () => {
    if (!brandUrl.trim()) {
      setError('Please enter a brand URL')
      return
    }

    try {
      setLoading(true)
      setError(null)
      
      const params = new URLSearchParams({
        brandUrl: brandUrl.trim(),
        topic: topic.trim()
      })
      
      const response = await fetch(`/api/get_agent_recommendation_content_simple?${params}`)
      const result: ApiResponse = await response.json()
      
      if (result.success && result.data) {
        setData(result.data)
      } else {
        setError(result.error || 'Failed to load agent recommendation content')
        setData(null)
      }
    } catch (err) {
      console.error('Error loading content:', err)
      setError('An error occurred while loading the content')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [brandUrl, topic])

  // Handle form submission
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    loadContent()
  }, [loadContent])

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

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <SideNavigation />
      <div className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
            <div className="flex items-center space-x-3 mb-6">
              <Bot className="h-8 w-8 text-purple-600" />
              <h1 className="text-3xl font-bold text-gray-900">Agent Recommendation Analysis</h1>
            </div>
            
            {/* Search Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="brandUrl" className="block text-sm font-medium text-gray-700 mb-2">
                    Brand URL
                  </label>
                  <div className="relative">
                    <ExternalLink className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <input
                      id="brandUrl"
                      type="url"
                      value={brandUrl}
                      onChange={(e) => setBrandUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      required
                    />
                  </div>
                </div>
                
                <div>
                  <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
                    Topic Filter
                  </label>
                  <div className="relative">
                    <Target className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <input
                      id="topic"
                      type="text"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="all (or specific topic)"
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
              
              <button
                type="submit"
                disabled={loading}
                className="flex items-center space-x-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span>{loading ? 'Analyzing...' : 'Analyze'}</span>
              </button>
            </form>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-8">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          )}

          {/* Results */}
          {data && (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Analysis Summary</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-purple-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2">
                      <MessageSquare className="h-5 w-5 text-purple-600" />
                      <span className="text-sm text-purple-600 font-medium">Prompts</span>
                    </div>
                    <div className="text-2xl font-bold text-purple-900 mt-1">
                      {data.totalPromptsProcessed}
                    </div>
                  </div>
                  
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2">
                      <Globe className="h-5 w-5 text-blue-600" />
                      <span className="text-sm text-blue-600 font-medium">Domains</span>
                    </div>
                    <div className="text-2xl font-bold text-blue-900 mt-1">
                      {data.statistics.totalDomains}
                    </div>
                  </div>
                  
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2">
                      <BarChart3 className="h-5 w-5 text-green-600" />
                      <span className="text-sm text-green-600 font-medium">Sentences</span>
                    </div>
                    <div className="text-2xl font-bold text-green-900 mt-1">
                      {data.statistics.totalSentences}
                    </div>
                  </div>
                  
                  <div className="bg-orange-50 rounded-lg p-4">
                    <div className="flex items-center space-x-2">
                      <Bot className="h-5 w-5 text-orange-600" />
                      <span className="text-sm text-orange-600 font-medium">Platform</span>
                    </div>
                    <div className="text-sm font-bold text-orange-900 mt-1">
                      {data.metadata.agentPlatforms.join(', ')}
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 flex items-center space-x-4 text-sm text-gray-600">
                  <div className="flex items-center space-x-1">
                    <ExternalLink className="h-4 w-4" />
                    <span>{data.brandUrl}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Target className="h-4 w-4" />
                    <span>Topic: {data.topic}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Calendar className="h-4 w-4" />
                    <span>{new Date(data.metadata.sampledTime).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Domain Content */}
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-gray-900">Domain Recommendations</h2>
                
                {Object.entries(data.domainContent)
                  .sort(([, a], [, b]) => b.length - a.length)
                  .map(([domain, sentences]) => {
                    const isExpanded = expandedDomains.has(domain)
                    
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
                                <p className="text-sm text-gray-600">{sentences.length} recommendations</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-gray-500">Recommendations</div>
                              <div className="text-sm font-medium text-blue-600">
                                {sentences.length}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Domain Content */}
                        {isExpanded && (
                          <div className="p-6">
                            <div className="space-y-3">
                              {sentences.map((sentence, index) => (
                                <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                                  <p className="text-sm text-gray-900 leading-relaxed">{sentence}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                
                {Object.keys(data.domainContent).length === 0 && (
                  <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                    <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">No Recommendations Found</h3>
                    <p className="text-gray-600">
                      No domain-specific recommendations were found for the specified topic.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!data && !loading && !error && (
            <div className="bg-white rounded-xl shadow-lg p-12 text-center">
              <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Agent Recommendation Analysis</h3>
              <p className="text-gray-600 mb-4">
                Enter a brand URL and optional topic to analyze AI agent recommendations.
              </p>
              <p className="text-sm text-gray-500">
                This tool analyzes how AI agents recommend domains and services for your brand.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
