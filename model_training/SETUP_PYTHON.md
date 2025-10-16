# Python Environment Setup for Model Training

## Current Status

✅ **MongoDB**: Running on port 27018 with 1309 training examples  
✅ **Plotting Script**: Created at `plot_visibility_analysis.py`  
⚠️ **Python**: Not yet installed

## Quick Setup Guide

### Option 1: Install Python using Homebrew (Recommended)

```bash
# Install Python 3
brew install python3

# Verify installation
python3 --version

# Install pip packages
cd /Users/impanyu/git_repo/GEO/model_training
pip3 install -r requirements.txt
```

### Option 2: Install Python from Official Website

1. Download Python 3.11+ from https://www.python.org/downloads/macos/
2. Install the downloaded package
3. Open a new terminal and verify:
   ```bash
   python3 --version
   ```
4. Install packages:
   ```bash
   cd /Users/impanyu/git_repo/GEO/model_training
   pip3 install -r requirements.txt
   ```

### Option 3: Use Conda/Miniconda

```bash
# Install Miniconda (if not already installed)
brew install --cask miniconda

# Create environment
conda create -n geo-training python=3.11

# Activate environment
conda activate geo-training

# Install packages
cd /Users/impanyu/git_repo/GEO/model_training
pip install -r requirements.txt
```

## Minimal Installation (Just for Plotting)

If you only want to run the plotting script without the full ML training environment:

```bash
# After installing Python 3
pip3 install pymongo matplotlib pandas numpy seaborn python-dotenv
```

## Running the Plotting Script

Once Python and packages are installed:

```bash
cd /Users/impanyu/git_repo/GEO/model_training
python3 plot_visibility_analysis.py
```

**Expected Output:**
- 6 PNG plot files
- 1 summary report TXT file
- Console output showing progress

**Time to complete:** ~10-30 seconds depending on data size

## What the Script Does

### 1. Average Visibility by Prompts
Creates a horizontal bar chart showing:
- Top 30 prompts ranked by average visibility
- Color-coded bars (green = high visibility, red = low)
- Sample counts for each prompt

### 2. Average Visibility by Sentences  
Creates a horizontal bar chart showing:
- Top 30 sentences ranked by average visibility
- How different sentence formulations perform
- Sample counts per sentence

### 3. Average Visibility by Domains
Creates a horizontal bar chart showing:
- Top 50 domains ranked by average visibility  
- Which domains have higher visibility scores
- Sample counts per domain

### 4. Distribution Plots
Creates histogram and cumulative distribution plots for:
- Prompt visibility distribution
- Sentence visibility distribution
- Domain visibility distribution

### 5. Summary Report
Generates a text file with:
- Statistical summaries (mean, median, std dev, percentiles)
- Top 10 performers in each category
- Total counts and sample sizes

## Troubleshooting

### Issue: "command not found: python3"
**Solution:** Python is not installed. Follow Option 1 or 2 above.

### Issue: "No module named 'pymongo'"
**Solution:** Packages not installed. Run:
```bash
pip3 install -r requirements.txt
```

### Issue: "MONGODB_URI environment variable is not set"
**Solution:** Ensure `.env.local` exists in the parent directory with:
```env
MONGODB_URI=mongodb://localhost:27018/springbrand-ai
```

### Issue: "No training data found in database"
**Solution:** Run the training data generation script first:
```bash
cd /Users/impanyu/git_repo/GEO
npm run generate-training-data
```

### Issue: xcrun errors on macOS
**Solution:** These are warnings about Xcode Command Line Tools but shouldn't prevent Python from working. If Python itself fails, reinstall Command Line Tools:
```bash
xcode-select --install
```

## Verifying Your Setup

Run this command to verify everything is ready:

```bash
cd /Users/impanyu/git_repo/GEO/model_training

# Check Python
python3 --version

# Check packages
python3 -c "import pymongo, matplotlib, pandas, numpy, seaborn; print('✅ All packages ready')"

# Check MongoDB connection
mongosh --port 27018 springbrand-ai --eval "db.prompt_domain_sentences_visibility_training_data.countDocuments()" --quiet

# Check environment file
test -f ../.env.local && echo "✅ .env.local exists" || echo "❌ .env.local not found"
```

If all checks pass, you're ready to run:
```bash
python3 plot_visibility_analysis.py
```

## Expected Results

After running the script successfully, you should see:

```
======================================================================
VISIBILITY ANALYSIS - PLOTTING SCRIPT
======================================================================
🔗 Connecting to MongoDB...
📊 Fetching training data...
✅ Loaded 1309 training examples

📊 Analyzing 1309 training examples...

🔍 Calculating visibility by prompt...
   Found X unique prompts

🔍 Calculating visibility by sentence...
   Found X unique sentences

🔍 Calculating visibility by domain...
   Found X unique domains

📈 Generating plots...
✅ Saved plot: visibility_by_prompts.png
✅ Saved plot: visibility_by_sentences.png
✅ Saved plot: visibility_by_domains.png

📊 Generating distribution plots...
✅ Saved distribution plot: visibility_distribution_prompts.png
✅ Saved distribution plot: visibility_distribution_sentences.png
✅ Saved distribution plot: visibility_distribution_domains.png

📝 Generating summary report...
✅ Saved summary report: visibility_summary_report.txt

======================================================================
✅ ALL PLOTS GENERATED SUCCESSFULLY!
======================================================================
```

## Next Steps

After generating the plots:

1. **Review the plots** - Open the PNG files to see visibility patterns
2. **Read the summary** - Check `visibility_summary_report.txt` for statistics
3. **Identify insights** - Look for:
   - Which prompts have highest visibility
   - Which sentence structures work best
   - Which domains perform well
4. **Iterate** - Use insights to improve your content optimization strategy

## Additional Resources

- Main README: `../README.md`
- Model Training Guide: `README.md`
- Requirements: `requirements.txt`

---

**Your Data:** 1309 training examples ready to analyze!

