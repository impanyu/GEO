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

## Scripts Usage

This project includes several powerful scripts for SEO prompt generation and brand visibility analysis. All scripts require proper environment variable configuration.

### Prerequisites for Scripts

Ensure your `.env.local` file includes:

```env
# OpenAI API
OPENAI_API_KEY=your-openai-api-key

# Exa.ai API (for web content analysis)
EXA_API_KEY=your-exa-api-key

# SerpApi (for web search analysis)
SERPAPI_KEY=your-serpapi-key

# MongoDB (required for data storage)
MONGODB_URI=mongodb://localhost:27017/springbrand-ai

# Next.js (for API calls)
NEXTAUTH_URL=http://localhost:3000
```

### 1. Generate Prompt Sets

Generate SEO-optimized prompts from brand websites using AI-powered content analysis.

```bash
# Generate prompts for a single website
npm run generate-prompts https://apple.com

# Generate prompts for multiple websites
npm run generate-prompts https://apple.com https://microsoft.com
```

**What it does:**
- Analyzes website content using Exa.ai
- Extracts 4-6 major topics relevant to the brand
- Generates 10-15 SEO keywords per topic
- Creates 5 prompt variations per keyword
- Stores results in MongoDB with topic/keyword mappings

**Output:** Cached in MongoDB and accessible via the web interface at `/geo/prompts`

### 2. Generate Data Table Analysis

Perform comprehensive brand visibility analysis across multiple AI platforms.

```bash
# Basic usage with default OpenAI platform
npm run generate-data-table https://apple.com

# Specify platform explicitly
npm run generate-data-table openai https://apple.com

# Analyze multiple brands simultaneously
npm run generate-data-table openai https://apple.com https://microsoft.com

# Future platform support
npm run generate-data-table google-ai https://apple.com
```

**Configuration Variables:**
- `QUERIES_PER_PROMPT`: Number of queries per prompt (default: 5)
- `SAMPLED_PROMPTS_COUNT`: Number of prompts to analyze (default: 5)

**What it does:**
1. **Prompt Generation**: Gets prompts from `generate-prompt-set` API
2. **Random Sampling**: Selects configured number of prompts for analysis
3. **Multi-Query Analysis**: Runs each prompt multiple times through AI platforms
4. **Brand Mention Analysis**: Uses AI to detect and rank brand mentions
5. **Data Storage**: Stores query responses and analysis results in MongoDB
6. **Metrics Calculation**: Computes visibility scores, average rankings, and appearance rates

**Output:** 
- Cached in MongoDB 
- Accessible via web interface at `/geo/data-table`
- Supports both individual prompt and topic-grouped analysis

### 3. Analyze Web Content

Perform comprehensive web content analysis using Google search results to understand brand perception across 15 content dimensions.

```bash
# Analyze web content for multiple brands
npm run analyze-web-content https://apple.com https://microsoft.com

# Example with other brands
npm run analyze-web-content https://tesla.com https://nike.com https://spotify.com
```

**Required Environment Variables:**
- `SERPAPI_KEY`: SerpApi key for Google search functionality  
- `FIRECRAWL_API_KEY`: Firecrawl API key for web scraping
- `OPENROUTER_API_KEY`: OpenRouter API key for LLM content analysis (supports multiple AI models)

**What it does:**
- Extracts brand names from provided URLs
- Searches Google for each brand (top 100 organic results)
- Scrapes page summaries using Firecrawl API
- Analyzes content with AI models (via OpenRouter) across 15 dimensions
- Stores results in new data structure: `{dimension: {domain: [sentences]}}`

**Target Websites (25 sites):**
- News & Media: Wikipedia, Google Blog, NY Times, Forbes, Washington Post
- Social & Reviews: Reddit, Facebook, Instagram, Yelp, Trustpilot
- Business & Tech: LinkedIn, Medium, G2, Capterra, NerdWallet
- E-commerce & Entertainment: Amazon, YouTube, IMDB
- Health & Lifestyle: Healthline, Good Housekeeping, Bankrate
- Reference: Britannica, Quora, TripAdvisor

**15 Content Dimensions Analyzed:**
1. **Functionality** - Core features and problem-solving capabilities
2. **Quality** - Materials, build, craftsmanship, durability
3. **Performance/Reliability** - Consistency, uptime, dependability
4. **Design & Aesthetic** - Visual identity, style, UI/UX
5. **Price/Value Proposition** - Cost-benefit analysis, value for money
6. **Innovation/Technology** - Novel aspects, technological edge
7. **Safety/Security/Privacy** - Protection, compliance, data safety
8. **Sustainability/Ethics** - Environmental impact, ethical practices
9. **Trustworthiness/Credibility** - Certifications, reviews, reputation
10. **Core Values/Mission** - Brand beliefs, social mission
11. **Story/Origin** - Founder's story, brand narrative
12. **Emotional Connection** - Brand personality, customer feelings
13. **Differentiation/USP** - Unique selling propositions
14. **User/Audience Identity** - Target demographics, user experience
15. **After-Sales Support** - Customer service, loyalty programs

