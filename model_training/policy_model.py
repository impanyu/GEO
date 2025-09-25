#!/usr/bin/env python3
"""
Policy Model Training using GRPO (Generative Reinforcement Policy Optimization)

This model learns to modify sentence lists to improve visibility scores.
It uses reinforcement learning with two reward signals:
1. GPT-4o based relevance/modification scoring
2. Trained reward model predictions
"""

import argparse
import json
import os
import sys
import asyncio
from typing import List, Dict, Tuple, Optional
import logging
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoTokenizer, 
    AutoModelForCausalLM,
    get_linear_schedule_with_warmup,
    set_seed
)
import matplotlib.pyplot as plt
import numpy as np
from tqdm import tqdm
import requests
from dotenv import load_dotenv

from reward_model import RewardModel, TrainingConfig as RewardConfig

# Load environment variables
load_dotenv('../.env.local')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Content dimensions from analyze-web-content.ts
CONTENT_DIMENSIONS_DESCRIPTIONS = {
    "Functionality": "Core features and capabilities of the product or service",
    "Quality": "Performance, reliability, and overall quality metrics",
    "Price / Value Proposition": "Pricing information and value offering",
    "User Experience / Ease of Use": "User interface, usability, and customer experience",
    "Customer Support / Service": "Support quality and customer service aspects",
    "Integration / Compatibility": "Integration capabilities and compatibility with other systems",
    "Security / Privacy": "Security features and privacy protection measures",
    "Scalability / Performance": "Ability to scale and performance characteristics",
    "Innovation / Technology": "Technological innovation and cutting-edge features",
    "Market Position / Reputation": "Market standing and brand reputation",
    "Documentation / Resources": "Quality of documentation and available resources",
    "Community / Ecosystem": "Developer community and ecosystem support",
    "Compliance / Standards": "Regulatory compliance and industry standards",
    "Customization / Flexibility": "Customization options and flexibility",
    "Analytics / Insights": "Analytics capabilities and data insights"
}

@dataclass
class PolicyConfig:
    """Policy training configuration"""
    model_name: str = "microsoft/DialoGPT-medium"
    reward_model_path: str = "./reward_model_output/reward_model_epoch_10.pt"
    max_length: int = 512
    max_new_tokens: int = 256
    batch_size: int = 4
    learning_rate: float = 1e-5
    num_epochs: int = 5
    ppo_epochs: int = 4
    clip_range: float = 0.2
    entropy_coef: float = 0.01
    value_coef: float = 0.5
    max_grad_norm: float = 1.0
    gae_lambda: float = 0.95
    gamma: float = 0.99
    seed: int = 42
    output_dir: str = "./policy_model_output"
    save_every: int = 1

class SentenceModificationDataset(Dataset):
    """Dataset for sentence modification task"""
    
    def __init__(self, data: List[Dict], tokenizer, max_length: int = 512):
        self.data = data
        self.tokenizer = tokenizer
        self.max_length = max_length
    
    def __len__(self):
        return len(self.data)
    
    def __getitem__(self, idx):
        item = self.data[idx]
        
        # Create input prompt for sentence modification
        sentences_json = json.dumps(item['sentences'])
        prompt = f"Modify the following sentences to improve brand visibility:\nSentences: {sentences_json}\nDimension: {item['dimension']}\nDomain: {item['domain']}\nModified sentences:"
        
        # Tokenize
        encoding = self.tokenizer(
            prompt,
            truncation=True,
            padding='max_length',
            max_length=self.max_length,
            return_tensors='pt'
        )
        
        return {
            'input_ids': encoding['input_ids'].flatten(),
            'attention_mask': encoding['attention_mask'].flatten(),
            'original_sentences': item['sentences'],
            'dimension': item['dimension'],
            'domain': item['domain'],
            'brand_name': item.get('brand_name', '')
        }

