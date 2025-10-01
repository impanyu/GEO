'use client'

import React, { useState, useCallback } from 'react'
import { 
  FileText, 
  Search, 
  Calendar, 
  BarChart3, 
  Target,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Download,
  Loader2,
  Globe,
  MessageSquare,
  Users
} from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import ReactMarkdown from 'react-markdown'

// Interfaces
interface GapAnalysis {
  missingDomains: string[]
  commonDomains: string[]
  currentOnlyDomains: string[]
}

interface ContentSummary {
  totalDomains: number
  totalSentences: number
  domains: string[]
  sampledTime?: string
  totalPromptsProcessed?: number
}

interface PolicyReportData {
  brandUrl: string
  normalizedBrandUrl: string
  topic: string
  analysisTimestamp: string
  currentContent: ContentSummary
  recommendationContent: ContentSummary
  gapAnalysis: GapAnalysis
  policyReport: string
}

interface ApiResponse {
  success: boolean
  data?: PolicyReportData
  error?: string
}

export default function PolicyReportPage() {
  const { isCollapsed } = useNavigation()
  const [brandUrl, setBrandUrl] = useState('')
  const [topic, setTopic] = useState('all')
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<PolicyReportData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generateReport = useCallback(async () => {
    if (!brandUrl.trim()) {
      setError('Please enter a brand URL')
      return
    }

    setLoading(true)
    setError(null)
    setReportData(null)

    try {
      console.log('🔍 Generating policy report for:', brandUrl, 'topic:', topic)
      
      const response = await fetch(
        `/api/get_policy_for_brand_and_topic?brandUrl=${encodeURIComponent(brandUrl)}&topic=${encodeURIComponent(topic)}`
      )
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const result: ApiResponse = await response.json()
      
      if (result.success && result.data) {
        setReportData(result.data)
        console.log('✅ Policy report generated successfully')
      } else {
        throw new Error(result.error || 'Failed to generate policy report')
      }
    } catch (err) {
      console.error('❌ Error generating policy report:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }, [brandUrl, topic])

  const downloadReport = useCallback(() => {
    if (!reportData) return
    
    const blob = new Blob([reportData.policyReport], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `policy-report-${reportData.normalizedBrandUrl}-${reportData.topic}-${new Date().toISOString().split('T')[0]}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [reportData])

  return (
    <div className="flex h-screen bg-gray-50">
      <SideNavigation />
      
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${
        isCollapsed ? 'ml-16' : 'ml-64'
      }`}>
        {/* Header */}
        <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <FileText className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Policy Report</h1>
                <p className="text-sm text-gray-600">
                  Generate comprehensive brand visibility policy recommendations
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Input Form */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Search className="h-5 w-5 mr-2 text-blue-600" />
              Analysis Configuration
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="brandUrl" className="block text-sm font-medium text-gray-700 mb-2">
                  Brand URL *
                </label>
                <input
                  type="url"
                  id="brandUrl"
                  value={brandUrl}
                  onChange={(e) => setBrandUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={loading}
                />
              </div>
              
              <div>
                <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
                  Topic Focus
                </label>
                <input
                  type="text"
                  id="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g., chat sdk, messaging, real-time communication"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={loading}
                />
              </div>
            </div>
            
            <button
              onClick={generateReport}
              disabled={loading || !brandUrl.trim()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating Report...
                </>
              ) : (
                <>
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Generate Policy Report
                </>
              )}
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
                <span className="text-red-800 font-medium">Error</span>
              </div>
              <p className="text-red-700 mt-1">{error}</p>
            </div>
          )}

          {/* Report Results */}
          {reportData && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Current Content</p>
                      <p className="text-2xl font-bold text-gray-900">{reportData.currentContent.totalDomains}</p>
                      <p className="text-xs text-gray-500">{reportData.currentContent.totalSentences} sentences</p>
                    </div>
                    <Globe className="h-8 w-8 text-blue-600" />
                  </div>
                </div>
                
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">AI Recommendations</p>
                      <p className="text-2xl font-bold text-gray-900">{reportData.recommendationContent.totalDomains}</p>
                      <p className="text-xs text-gray-500">{reportData.recommendationContent.totalSentences} sentences</p>
                    </div>
                    <MessageSquare className="h-8 w-8 text-green-600" />
                  </div>
                </div>
                
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Missing Domains</p>
                      <p className="text-2xl font-bold text-gray-900">{reportData.gapAnalysis.missingDomains.length}</p>
                      <p className="text-xs text-gray-500">Opportunities identified</p>
                    </div>
                    <Target className="h-8 w-8 text-orange-600" />
                  </div>
                </div>
              </div>

              {/* Gap Analysis */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <TrendingUp className="h-5 w-5 mr-2 text-blue-600" />
                  Gap Analysis Summary
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2 flex items-center">
                      <AlertCircle className="h-4 w-4 mr-1 text-orange-600" />
                      Missing Domains ({reportData.gapAnalysis.missingDomains.length})
                    </h4>
                    <div className="space-y-1">
                      {reportData.gapAnalysis.missingDomains.slice(0, 5).map((domain, index) => (
                        <div key={index} className="text-sm text-gray-600 bg-orange-50 px-2 py-1 rounded">
                          {domain}
                        </div>
                      ))}
                      {reportData.gapAnalysis.missingDomains.length > 5 && (
                        <div className="text-xs text-gray-500">
                          +{reportData.gapAnalysis.missingDomains.length - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2 flex items-center">
                      <CheckCircle className="h-4 w-4 mr-1 text-green-600" />
                      Common Domains ({reportData.gapAnalysis.commonDomains.length})
                    </h4>
                    <div className="space-y-1">
                      {reportData.gapAnalysis.commonDomains.slice(0, 5).map((domain, index) => (
                        <div key={index} className="text-sm text-gray-600 bg-green-50 px-2 py-1 rounded">
                          {domain}
                        </div>
                      ))}
                      {reportData.gapAnalysis.commonDomains.length > 5 && (
                        <div className="text-xs text-gray-500">
                          +{reportData.gapAnalysis.commonDomains.length - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2 flex items-center">
                      <Users className="h-4 w-4 mr-1 text-blue-600" />
                      Current Only ({reportData.gapAnalysis.currentOnlyDomains.length})
                    </h4>
                    <div className="space-y-1">
                      {reportData.gapAnalysis.currentOnlyDomains.slice(0, 5).map((domain, index) => (
                        <div key={index} className="text-sm text-gray-600 bg-blue-50 px-2 py-1 rounded">
                          {domain}
                        </div>
                      ))}
                      {reportData.gapAnalysis.currentOnlyDomains.length > 5 && (
                        <div className="text-xs text-gray-500">
                          +{reportData.gapAnalysis.currentOnlyDomains.length - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Policy Report */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                    <FileText className="h-5 w-5 mr-2 text-blue-600" />
                    Policy Report
                  </h3>
                  <button
                    onClick={downloadReport}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download MD
                  </button>
                </div>
                
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      h1: ({ children }) => <h1 className="text-2xl font-bold text-gray-900 mb-4">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-lg font-medium text-gray-900 mt-4 mb-2">{children}</h3>,
                      ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-4">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 mb-4">{children}</ol>,
                      li: ({ children }) => <li className="text-gray-700">{children}</li>,
                      p: ({ children }) => <p className="text-gray-700 mb-3">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                    }}
                  >
                    {reportData.policyReport}
                  </ReactMarkdown>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
