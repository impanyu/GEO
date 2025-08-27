'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useNavigation } from '@/contexts/NavigationContext'
import SideNavigation from '@/components/SideNavigation'
import LandingPage from '@/components/LandingPage'
import LoadingSpinner from '@/components/LoadingSpinner'

function HomeContent() {
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
    return null // Will redirect to signin
  }

  return (
    <div className="min-h-screen flex">
      <SideNavigation />
      <div className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        <LandingPage />
      </div>
    </div>
  )
}

export default function Home() {
  return <HomeContent />
}
