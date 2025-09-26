#!/usr/bin/env python3
"""
Reward Model Training for Visibility Prediction

This model learns to predict visibility scores given:
- List of sentences (as JSON)
- Content dimension name
- Normalized domain URL

The model is fine-tuned to predict the visibility score from FullWebContentCache data.
"""

import argparse
import json
import os
import sys
from typing import List, Dict, Tuple, Optional
import logging
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split
from transformers import (
    AutoTokenizer, 
    AutoModel,  # Changed from AutoModelForSequenceClassification
    LlamaForCausalLM,
    LlamaTokenizer,
    GPT2LMHeadModel,
    GPT2Tokenizer,
    get_linear_schedule_with_warmup,
    set_seed
)
import matplotlib.pyplot as plt
import numpy as np
from tqdm import tqdm
import pymongo
from dotenv import load_dotenv

# Load environment variables
load_dotenv('../.env.local')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class TrainingConfig:
    """Training configuration"""
    model_name: str = "meta-llama/Llama-3.1-8B"
    max_length: int = 512
    batch_size: int = 8
    learning_rate: float = 2e-5
    num_epochs: int = 10
    warmup_steps: int = 100
    weight_decay: float = 0.01
    train_split: float = 0.8
    seed: int = 42
    output_dir: str = "./reward_model_output"
    save_every: int = 2
    use_lora: bool = False  # Added for large model support
    gradient_accumulation_steps: int = 1  # Added for large models

class VisibilityDataset(Dataset):
    """Dataset for visibility prediction"""
    
    def __init__(self, data: List[Dict], tokenizer, max_length: int = 512):
        self.data = data
        self.tokenizer = tokenizer
        self.max_length = max_length
    
    def __len__(self):
        return len(self.data)
    
    def __getitem__(self, idx):
        item = self.data[idx]
        
        # Combine sentences, dimension, and domain into input text
        sentences_json = json.dumps(item['sentences'])
        input_text = f"Sentences: {sentences_json}\nDimension: {item['dimension']}\nDomain: {item['domain']}"
        
        # Tokenize input
        encoding = self.tokenizer(
            input_text,
            truncation=True,
            padding='max_length',
            max_length=self.max_length,
            return_tensors='pt'
        )
        
        return {
            'input_ids': encoding['input_ids'].flatten(),
            'attention_mask': encoding['attention_mask'].flatten(),
            'visibility': torch.tensor(item['visibility'], dtype=torch.float)
        }

