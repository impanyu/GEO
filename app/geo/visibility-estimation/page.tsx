'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Search, Zap, Globe, MessageSquare, Target, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import SideNavigation from '../../../components/SideNavigation'
import { useNavigation } from '@/contexts/NavigationContext'

// List of 100 main public websites
const MAIN_WEBSITES = [
  'wikipedia.org', 'youtube.com', 'reddit.com', 'quora.com', 'stackoverflow.com',
  'github.com', 'medium.com', 'linkedin.com', 'twitter.com', 'facebook.com',
  'instagram.com', 'tiktok.com', 'pinterest.com', 'tumblr.com', 'discord.com',
  'slack.com', 'zoom.us', 'microsoft.com', 'google.com', 'apple.com',
  'amazon.com', 'netflix.com', 'spotify.com', 'twitch.tv', 'vimeo.com',
  'dropbox.com', 'notion.so', 'trello.com', 'asana.com', 'figma.com',
  'canva.com', 'adobe.com', 'shopify.com', 'wordpress.com', 'wix.com',
  'squarespace.com', 'mailchimp.com', 'hubspot.com', 'salesforce.com', 'zendesk.com',
  'intercom.com', 'stripe.com', 'paypal.com', 'coinbase.com', 'binance.com',
  'airbnb.com', 'uber.com', 'lyft.com', 'doordash.com', 'grubhub.com',
  'yelp.com', 'tripadvisor.com', 'booking.com', 'expedia.com', 'kayak.com',
  'cnn.com', 'bbc.com', 'nytimes.com', 'washingtonpost.com', 'reuters.com',
  'bloomberg.com', 'forbes.com', 'techcrunch.com', 'theverge.com', 'wired.com',
  'arstechnica.com', 'engadget.com', 'gizmodo.com', 'mashable.com', 'buzzfeed.com',
  'vice.com', 'vox.com', 'slate.com', 'theatlantic.com', 'newyorker.com',
  'espn.com', 'nfl.com', 'nba.com', 'mlb.com', 'fifa.com',
  'imdb.com', 'rottentomatoes.com', 'metacritic.com', 'goodreads.com', 'audible.com',
  'coursera.org', 'udemy.com', 'khanacademy.org', 'edx.org', 'duolingo.com',
  'webmd.com', 'mayoclinic.org', 'healthline.com', 'nih.gov', 'who.int',
  'weather.com', 'accuweather.com', 'maps.google.com', 'openstreetmap.org', 'bing.com',
  'duckduckgo.com', 'yahoo.com', 'baidu.com', 'yandex.com', 'ask.com'
]

const AGENT_PLATFORMS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'microsoft', label: 'Microsoft' },
  { value: 'meta', label: 'Meta' }
]

interface VisibilityResult {
  score: number
  nearestNeighbors: Array<{
    prompt: string
    domain: string
    sentence: string
    visibility: number
    similarity: number
  }>
}

interface OptimizationResult {
  originalScore: number
  optimizedSentence: string
  optimizedScore: number
  improvement: number
  candidates: Array<{
    sentence: string
    score: number
  }>
}

