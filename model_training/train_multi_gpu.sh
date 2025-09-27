#!/bin/bash

# Multi-GPU Training Script for GRPO Policy Model
# Usage: ./train_multi_gpu.sh [brand_urls...] [options]

set -e

# Default values
NUM_GPUS=8
BATCH_SIZE=1  # Per GPU batch size (very small for memory efficiency)
MODEL="meta-llama/Llama-3.1-8B-Instruct"
EPOCHS=5
NUM_SAMPLES=2  # Further reduced for multi-GPU to save memory
OUTPUT_DIR="./grpo_model_output_multi_gpu"
MAX_LENGTH=256  # Reduced sequence length

# Print GPU info
echo "🔍 Checking GPU availability..."
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU count: {torch.cuda.device_count()}')"

# Check if we have enough GPUs
AVAILABLE_GPUS=$(python -c "import torch; print(torch.cuda.device_count())")
if [ "$AVAILABLE_GPUS" -lt "$NUM_GPUS" ]; then
    echo "⚠️  Warning: Requested $NUM_GPUS GPUs but only $AVAILABLE_GPUS available"
    echo "   Using $AVAILABLE_GPUS GPUs instead"
    NUM_GPUS=$AVAILABLE_GPUS
fi

# Brand URLs (use defaults if not provided)
if [ $# -eq 0 ]; then
    BRAND_URLS="https://sendbird.com https://twilio.com"
    echo "📝 Using default brand URLs: $BRAND_URLS"
else
    BRAND_URLS="$*"
    echo "📝 Using provided brand URLs: $BRAND_URLS"
fi

echo "🚀 Starting multi-GPU GRPO training..."
echo "   🎯 GPUs: $NUM_GPUS"
echo "   📦 Batch size per GPU: $BATCH_SIZE"
echo "   🧠 Model: $MODEL"
echo "   🔄 Epochs: $EPOCHS"
echo "   🎲 Samples per input: $NUM_SAMPLES"
echo "   📁 Output: $OUTPUT_DIR"
echo ""

# Set PyTorch CUDA memory allocation strategy
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# Run training with multi-GPU support
python policy_model.py \
    $BRAND_URLS \
    --num_gpus $NUM_GPUS \
    --batch_size $BATCH_SIZE \
    --model "$MODEL" \
    --epochs $EPOCHS \
    --num_samples_per_input $NUM_SAMPLES \
    --output_dir "$OUTPUT_DIR" \
    --use_lora \
    --gradient_accumulation_steps 8 \
    --max_length $MAX_LENGTH

echo "✅ Multi-GPU training completed!"