class RewardModel(nn.Module):
    """Improved reward model for visibility prediction - supports all LLM architectures"""
    
    def __init__(self, model_name: str, use_lora: bool = False):
        super().__init__()
        self.model_name = model_name
        self.use_lora = use_lora
        
        # Load model based on architecture
        logger.info(f"Loading model: {model_name}")
        if "llama" in model_name.lower():
            self.backbone = LlamaForCausalLM.from_pretrained(
                model_name,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                device_map="auto" if torch.cuda.is_available() else None
            )
            self.hidden_size = self.backbone.config.hidden_size
        elif "gpt" in model_name.lower():
            self.backbone = AutoModel.from_pretrained(model_name)
            self.hidden_size = self.backbone.config.hidden_size
        else:
            # Generic transformer
            self.backbone = AutoModel.from_pretrained(model_name)
            self.hidden_size = self.backbone.config.hidden_size
        
        # Add improved reward head
        self.reward_head = nn.Sequential(
            nn.Linear(self.hidden_size, self.hidden_size // 2),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(self.hidden_size // 2, 1),
            nn.Sigmoid()  # Ensure output is between 0 and 1
        )
        
        # Optional: Use LoRA for large models to reduce memory
        if use_lora:
            self._setup_lora()
        
        logger.info(f"Model loaded with {sum(p.numel() for p in self.parameters())} parameters")
    
    def _setup_lora(self):
        """Setup LoRA (Low-Rank Adaptation) for memory efficiency"""
        try:
            from peft import get_peft_model, LoraConfig, TaskType
            
            # Configure LoRA based on model type
            if "llama" in self.model_name.lower():
                target_modules = ["q_proj", "v_proj", "k_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
            else:
                target_modules = ["q_proj", "v_proj", "k_proj", "o_proj"]
            
            lora_config = LoraConfig(
                task_type=TaskType.FEATURE_EXTRACTION,
                inference_mode=False,
                r=16,  # Rank
                lora_alpha=32,
                lora_dropout=0.1,
                target_modules=target_modules
            )
            
            self.backbone = get_peft_model(self.backbone, lora_config)
            logger.info("✅ LoRA enabled for memory efficiency")
            
        except ImportError:
            logger.warning("⚠️ PEFT not installed. Install with: pip install peft")
            logger.warning("   Continuing without LoRA - may require more memory")
    
    def forward(self, input_ids, attention_mask=None):
        # Get model outputs
        if "llama" in self.model_name.lower():
            # For Llama, we need to handle it differently
            outputs = self.backbone(
                input_ids=input_ids, 
                attention_mask=attention_mask,
                output_hidden_states=True
            )
            # Use last hidden state
            hidden_states = outputs.hidden_states[-1]
        else:
            # For other models (GPT-2, DialoGPT, etc.)
            outputs = self.backbone(
                input_ids=input_ids,
                attention_mask=attention_mask
            )
            hidden_states = outputs.last_hidden_state
        
        # Pool the hidden states (always use mean pooling for consistency)
        if attention_mask is not None:
            # Mean pooling with attention mask (preferred)
            mask_expanded = attention_mask.unsqueeze(-1).expand(hidden_states.size()).float()
            sum_embeddings = torch.sum(hidden_states * mask_expanded, 1)
            sum_mask = torch.clamp(mask_expanded.sum(1), min=1e-9)
            pooled_output = sum_embeddings / sum_mask
        else:
            # Mean pooling without attention mask (fallback)
            # This is safer than using last token which might be padding
            pooled_output = torch.mean(hidden_states, dim=1)
            logger.warning("⚠️ No attention mask provided - using simple mean pooling. "
                         "This may include padding tokens in the average.")
        
        # Get reward score
        reward_score = self.reward_head(pooled_output)
        
        return reward_score.squeeze(-1)

class RewardModelTrainer:
    """Trainer for the reward model"""
    
    def __init__(self, config: TrainingConfig):
        self.config = config
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        logger.info(f"Using device: {self.device}")
        
        # Set seed for reproducibility
        set_seed(config.seed)
        
        # Initialize tokenizer based on model type
        if "llama" in config.model_name.lower():
            self.tokenizer = LlamaTokenizer.from_pretrained(config.model_name)
        elif "gpt2" in config.model_name.lower():
            self.tokenizer = GPT2Tokenizer.from_pretrained(config.model_name)
        else:
            self.tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        
        # Set pad token if not exists
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        
        # Auto-determine LoRA usage for large models
        use_lora = config.use_lora
        if not use_lora and "llama" in config.model_name.lower() and "8b" in config.model_name.lower():
            use_lora = True
            logger.info("🔥 Auto-enabling LoRA for Llama 8B model")
        
        # Initialize model with improved architecture
        self.model = RewardModel(config.model_name, use_lora=use_lora)
        
        # Move to device (handle large models)
        if not torch.cuda.is_available() or not use_lora:
            self.model.to(self.device)
        else:
            logger.info("🎮 Model using device_map for large model optimization")
        
        # Create output directory
        os.makedirs(config.output_dir, exist_ok=True)
        
        # Training history
        self.train_losses = []
        self.val_losses = []
        self.val_mae = []
    
    def load_data_from_mongodb(self, brand_urls: List[str]) -> List[Dict]:
        """Load training data from MongoDB FullWebContentCache"""
        logger.info(f"Loading data for {len(brand_urls)} brands from MongoDB")
        
        # Connect to MongoDB
        mongo_uri = os.getenv('MONGODB_URI')
        if not mongo_uri:
            raise ValueError("MONGODB_URI not found in environment variables")
        
        client = pymongo.MongoClient(mongo_uri)
        db = client['springbrand-ai']
        collection = db['full_web_content']
        
        training_data = []
        
        for brand_url in brand_urls:
            # Normalize URL (simple version)
            normalized_url = brand_url.lower().replace('https://', '').replace('http://', '').replace('www.', '')
            
            # Find document by normalized brand URL
            doc = collection.find_one({'normalizedBrandUrl': normalized_url})
            
            if not doc:
                logger.warning(f"No document found for brand URL: {brand_url}")
                continue
            
            website_content = doc.get('websiteContent', {})
            
            # Extract training samples
            for dimension, domain_data in website_content.items():
                for normalized_domain, content_data in domain_data.items():
                    # Handle both old and new data structures
                    if isinstance(content_data, list):
                        # Old structure: just list of sentences
                        sentences = content_data
                        visibility = 0.0  # Default visibility for old data
                    else:
                        # New structure: {sentences: [], visibility: float}
                        sentences = content_data.get('sentences', [])
                        visibility = content_data.get('visibility', 0.0)
                    
                    if sentences:  # Only add if there are sentences
                        training_data.append({
                            'sentences': sentences,
                            'dimension': dimension,
                            'domain': normalized_domain,
                            'visibility': visibility,
                            'brand_url': brand_url
                        })
        
        logger.info(f"Loaded {len(training_data)} training samples")
        return training_data
    
    def create_data_loaders(self, data: List[Dict]) -> Tuple[DataLoader, DataLoader]:
        """Create train and validation data loaders"""
        dataset = VisibilityDataset(data, self.tokenizer, self.config.max_length)
        
        # Split dataset
        train_size = int(self.config.train_split * len(dataset))
        val_size = len(dataset) - train_size
        
        train_dataset, val_dataset = random_split(dataset, [train_size, val_size])
        
        train_loader = DataLoader(
            train_dataset, 
            batch_size=self.config.batch_size, 
            shuffle=True
        )
        val_loader = DataLoader(
            val_dataset, 
            batch_size=self.config.batch_size, 
            shuffle=False
        )
        
        logger.info(f"Train samples: {train_size}, Val samples: {val_size}")
        return train_loader, val_loader
    
    def train_epoch(self, train_loader: DataLoader, optimizer, scheduler) -> float:
        """Train for one epoch with gradient accumulation support"""
        self.model.train()
        total_loss = 0
        criterion = nn.BCELoss()  # Better for probability prediction (0-1 range)
        
        progress_bar = tqdm(train_loader, desc="Training")
        
        # Gradient accumulation
        accumulation_steps = self.config.gradient_accumulation_steps
        optimizer.zero_grad()
        
        for step, batch in enumerate(progress_bar):
            # Move to device (handle device_map for large models)
            if hasattr(self.model.backbone, 'device') and self.model.backbone.device != self.device:
                # Model is using device_map, inputs will be moved automatically
                input_ids = batch['input_ids']
                attention_mask = batch['attention_mask']
                visibility = batch['visibility'].to(self.device)
            else:
                input_ids = batch['input_ids'].to(self.device)
                attention_mask = batch['attention_mask'].to(self.device)
                visibility = batch['visibility'].to(self.device)
            
            # Forward pass
            predictions = self.model(input_ids, attention_mask)
            loss = criterion(predictions, visibility)
            
            # Scale loss for gradient accumulation
            loss = loss / accumulation_steps
            
            # Backward pass
            loss.backward()
            
            # Update every accumulation_steps or at the end
            if (step + 1) % accumulation_steps == 0 or (step + 1) == len(train_loader):
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                optimizer.step()
                scheduler.step()
                optimizer.zero_grad()
            
            total_loss += loss.item() * accumulation_steps  # Unscale for logging
            progress_bar.set_postfix({'loss': loss.item() * accumulation_steps})
        
        return total_loss / len(train_loader)
    
    def validate(self, val_loader: DataLoader) -> Tuple[float, float]:
        """Validate the model"""
        self.model.eval()
        total_loss = 0
        total_mae = 0
        criterion = nn.BCELoss()  # Better for probability prediction (0-1 range)
        
        with torch.no_grad():
            for batch in tqdm(val_loader, desc="Validation"):
                # Move to device (handle device_map for large models)
                if hasattr(self.model.backbone, 'device') and self.model.backbone.device != self.device:
                    # Model is using device_map, inputs will be moved automatically
                    input_ids = batch['input_ids']
                    attention_mask = batch['attention_mask']
                    visibility = batch['visibility'].to(self.device)
                else:
                    input_ids = batch['input_ids'].to(self.device)
                    attention_mask = batch['attention_mask'].to(self.device)
                    visibility = batch['visibility'].to(self.device)
                
                predictions = self.model(input_ids, attention_mask)
                loss = criterion(predictions, visibility)
                mae = torch.mean(torch.abs(predictions - visibility))
                
                total_loss += loss.item()
                total_mae += mae.item()
        
        avg_loss = total_loss / len(val_loader)
        avg_mae = total_mae / len(val_loader)
        
        return avg_loss, avg_mae
    
    def plot_training_history(self):
        """Plot training history"""
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
        
        # Loss plot
        epochs = range(1, len(self.train_losses) + 1)
        ax1.plot(epochs, self.train_losses, 'b-', label='Training Loss')
        ax1.plot(epochs, self.val_losses, 'r-', label='Validation Loss')
        ax1.set_title('Training and Validation Loss')
        ax1.set_xlabel('Epoch')
        ax1.set_ylabel('Loss')
        ax1.legend()
        ax1.grid(True)
        
        # MAE plot
        ax2.plot(epochs, self.val_mae, 'g-', label='Validation MAE')
        ax2.set_title('Validation Mean Absolute Error')
        ax2.set_xlabel('Epoch')
        ax2.set_ylabel('MAE')
        ax2.legend()
        ax2.grid(True)
        
        plt.tight_layout()
        plt.savefig(os.path.join(self.config.output_dir, 'training_history.png'))
        plt.show()
    
    def save_model(self, epoch: int):
        """Save model checkpoint"""
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': self.model.state_dict(),
            'config': self.config,
            'train_losses': self.train_losses,
            'val_losses': self.val_losses,
            'val_mae': self.val_mae
        }
        
        checkpoint_path = os.path.join(
            self.config.output_dir, 
            f'reward_model_epoch_{epoch}.pt'
        )
        torch.save(checkpoint, checkpoint_path)
        logger.info(f"Saved checkpoint: {checkpoint_path}")
    
    def train(self, brand_urls: List[str]):
        """Main training loop"""
        logger.info("Starting reward model training")
        
        # Load data
        data = self.load_data_from_mongodb(brand_urls)
        if not data:
            raise ValueError("No training data found")
        
        # Create data loaders
        train_loader, val_loader = self.create_data_loaders(data)
        
        # Setup optimizer and scheduler
        optimizer = optim.AdamW(
            self.model.parameters(),
            lr=self.config.learning_rate,
            weight_decay=self.config.weight_decay
        )
        
        total_steps = len(train_loader) * self.config.num_epochs
        scheduler = get_linear_schedule_with_warmup(
            optimizer,
            num_warmup_steps=self.config.warmup_steps,
            num_training_steps=total_steps
        )
        
        # Training loop
        best_val_loss = float('inf')
        
        for epoch in range(1, self.config.num_epochs + 1):
            logger.info(f"Epoch {epoch}/{self.config.num_epochs}")
            
            # Train
            train_loss = self.train_epoch(train_loader, optimizer, scheduler)
            self.train_losses.append(train_loss)
            
            # Validate
            val_loss, val_mae = self.validate(val_loader)
            self.val_losses.append(val_loss)
            self.val_mae.append(val_mae)
            
            logger.info(f"Train Loss: {train_loss:.4f}, Val Loss: {val_loss:.4f}, Val MAE: {val_mae:.4f}")
            
            # Save best model
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                self.save_model(epoch)
                logger.info(f"New best model saved with val_loss: {val_loss:.4f}")
            
            # Save checkpoint periodically
            if epoch % self.config.save_every == 0:
                self.save_model(epoch)
        
        # Plot training history
        self.plot_training_history()
        
        # Save final model
        self.save_model(self.config.num_epochs)
        logger.info("Training completed!")

def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Train reward model for visibility prediction")
    parser.add_argument(
        'brand_urls', 
        nargs='+', 
        help='List of brand URLs to use for training'
    )
    parser.add_argument(
        '--model', 
        default='meta-llama/Llama-3.1-8B',
        help='Base model to fine-tune'
    )
    parser.add_argument(
        '--batch_size', 
        type=int, 
        default=8,
        help='Batch size for training'
    )
    parser.add_argument(
        '--epochs', 
        type=int, 
        default=10,
        help='Number of training epochs'
    )
    parser.add_argument(
        '--learning_rate', 
        type=float, 
        default=2e-5,
        help='Learning rate'
    )
    parser.add_argument(
        '--output_dir', 
        default='./reward_model_output',
        help='Output directory for model and results'
    )
    parser.add_argument(
        '--use_lora',
        action='store_true',
        help='Use LoRA for memory-efficient training (auto-enabled for 8B+ models)'
    )
    parser.add_argument(
        '--gradient_accumulation_steps',
        type=int,
        default=1,
        help='Number of gradient accumulation steps (useful for large models)'
    )
    parser.add_argument(
        '--max_length',
        type=int,
        default=512,
        help='Maximum sequence length'
    )
    
    args = parser.parse_args()
    
    # Auto-adjust settings for large models
    if "llama" in args.model.lower() and "8b" in args.model.lower():
        logger.info("🔥 Detected Llama 8B model - auto-adjusting settings for large model")

        if args.gradient_accumulation_steps == 1:
            logger.info(f"   Setting gradient accumulation steps to 4")
            args.gradient_accumulation_steps = 4
        if not args.use_lora:
            logger.info(f"   Auto-enabling LoRA")
            args.use_lora = True
    
    # Create training config
    config = TrainingConfig(
        model_name=args.model,
        batch_size=args.batch_size,
        num_epochs=args.epochs,
        learning_rate=args.learning_rate,
        output_dir=args.output_dir,
        use_lora=args.use_lora,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        max_length=args.max_length
    )
    
    # Initialize trainer
    trainer = RewardModelTrainer(config)
    
    # Start training
    try:
        trainer.train(args.brand_urls)
    except Exception as e:
        logger.error(f"Training failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