**What it does:**
1. **Prompt Sampling**: Gets 5 SEO prompts from existing cache or generates new ones
2. **Multi-Site Search**: Searches each prompt across all 25 target websites using [SerpApi](https://serpapi.com/search-api)
3. **Content Extraction**: Retrieves full webpage content using Exa.ai API
4. **AI Content Analysis**: Uses GPT-4 to categorize content into 15 brand dimensions
5. **Frequency Counting**: Tracks snippet frequency and semantic similarity
6. **Data Storage**: Stores comprehensive analysis in `full_web_content` MongoDB collection

**Output:**
- Comprehensive brand perception analysis across major web platforms
- Content categorized into 15 strategic dimensions
- Frequency analysis of brand mentions and associations
- Stored in MongoDB `full_web_content` collection for further analysis

### 3. Script Configuration

You can modify script behavior by editing the configuration constants:

**In `scripts/generate-data-table.ts`:**
```typescript
// Number of queries per prompt (1-10 recommended)
const QUERIES_PER_PROMPT = 5

// Number of prompts to sample for analysis (1-20 recommended)
const SAMPLED_PROMPTS_COUNT = 5
```

**In `scripts/generate-prompts.ts`:**
```typescript
// Additional configuration options available in the script
```

### 4. Web Interface Integration

All scripts integrate with the web interface:

**Prompt Generation:**
- Navigate to `/geo/prompts`
- Enter brand URL
- View generated topics, keywords, and prompts
- Download results as structured JSON

**Data Table Analysis:**
- Navigate to `/geo/data-table`
- Enter brand URL and select platform
- Choose grouping: by individual prompts or by topics
- Apply date range filters
- View detailed brand visibility metrics
- Download full analysis results

### 5. Data Storage Structure

**Prompt Cache (`prompt_cache` collection):**
```json
{
  "normalizedUrl": "https://apple.com",
  "brandName": "Apple",
  "topics": ["smartphones", "computers"],
  "keywords": ["iPhone", "MacBook", ...],
  "prompts": ["latest iPhone features", ...],
  "keywordToTopic": {"iPhone": "smartphones"},
  "promptToKeyword": {"latest iPhone features": "iPhone"}
}
```

**Data Table Cache (`data_table_cache` collection):**
```json
{
  "normalizedUrl": "https://apple.com",
  "brandName": "Apple",
  "agenticPlatform": "openai",
  "results": [
    {
      "prompt": "latest iPhone features",
      "topic": "smartphones",
      "datetime": "2025-01-01T10:00:00Z",
      "brandAnalysis": {
        "totalAppearancesAcrossResponses": 3,
        "avgAppearancesPerResponse": 0.6,
        "avgRank": 2.5
      },
      "totalCitationsOfAllBrands": 5
    }
  ]
}
```

**Query Responses (`query_responses` collection):**
```json
{
  "prompt": "latest iPhone features",
  "responses": [
    {
      "output_text": "Response text...",
      "annotations": [{"type": "url_citation", "url": "...", "title": "..."}]
    }
  ],
  "agenticPlatform": "openai",
  "queryDatetime": "2025-01-01T10:00:00Z"
}
```

### 6. Troubleshooting

**Common Issues:**

1. **"Exa API key not configured"**
   ```bash
   # Ensure EXA_API_KEY is set in .env.local
   echo $EXA_API_KEY  # Should show your key
   ```

2. **"MongoDB connection failed"**
   ```bash
   # Check MongoDB is running
   mongod --dbpath ./data/db
   # Or verify Atlas connection string
   ```

3. **"OpenAI API rate limit"**
   - Reduce `QUERIES_PER_PROMPT` and `SAMPLED_PROMPTS_COUNT`
   - Add delays between script runs

4. **"No web search activity detected"**
   - This is expected behavior with current OpenAI API limitations
   - Scripts include fallback logic for analysis

**Logs and Debugging:**
- Scripts provide detailed console output
- Check MongoDB collections for stored data
- Use browser DevTools to inspect API responses

### 7. Performance Considerations

**Script Execution Times:**
- `generate-prompts`: 2-5 minutes per URL
- `generate-data-table`: 10-30 minutes per URL (depends on configuration)

**Resource Usage:**
- API calls: OpenAI, Exa.ai (monitor usage and costs)
- MongoDB storage: ~1-10MB per brand analysis
- Memory: ~100-500MB during script execution

**Optimization Tips:**
- Run scripts during off-peak hours
- Use smaller `SAMPLED_PROMPTS_COUNT` for testing
- Implement API key rotation for high-volume usage

## API Documentation

The system provides two main REST APIs for programmatic access to SEO analysis and brand visibility features.

### 1. Generate Prompt Set API

**Endpoint:** `GET /api/generate_prompt_set`

Generate SEO-optimized prompts from brand websites using AI-powered content analysis.

**Parameters:**
- `url` (required): Brand website URL to analyze

**Example Request:**
```bash
curl "http://localhost:3000/api/generate_prompt_set?url=https://apple.com"
```

**Response Format:**
```json
{
  "success": true,
  "brandUrl": "https://apple.com",
  "brandName": "Apple",
  "topics": [
    "smartphones",
    "computers", 
    "tablets",
    "software"
  ],
  "keywords": [
    "iPhone",
    "MacBook",
    "iPad",
    "iOS",
    "...additional keywords"
  ],
  "totalPrompts": 245,
  "prompts": [
    "latest iPhone features",
    "MacBook Pro specifications",
    "iPad productivity apps",
    "...additional prompts"
  ],
  "keywordToTopic": {
    "iPhone": "smartphones",
    "MacBook": "computers",
    "iPad": "tablets"
  },
  "promptToKeyword": {
    "latest iPhone features": "iPhone",
    "MacBook Pro specifications": "MacBook"
  }
}
```

**Features:**
- **Automatic Caching**: Results are cached in MongoDB for faster subsequent requests
- **URL Normalization**: Handles various URL formats (with/without protocol, www, trailing slashes)
- **Topic Extraction**: Uses AI to identify 4-6 major brand themes
- **Keyword Generation**: Creates 10-15 SEO keywords per topic
- **Prompt Expansion**: Generates 5 prompt variations per keyword
- **Relationship Mapping**: Provides topic↔keyword↔prompt relationships

**Error Responses:**
```json
{
  "success": false,
  "error": "Invalid URL format"
}
```

### 2. Get Full Data Table API

**Endpoint:** `GET /api/get_full_data_table`

Retrieve comprehensive brand visibility analysis results with advanced filtering and grouping options.

**Parameters:**
- `url` (required): Brand website URL to analyze
- `platform` (optional): AI platform used for analysis (default: "openai")
- `group_by` (optional): Grouping method - "prompt" or "topic" (default: "prompt")
- `begin_datetime` (optional): Filter results from this datetime (ISO format)
- `end_datetime` (optional): Filter results until this datetime (ISO format)

**Example Requests:**
```bash
# Basic request
curl "http://localhost:3000/api/get_full_data_table?url=https://apple.com"

# With grouping and date filtering
curl "http://localhost:3000/api/get_full_data_table?url=https://apple.com&group_by=topic&begin_datetime=2025-01-01T00:00:00.000Z&end_datetime=2025-12-31T23:59:59.000Z"

# Specify platform
curl "http://localhost:3000/api/get_full_data_table?url=https://apple.com&platform=openai"
```

**Response Format (group_by=prompt):**
```json
[
  {
    "normalizedBrandUrl": "https://apple.com",
    "brandName": "Apple",
    "agenticPlatform": "openai",
    "prompt": "latest iPhone features",
    "topic": "smartphones",
    "datetime": "2025-01-01T10:00:00.000Z",
    "brandAnalysis": {
      "brandName": "Apple",
      "totalAppearancesAcrossResponses": 3,
      "avgAppearancesPerResponse": 0.6,
      "avgRank": 2.5
    },
    "totalCitationsOfAllBrands": 5,
    "queryResponseDocumentId": "60f7b3b3b3b3b3b3b3b3b3b3"
  }
]
```

**Response Format (group_by=topic):**
```json
[
  {
    "topic": "smartphones",
    "normalizedBrandUrl": "https://apple.com",
    "brandName": "Apple",
    "agenticPlatform": "openai",
    "promptCount": 3,
    "totalAppearances": 8,
    "totalQueries": 15,
    "visibility": 0.533,
    "avgRank": 2.8,
    "datetime": "2025-01-01T10:00:00.000Z",
    "prompts": [
      "latest iPhone features",
      "iPhone vs competitors", 
      "smartphone reviews"
    ]
  }
]
```

**Features:**
- **Cached Results**: Returns stored analysis data from MongoDB
- **Flexible Grouping**: View data by individual prompts or aggregated by topics
- **Date Range Filtering**: Filter results by analysis timestamp
- **Platform Support**: Currently supports OpenAI, extensible for other platforms
- **Comprehensive Metrics**: Includes visibility scores, rankings, and appearance counts
- **Topic Aggregation**: Automatically calculates topic-level statistics

**Query Response Integration:**
Access detailed query responses using the `queryResponseDocumentId`:
```bash
curl "http://localhost:3000/api/query-responses/{queryResponseDocumentId}"
```

**Error Responses:**
```json
{
  "error": "Invalid URL format",
  "status": 400
}
```

```json
{
  "error": "No data found for the specified URL and platform",
  "status": 404
}
```

**Data Generation:**
- Data is generated using the `generate-data-table` script
- Results are automatically cached for API access
- No real-time generation - APIs serve pre-analyzed data

**Integration Notes:**
- Both APIs integrate with the web interface at `/geo/prompts` and `/geo/data-table`
- APIs support the same URL normalization as the scripts
- All timestamps are in ISO 8601 format
- Caching ensures fast response times for repeated requests

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
