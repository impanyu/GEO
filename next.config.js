/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  api: {
    responseLimit: false,
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  // Extend API route timeout for complex websites
  async rewrites() {
    return []
  },
}

module.exports = nextConfig
