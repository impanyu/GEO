# Springbrand.ai - Generative Engine Optimization

Advanced AI Agent for Generative Engine Optimization with authentication-protected interface.

## Features

- 🔐 **Google OAuth Authentication** - Secure login with Google accounts
- 📊 **MongoDB Integration** - User data storage and management
- 🎨 **Modern UI** - Beautiful, responsive interface built with Tailwind CSS
- 🚀 **Next.js 14** - Latest React framework with App Router
- 🔒 **Protected Routes** - Authentication-required access to the optimization dashboard

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- MongoDB (local or MongoDB Atlas)
- Google OAuth credentials

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd GEO
npm install
```

### 2. Environment Setup

Create a `.env.local` file in the root directory:

```env
# NextAuth.js
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key-here

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# MongoDB
MONGODB_URI=mongodb://localhost:27017/springbrand-ai
# Or for MongoDB Atlas: mongodb+srv://username:password@cluster.mongodb.net/springbrand-ai
```

### 3. Google OAuth Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to "Credentials" and create OAuth 2.0 Client IDs
5. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (development)
   - `https://your-domain.com/api/auth/callback/google` (production)
6. Copy the Client ID and Client Secret to your `.env.local` file

### 4. MongoDB Setup

**Option A: Local MongoDB**
```bash
# Install MongoDB locally and start the service
mongod --dbpath /path/to/your/data/directory
```

**Option B: MongoDB Atlas**
1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a new cluster
3. Get the connection string and add it to your `.env.local`

### 5. Run the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
├── app/                    # Next.js 14 App Router
│   ├── auth/              # Authentication pages
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page (protected)
│   └── providers.tsx      # Context providers
├── components/            # React components
│   ├── LandingPage.tsx    # Main dashboard
│   └── LoadingSpinner.tsx # Loading component
├── lib/                   # Utilities
│   └── mongodb.ts         # MongoDB connection
├── pages/api/auth/        # NextAuth.js API routes
├── types/                 # TypeScript definitions
└── env.example           # Environment variables template
```

## Usage

1. **Authentication**: Users must sign in with their Google account to access the application
2. **URL Optimization**: Enter a webpage URL in the input field on the landing page
3. **AI Processing**: The system will process the URL for optimization recommendations
4. **Results**: View detailed optimization suggestions and improvements

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repository to [Vercel](https://vercel.com)
3. Add environment variables in Vercel dashboard
4. Deploy

### Environment Variables for Production

```env
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=your-production-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
MONGODB_URI=your-production-mongodb-uri
```

## Technologies Used

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS
- **Authentication**: NextAuth.js with Google OAuth
- **Database**: MongoDB with Mongoose
- **Icons**: Lucide React
- **Deployment**: Vercel (recommended)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see the [LICENSE](LICENSE) file for details.