class OpenRouterAPI:
    """OpenRouter API client for GPT-4o calls"""
    
    def __init__(self):
        self.api_key = os.getenv('OPENROUTER_API_KEY')
        if not self.api_key:
            raise ValueError("OPENROUTER_API_KEY not found in environment variables")
        
        self.base_url = "https://openrouter.ai/api/v1"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "GEO Model Training"
        }
    
    async def call_gpt4o(self, prompt: str) -> str:
        """Call GPT-4o via OpenRouter API"""
        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json={
                    "model": "openai/gpt-4o",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 100,
                    "temperature": 0.1
                }
            )
            response.raise_for_status()
            result = response.json()
            return result['choices'][0]['message']['content'].strip()
        except Exception as e:
            logger.error(f"Error calling GPT-4o: {e}")
            return "0"  # Default to 0 on error

class RewardCalculator:
    """Calculate rewards for generated sentences"""
    
    def __init__(self, reward_model_path: str):
        self.openrouter = OpenRouterAPI()
        self.reward_model = self.load_reward_model(reward_model_path)
        
    def load_reward_model(self, model_path: str) -> RewardModel:
        """Load trained reward model"""
        if not os.path.exists(model_path):
            logger.warning(f"Reward model not found at {model_path}. Using dummy model.")
            return None
        
        checkpoint = torch.load(model_path, map_location='cpu')
        config = checkpoint['config']
        
        model = RewardModel(config.model_name)
        model.load_state_dict(checkpoint['model_state_dict'])
        model.eval()
        
        logger.info(f"Loaded reward model from {model_path}")
        return model
    
    async def calculate_modification_scores(
        self, 
        original_sentences: List[str], 
        modified_sentences: List[str],
        brand_name: str,
        dimension: str
    ) -> float:
        """Calculate first reward signal using GPT-4o"""
        scores = []
        
        # Ensure both lists have the same length by padding with empty strings
        max_len = max(len(original_sentences), len(modified_sentences))
        orig_padded = original_sentences + [''] * (max_len - len(original_sentences))
        mod_padded = modified_sentences + [''] * (max_len - len(modified_sentences))
        
        for i, (orig, mod) in enumerate(zip(orig_padded, mod_padded)):
            if orig and mod:
                # Both sentences exist - check if modification
                prompt = f"""
                Evaluate if the following two sentences are essentially talking about the same thing, where the second is a modified version of the first:

                Original: "{orig}"
                Modified: "{mod}"

                Reply with exactly "1" if they are talking about the same thing (even with different words/semantics), or "0" if they are completely different topics.
                """
                
                score_str = await self.openrouter.call_gpt4o(prompt)
                try:
                    score = float(score_str)
                    scores.append(min(max(score, 0), 1))  # Clamp to [0, 1]
                except:
                    scores.append(0)
                    
            elif not orig and mod:
                # New sentence - check relevance to brand and dimension
                dimension_desc = CONTENT_DIMENSIONS_DESCRIPTIONS.get(dimension, dimension)
                prompt = f"""
                Rate the relevance of the following sentence to the brand "{brand_name}" and content dimension "{dimension}" ({dimension_desc}):

                Sentence: "{mod}"

                Reply with a number between 0 and 1, where 0 means completely irrelevant and 1 means perfectly relevant.
                """
                
                score_str = await self.openrouter.call_gpt4o(prompt)
                try:
                    score = float(score_str)
                    scores.append(min(max(score, 0), 1))  # Clamp to [0, 1]
                except:
                    scores.append(0)
                    
            elif orig and not mod:
                # Deletion - consider as valid modification
                scores.append(1.0)
            else:
                # Both empty - neutral
                scores.append(0.5)
        
        return np.mean(scores) if scores else 0.0
    
    def calculate_visibility_score(
        self, 
        sentences: List[str], 
        dimension: str, 
        domain: str
    ) -> float:
        """Calculate second reward signal using trained reward model"""
        if self.reward_model is None:
            return 0.5  # Default score if no reward model
        
        try:
            # Prepare input similar to reward model training
            sentences_json = json.dumps(sentences)
            input_text = f"Sentences: {sentences_json}\nDimension: {dimension}\nDomain: {domain}"
            
            # This is a simplified version - in practice, you'd need the same tokenizer
            # For now, return a dummy score
            return 0.5  # Placeholder
            
        except Exception as e:
            logger.error(f"Error calculating visibility score: {e}")
            return 0.0
    
    async def calculate_total_reward(
        self,
        original_sentences: List[str],
        modified_sentences: List[str],
        brand_name: str,
        dimension: str,
        domain: str
    ) -> float:
        """Calculate final reward as product of both signals"""
        # First reward: modification/relevance score
        mod_score = await self.calculate_modification_scores(
            original_sentences, modified_sentences, brand_name, dimension
        )
        
        # Second reward: visibility prediction
        vis_score = self.calculate_visibility_score(modified_sentences, dimension, domain)
        
        # Final reward is the product
        final_reward = mod_score * vis_score
        
        logger.debug(f"Rewards - Modification: {mod_score:.3f}, Visibility: {vis_score:.3f}, Final: {final_reward:.3f}")
        return final_reward

