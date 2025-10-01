'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Home, 
  Bot, 
  Target, 
  Share2, 
  ExternalLink, 
  Megaphone, 
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Table,
  BarChart3,
  Globe
} from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'

const navigationItems = [
  {
    name: 'Main',
    href: '/',
    icon: Home,
    description: 'Landing page'
  },
  {
    name: 'GEO',
    href: '/geo',
    icon: Bot,
    description: 'Generative Engine Optimization',
    hasSubNav: true
  },
  {
    name: 'SEO',
    href: '/seo',
    icon: Target,
    description: 'Search Engine Optimization'
  },
  {
    name: 'Social',
    href: '/social',
    icon: Share2,
    description: 'Social Media Marketing'
  },
  {
    name: 'Off-Site',
    href: '/offsite',
    icon: ExternalLink,
    description: 'Off-site Promotion'
  },
  {
    name: 'Ad',
    href: '/ad',
    icon: Megaphone,
    description: 'Advertisement Campaigns'
  },
  {
    name: 'Report',
    href: '/report',
    icon: FileText,
    description: 'Analytics & Reports'
  }
]

const geoSubNavItems = [
  {
    name: 'Prompts',
    href: '/geo/prompts',
    icon: MessageSquare,
    description: 'Generate prompt sets'
  },
  {
    name: 'Data Table',
    href: '/geo/data-table',
    icon: Table,
    description: 'Data table view'
  },
  {
    name: 'Full Web Content',
    href: '/geo/full-web-content',
    icon: Globe,
    description: 'Web content analysis'
  },
  {
    name: 'Simple Web Content',
    href: '/geo/simple-web-content',
    icon: Globe,
    description: 'Simplified web content'
  },
  {
    name: 'Agent Recommendation',
    href: '/geo/agent-recommendation-content',
    icon: Bot,
    description: 'AI agent recommendations'
  },
  {
    name: 'Simple Agent Rec',
    href: '/geo/agent-recommendation-simple',
    icon: Bot,
    description: 'Simplified agent recommendations'
  },
  {
    name: 'Policy Report',
    href: '/geo/policy-report',
    icon: FileText,
    description: 'Brand visibility policy analysis'
  },
  {
    name: 'GEO Result',
    href: '/optimize',
    icon: BarChart3,
    description: 'Optimization results'
  }
]

export default function SideNavigation() {
  const pathname = usePathname()
  const { isCollapsed, setIsCollapsed, geoSubNavOpen, setGeoSubNavOpen } = useNavigation()

  return (
    <div className={`fixed left-0 top-0 h-full bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white shadow-2xl transition-all duration-300 z-50 flex flex-col ${
      isCollapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700 flex-shrink-0">
        {!isCollapsed && (
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="font-bold text-lg bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Springbrand
            </span>
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Navigation Items - Scrollable */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden mt-6 px-2 pb-4" style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#475569 #1e293b'
      }}>
        <div className="space-y-2">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href === '/optimize' && pathname?.startsWith('/optimize')) ||
              (item.name === 'GEO' && (pathname?.startsWith('/geo') || pathname?.startsWith('/optimize')))
            
            return (
              <div key={item.name}>
                {/* Main navigation item */}
                {item.hasSubNav ? (
                  <div
                    onClick={() => {
                      if (!isCollapsed) {
                        setGeoSubNavOpen(!geoSubNavOpen)
                      }
                    }}
                    className={`group flex items-center px-3 py-3 rounded-xl transition-all duration-200 relative overflow-hidden cursor-pointer ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg transform scale-105'
                        : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                    }`}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <div className="absolute left-0 top-0 w-1 h-full bg-gradient-to-b from-blue-400 to-purple-400 rounded-r-full" />
                    )}
                    
                    {/* Icon */}
                    <div className={`flex-shrink-0 ${isCollapsed ? 'mx-auto' : 'mr-3'}`}>
                      <item.icon className={`w-5 h-5 ${
                        isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'
                      }`} />
                    </div>
                    
                    {/* Text and Chevron */}
                    {!isCollapsed && (
                      <div className="flex-1 min-w-0 flex items-center justify-between">
                        <div>
                          <div className={`font-medium ${
                            isActive ? 'text-white' : 'text-slate-300 group-hover:text-white'
                          }`}>
                            {item.name}
                          </div>
                          <div className={`text-xs mt-0.5 ${
                            isActive ? 'text-blue-100' : 'text-slate-500 group-hover:text-slate-400'
                          }`}>
                            {item.description}
                          </div>
                        </div>
                        <div className="flex-shrink-0 ml-2">
                          {geoSubNavOpen ? (
                            <ChevronUp className={`w-4 h-4 ${
                              isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'
                            }`} />
                          ) : (
                            <ChevronDown className={`w-4 h-4 ${
                              isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'
                            }`} />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Hover effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-xl" />
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className={`group flex items-center px-3 py-3 rounded-xl transition-all duration-200 relative overflow-hidden ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg transform scale-105'
                        : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                    }`}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <div className="absolute left-0 top-0 w-1 h-full bg-gradient-to-b from-blue-400 to-purple-400 rounded-r-full" />
                    )}
                    
                    {/* Icon */}
                    <div className={`flex-shrink-0 ${isCollapsed ? 'mx-auto' : 'mr-3'}`}>
                      <item.icon className={`w-5 h-5 ${
                        isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'
                      }`} />
                    </div>
                    
                    {/* Text */}
                    {!isCollapsed && (
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium ${
                          isActive ? 'text-white' : 'text-slate-300 group-hover:text-white'
                        }`}>
                          {item.name}
                        </div>
                        <div className={`text-xs mt-0.5 ${
                          isActive ? 'text-blue-100' : 'text-slate-500 group-hover:text-slate-400'
                        }`}>
                          {item.description}
                        </div>
                      </div>
                    )}

                    {/* Hover effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-xl" />
                  </Link>
                )}

                {/* Sub-navigation for GEO */}
                {item.hasSubNav && geoSubNavOpen && !isCollapsed && (
                  <div className="mt-2 ml-6 space-y-1">
                    {geoSubNavItems.map((subItem) => {
                      const isSubActive = pathname === subItem.href
                      
                      return (
                        <Link
                          key={subItem.name}
                          href={subItem.href}
                          className={`group flex items-center px-3 py-2 rounded-lg transition-all duration-200 relative overflow-hidden text-sm ${
                            isSubActive
                              ? 'bg-slate-700 text-blue-300 border-l-2 border-blue-400'
                              : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
                          }`}
                        >
                          {/* Icon */}
                          <div className="flex-shrink-0 mr-3">
                            <subItem.icon className={`w-4 h-4 ${
                              isSubActive ? 'text-blue-300' : 'text-slate-500 group-hover:text-white'
                            }`} />
                          </div>
                          
                          {/* Text */}
                          <div className="flex-1 min-w-0">
                            <div className={`font-medium ${
                              isSubActive ? 'text-blue-300' : 'text-slate-400 group-hover:text-white'
                            }`}>
                              {subItem.name}
                            </div>
                            <div className={`text-xs mt-0.5 ${
                              isSubActive ? 'text-blue-200' : 'text-slate-600 group-hover:text-slate-400'
                            }`}>
                              {subItem.description}
                            </div>
                          </div>

                          {/* Hover effect */}
                          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-lg" />
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </nav>

      {/* Footer */}
      {!isCollapsed && (
        <div className="flex-shrink-0 p-4">
          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
            <div className="text-xs text-slate-400 text-center">
              AI-Powered Marketing Suite
            </div>
            <div className="text-xs text-slate-500 text-center mt-1">
              v1.0.0
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
