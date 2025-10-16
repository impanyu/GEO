# Manual Setup Guide

Your Python 3.14.0 is ready! Here are the manual steps if you prefer to set up the environment yourself:

## Quick Setup (2 minutes)

```bash
cd /Users/impanyu/git_repo/GEO/model_training

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install packages
pip install pymongo matplotlib pandas numpy seaborn python-dotenv

# Run the plotting script
python3 plot_visibility_analysis.py
```

## What This Does

1. **Creates virtual environment** - Isolated Python environment to avoid system conflicts
2. **Installs plotting packages** - Only the minimal packages needed for visualization
3. **Runs analysis** - Connects to your MongoDB (1309 examples) and generates plots

## Expected Output

```
======================================================================
VISIBILITY ANALYSIS - PLOTTING SCRIPT
======================================================================
🔗 Connecting to MongoDB...
📊 Fetching training data...
✅ Loaded 1309 training examples
...
✅ ALL PLOTS GENERATED SUCCESSFULLY!
======================================================================
```

## Generated Files

- `visibility_by_prompts.png` - Top 30 prompts by visibility
- `visibility_by_sentences.png` - Top 30 sentences by visibility  
- `visibility_by_domains.png` - Top 50 domains by visibility
- `visibility_distribution_*.png` - Distribution plots (3 files)
- `visibility_summary_report.txt` - Statistics summary

## For Future Use

To run again later:

```bash
cd /Users/impanyu/git_repo/GEO/model_training
source venv/bin/activate  # Activate environment
python3 plot_visibility_analysis.py
```

## Alternative: Use the Automated Script

Instead of manual setup, you can just run:

```bash
./PLOT_QUICKSTART.sh
```

This does all the above steps automatically!
