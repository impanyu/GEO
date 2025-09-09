'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { 
  MessageSquare, 
  Search, 
  Loader2, 
  AlertCircle, 
  Copy,
  Download,
  RefreshCw,
  ExternalLink
} from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import LoadingSpinner from '@/components/LoadingSpinner'

interface PromptResult {
  success: boolean
  brandUrl: string
  brandName: string
  topics: string[]
  keywords: string[]
  totalPrompts: number
  prompts: string[]
  keywordToTopic: { [keyword: string]: string }
  promptToKeyword: { [prompt: string]: string }
}

function normalizeUrl(url: string): string {
  // Remove protocol if present
  let normalized = url.replace(/^https?:\/\//, '')
  
  // Remove www. if present
  normalized = normalized.replace(/^www\./, '')
  
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '')
  
  // Always use https unless http is explicitly specified
  if (!url.toLowerCase().startsWith('http://')) {
    return `https://${normalized}`
  }
  
  return `http://${normalized}`
}

function PromptsContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isCollapsed } = useNavigation()
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<PromptResult | null>(null)
  const [error, setError] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    }
  }, [status, router])

  const validateUrl = (urlString: string): boolean => {
    try {
      const normalizedUrl = normalizeUrl(urlString)
      new URL(normalizedUrl)
      return true
    } catch {
      return false
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    const trimmedUrl = url.trim()
    
    if (!validateUrl(trimmedUrl)) {
      setError('Please enter a valid URL (e.g., example.com or https://example.com)')
      return
    }

    setIsLoading(true)
    setError('')
    setResult(null)

    try {
      const normalizedUrl = normalizeUrl(trimmedUrl)
      
      // Call the generate_prompt_set API (which now includes caching internally)
      const response = await fetch(`/api/generate_prompt_set?url=${encodeURIComponent(normalizedUrl)}`)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data: PromptResult = await response.json()
      
      if (data.success) {
        setResult(data)
      } else {
        setError('Failed to generate prompts. Please try again.')
      }
    } catch (err) {
      console.error('Error generating prompts:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }

  const downloadPrompts = () => {
    if (!result) return

    const content = [
      `Brand: ${result.brandName}`,
      `Website: ${result.brandUrl}`,
      `Generated: ${new Date().toISOString()}`,
      `Total Prompts: ${result.totalPrompts}`,
      '',
      'TOPICS:',
      ...result.topics.map(topic => `• ${topic}`),
      '',
      'KEYWORDS (with source topics):',
      ...result.keywords.map(keyword => `• ${keyword} → ${result.keywordToTopic[keyword] || 'Unknown Topic'}`),
      '',
      'PROMPTS (with source keywords and topics):',
      ...result.prompts.map((prompt, index) => {
        const keyword = result.promptToKeyword[prompt]
        const topic = keyword ? result.keywordToTopic[keyword] : 'Unknown'
        return `${index + 1}. ${prompt} → ${keyword || 'Unknown Keyword'} → ${topic}`
      }),
      '',
      'MAPPING SUMMARY:',
      `• Keyword→Topic mappings: ${Object.keys(result.keywordToTopic).length}`,
      `• Prompt→Keyword mappings: ${Object.keys(result.promptToKeyword).length}`,
    ].join('\n')

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompts-${result.brandUrl.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.txt`
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
        {/* Header */}
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <MessageSquare className="h-8 w-8 text-blue-600" />
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Prompt Generator</h1>
                  <p className="text-sm text-gray-500">Generate SEO prompt sets from brand URLs</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* URL Input Form */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
                  Brand Website URL
                </label>
                <div className="flex space-x-3">
                  <input
                    type="text"
                    id="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Enter website URL (e.g., example.com, https://example.com)"
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    disabled={!url.trim() || isLoading}
                    className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center space-x-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Search className="h-5 w-5" />
                        <span>Generate Prompts</span>
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
                <h3 className="text-lg font-medium text-gray-900 mb-2">Generating Prompts</h3>
                <p className="text-gray-500 text-center">
                  This may take a few moments as we analyze the website content and generate SEO prompts...
                </p>
              </div>
            </div>
          )}

          {/* Results */}
          {result && !isLoading && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900">Results Summary</h2>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={downloadPrompts}
                      className="flex items-center space-x-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      <span>Download</span>
                    </button>
                    <a
                      href={result.brandUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center space-x-2 px-3 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span>Visit Site</span>
                    </a>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-indigo-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-indigo-600 truncate">{result.brandName}</div>
                    <div className="text-sm text-indigo-700">Brand Name</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-blue-600">{result.topics.length}</div>
                    <div className="text-sm text-blue-700">Topics</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-green-600">{result.keywords.length}</div>
                    <div className="text-sm text-green-700">Keywords</div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-purple-600">{result.totalPrompts}</div>
                    <div className="text-sm text-purple-700">Total Prompts</div>
                  </div>
                </div>
              </div>

              {/* Topics */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Extracted Topics</h3>
                <div className="flex flex-wrap gap-2">
                  {result.topics.map((topic, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              </div>

              {/* Keywords */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Generated Keywords</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {result.keywords.map((keyword, index) => (
                    <div
                      key={index}
                      className="px-3 py-2 bg-green-50 text-green-800 rounded-lg text-sm border border-green-200"
                    >
                      {keyword}
                    </div>
                  ))}
                </div>
              </div>

              {/* Prompts */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Generated Prompts</h3>
                <div className="space-y-3">
                  {result.prompts.map((prompt, index) => (
                    <div
                      key={index}
                      className="flex items-start justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-600 mb-1">Prompt #{index + 1}</div>
                        <div className="text-gray-900">{prompt}</div>
                      </div>
                      <button
                        onClick={() => copyToClipboard(prompt, index)}
                        className="ml-4 p-2 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Copy to clipboard"
                      >
                        {copiedIndex === index ? (
                          <RefreshCw className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!result && !isLoading && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <MessageSquare className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Prompts Generated Yet</h3>
              <p className="text-gray-500 mb-6">
                Enter a website URL above to generate SEO-optimized prompts for your brand.
              </p>
              <div className="bg-blue-50 rounded-lg p-4 text-left max-w-md mx-auto">
                <h4 className="font-medium text-blue-900 mb-2">How it works:</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Analyzes your website content</li>
                  <li>• Extracts key topics and themes</li>
                  <li>• Generates relevant keywords</li>
                  <li>• Creates SEO-optimized prompts</li>
                </ul>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default function PromptsPage() {
  return <PromptsContent />
}
