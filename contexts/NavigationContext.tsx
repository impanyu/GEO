'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

interface NavigationContextType {
  isCollapsed: boolean
  setIsCollapsed: (collapsed: boolean) => void
  geoSubNavOpen: boolean
  setGeoSubNavOpen: (open: boolean) => void
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined)

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [geoSubNavOpen, setGeoSubNavOpen] = useState(false)

  return (
    <NavigationContext.Provider value={{ 
      isCollapsed, 
      setIsCollapsed,
      geoSubNavOpen,
      setGeoSubNavOpen
    }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  const context = useContext(NavigationContext)
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider')
  }
  return context
}
