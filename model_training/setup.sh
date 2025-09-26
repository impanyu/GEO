#!/bin/bash

# Setup script for model training environment

echo "🚀 Setting up GEO Model Training Environment"
echo "============================================"

# Check Python version
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "📋 Python version: $python_version"

# Check if Python 3.8+ is available
if python3 -c "import sys; exit(0 if sys.version_info >= (3, 8) else 1)"; then
    echo "✅ Python version compatible"
else
    echo "❌ Python 3.8+ required"
    exit 1
fi

# Create virtual environment
echo "📦 Creating virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "ℹ️ Virtual environment already exists"
fi

# Activate virtual environment
echo "🔌 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install PyTorch (CPU version - change if you have CUDA)
echo "🔥 Installing PyTorch..."
if command -v nvidia-smi &> /dev/null; then
    echo "🎮 CUDA detected, installing GPU version..."
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
else
    echo "💻 Installing CPU version..."
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
fi

# Install other requirements
echo "📚 Installing other requirements..."
pip install -r requirements.txt

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p reward_model_output
mkdir -p policy_model_output
mkdir -p logs
mkdir -p data

# Check environment variables
echo "🔍 Checking environment variables..."
if [ -f "../.env.local" ]; then
    echo "✅ Found .env.local file"
    
    # Check MongoDB URI
    if grep -q "MONGODB_URI" ../.env.local; then
        echo "✅ MONGODB_URI configured"
    else
        echo "⚠️ MONGODB_URI not found in .env.local"
    fi
    
    # Check OpenRouter API key
    if grep -q "OPENROUTER_API_KEY" ../.env.local; then
        echo "✅ OPENROUTER_API_KEY configured"
    else
        echo "⚠️ OPENROUTER_API_KEY not found in .env.local"
    fi
else
    echo "⚠️ .env.local file not found in parent directory"
    echo "   Please create ../.env.local with required environment variables"
fi

# Test imports
echo "🧪 Testing Python imports..."
python3 -c "
try:
    import torch
    import transformers
    import pymongo
    import matplotlib
    import numpy
    print('✅ All required packages imported successfully')
    print(f'   PyTorch version: {torch.__version__}')
    print(f'   Transformers version: {transformers.__version__}')
    print(f'   Device: {\"CUDA\" if torch.cuda.is_available() else \"CPU\"}')
except ImportError as e:
    print(f'❌ Import error: {e}')
    exit(1)
"

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "📝 Next steps:"
echo "   1. Activate the virtual environment: source venv/bin/activate"
echo "   2. Configure .env.local with MongoDB URI and OpenRouter API key"
echo "   3. Run training: python train_models.py <brand_urls> --train_both"
echo ""
echo "💡 Example usage:"
echo "   python train_models.py https://www.sendbird.com https://www.twilio.com --train_both"
echo ""
echo "📚 For more information, see README.md"
