#!/usr/bin/env python3
"""
Complete training pipeline for both reward and policy models

This script orchestrates the training of:
1. Reward model for visibility prediction
2. Policy model using GRPO for sentence modification

Usage:
    python train_models.py https://www.sendbird.com https://www.twilio.com --train_reward --train_policy
"""

import argparse
import asyncio
import os
import sys
import logging
from typing import List

from reward_model import RewardModelTrainer, TrainingConfig as RewardConfig
from policy_model import PolicyTrainer, PolicyConfig

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def setup_directories():
    """Create necessary directories"""
    os.makedirs("reward_model_output", exist_ok=True)
    os.makedirs("policy_model_output", exist_ok=True)
    os.makedirs("logs", exist_ok=True)

def train_reward_model(brand_urls: List[str], config: RewardConfig) -> str:
    """Train the reward model"""
    logger.info("🎯 Starting Reward Model Training")
    logger.info("="*50)
    
    trainer = RewardModelTrainer(config)
    trainer.train(brand_urls)
    
    # Return path to best model
    best_model_path = os.path.join(config.output_dir, f'reward_model_epoch_{config.num_epochs}.pt')
    logger.info(f"✅ Reward model training completed: {best_model_path}")
    return best_model_path

async def train_policy_model(brand_urls: List[str], config: PolicyConfig):
    """Train the policy model"""
    logger.info("🚀 Starting Policy Model Training with GRPO")
    logger.info("="*50)
    
    # Create dummy training data (in practice, load from MongoDB)
    train_data = []
    for brand_url in brand_urls:
        # This is simplified - you'd actually load from FullWebContentCache
        train_data.append({
            'sentences': [
                f'Example functionality for {brand_url}',
                f'Quality features of {brand_url}',
                f'Pricing information for {brand_url}'
            ],
            'dimension': 'Functionality',
            'domain': brand_url.replace('https://', '').replace('www.', ''),
            'brand_name': brand_url.replace('https://', '').replace('www.', '').split('.')[0].title()
        })
    
    trainer = PolicyTrainer(config)
    await trainer.train(train_data)
    
    logger.info("✅ Policy model training completed")

def main():
    """Main training pipeline"""
    parser = argparse.ArgumentParser(description="Train reward and policy models")
    
    # Data arguments
    parser.add_argument(
        'brand_urls',
        nargs='+',
        help='List of brand URLs for training'
    )
    
    # Training control
    parser.add_argument(
        '--train_reward',
        action='store_true',
        help='Train the reward model'
    )
    parser.add_argument(
        '--train_policy',
        action='store_true',
        help='Train the policy model'
    )
    parser.add_argument(
        '--train_both',
        action='store_true',
        help='Train both models sequentially'
    )
    
    # Model arguments
    parser.add_argument(
        '--reward_model',
        default='microsoft/DialoGPT-medium',
        help='Base model for reward model'
    )
    parser.add_argument(
        '--policy_model',
        default='microsoft/DialoGPT-medium',
        help='Base model for policy model'
    )
    
    # Training hyperparameters
    parser.add_argument(
        '--reward_epochs',
        type=int,
        default=10,
        help='Number of epochs for reward model'
    )
    parser.add_argument(
        '--policy_epochs',
        type=int,
        default=5,
        help='Number of epochs for policy model'
    )
    parser.add_argument(
        '--batch_size',
        type=int,
        default=8,
        help='Batch size for training'
    )
    parser.add_argument(
        '--learning_rate',
        type=float,
        default=2e-5,
        help='Learning rate for training'
    )
    
    # Output arguments
    parser.add_argument(
        '--reward_output_dir',
        default='./reward_model_output',
        help='Output directory for reward model'
    )
    parser.add_argument(
        '--policy_output_dir',
        default='./policy_model_output',
        help='Output directory for policy model'
    )
    
    args = parser.parse_args()
    
    # Validate arguments
    if not (args.train_reward or args.train_policy or args.train_both):
        logger.error("Please specify --train_reward, --train_policy, or --train_both")
        sys.exit(1)
    
    if len(args.brand_urls) == 0:
        logger.error("Please provide at least one brand URL")
        sys.exit(1)
    
    # Setup
    setup_directories()
    logger.info(f"🚀 Starting training pipeline for {len(args.brand_urls)} brands")
    logger.info(f"Brand URLs: {', '.join(args.brand_urls)}")
    
    try:
        reward_model_path = None
        
        # Train reward model
        if args.train_reward or args.train_both:
            reward_config = RewardConfig(
                model_name=args.reward_model,
                batch_size=args.batch_size,
                num_epochs=args.reward_epochs,
                learning_rate=args.learning_rate,
                output_dir=args.reward_output_dir
            )
            reward_model_path = train_reward_model(args.brand_urls, reward_config)
        
        # Train policy model
        if args.train_policy or args.train_both:
            # Use trained reward model if available
            if reward_model_path and os.path.exists(reward_model_path):
                policy_reward_path = reward_model_path
            else:
                policy_reward_path = os.path.join(args.reward_output_dir, f'reward_model_epoch_{args.reward_epochs}.pt')
            
            policy_config = PolicyConfig(
                model_name=args.policy_model,
                reward_model_path=policy_reward_path,
                batch_size=max(1, args.batch_size // 2),  # Smaller batch for policy
                num_epochs=args.policy_epochs,
                learning_rate=args.learning_rate / 2,  # Lower LR for policy
                output_dir=args.policy_output_dir
            )
            
            asyncio.run(train_policy_model(args.brand_urls, policy_config))
        
        logger.info("🎉 Training pipeline completed successfully!")
        logger.info("="*50)
        
        # Print summary
        logger.info("📊 Training Summary:")
        if args.train_reward or args.train_both:
            logger.info(f"  Reward Model: {args.reward_output_dir}")
        if args.train_policy or args.train_both:
            logger.info(f"  Policy Model: {args.policy_output_dir}")
        
        logger.info("\n📝 Next Steps:")
        logger.info("1. Check training plots in the output directories")
        logger.info("2. Evaluate model performance on validation data")
        logger.info("3. Use trained models for inference")
        
    except Exception as e:
        logger.error(f"❌ Training pipeline failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
