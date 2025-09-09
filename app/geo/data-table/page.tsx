'use client'

import React, { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { 
  Search, 
  Loader2, 
  AlertCircle, 
  ExternalLink, 
  Download,
  Eye,
  Calendar,
  Globe,
  BarChart3,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Link as LinkIcon,
  Hash
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import LoadingSpinner from '@/components/LoadingSpinner'

// Configuration constants (should match backend configuration)
const QUERIES_PER_PROMPT = 5

interface BrandAnalysis {
  brandName: string
  totalAppearancesAcross10Responses: number
  avgAppearancesPerResponse: number
  avgRank: number
}

interface DataTableResult {
  normalizedBrandUrl: string
  brandName: string
  agenticPlatform: string
  prompt: string
  topic: string
  datetime: string | Date | undefined
  brandAnalysis: BrandAnalysis // Single brand analysis instead of array
  totalCitationsOfAllBrands: number // Always 10 (number of responses)
  queryResponseDocumentId: string // Reference to QueryResponseDocument
}

interface TopicGroupedResult {
  topic: string
  normalizedBrandUrl: string
  brandName: string
  agenticPlatform: string
  promptCount: number
  totalAppearances: number
  totalQueries: number
  visibility: number
  avgRank: number
  datetime: Date
  prompts: string[]
}

function formatDateTime(dateTime: string | Date | undefined | null): string {
  if (!dateTime) {
    return 'N/A'
  }
  
  try {
    const date = typeof dateTime === 'string' ? new Date(dateTime) : dateTime
    
    // Check if the date is valid
    if (date instanceof Date && isNaN(date.getTime())) {
      return 'Invalid Date'
    }
    
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch (error) {
    console.error('Error formatting datetime:', error)
    return 'Invalid Date'
  }
}

function normalizeUrl(url: string): string {
  const originalUrl = url
  
  // Remove protocol if present
  let normalized = url.replace(/^https?:\/\//, '')
  
  // Remove www. if present
  normalized = normalized.replace(/^www\./, '')
  
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '')
  
  // Always use https unless http is explicitly specified in original URL
  if (!originalUrl.toLowerCase().startsWith('http://')) {
    return `https://${normalized}`
  }
  
  return `http://${normalized}`
}

function DataTableContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isCollapsed } = useNavigation()
  const [url, setUrl] = useState('')
  const [platform, setPlatform] = useState('openai')
  const [groupBy, setGroupBy] = useState<'prompt' | 'topic'>('prompt')
  const [beginDatetime, setBeginDatetime] = useState('')
  const [endDatetime, setEndDatetime] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<DataTableResult[] | null>(null)
  const [topicResults, setTopicResults] = useState<TopicGroupedResult[] | null>(null)

  // Debug state changes
  useEffect(() => {
    console.log('State update - results:', results?.length || 0, 'items')
  }, [results])

  useEffect(() => {
    console.log('State update - topicResults:', topicResults?.length || 0, 'items')
  }, [topicResults])

  const [error, setError] = useState('')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [queryResponses, setQueryResponses] = useState<{[key: string]: any}>({})

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    }
  }, [status, router])

  const fetchDataForCurrentUrl = async () => {
    if (!url.trim()) return

    const trimmedUrl = url.trim()
    
    if (!validateUrl(trimmedUrl)) {
      setError('Please enter a valid URL')
      return
    }

    setIsLoading(true)
    setError('')
    setResults(null)
    setTopicResults(null)
    setExpandedRows(new Set())

    try {
      const normalizedUrl = normalizeUrl(trimmedUrl)
      
      // Build query parameters
      const params = new URLSearchParams({
        url: normalizedUrl,
        platform: platform,
        group_by: groupBy
      })
      
      // Add datetime filters if provided
      if (beginDatetime) {
        params.append('begin_datetime', new Date(beginDatetime).toISOString())
      }
      if (endDatetime) {
        params.append('end_datetime', new Date(endDatetime).toISOString())
      }
      
      const response = await fetch(`/api/get_full_data_table?${params.toString()}`)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }
      
      if (groupBy === 'topic') {
        const data: TopicGroupedResult[] = await response.json()
        console.log('Received topic-grouped data table results:', data)
        console.log('Topic results length:', data.length)
        console.log('Setting topicResults state...')
        setTopicResults(data)
        console.log('topicResults state set')
      } else {
        const data: DataTableResult[] = await response.json()
        console.log('Received data table results:', data)
        
        // Transform data to handle old field names (backward compatibility)
        const transformedData = data.map(result => {
          const anyResult = result as any
          return {
            ...result,
            datetime: result.datetime || anyResult.dateTime || null,
            topic: result.topic || 'Unknown'
          }
        })
        
        // Debug: Check the structure of the first result
        if (transformedData && transformedData.length > 0) {
          console.log('First result structure:', transformedData[0])
          console.log('First result datetime:', transformedData[0].datetime)
          console.log('First result topic:', transformedData[0].topic)
          console.log('All result topics:', transformedData.map(r => r.topic))
        }
        
        setResults(transformedData)
      }
    } catch (err) {
      console.error('Error fetching data table:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch data table')
    } finally {
      setIsLoading(false)
    }
  }

  // Note: User needs to click submit again when changing groupBy mode for now

  const validateUrl = (urlString: string): boolean => {
    try {
      // Basic check for empty or very short strings
      if (!urlString || urlString.trim().length < 3) {
        return false
      }
      
      const normalizedUrl = normalizeUrl(urlString)
      
      // Try to create a URL object
      const urlObj = new URL(normalizedUrl)
      
      // Additional validation: must have a hostname
      if (!urlObj.hostname || urlObj.hostname.length < 3) {
        return false
      }
      
      // Must contain at least one dot (for domain.tld)
      if (!urlObj.hostname.includes('.')) {
        return false
      }
      
      return true
    } catch (error) {
      return false
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    await fetchDataForCurrentUrl()
  }

  const fetchQueryResponses = async (queryResponseDocumentId: string) => {
    if (queryResponses[queryResponseDocumentId] || queryResponseDocumentId === 'error') {
      return
    }

    try {
      const response = await fetch(`/api/query-responses/${queryResponseDocumentId}`)
      
      if (!response.ok) {
        console.error('Failed to fetch query responses:', response.status)
        // Store error state
        setQueryResponses(prev => ({
          ...prev,
          [queryResponseDocumentId]: { error: 'Failed to load responses' }
        }))
        return
      }
      
      const data = await response.json()
      setQueryResponses(prev => ({
        ...prev,
        [queryResponseDocumentId]: data
      }))
    } catch (error) {
      console.error('Error fetching query responses:', error)
      setQueryResponses(prev => ({
        ...prev,
        [queryResponseDocumentId]: { error: 'Failed to load responses' }
      }))
    }
  }

  const toggleRowExpansion = async (index: number) => {
    const newExpandedRows = new Set(expandedRows)
    if (newExpandedRows.has(index)) {
      newExpandedRows.delete(index)
    } else {
      newExpandedRows.add(index)
      // Fetch query responses when expanding
      if (results && results[index]) {
        await fetchQueryResponses(results[index].queryResponseDocumentId)
      }
    }
    setExpandedRows(newExpandedRows)
  }

  const getEmotionIcon = (emotion: string) => {
    switch (emotion) {
      case 'positive':
        return <ThumbsUp className="h-4 w-4 text-green-500" />
      case 'negative':
        return <ThumbsDown className="h-4 w-4 text-red-500" />
      default:
        return <Minus className="h-4 w-4 text-gray-500" />
    }
  }

  const getEmotionColor = (emotion: string) => {
    switch (emotion) {
      case 'positive':
        return 'bg-green-50 text-green-700'
      case 'negative':
        return 'bg-red-50 text-red-700'
      default:
        return 'bg-gray-50 text-gray-700'
    }
  }

  const downloadData = () => {
    const dataToDownload = groupBy === 'topic' ? topicResults : results
    if (!dataToDownload) return

    // Export full JSON results
    const jsonContent = JSON.stringify(dataToDownload, null, 2)

    const blob = new Blob([jsonContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `brand-analysis-${groupBy}-${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (status === 'loading') {
    return <LoadingSpinner />
  }

  if (status === 'unauthenticated') {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <SideNavigation />
      <div className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Brand Analysis Data Table</h1>
            <p className="text-gray-600">
              Analyze brand mentions, rankings, and sentiment across 10 web search queries for each prompt.
            </p>
          </div>

          {/* Input Form */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
                  Brand Website URL
                </label>
                <div className="flex space-x-4">
                  <div className="flex-1">
                    <input
                      type="text"
                      id="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://apple.com"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={isLoading}
                    />
                  </div>
                  <div>
                    <select
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={isLoading}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="google-ai" disabled>Google AI (Coming Soon)</option>
                    </select>
                  </div>
                  <div>
                    <select
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value as 'prompt' | 'topic')}
                      className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={isLoading}
                    >
                      <option value="prompt">Group by Prompt</option>
                      <option value="topic">Group by Topic</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={!url.trim() || isLoading}
                    className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Analyzing...</span>
                      </>
                    ) : (
                      <>
                        <Search className="h-5 w-5" />
                        <span>Analyze</span>
                      </>
                    )}
                  </button>
                </div>
                
                {/* DateTime Filters */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Date Range Filter (Optional)</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="beginDatetime" className="block text-sm font-medium text-gray-600 mb-1">
                        From Date
                      </label>
                      <input
                        type="datetime-local"
                        id="beginDatetime"
                        value={beginDatetime}
                        onChange={(e) => setBeginDatetime(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        disabled={isLoading}
                      />
                    </div>
                    <div>
                      <label htmlFor="endDatetime" className="block text-sm font-medium text-gray-600 mb-1">
                        To Date
                      </label>
                      <input
                        type="datetime-local"
                        id="endDatetime"
                        value={endDatetime}
                        onChange={(e) => setEndDatetime(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        disabled={isLoading}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-gray-500">
                      Leave empty to include all data. Filters apply to the creation time of analysis results.
                    </p>
                    {(beginDatetime || endDatetime) && (
                      <button
                        type="button"
                        onClick={() => {
                          setBeginDatetime('')
                          setEndDatetime('')
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 underline"
                        disabled={isLoading}
                      >
                        Clear Filters
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>

            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <p className="text-red-700">{error}</p>
                </div>
              </div>
            )}
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="flex flex-col items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Analyzing Brand Mentions</h3>
                <p className="text-gray-500 text-center">
                  This may take 10-15 minutes as we run 10 queries per prompt and analyze brand rankings...
                </p>
              </div>
            </div>
          )}

          {/* Results Table */}
          {(() => {
            console.log('Checking render conditions:')
            console.log('groupBy:', groupBy)
            console.log('results:', results?.length || 0)
            console.log('topicResults:', topicResults?.length || 0)
            console.log('isLoading:', isLoading)
            console.log('Should render:', ((results && groupBy === 'prompt') || (topicResults && groupBy === 'topic')) && !isLoading)
            return ((results && groupBy === 'prompt') || (topicResults && groupBy === 'topic')) && !isLoading
          })() && (
            <div className="space-y-6">
              {/* Summary Cards */}
              {groupBy === 'prompt' && results && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <MessageSquare className="h-5 w-5 text-blue-500" />
                    <span className="text-sm font-medium text-gray-600">Total Prompts</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">{results.length}</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <Globe className="h-5 w-5 text-green-500" />
                    <span className="text-sm font-medium text-gray-600">Brand Analyzed</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {results[0]?.brandName || 'None'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Single brand analysis
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <BarChart3 className="h-5 w-5 text-purple-500" />
                    <span className="text-sm font-medium text-gray-600">Total Queries</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {results.length * 10}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">10 per prompt</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <Eye className="h-5 w-5 text-indigo-500" />
                    <span className="text-sm font-medium text-gray-600">Avg Visibility</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {results.length > 0 ? (
                      (results.reduce((sum, result) => {
                        const visibility = result.brandAnalysis.totalAppearancesAcross10Responses / result.totalCitationsOfAllBrands
                        return sum + visibility
                      }, 0) / results.length * 100).toFixed(2)
                    ) : '0.00'}%
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <BarChart3 className="h-5 w-5 text-amber-500" />
                    <span className="text-sm font-medium text-gray-600">Avg Rank</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {(() => {
                      const rankedResults = results.filter(result => result.brandAnalysis.avgRank > 0)
                      return rankedResults.length > 0 ? (
                        rankedResults.reduce((sum, result) => sum + result.brandAnalysis.avgRank, 0) / rankedResults.length
                      ).toFixed(2) : 'N/A'
                    })()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {(() => {
                      const rankedResults = results.filter(result => result.brandAnalysis.avgRank > 0)
                      return `${rankedResults.length}/${results.length} ranked`
                    })()}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <Globe className="h-5 w-5 text-orange-500" />
                    <span className="text-sm font-medium text-gray-600">Platform</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2 capitalize">{platform}</div>
                </div>
              </div>
              )}

              {/* Topic Summary Cards */}
              {groupBy === 'topic' && topicResults && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center space-x-2">
                      <MessageSquare className="h-5 w-5 text-blue-500" />
                      <span className="text-sm font-medium text-gray-600">Total Topics</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">{topicResults.length}</div>
                  </div>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center space-x-2">
                      <Globe className="h-5 w-5 text-green-500" />
                      <span className="text-sm font-medium text-gray-600">Total Prompts</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">
                      {topicResults.reduce((sum, topic) => sum + topic.promptCount, 0)}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center space-x-2">
                      <BarChart3 className="h-5 w-5 text-purple-500" />
                      <span className="text-sm font-medium text-gray-600">Total Queries</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">
                      {topicResults.reduce((sum, topic) => sum + topic.totalQueries, 0)}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center space-x-2">
                      <Eye className="h-5 w-5 text-indigo-500" />
                      <span className="text-sm font-medium text-gray-600">Avg Visibility</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">
                      {topicResults.length > 0 ? (
                        (topicResults.reduce((sum, topic) => sum + topic.visibility, 0) / topicResults.length * 100).toFixed(2)
                      ) : '0.00'}%
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center space-x-2">
                      <BarChart3 className="h-5 w-5 text-yellow-500" />
                      <span className="text-sm font-medium text-gray-600">Avg Rank</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 mt-2">
                      {(() => {
                        const rankedTopics = topicResults.filter(topic => topic.avgRank > 0)
                        return rankedTopics.length > 0 
                          ? (rankedTopics.reduce((sum, topic) => sum + topic.avgRank, 0) / rankedTopics.length).toFixed(1)
                          : '-'
                      })()}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {(() => {
                        const rankedTopics = topicResults.filter(topic => topic.avgRank > 0)
                        return `${rankedTopics.length}/${topicResults.length} ranked`
                      })()}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center space-x-2">
                      <Globe className="h-5 w-5 text-orange-500" />
                      <span className="text-sm font-medium text-gray-600">Platform</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 mt-2 capitalize">{platform}</div>
                  </div>
                </div>
              )}

              {/* Data Table */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">Analysis Results</h2>
                  <button
                    onClick={downloadData}
                    className="flex items-center space-x-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download JSON</span>
                  </button>
                </div>

                <div className="w-full">
                  <table className="w-full table-auto">
                    {/* Prompt View Headers */}
                    {groupBy === 'prompt' && (
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prompt</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Topic</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date/Time</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Appearances</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visibility</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Rank</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                    )}
                    
                    {/* Topic View Headers */}
                    {groupBy === 'topic' && (
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Topic</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prompt Count</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date/Time</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Appearances</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visibility</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Rank</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                    )}
                    {/* Prompt View Body */}
                    {groupBy === 'prompt' && results && (
                      <tbody className="bg-white divide-y divide-gray-200">
                        {results.map((result, index) => (
                        <React.Fragment key={index}>
                          <tr className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900 max-w-xs truncate">
                                {result.prompt}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                {result.topic}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4 text-gray-400" />
                                <span className="text-sm text-gray-500">
                                  {formatDateTime(result.datetime)}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {result.brandAnalysis.totalAppearancesAcross10Responses}/10
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className="text-sm text-gray-900">
                                {(result.brandAnalysis.avgAppearancesPerResponse * 100).toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className="text-sm text-gray-900">
                                {result.brandAnalysis.avgRank > 0 ? result.brandAnalysis.avgRank.toFixed(1) : '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                              <button
                                onClick={() => toggleRowExpansion(index)}
                                className="text-blue-600 hover:text-blue-900 mr-3"
                              >
                                {expandedRows.has(index) ? 'Collapse' : 'Expand'}
                              </button>
                            </td>
                          </tr>
                          
                          {/* Expanded Row Details */}
                            {expandedRows.has(index) && (
                              <tr>
                                <td colSpan={7} className="px-6 py-4 bg-gray-50">
                                  <div className="space-y-6 w-full">
                                  {/* Full Prompt */}
                                  <div>
                                    <h4 className="text-sm font-medium text-gray-900 mb-2">Full Prompt:</h4>
                                    <p className="text-sm text-gray-700 bg-white p-3 rounded border">
                                      {result.prompt}
                                    </p>
                                  </div>
                                  
                                  {/* Query Responses */}
                                  <div>
                                    <h4 className="text-sm font-medium text-gray-900 mb-3">
                                      {QUERIES_PER_PROMPT} Query Responses:
                                    </h4>
                                    <div className="bg-gray-50 p-4 rounded-lg w-full">
                                      <div className="flex items-center space-x-2 mb-3">
                                        <ExternalLink className="h-4 w-4 text-blue-500" />
                                        <span className="text-sm text-gray-700">
                                          Document ID: 
                                          <code className="ml-2 px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                                            {result.queryResponseDocumentId}
                                          </code>
                                        </span>
                                      </div>
                                      
                                      {result.queryResponseDocumentId === 'error' ? (
                                        <div className="text-sm text-red-600">
                                          Error occurred during query processing
                                        </div>
                                      ) : queryResponses[result.queryResponseDocumentId]?.error ? (
                                        <div className="text-sm text-red-600">
                                          {queryResponses[result.queryResponseDocumentId].error}
                                        </div>
                                      ) : queryResponses[result.queryResponseDocumentId]?.responses ? (
                                        <div className="space-y-4">
                                          {queryResponses[result.queryResponseDocumentId].responses.map((response: any, responseIndex: number) => (
                                            <div key={responseIndex} className="bg-white p-4 rounded border-l-4 border-blue-200 w-full">
                                              <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center space-x-2">
                                                  <Hash className="h-4 w-4 text-gray-400" />
                                                  <span className="text-sm font-medium text-gray-700">
                                                    Response {responseIndex + 1}/{QUERIES_PER_PROMPT}
                                                  </span>
                                                </div>
                                                {response.annotations && response.annotations.length > 0 && (
                                                  <div className="flex items-center space-x-1">
                                                    <LinkIcon className="h-3 w-3 text-blue-500" />
                                                    <span className="text-xs text-blue-600 font-medium">
                                                      {response.annotations.length} citation{response.annotations.length !== 1 ? 's' : ''}
                                                    </span>
                                                  </div>
                                                )}
                                              </div>
                                              
                                              {/* Response Text as Markdown */}
                                              <div className="mb-4">
                                                <h5 className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">Response Content</h5>
                                                <div className="prose prose-sm max-w-none text-gray-700 bg-gray-50 p-3 rounded border w-full overflow-hidden">
                                                  <ReactMarkdown>
                                                    {response.output_text}
                                                  </ReactMarkdown>
                                                </div>
                                              </div>
                                              
                                              {/* Full Annotations Display */}
                                              {response.annotations && response.annotations.length > 0 && (
                                                <div>
                                                  <h5 className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">Citations & Sources</h5>
                                                  <div className="space-y-2">
                                                    {response.annotations.map((annotation: any, annIndex: number) => (
                                                      <div key={annIndex} className="bg-blue-50 p-3 rounded border border-blue-200">
                                                        <div className="flex items-start space-x-2">
                                                          <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-200 text-blue-800 text-xs font-bold rounded-full flex-shrink-0 mt-0.5">
                                                            {annIndex + 1}
                                                          </span>
                                                          <div className="flex-1 min-w-0">
                                                            {annotation.title && (
                                                              <div className="text-sm font-medium text-gray-900 mb-1">
                                                                {annotation.title}
                                                              </div>
                                                            )}
                                                            {annotation.url && (
                                                              <div className="text-xs text-blue-600 break-all mb-1 overflow-wrap-anywhere">
                                                                <a 
                                                                  href={annotation.url} 
                                                                  target="_blank" 
                                                                  rel="noopener noreferrer"
                                                                  className="hover:underline"
                                                                >
                                                                  {annotation.url}
                                                                </a>
                                                              </div>
                                                            )}
                                                            <div className="flex items-center space-x-3 text-xs text-gray-500">
                                                              <span>Type: {annotation.type || 'citation'}</span>
                                                              {annotation.index !== null && annotation.index !== undefined && (
                                                                <span>Index: {annotation.index}</span>
                                                              )}
                                                            </div>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                              
                                              {(!response.annotations || response.annotations.length === 0) && (
                                                <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                                                  <div className="flex items-center space-x-2">
                                                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                                                    <span className="text-sm text-yellow-800">No citations or sources found</span>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-sm text-gray-500">
                                          Loading query responses...
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                        ))}
                      </tbody>
                    )}

                    {/* Topic View Body */}
                    {groupBy === 'topic' && topicResults && (
                      <tbody className="bg-white divide-y divide-gray-200">
                        {topicResults.map((topic, index) => (
                          <React.Fragment key={index}>
                            <tr className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                                  {topic.topic}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center space-x-1">
                                  <MessageSquare className="h-4 w-4 text-gray-400" />
                                  <span className="text-sm text-gray-900">{topic.promptCount}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center space-x-1">
                                  <Calendar className="h-4 w-4 text-gray-400" />
                                  <span className="text-sm text-gray-500">
                                    {formatDateTime(topic.datetime)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  {topic.totalAppearances}/{topic.totalQueries}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <span className="text-sm text-gray-900">
                                  {(topic.visibility * 100).toFixed(1)}%
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-center">
                                <span className="text-sm text-gray-900">
                                  {topic.avgRank > 0 ? topic.avgRank.toFixed(1) : '-'}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                <button
                                  onClick={() => toggleRowExpansion(index)}
                                  className="text-blue-600 hover:text-blue-900 mr-3"
                                >
                                  {expandedRows.has(index) ? 'Collapse' : 'View Prompts'}
                                </button>
                              </td>
                            </tr>
                            
                            {/* Expanded Row for Topic Details */}
                            {expandedRows.has(index) && (
                              <tr>
                                <td colSpan={7} className="px-6 py-4 bg-gray-50">
                                  <div className="space-y-4 w-full">
                                    <div>
                                      <h4 className="text-sm font-medium text-gray-900 mb-3">
                                        {topic.promptCount} Prompts in "{topic.topic}" Topic:
                                      </h4>
                                      <div className="grid grid-cols-1 gap-2">
                                        {topic.prompts.map((prompt, promptIndex) => (
                                          <div key={promptIndex} className="bg-white p-3 rounded border border-gray-200">
                                            <span className="text-sm text-gray-700">{prompt}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DataTablePage() {
  return <DataTableContent />
}
