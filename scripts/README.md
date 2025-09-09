# Prompt Generation Scripts

This directory contains scripts for generating SEO prompts that are decoupled from the API endpoints.

## Scripts

### `generate-prompts.ts`

Standalone script for generating prompts for a brand URL and storing them in the MongoDB cache.

### `generate-data-table.ts`

Standalone script for generating full data table analysis for a brand URL and storing the results in MongoDB cache.

#### Usage

```bash
# Generate Prompts
npm run generate-prompts <brand-url>
npx tsx scripts/generate-prompts.ts <brand-url>

# Generate Data Table
npm run generate-data-table <brand-url> [platform]
npx tsx scripts/generate-data-table.ts <brand-url> [platform]

# Examples
npm run generate-prompts https://apple.com
npm run generate-data-table https://apple.com openai
npm run generate-data-table https://tesla.com google-ai
npx tsx scripts/generate-prompts.ts https://microsoft.com
npx tsx scripts/generate-data-table.ts https://microsoft.com openai
```

#### What it does

1. **Fetches Content**: Uses Exa.ai API to get brand content
2. **Extracts Brand Name**: Uses OpenAI to identify the main brand
3. **Generates Topics**: Extracts 4-6 SEO-relevant topics
4. **Creates Keywords**: Generates 10-15 keywords per topic
5. **Expands to Prompts**: Creates 5 prompts per keyword (informational, commercial, transactional)
6. **Builds Mappings**: Creates keyword→topic and prompt→keyword relationship mappings
7. **Caches Results**: Stores in MongoDB for API consumption

#### Data Table Generation Process (`generate-data-table.ts`)

1. **Gets Prompts**: Calls `/generate_prompt_set` API to get cached prompts
2. **Samples Prompts**: Randomly selects 5 prompts for analysis  
3. **Calls AI Platform**: Uses OpenAI (or other platforms) with web search
4. **Analyzes Brands**: Identifies all brand mentions and traces to root brands
5. **Calculates Metrics**: Computes visibility ratios and brand mention counts
6. **Sentiment Analysis**: Determines emotion (positive/negative/neutral)
7. **Caches Results**: Stores complete analysis in MongoDB

#### Output

```
🚀 Starting prompt generation for: https://apple.com
Step 1: Fetching content from Exa.ai...
Step 2: Extracting brand name...
Extracted brand name: Apple
Step 3: Extracting topics...
Extracted 6 topics: ["Technology", "Mobile Devices", "Computing", "Software", "Innovation", "Design"]
Step 4: Generating keywords for each topic...
Step 5: Generating prompts for keywords in batches...
✅ Prompt generation completed successfully!
📊 Generated 450 unique prompts
🏷️  Brand: Apple
📝 Topics: Technology, Mobile Devices, Computing, Software, Innovation, Design
🔗 Keywords: 90 total
🗂️  Keyword→Topic mappings: 90
📋 Prompt→Keyword mappings: 450
```

## API Integration

After running the script, the `/api/generate_prompt_set` endpoint will return cached data:

```bash
# Returns cached prompts if available
GET /api/generate_prompt_set?url=https://apple.com

# Force regeneration via API (optional)
GET /api/generate_prompt_set?url=https://apple.com&generate=true
```

## Data Structure

The generated data includes comprehensive mapping relationships:

```json
{
  "success": true,
  "brandUrl": "https://apple.com",
  "brandName": "Apple",
  "topics": ["Technology", "Mobile Devices", "Computing"],
  "keywords": ["smartphone", "laptop", "innovation"],
  "totalPrompts": 450,
  "prompts": ["smartphone", "best smartphone 2025", "how to choose smartphone"],
  "keywordToTopic": {
    "smartphone": "Mobile Devices",
    "laptop": "Computing",
    "innovation": "Technology"
  },
  "promptToKeyword": {
    "smartphone": "smartphone",
    "best smartphone 2025": "smartphone",
    "how to choose smartphone": "smartphone"
  }
}
```

### Mapping Benefits

- **Traceability**: Track each prompt back to its source keyword and topic
- **Analysis**: Understand which topics generate the most prompts
- **Filtering**: Group prompts by keyword or topic for targeted campaigns
- **Optimization**: Identify high-performing topic-keyword combinations

## Environment Variables

Make sure these are set in `.env.local`:

```env
EXA_API_KEY=your_exa_api_key
OPENAI_API_KEY=your_openai_api_key
MONGODB_URI=mongodb://localhost:27018/springbrand-ai
```

## Benefits of Decoupled Architecture

1. **Performance**: API responses are instant (cache-only)
2. **Reliability**: Generation errors don't affect API availability
3. **Flexibility**: Can run generation offline, scheduled, or on-demand
4. **Debugging**: Easier to debug generation process in isolation
5. **Scalability**: Can run multiple generations in parallel
6. **Cost Control**: Generate prompts only when needed

## Workflow

1. **Generate**: Run script to create prompts for a brand
2. **Cache**: Prompts are stored in MongoDB
3. **Serve**: API instantly returns cached data
4. **Update**: Re-run script to refresh prompts when needed
