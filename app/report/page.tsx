'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import LoadingSpinner from '@/components/LoadingSpinner'
import { FileText, BarChart3, PieChart, TrendingUp, Download, Calendar } from 'lucide-react'

function ReportContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { isCollapsed } = useNavigation()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    }
  }, [status, router])

  if (status === 'loading') {
    return <LoadingSpinner />
  }

  if (status === 'unauthenticated') {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex">
      <SideNavigation />
      
      {/* Main Content */}
      <main className={`flex-1 transition-all duration-300 p-8 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">Analytics & Reports</h1>
                  <p className="text-gray-600">Comprehensive insights and performance analytics</p>
                </div>
              </div>
              <div className="flex space-x-3">
                <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center space-x-2">
                  <Download className="w-4 h-4" />
                  <span>Export Report</span>
                </button>
                <button className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-2">
                  <Calendar className="w-4 h-4" />
                  <span>Schedule Report</span>
                </button>
              </div>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <span className="text-green-600 text-sm font-semibold">+12%</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">2.4M</div>
              <div className="text-gray-600 text-sm">Total Impressions</div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <span className="text-green-600 text-sm font-semibold">+8.5%</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">45.2K</div>
              <div className="text-gray-600 text-sm">Clicks</div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <PieChart className="w-6 h-6 text-white" />
                </div>
                <span className="text-green-600 text-sm font-semibold">+15%</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">3.2%</div>
              <div className="text-gray-600 text-sm">Conversion Rate</div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <span className="text-green-600 text-sm font-semibold">+22%</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-1">$12.4K</div>
              <div className="text-gray-600 text-sm">Revenue</div>
            </div>
          </div>

          {/* Report Types */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center mb-4">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">SEO Performance</h3>
              <p className="text-gray-600 mb-4">Track keyword rankings, organic traffic, and search visibility.</p>
              <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                View SEO Report
              </button>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-gradient-to-br from-pink-500 to-red-600 rounded-xl flex items-center justify-center mb-4">
                <PieChart className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Social Media Analytics</h3>
              <p className="text-gray-600 mb-4">Analyze engagement, reach, and social media performance.</p>
              <button className="bg-pink-600 text-white px-4 py-2 rounded-lg hover:bg-pink-700 transition-colors">
                View Social Report
              </button>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-teal-600 rounded-xl flex items-center justify-center mb-4">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Ad Campaign Performance</h3>
              <p className="text-gray-600 mb-4">Monitor ad spend, ROI, and campaign effectiveness.</p>
              <button className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors">
                View Ad Report
              </button>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center mb-4">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Content Performance</h3>
              <p className="text-gray-600 mb-4">Track content engagement, shares, and conversion rates.</p>
              <button className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors">
                View Content Report
              </button>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-xl flex items-center justify-center mb-4">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Website Analytics</h3>
              <p className="text-gray-600 mb-4">Comprehensive website traffic and user behavior analysis.</p>
              <button className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors">
                View Website Report
              </button>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-xl flex items-center justify-center mb-4">
                <PieChart className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Competitor Analysis</h3>
              <p className="text-gray-600 mb-4">Compare your performance against competitors.</p>
              <button className="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors">
                View Comparison
              </button>
            </div>
          </div>

          {/* Recent Reports */}
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 mb-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Recent Reports</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Monthly SEO Report - December 2024</div>
                    <div className="text-sm text-gray-500">Generated on Dec 1, 2024</div>
                  </div>
                </div>
                <button className="text-blue-600 hover:text-blue-700 font-medium">Download</button>
              </div>

              <div className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Social Media Analytics - November 2024</div>
                    <div className="text-sm text-gray-500">Generated on Nov 30, 2024</div>
                  </div>
                </div>
                <button className="text-blue-600 hover:text-blue-700 font-medium">Download</button>
              </div>

              <div className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <PieChart className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">Ad Campaign Performance - Q4 2024</div>
                    <div className="text-sm text-gray-500">Generated on Nov 28, 2024</div>
                  </div>
                </div>
                <button className="text-blue-600 hover:text-blue-700 font-medium">Download</button>
              </div>
            </div>
          </div>

          {/* Coming Soon Section */}
          <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-400 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Advanced Analytics Coming Soon</h2>
              <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
                We're developing AI-powered analytics with predictive insights, automated reporting, 
                and advanced data visualization tools.
              </p>
              <div className="flex justify-center space-x-4">
                <button className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-6 py-3 rounded-xl font-semibold hover:from-indigo-700 hover:to-blue-700 transition-all">
                  Request Beta Access
                </button>
                <button className="border border-gray-300 text-gray-700 px-6 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors">
                  View Features
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default function ReportPage() {
  return <ReportContent />
}
