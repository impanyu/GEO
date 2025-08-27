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
  ChevronRight
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
    href: '/optimize',
    icon: Bot,
    description: 'Generative Engine Optimization'
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

export default function SideNavigation() {
  const pathname = usePathname()
  const { isCollapsed, setIsCollapsed } = useNavigation()

  return (
    <div className={`fixed left-0 top-0 h-full bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white shadow-2xl transition-all duration-300 z-50 ${
      isCollapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
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

      {/* Navigation Items */}
      <nav className="mt-6 px-2">
        <div className="space-y-2">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href === '/optimize' && pathname?.startsWith('/optimize'))
            
            return (
              <Link
                key={item.name}
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
            )
          })}
        </div>
      </nav>

      {/* Footer */}
      {!isCollapsed && (
        <div className="absolute bottom-4 left-4 right-4">
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
