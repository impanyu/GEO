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
  Minus
} from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import LoadingSpinner from '@/components/LoadingSpinner'

interface DataTableResult {
  normalizedBrandUrl: string
  agenticPlatform: string
  prompt: string
  dateTime: string
  citationTimes: number
  totalCitationsOfAllBrands: number
  visibility: number
  emotion: 'positive' | 'negative' | 'neutral'
  otherBrands: string[]
  fullTextResponse: string
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
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<DataTableResult[] | null>(null)
  const [error, setError] = useState('')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    }
  }, [status, router])

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

    const trimmedUrl = url.trim()
    
    if (!validateUrl(trimmedUrl)) {
      setError('Please enter a valid URL')
      return
    }

    setIsLoading(true)
    setError('')
    setResults(null)

    try {
      const normalizedUrl = normalizeUrl(trimmedUrl)
      const response = await fetch(`/api/get_full_data_table?url=${encodeURIComponent(normalizedUrl)}&platform=${platform}`)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }
      
      const data: DataTableResult[] = await response.json()
      setResults(data)
    } catch (err) {
      console.error('Error fetching data table:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch data table')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleRowExpansion = (index: number) => {
    const newExpandedRows = new Set(expandedRows)
    if (newExpandedRows.has(index)) {
      newExpandedRows.delete(index)
    } else {
      newExpandedRows.add(index)
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
    if (!results) return

    // Export full JSON results
    const jsonContent = JSON.stringify(results, null, 2)

    const blob = new Blob([jsonContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `brand-analysis-${new Date().toISOString().split('T')[0]}.txt`
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
              Analyze brand mentions and sentiment across web search results for specific prompts.
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
                      placeholder="https://example.com"
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
                  This may take several minutes as we analyze prompts with real-time web search...
                </p>
              </div>
            </div>
          )}

          {/* Results Table */}
          {results && !isLoading && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <MessageSquare className="h-5 w-5 text-blue-500" />
                    <span className="text-sm font-medium text-gray-600">Total Prompts</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">{results.length}</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <BarChart3 className="h-5 w-5 text-green-500" />
                    <span className="text-sm font-medium text-gray-600">Brand Mentions</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {results.reduce((sum, r) => sum + r.citationTimes, 0)}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center space-x-2">
                    <Eye className="h-5 w-5 text-purple-500" />
                    <span className="text-sm font-medium text-gray-600">Avg Visibility</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 mt-2">
                    {(results.reduce((sum, r) => sum + r.visibility, 0) / results.length * 100).toFixed(2)}%
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

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prompt</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date/Time</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Citations</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visibility</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Emotion</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
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
                              <div className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4 text-gray-400" />
                                <span className="text-sm text-gray-500">
                                  {new Date(result.dateTime).toLocaleDateString()}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">
                                {result.citationTimes} / {result.totalCitationsOfAllBrands}
                              </div>
                              <div className="text-xs text-gray-500">
                                brand / all brands
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">
                                {(result.visibility * 100).toFixed(2)}%
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${getEmotionColor(result.emotion)}`}>
                                {getEmotionIcon(result.emotion)}
                                <span className="capitalize">{result.emotion}</span>
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
                              <td colSpan={6} className="px-6 py-4 bg-gray-50">
                                <div className="space-y-4">
                                  {/* Full Prompt */}
                                  <div>
                                    <h4 className="text-sm font-medium text-gray-900 mb-2">Full Prompt:</h4>
                                    <p className="text-sm text-gray-700 bg-white p-3 rounded border">
                                      {result.prompt}
                                    </p>
                                  </div>
                                  
                                  {/* Other Brands */}
                                  <div>
                                    <h4 className="text-sm font-medium text-gray-900 mb-2">
                                      Other Brands Mentioned ({result.otherBrands.length}):
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                      {result.otherBrands.length > 0 ? (
                                        result.otherBrands.map((brand, brandIndex) => (
                                          <span
                                            key={brandIndex}
                                            className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-sm"
                                          >
                                            {brand}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-gray-500 text-sm italic">No other brands mentioned</span>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Full Response */}
                                  <div>
                                    <h4 className="text-sm font-medium text-gray-900 mb-2">AI Response:</h4>
                                    <div className="bg-white p-3 rounded border text-sm text-gray-700 max-h-40 overflow-y-auto">
                                      {result.fullTextResponse}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
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
