#!/bin/bash
# Quick setup and run script for visibility plotting

set -e

echo "=================================="
echo "Visibility Analysis Quick Setup"
echo "=================================="
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed"
    echo ""
    echo "Please install Python first:"
    echo "  brew install python3"
    echo ""
    echo "Or see SETUP_PYTHON.md for detailed instructions"
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"
echo ""

# Check required packages
echo "🔍 Checking required packages..."
python3 -c "import pymongo" 2>/dev/null || MISSING=1
python3 -c "import matplotlib" 2>/dev/null || MISSING=1
python3 -c "import pandas" 2>/dev/null || MISSING=1
python3 -c "import numpy" 2>/dev/null || MISSING=1
python3 -c "import seaborn" 2>/dev/null || MISSING=1
python3 -c "import dotenv" 2>/dev/null || MISSING=1

if [ ! -z "$MISSING" ]; then
    echo "❌ Some packages are missing"
    echo ""
    echo "Setting up virtual environment and installing packages..."
    echo ""
    
    # Create virtual environment if it doesn't exist
    if [ ! -d "venv" ]; then
        echo "📦 Creating virtual environment..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment
    echo "🔧 Activating virtual environment..."
    source venv/bin/activate
    
    # Install minimal packages for plotting
    echo "📦 Installing required packages..."
    pip install pymongo matplotlib pandas numpy seaborn python-dotenv
    
    echo ""
    echo "✅ Packages installed in virtual environment"
else
    echo "🔧 Activating virtual environment..."
    source venv/bin/activate 2>/dev/null || echo "⚠️  No virtual environment found, using system Python"
fi

echo "✅ All packages available"
echo ""

# Check MongoDB
echo "🔍 Checking MongoDB connection..."
if ! command -v mongosh &> /dev/null; then
    echo "⚠️  mongosh not found, skipping database check"
else
    COUNT=$(mongosh --port 27018 springbrand-ai --eval "db.prompt_domain_sentences_visibility_training_data.countDocuments()" --quiet 2>/dev/null || echo "0")
    if [ "$COUNT" -gt "0" ]; then
        echo "✅ MongoDB connected: $COUNT training examples"
    else
        echo "⚠️  No training data found in database"
        echo "   Run: npm run generate-training-data"
    fi
fi
echo ""

# Check .env.local
if [ -f "../.env.local" ]; then
    echo "✅ .env.local found"
else
    echo "⚠️  .env.local not found in parent directory"
fi
echo ""

# Run the plotting script
echo "=================================="
echo "Running Visibility Analysis..."
echo "=================================="
echo ""

# Ensure virtual environment is activated
source venv/bin/activate 2>/dev/null || echo "⚠️  Using system Python"

python3 plot_visibility_analysis.py

echo ""
echo "=================================="
echo "✅ Complete!"
echo "=================================="
echo ""
echo "Generated files:"
ls -lh *.png *.txt 2>/dev/null | tail -7 | awk '{print "  " $9 " (" $5 ")"}'