export default function VisibilityEstimationPage() {
  const { isCollapsed, setIsCollapsed } = useNavigation()
  
  // Form state
  const [brandUrl, setBrandUrl] = useState('')
  const [agentPlatform, setAgentPlatform] = useState('openai')
  const [prompt, setPrompt] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [content, setContent] = useState('')
  
  // Data state
  const [availablePrompts, setAvailablePrompts] = useState<string[]>([])
  const [filteredWebsites, setFilteredWebsites] = useState<string[]>([])
  const [filteredPrompts, setFilteredPrompts] = useState<string[]>([])
  
  // Results state
  const [visibilityResult, setVisibilityResult] = useState<VisibilityResult | null>(null)
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [neighborsExpanded, setNeighborsExpanded] = useState(false)
  const [candidatesExpanded, setCandidatesExpanded] = useState(false)

  // Load available prompts on component mount
  useEffect(() => {
    const loadPrompts = async () => {
      try {
        const response = await fetch('/api/get_available_prompts')
        if (response.ok) {
          const data = await response.json()
          setAvailablePrompts(data.prompts || [])
          setFilteredPrompts(data.prompts || [])
        }
      } catch (error) {
        console.error('Error loading prompts:', error)
      }
    }
    
    loadPrompts()
  }, [])

  // Filter websites based on input
  const handleWebsiteUrlChange = useCallback((value: string) => {
    setWebsiteUrl(value)
    if (value.length > 0) {
      const filtered = MAIN_WEBSITES.filter(site => 
        site.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 10)
      setFilteredWebsites(filtered)
    } else {
      setFilteredWebsites([])
    }
  }, [])

  // Filter prompts based on input
  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value)
    if (value.length > 0) {
      const filtered = availablePrompts.filter(p => 
        p.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 10)
      setFilteredPrompts(filtered)
    } else {
      setFilteredPrompts(availablePrompts.slice(0, 10))
    }
  }, [availablePrompts])

  // Get visibility score
  const handleGetVisibilityScore = async () => {
    if (!prompt.trim() || !websiteUrl.trim()) {
      alert('Please provide both prompt and website URL')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/get_visibility_score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandUrl,
          agentPlatform,
          prompt,
          domain: websiteUrl,
          sentence: content
        })
      })

      if (response.ok) {
        const result = await response.json()
        setVisibilityResult(result)
        setOptimizationResult(null) // Clear previous optimization
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error getting visibility score:', error)
      alert('Failed to get visibility score')
    } finally {
      setLoading(false)
    }
  }

  // Optimize content
  const handleOptimize = async () => {
    if (!prompt.trim() || !websiteUrl.trim()) {
      alert('Please provide both prompt and website URL')
      return
    }

    setOptimizing(true)
    try {
      const response = await fetch('/api/optimize_content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandUrl,
          agentPlatform,
          prompt,
          domain: websiteUrl,
          sentence: content
        })
      })

      if (response.ok) {
        const result = await response.json()
        setOptimizationResult(result)
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error optimizing content:', error)
      alert('Failed to optimize content')
    } finally {
      setOptimizing(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SideNavigation />
      
      <div className={`transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="p-8">
          <div className="max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Visibility Estimation
              </h1>
              <p className="text-gray-600">
                Estimate and optimize content visibility scores using AI-powered analysis
              </p>
            </div>

            {/* Input Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Brand URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Globe className="inline h-4 w-4 mr-1" />
                    Brand URL
                  </label>
                  <input
                    type="text"
                    value={brandUrl}
                    onChange={(e) => setBrandUrl(e.target.value)}
                    placeholder="e.g., example.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Agent Platform */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Target className="inline h-4 w-4 mr-1" />
                    Agent Platform
                  </label>
                  <select
                    value={agentPlatform}
                    onChange={(e) => setAgentPlatform(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {AGENT_PLATFORMS.map(platform => (
                      <option key={platform.value} value={platform.value}>
                        {platform.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Website URL */}
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Search className="inline h-4 w-4 mr-1" />
                    Website URL
                  </label>
                  <input
                    type="text"
                    value={websiteUrl}
                    onChange={(e) => handleWebsiteUrlChange(e.target.value)}
                    placeholder="Enter or select a website..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {filteredWebsites.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredWebsites.map((site, index) => (
                        <div
                          key={index}
                          onClick={() => {
                            setWebsiteUrl(site)
                            setFilteredWebsites([])
                          }}
                          className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                        >
                          {site}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Prompt - Full Width */}
              <div className="mt-6">
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <MessageSquare className="inline h-4 w-4 mr-1" />
                    Prompt
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => handlePromptChange(e.target.value)}
                    placeholder="Enter or select a prompt..."
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
                  />
                  {filteredPrompts.length > 0 && prompt && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                      {filteredPrompts.map((p, index) => (
                        <div
                          key={index}
                          onClick={() => {
                            setPrompt(p)
                            setFilteredPrompts([])
                          }}
                          className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                        >
                          {p.length > 80 ? `${p.substring(0, 80)}...` : p}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Content to Publish
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter the content about your brand to publish..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-4 mt-6">
                <button
                  onClick={handleGetVisibilityScore}
                  disabled={loading}
                  className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Target className="h-4 w-4 mr-2" />
                  {loading ? 'Calculating...' : 'Get Visibility Score'}
                </button>

                <button
                  onClick={handleOptimize}
                  disabled={optimizing}
                  className="flex items-center px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {optimizing ? 'Optimizing...' : 'Optimize'}
                </button>
              </div>
            </div>

            {/* Results */}
            {visibilityResult && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">
                  Visibility Score Results
                </h2>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-medium text-blue-900">
                      Visibility Score
                    </span>
                    <span className="text-2xl font-bold text-blue-600">
                      {(visibilityResult.score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-gray-900">
                    Top 10 Nearest Neighbors
                  </h3>
                  <button
                    onClick={() => setNeighborsExpanded(!neighborsExpanded)}
                    className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <span className="text-sm font-medium">
                      {neighborsExpanded ? 'Collapse' : 'Expand'}
                    </span>
                    {neighborsExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                </div>
                
                {neighborsExpanded && (
                  <div className="space-y-3">
                    {visibilityResult.nearestNeighbors.map((neighbor, index) => (
                      <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="font-medium text-gray-700">Prompt:</span>
                            <p className="text-gray-600 mt-1">
                              {neighbor.prompt.length > 50 ? `${neighbor.prompt.substring(0, 50)}...` : neighbor.prompt}
                            </p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Domain:</span>
                            <p className="text-gray-600 mt-1">{neighbor.domain}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Sentence:</span>
                            <p className="text-gray-600 mt-1">
                              {neighbor.sentence.length > 50 ? `${neighbor.sentence.substring(0, 50)}...` : neighbor.sentence}
                            </p>
                          </div>
                          <div className="flex justify-between">
                            <div>
                              <span className="font-medium text-gray-700">Visibility:</span>
                              <p className="text-gray-600 mt-1">{(neighbor.visibility * 100).toFixed(1)}%</p>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Similarity:</span>
                              <p className="text-gray-600 mt-1">{(neighbor.similarity * 100).toFixed(1)}%</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Optimization Results */}
            {optimizationResult && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">
                  Optimization Results
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="text-center">
                      <span className="text-sm font-medium text-red-700">Original Score</span>
                      <div className="text-2xl font-bold text-red-600 mt-1">
                        {(optimizationResult.originalScore * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="text-center">
                      <span className="text-sm font-medium text-green-700">Optimized Score</span>
                      <div className="text-2xl font-bold text-green-600 mt-1">
                        {(optimizationResult.optimizedScore * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="text-center">
                      <span className="text-sm font-medium text-blue-700">Improvement</span>
                      <div className="text-2xl font-bold text-blue-600 mt-1">
                        +{(optimizationResult.improvement * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                  <h3 className="text-lg font-medium text-green-900 mb-2">
                    Optimized Content
                  </h3>
                  <p className="text-green-800">
                    {optimizationResult.optimizedSentence}
                  </p>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-medium text-gray-900">
                    All Candidates Tested
                  </h3>
                  <button
                    onClick={() => setCandidatesExpanded(!candidatesExpanded)}
                    className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <span className="text-sm font-medium">
                      {candidatesExpanded ? 'Collapse' : 'Expand'}
                    </span>
                    {candidatesExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                </div>
                
                {candidatesExpanded && (
                  <div className="space-y-3">
                    {optimizationResult.candidates.map((candidate, index) => (
                      <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <p className="text-gray-800 flex-1 mr-4">
                            {candidate.sentence}
                          </p>
                          <span className="text-sm font-medium text-gray-600 whitespace-nowrap">
                            {(candidate.score * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
