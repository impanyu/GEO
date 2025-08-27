'use client'

import { signIn, getSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Globe, Chrome } from 'lucide-react'

export default function SignIn() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const checkSession = async () => {
      const session = await getSession()
      if (session) {
        router.push('/')
      }
    }
    checkSession()
  }, [router])

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl: '/' })
    } catch (error) {
      console.error('Sign in error:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Logo and Header */}
        <div className="text-center">
          <div className="flex justify-center items-center space-x-3 mb-6">
            <Globe className="h-12 w-12 text-blue-600" />
            <span className="text-3xl font-bold text-gray-900">Springbrand.ai</span>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Welcome Back
          </h2>
          <p className="text-gray-600">
            Sign in to access your AI-powered optimization dashboard
          </p>
        </div>

        {/* Sign In Card */}
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl border border-gray-200 p-8">
          <div className="space-y-6">
            <div className="text-center">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Continue with Google
              </h3>
              <p className="text-sm text-gray-600">
                Use your Google account to access Springbrand.ai
              </p>
            </div>

            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full flex items-center justify-center px-6 py-4 border border-gray-300 rounded-2xl shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600"></div>
              ) : (
                <>
                  <Chrome className="h-5 w-5 mr-3 text-blue-600" />
                  <span>Sign in with Google</span>
                </>
              )}
            </button>

            <div className="text-center">
              <p className="text-xs text-gray-500">
                By signing in, you agree to our{' '}
                <a href="#" className="text-blue-600 hover:text-blue-700">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="#" className="text-blue-600 hover:text-blue-700">
                  Privacy Policy
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* Features Preview */}
        <div className="text-center space-y-4">
          <h4 className="text-lg font-medium text-gray-900">
            What you'll get access to:
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center justify-center space-x-2 text-gray-600">
              <div className="h-2 w-2 bg-blue-600 rounded-full"></div>
              <span>AI-Powered Analysis</span>
            </div>
            <div className="flex items-center justify-center space-x-2 text-gray-600">
              <div className="h-2 w-2 bg-purple-600 rounded-full"></div>
              <span>Real-time Optimization</span>
            </div>
            <div className="flex items-center justify-center space-x-2 text-gray-600">
              <div className="h-2 w-2 bg-green-600 rounded-full"></div>
              <span>Detailed Reports</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
