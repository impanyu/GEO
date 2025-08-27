'use client'

import { SessionProvider } from 'next-auth/react'
import { NavigationProvider } from '@/contexts/NavigationContext'

export function Providers({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SessionProvider>
      <NavigationProvider>
        {children}
      </NavigationProvider>
    </SessionProvider>
  )
}