class PolicyModel(nn.Module):
    """Policy model for sentence modification"""
    
    def __init__(self, model_name: str):
        super().__init__()
        self.backbone = AutoModelForCausalLM.from_pretrained(model_name)
        self.value_head = nn.Linear(self.backbone.config.hidden_size, 1)
    
    def forward(self, input_ids, attention_mask=None, labels=None):
        outputs = self.backbone(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
        
        # Get last hidden state for value estimation
        last_hidden_state = outputs.hidden_states[-1] if hasattr(outputs, 'hidden_states') else None
        value = None
        if last_hidden_state is not None:
            value = self.value_head(last_hidden_state[:, -1, :])  # Use last token
        
        return {
            'logits': outputs.logits,
            'value': value,
            'loss': outputs.loss if hasattr(outputs, 'loss') else None
        }
    
    def generate(self, input_ids, attention_mask=None, **kwargs):
        return self.backbone.generate(input_ids=input_ids, attention_mask=attention_mask, **kwargs)

class PolicyTrainer:
    """GRPO trainer for policy model"""
    
    def __init__(self, config: PolicyConfig):
        self.config = config
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        logger.info(f"Using device: {self.device}")
        
        # Set seed
        set_seed(config.seed)
        
        # Initialize tokenizer and model
        self.tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        
        self.model = PolicyModel(config.model_name)
        self.model.to(self.device)
        
        # Initialize reward calculator
        self.reward_calculator = RewardCalculator(config.reward_model_path)
        
        # Create output directory
        os.makedirs(config.output_dir, exist_ok=True)
        
        # Training history
        self.episode_rewards = []
        self.policy_losses = []
        self.value_losses = []
    
    def generate_modified_sentences(self, batch) -> List[List[str]]:
        """Generate modified sentences using the policy model"""
        self.model.eval()
        generated_sentences = []
        
        with torch.no_grad():
            for i in range(len(batch['input_ids'])):
                input_ids = batch['input_ids'][i:i+1].to(self.device)
                attention_mask = batch['attention_mask'][i:i+1].to(self.device)
                
                # Generate response
                outputs = self.model.generate(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    max_new_tokens=self.config.max_new_tokens,
                    do_sample=True,
                    temperature=0.7,
                    pad_token_id=self.tokenizer.pad_token_id
                )
                
                # Decode and extract sentences
                generated_text = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
                
                # Extract modified sentences from generated text
                # This is a simplified extraction - in practice, you'd want more robust parsing
                try:
                    if "Modified sentences:" in generated_text:
                        json_part = generated_text.split("Modified sentences:")[-1].strip()
                        modified_sentences = json.loads(json_part)
                        if isinstance(modified_sentences, list):
                            generated_sentences.append(modified_sentences)
                        else:
                            generated_sentences.append([str(modified_sentences)])
                    else:
                        generated_sentences.append(batch['original_sentences'][i])
                except:
                    # Fallback to original sentences if parsing fails
                    generated_sentences.append(batch['original_sentences'][i])
        
        return generated_sentences
    
    async def calculate_rewards(self, batch, generated_sentences: List[List[str]]) -> List[float]:
        """Calculate rewards for generated sentences"""
        rewards = []
        
        for i in range(len(batch['original_sentences'])):
            reward = await self.reward_calculator.calculate_total_reward(
                original_sentences=batch['original_sentences'][i],
                modified_sentences=generated_sentences[i],
                brand_name=batch['brand_name'][i],
                dimension=batch['dimension'][i],
                domain=batch['domain'][i]
            )
            rewards.append(reward)
        
        return rewards
    
    def compute_advantages(self, rewards: List[float], values: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Compute advantages using GAE"""
        rewards = torch.tensor(rewards, dtype=torch.float32, device=self.device)
        
        # Simple advantage calculation (can be improved with proper GAE)
        advantages = rewards - values.squeeze()
        returns = rewards
        
        return advantages, returns
    
    def ppo_update(self, batch, old_log_probs: torch.Tensor, advantages: torch.Tensor, returns: torch.Tensor):
        """Perform PPO update"""
        self.model.train()
        
        for _ in range(self.config.ppo_epochs):
            # Forward pass
            input_ids = batch['input_ids'].to(self.device)
            attention_mask = batch['attention_mask'].to(self.device)
            
            outputs = self.model(input_ids=input_ids, attention_mask=attention_mask)
            
            # Calculate new log probabilities (simplified)
            logits = outputs['logits']
            new_log_probs = torch.log_softmax(logits, dim=-1).mean(dim=-1)
            
            # Calculate ratio
            ratio = torch.exp(new_log_probs - old_log_probs)
            
            # Clipped surrogate objective
            surr1 = ratio * advantages
            surr2 = torch.clamp(ratio, 1 - self.config.clip_range, 1 + self.config.clip_range) * advantages
            policy_loss = -torch.min(surr1, surr2).mean()
            
            # Value loss
            values = outputs['value'].squeeze() if outputs['value'] is not None else torch.zeros_like(returns)
            value_loss = nn.MSELoss()(values, returns)
            
            # Total loss
            total_loss = policy_loss + self.config.value_coef * value_loss
            
            # Backward pass
            total_loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.config.max_grad_norm)
            
            # Store losses
            self.policy_losses.append(policy_loss.item())
            self.value_losses.append(value_loss.item())
    
    async def train_epoch(self, data_loader: DataLoader, optimizer) -> float:
        """Train for one epoch using GRPO"""
        total_reward = 0
        num_batches = 0
        
        for batch in tqdm(data_loader, desc="Training Policy"):
            # Generate modified sentences
            generated_sentences = self.generate_modified_sentences(batch)
            
            # Calculate rewards
            rewards = await self.calculate_rewards(batch, generated_sentences)
            total_reward += sum(rewards)
            num_batches += 1
            
            # Get current values and log probabilities
            input_ids = batch['input_ids'].to(self.device)
            attention_mask = batch['attention_mask'].to(self.device)
            
            with torch.no_grad():
                outputs = self.model(input_ids=input_ids, attention_mask=attention_mask)
                values = outputs['value'] if outputs['value'] is not None else torch.zeros(len(rewards), device=self.device)
                old_log_probs = torch.log_softmax(outputs['logits'], dim=-1).mean(dim=-1)
            
            # Compute advantages
            advantages, returns = self.compute_advantages(rewards, values)
            
            # PPO update
            optimizer.zero_grad()
            self.ppo_update(batch, old_log_probs, advantages, returns)
            optimizer.step()
        
        avg_reward = total_reward / num_batches if num_batches > 0 else 0
        self.episode_rewards.append(avg_reward)
        return avg_reward
    
    def plot_training_history(self):
        """Plot training history"""
        fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(12, 8))
        
        # Episode rewards
        if self.episode_rewards:
            epochs = range(1, len(self.episode_rewards) + 1)
            ax1.plot(epochs, self.episode_rewards, 'b-')
            ax1.set_title('Episode Rewards')
            ax1.set_xlabel('Epoch')
            ax1.set_ylabel('Average Reward')
            ax1.grid(True)
        
        # Policy losses
        if self.policy_losses:
            ax2.plot(self.policy_losses, 'r-')
            ax2.set_title('Policy Losses')
            ax2.set_xlabel('Update Step')
            ax2.set_ylabel('Policy Loss')
            ax2.grid(True)
        
        # Value losses
        if self.value_losses:
            ax3.plot(self.value_losses, 'g-')
            ax3.set_title('Value Losses')
            ax3.set_xlabel('Update Step')
            ax3.set_ylabel('Value Loss')
            ax3.grid(True)
        
        # Combined loss
        if self.policy_losses and self.value_losses:
            combined_loss = np.array(self.policy_losses) + np.array(self.value_losses)
            ax4.plot(combined_loss, 'm-')
            ax4.set_title('Combined Loss')
            ax4.set_xlabel('Update Step')
            ax4.set_ylabel('Total Loss')
            ax4.grid(True)
        
        plt.tight_layout()
        plt.savefig(os.path.join(self.config.output_dir, 'policy_training_history.png'))
        plt.show()
    
    def save_model(self, epoch: int):
        """Save model checkpoint"""
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': self.model.state_dict(),
            'config': self.config,
            'episode_rewards': self.episode_rewards,
            'policy_losses': self.policy_losses,
            'value_losses': self.value_losses
        }
        
        checkpoint_path = os.path.join(
            self.config.output_dir,
            f'policy_model_epoch_{epoch}.pt'
        )
        torch.save(checkpoint, checkpoint_path)
        logger.info(f"Saved checkpoint: {checkpoint_path}")
    
    async def train(self, train_data: List[Dict]):
        """Main training loop"""
        logger.info("Starting policy model training with GRPO")
        
        # Create dataset and dataloader
        dataset = SentenceModificationDataset(train_data, self.tokenizer, self.config.max_length)
        data_loader = DataLoader(dataset, batch_size=self.config.batch_size, shuffle=True)
        
        # Setup optimizer
        optimizer = optim.AdamW(self.model.parameters(), lr=self.config.learning_rate)
        
        # Training loop
        for epoch in range(1, self.config.num_epochs + 1):
            logger.info(f"Epoch {epoch}/{self.config.num_epochs}")
            
            avg_reward = await self.train_epoch(data_loader, optimizer)
            logger.info(f"Average Reward: {avg_reward:.4f}")
            
            # Save checkpoint
            if epoch % self.config.save_every == 0:
                self.save_model(epoch)
        
        # Plot results and save final model
        self.plot_training_history()
        self.save_model(self.config.num_epochs)
        logger.info("Policy training completed!")

def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Train policy model using GRPO")
    parser.add_argument(
        'brand_urls',
        nargs='+',
        help='List of brand URLs for training data'
    )
    parser.add_argument(
        '--model',
        default='microsoft/DialoGPT-medium',
        help='Base model to fine-tune'
    )
    parser.add_argument(
        '--reward_model_path',
        default='./reward_model_output/reward_model_epoch_10.pt',
        help='Path to trained reward model'
    )
    parser.add_argument(
        '--epochs',
        type=int,
        default=5,
        help='Number of training epochs'
    )
    parser.add_argument(
        '--batch_size',
        type=int,
        default=4,
        help='Batch size for training'
    )
    parser.add_argument(
        '--output_dir',
        default='./policy_model_output',
        help='Output directory for model and results'
    )
    
    args = parser.parse_args()
    
    # Create config
    config = PolicyConfig(
        model_name=args.model,
        reward_model_path=args.reward_model_path,
        num_epochs=args.epochs,
        batch_size=args.batch_size,
        output_dir=args.output_dir
    )
    
    # For this example, we'll create dummy training data
    # In practice, you'd load from MongoDB like in the reward model
    train_data = [
        {
            'sentences': ['Example sentence 1', 'Example sentence 2'],
            'dimension': 'Functionality',
            'domain': 'example.com',
            'brand_name': 'Example Brand'
        }
    ]
    
    # Initialize trainer
    trainer = PolicyTrainer(config)
    
    # Start training
    try:
        asyncio.run(trainer.train(train_data))
    except Exception as e:
        logger.error(f"Training failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
