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
import pymongo
from dotenv import load_dotenv

# Load environment variables
load_dotenv('../.env.local')

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib.models.FullWebContentCache import FullWebContentCache
from lib.models.PromptCache import normalizeUrl

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoTokenizer, 
    AutoModel,
    AutoModelForCausalLM,
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
class GRPOConfig:
    """GRPO training configuration"""
    model_name: str = "meta-llama/Llama-3.1-8B"  # Default to Llama 3.1 8B
    reward_model_path: str = "./reward_model_output/reward_model_epoch_10.pt"
    max_length: int = 512
    max_new_tokens: int = 256
    batch_size: int = 2  # Smaller default for large models
    learning_rate: float = 1e-6  # Lower learning rate for large models
    num_epochs: int = 5
    grpo_epochs: int = 4  # Number of GRPO update epochs per collection
    temperature: float = 0.7  # Sampling temperature
    top_k: int = 50  # Top-k sampling
    top_p: float = 0.9  # Top-p (nucleus) sampling
    max_grad_norm: float = 1.0
    seed: int = 42
    output_dir: str = "./grpo_model_output"
    save_every: int = 1
    use_lora: bool = False  # Added for large model support
    gradient_accumulation_steps: int = 1  # Added for large models
    baseline_tau: float = 0.95  # Exponential moving average for baseline

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
        
        model = RewardModel(config.model_name, use_lora=getattr(config, 'use_lora', False))
        model.load_state_dict(checkpoint['model_state_dict'])
        model.eval()
        
        # Also initialize the tokenizer for consistent inference
        if "llama" in config.model_name.lower():
            from transformers import LlamaTokenizer
            self.reward_tokenizer = LlamaTokenizer.from_pretrained(config.model_name)
        elif "gpt2" in config.model_name.lower():
            from transformers import GPT2Tokenizer
            self.reward_tokenizer = GPT2Tokenizer.from_pretrained(config.model_name)
        else:
            from transformers import AutoTokenizer
            self.reward_tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        
        # Set pad token if not exists
        if self.reward_tokenizer.pad_token is None:
            self.reward_tokenizer.pad_token = self.reward_tokenizer.eos_token
        
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
        if self.reward_model is None or not hasattr(self, 'reward_tokenizer'):
            return 0.5  # Default score if no reward model or tokenizer
        
        try:
            # Prepare input exactly like reward model training (VisibilityDataset)
            sentences_json = json.dumps(sentences)
            input_text = f"Sentences: {sentences_json}\nDimension: {dimension}\nDomain: {domain}"
            
            # Tokenize input using cached tokenizer (same as VisibilityDataset)
            encoding = self.reward_tokenizer(
                input_text,
                truncation=True,
                padding='max_length',
                max_length=512,  # Same as reward model training
                return_tensors='pt'
            )
            
            # Move to appropriate device
            device = next(self.reward_model.parameters()).device
            input_ids = encoding['input_ids'].to(device)
            attention_mask = encoding['attention_mask'].to(device)
            
            # Run inference
            self.reward_model.eval()
            with torch.no_grad():
                # Handle device mapping for large models
                if hasattr(self.reward_model.backbone, 'device') and self.reward_model.backbone.device != device:
                    # Model is using device_map, inputs will be moved automatically
                    reward_score = self.reward_model(input_ids=input_ids, attention_mask=attention_mask)
                else:
                    reward_score = self.reward_model(input_ids=input_ids, attention_mask=attention_mask)
                
                # Extract scalar value (reward model outputs sigmoid, so it's between 0-1)
                visibility_score = reward_score.squeeze().item()
                
            logger.debug(f"Reward model visibility score: {visibility_score:.4f} for {len(sentences)} sentences in {dimension}")
            return float(visibility_score)
            
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

class GRPOModel(nn.Module):
    """Pure GRPO model for sentence modification - no critic/value function"""
    
    def __init__(self, model_name: str, use_lora: bool = False):
        super().__init__()
        self.model_name = model_name
        self.use_lora = use_lora
        
        # Load model based on architecture
        logger.info(f"Loading GRPO model: {model_name}")
        if "llama" in model_name.lower():
            self.backbone = LlamaForCausalLM.from_pretrained(
                model_name,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                device_map="auto" if torch.cuda.is_available() else None
            )
        else:
            # Generic causal LM (GPT-2, DialoGPT, etc.)
            self.backbone = AutoModelForCausalLM.from_pretrained(model_name)
        
        # No value head needed for pure GRPO!
        
        # Optional: Use LoRA for large models to reduce memory
        if use_lora:
            self._setup_lora()
        
        logger.info(f"GRPO model loaded with {sum(p.numel() for p in self.parameters())} parameters")
    
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
                task_type=TaskType.CAUSAL_LM,
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
    
    def forward(self, input_ids, attention_mask=None, labels=None):
        # Pure language model forward pass - no value head
        outputs = self.backbone(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
        return outputs
    
    def generate(self, input_ids, attention_mask=None, **kwargs):
        return self.backbone.generate(input_ids=input_ids, attention_mask=attention_mask, **kwargs)

class GRPOTrainer:
    """Pure GRPO trainer - no critic/value function"""
    
    def __init__(self, config: GRPOConfig):
        self.config = config
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        logger.info(f"Using device: {self.device}")
        
        # Set seed
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
        
        # Initialize GRPO model (no value head)
        self.model = GRPOModel(config.model_name, use_lora=use_lora)
        
        # Move to device (handle large models)
        if not torch.cuda.is_available() or not use_lora:
            self.model.to(self.device)
        else:
            logger.info("🎮 Model using device_map for large model optimization")
        
        # Initialize reward calculator
        self.reward_calculator = RewardCalculator(config.reward_model_path)
        
        # Create output directory
        os.makedirs(config.output_dir, exist_ok=True)
        
        # GRPO-specific tracking
        self.episode_rewards = []
        self.policy_losses = []
        self.baseline_rewards = []  # Track baseline for GRPO
        self.running_baseline = 0.0  # Exponential moving average baseline
    
    def generate_and_score(self, batch) -> Tuple[List[List[str]], torch.Tensor]:
        """Generate sentences and calculate log probabilities for GRPO"""
        # Store current training mode
        was_training = self.model.training
        self.model.eval()  # Switch to eval for generation
        
        generated_sentences = []
        log_probs_list = []
        
        with torch.no_grad():
            for i in range(len(batch['input_ids'])):
                # Handle device mapping for large models
                if hasattr(self.model.backbone, 'device') and self.model.backbone.device != self.device:
                    input_ids = batch['input_ids'][i:i+1]
                    attention_mask = batch['attention_mask'][i:i+1]
                else:
                    input_ids = batch['input_ids'][i:i+1].to(self.device)
                    attention_mask = batch['attention_mask'][i:i+1].to(self.device)
                
                # Generate response with sampling
                outputs = self.model.generate(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    max_new_tokens=self.config.max_new_tokens,
                    do_sample=True,
                    temperature=self.config.temperature,
                    top_k=self.config.top_k,
                    top_p=self.config.top_p,
                    pad_token_id=self.tokenizer.pad_token_id,
                    return_dict_in_generate=True,
                    output_scores=True
                )
                
                generated_ids = outputs.sequences[0]
                
                # Calculate log probabilities for the generated sequence
                input_length = input_ids.shape[1]
                new_token_ids = generated_ids[input_length:]
                
                if len(new_token_ids) > 0 and hasattr(outputs, 'scores'):
                    # Calculate log probabilities for generated tokens
                    log_probs = []
                    for j, (score, token_id) in enumerate(zip(outputs.scores, new_token_ids)):
                        token_log_prob = torch.log_softmax(score, dim=-1)[0, token_id]
                        log_probs.append(token_log_prob)
                    
                    if log_probs:
                        # Sum log probabilities (log of product = sum of logs)
                        log_probs_list.append(torch.stack(log_probs).sum())
                    else:
                        log_probs_list.append(torch.tensor(0.0, device=self.device))
                else:
                    log_probs_list.append(torch.tensor(0.0, device=self.device))
                
                # Decode and extract sentences
                generated_text = self.tokenizer.decode(generated_ids, skip_special_tokens=True)
                
                # Extract modified sentences from generated text
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
                    generated_sentences.append(batch['original_sentences'][i])
        
        log_probs = torch.stack(log_probs_list) if log_probs_list else torch.zeros(len(batch['input_ids']), device=self.device)
        
        # Restore original training mode
        if was_training:
            self.model.train()
        
        return generated_sentences, log_probs
    
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
    
    async def calculate_rewards_tmp(self, batch, generated_sentences: List[List[str]]) -> List[float]:
        """
        Calculate rewards using OpenRouter GPT-4o API directly
        
        This is a simplified alternative to the complex reward model approach.
        GPT-4o evaluates the quality of generated sentences and predicts the probability
        they would be quoted by AI agents like ChatGPT in response to prompts.
        
        Args:
            batch: Batch data containing brand_name, dimension, domain
            generated_sentences: List of generated sentence lists for each sample
            
        Returns:
            List of reward scores (0-1) for each sample
        """
        rewards = []
        
        for i in range(len(generated_sentences)):
            try:
                # Extract context information
                brand_name = batch['brand_name'][i] if 'brand_name' in batch else 'Unknown Brand'
                dimension = batch['dimension'][i] if 'dimension' in batch else 'General'
                domain = batch['domain'][i] if 'domain' in batch else 'unknown.com'
                sentences = generated_sentences[i]
                
                # Skip empty sentence lists
                if not sentences or len(sentences) == 0:
                    rewards.append(0.0)
                    continue
                
                # Format sentences for evaluation
                sentences_text = '\n'.join([f"- {sentence}" for sentence in sentences])
                
                # Create evaluation prompt
                prompt = f"""
You are an AI content quality evaluator. Your task is to assess the quality and usefulness of content sentences.

CONTEXT:
- Brand: {brand_name}
- Content Dimension: {dimension}
- Source Domain: {domain}

CONTENT TO EVALUATE:
{sentences_text}

EVALUATION TASK:
Rate the probability (0.0 to 1.0) that these sentences would be quoted or referenced by AI agents like ChatGPT when answering user questions about this brand or topic.

QUALITY CRITERIA:
1. Factual accuracy and informativeness
2. Relevance to the brand and dimension
3. Clarity and readability
4. Usefulness for answering questions
5. Credibility and trustworthiness
6. Specificity vs vague generalities

SCORING GUIDE:
- 0.9-1.0: Exceptional quality - highly likely to be quoted
- 0.7-0.8: Good quality - probably quoted for relevant queries  
- 0.5-0.6: Average quality - might be quoted occasionally
- 0.3-0.4: Below average - unlikely to be quoted
- 0.0-0.2: Poor quality - very unlikely to be quoted

Return ONLY a single floating point number between 0.0 and 1.0 representing the probability score.
"""

                # Call OpenRouter GPT-4o API
                reward_score = await self._call_openrouter_for_reward(prompt)
                rewards.append(reward_score)
                
                logger.debug(f"Sample {i}: Brand={brand_name}, Dimension={dimension}, Reward={reward_score:.3f}")
                
            except Exception as e:
                logger.error(f"Error calculating reward for sample {i}: {e}")
                rewards.append(0.0)  # Default reward on error
        
        return rewards
    
    async def _call_openrouter_for_reward(self, prompt: str) -> float:
        """
        Call OpenRouter GPT-4o API to get reward score
        
        Args:
            prompt: Evaluation prompt for GPT-4o
            
        Returns:
            Reward score between 0.0 and 1.0
        """
        try:
            # Check for API key
            openrouter_api_key = os.getenv('OPENROUTER_API_KEY')
            if not openrouter_api_key:
                logger.error("OPENROUTER_API_KEY not found in environment")
                return 0.0
            
            # Prepare request
            headers = {
                'Authorization': f'Bearer {openrouter_api_key}',
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/your-repo',
                'X-Title': 'GEO Policy Model Training'
            }
            
            data = {
                'model': 'openai/gpt-4o',
                'messages': [
                    {
                        'role': 'user',
                        'content': prompt
                    }
                ],
                'temperature': 0.1,
                'max_tokens': 10  # We only need a single number
            }
            
            # Make API call
            response = requests.post(
                'https://openrouter.ai/api/v1/chat/completions',
                headers=headers,
                json=data,
                timeout=30
            )
            
            if response.status_code != 200:
                logger.error(f"OpenRouter API error: {response.status_code} - {response.text}")
                return 0.0
            
            result = response.json()
            
            # Extract and parse response
            content = result.get('choices', [{}])[0].get('message', {}).get('content', '0.0')
            
            # Parse the floating point number
            try:
                reward_score = float(content.strip())
                # Clamp to valid range
                reward_score = max(0.0, min(1.0, reward_score))
                return reward_score
            except ValueError:
                logger.error(f"Could not parse reward score from: '{content}'")
                return 0.0
                
        except Exception as e:
            logger.error(f"Error calling OpenRouter API: {e}")
            return 0.0
    
    def update_baseline(self, rewards: torch.Tensor):
        """Update exponential moving average baseline for GRPO"""
        batch_reward_mean = rewards.mean().item()
        
        if self.running_baseline == 0.0:
            # Initialize baseline with first batch
            self.running_baseline = batch_reward_mean
        else:
            # Exponential moving average
            self.running_baseline = (
                self.config.baseline_tau * self.running_baseline + 
                (1 - self.config.baseline_tau) * batch_reward_mean
            )
        
        self.baseline_rewards.append(self.running_baseline)
        logger.debug(f"Baseline updated: {self.running_baseline:.4f}")
    
    def grpo_loss(self, log_probs: torch.Tensor, rewards: torch.Tensor) -> torch.Tensor:
        """
        Compute GRPO loss: -log_prob * (reward - baseline)
        
        This is the core of GRPO - we increase probability of actions that 
        got rewards above baseline, decrease probability of actions below baseline.
        
        Args:
            log_probs: Log probabilities from policy (requires_grad=True)
            rewards: Reward values (treated as constants, no gradients needed)
        """
        # Ensure rewards are detached (treated as constants during backprop)
        rewards = rewards.detach()
        
        # Center rewards around baseline
        baseline = torch.tensor(self.running_baseline, device=self.device)
        advantages = rewards - baseline
        
        # GRPO gradient: ∇θ J = ∇θ log π(a|s) * (R - b)
        # Only log_probs contributes gradients, advantages are constants
        loss = -(log_probs * advantages).mean()
        
        return loss
    
    async def collect_and_train(self, data_loader: DataLoader, optimizer) -> float:
        """
        Pure GRPO training: collect experiences and train in one go
        No separate experience collection phase - GRPO is simpler than PPO
        """
        total_reward = 0
        num_batches = 0
        
        # Gradient accumulation
        accumulation_steps = self.config.gradient_accumulation_steps
        optimizer.zero_grad()
        
        for step, batch in enumerate(tqdm(data_loader, desc="GRPO Training")):
            # Generate sentences and get log probabilities
            generated_sentences, log_probs = self.generate_and_score(batch)
            
            # Calculate rewards
            rewards = await self.calculate_rewards_tmp(batch, generated_sentences)
            rewards_tensor = torch.tensor(rewards, dtype=torch.float32, device=self.device)
            
            total_reward += sum(rewards)
            num_batches += 1
            
            # Update baseline (exponential moving average)
            self.update_baseline(rewards_tensor)
            
            # Compute GRPO loss
            loss = self.grpo_loss(log_probs, rewards_tensor)
            
            # Scale loss for gradient accumulation
            loss = loss / accumulation_steps
            
            # Backward pass
            loss.backward()
            
            # Store loss
            self.policy_losses.append(loss.item() * accumulation_steps)
            
            # Update every accumulation_steps or at the end
            if (step + 1) % accumulation_steps == 0 or (step + 1) == len(data_loader):
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.config.max_grad_norm)
                optimizer.step()
                optimizer.zero_grad()
        
        avg_reward = total_reward / num_batches if num_batches > 0 else 0
        self.episode_rewards.append(avg_reward)
        return avg_reward
    
    async def train_epoch(self, data_loader: DataLoader, optimizer) -> float:
        """
        Train for one epoch using pure GRPO algorithm
        
        GRPO is simpler than PPO:
        1. Generate sentences and calculate log probabilities (in eval mode)
        2. Calculate rewards for generated sentences
        3. Update baseline (exponential moving average)
        4. Compute GRPO loss: -log_prob * (reward - baseline) (in train mode)
        5. Update policy parameters
        
        No value function, no experience replay, no clipping!
        """
        # Set model to training mode (generate_and_score will temporarily switch to eval)
        self.model.train()
        return await self.collect_and_train(data_loader, optimizer)
    
    def plot_training_history(self):
        """Plot GRPO training history"""
        fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(12, 8))
        
        # Episode rewards
        if self.episode_rewards:
            epochs = range(1, len(self.episode_rewards) + 1)
            ax1.plot(epochs, self.episode_rewards, 'b-')
            ax1.set_title('Episode Rewards')
            ax1.set_xlabel('Epoch')
            ax1.set_ylabel('Average Reward')
            ax1.grid(True)
        
        # Policy losses (GRPO loss)
        if self.policy_losses:
            ax2.plot(self.policy_losses, 'r-')
            ax2.set_title('GRPO Policy Losses')
            ax2.set_xlabel('Update Step')
            ax2.set_ylabel('GRPO Loss')
            ax2.grid(True)
        
        # Baseline rewards
        if self.baseline_rewards:
            ax3.plot(self.baseline_rewards, 'g-')
            ax3.set_title('Reward Baseline')
            ax3.set_xlabel('Update Step')
            ax3.set_ylabel('Baseline Value')
            ax3.grid(True)
        
        # Reward distribution (if we have enough data)
        if len(self.episode_rewards) > 1:
            ax4.hist(self.episode_rewards, bins=20, alpha=0.7, color='purple')
            ax4.set_title('Reward Distribution')
            ax4.set_xlabel('Average Reward')
            ax4.set_ylabel('Frequency')
            ax4.grid(True)
        
        plt.tight_layout()
        plt.savefig(os.path.join(self.config.output_dir, 'grpo_training_history.png'))
        plt.show()
    
    def save_model(self, epoch: int):
        """Save model checkpoint"""
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': self.model.state_dict(),
            'config': self.config,
            'episode_rewards': self.episode_rewards,
            'policy_losses': self.policy_losses,
            'baseline_rewards': self.baseline_rewards,
            'running_baseline': self.running_baseline
        }
        
        checkpoint_path = os.path.join(
            self.config.output_dir,
            f'grpo_model_epoch_{epoch}.pt'
        )
        torch.save(checkpoint, checkpoint_path)
        logger.info(f"Saved GRPO checkpoint: {checkpoint_path}")
    
    async def train(self, train_data: List[Dict]):
        """Main GRPO training loop"""
        logger.info("Starting GRPO (Generative Reinforcement Policy Optimization) training")
        
        # Create dataset and dataloader
        dataset = SentenceModificationDataset(train_data, self.tokenizer, self.config.max_length)
        data_loader = DataLoader(dataset, batch_size=self.config.batch_size, shuffle=True)
        
        # Setup optimizer
        optimizer = optim.AdamW(self.model.parameters(), lr=self.config.learning_rate)
        
        # Training loop
        for epoch in range(1, self.config.num_epochs + 1):
            logger.info(f"GRPO Epoch {epoch}/{self.config.num_epochs}")
            
            avg_reward = await self.train_epoch(data_loader, optimizer)
            logger.info(f"Average Reward: {avg_reward:.4f}, Baseline: {self.running_baseline:.4f}")
            
            # Save checkpoint
            if epoch % self.config.save_every == 0:
                self.save_model(epoch)
        
        # Plot results and save final model
        self.plot_training_history()
        self.save_model(self.config.num_epochs)
        logger.info("GRPO training completed!")

async def load_training_data(brand_urls: List[str]) -> List[Dict]:
    """Load training data from MongoDB FullWebContentCache"""
    logger.info(f"Loading training data for {len(brand_urls)} brand URLs...")
    
    training_data = []
    
    for brand_url in brand_urls:
        try:
            # Normalize URL
            normalized_url = normalizeUrl(brand_url)
            logger.info(f"Loading data for {brand_url} (normalized: {normalized_url})")
            
            # Get data from MongoDB
            web_content_doc = await FullWebContentCache.findByBrandUrl(normalized_url)
            if not web_content_doc:
                logger.warning(f"No web content found for {brand_url}")
                continue
                
            brand_name = web_content_doc.brandName
            website_content = web_content_doc.websiteContent
            
            # Extract training samples from each dimension and domain
            for dimension, content_snippets in website_content.items():
                for domain, domain_data in content_snippets.items():
                    # Handle both old and new data formats
                    if isinstance(domain_data, list):
                        # Old format: domain_data is just a list of sentences
                        sentences = domain_data
                        visibility = 0.0  # Default for old format
                    else:
                        # New format: domain_data has sentences and visibility
                        sentences = domain_data.get('sentences', [])
                        visibility = domain_data.get('visibility', 0.0)
                    
                    if sentences:  # Only add if there are sentences
                        training_data.append({
                            'sentences': sentences,
                            'dimension': dimension,
                            'domain': domain,
                            'brand_name': brand_name,
                            'brand_url': brand_url,
                            'visibility': visibility
                        })
            
            logger.info(f"Loaded {len([d for d in training_data if d['brand_url'] == brand_url])} samples for {brand_name}")
            
        except Exception as e:
            logger.error(f"Error loading data for {brand_url}: {e}")
            continue
    
    logger.info(f"Total training samples loaded: {len(training_data)}")
    
    if not training_data:
        raise ValueError("No training data found! Make sure to run analyze-web-content.ts first.")
    
    return training_data

def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Train policy model using Pure GRPO (Generative Reinforcement Policy Optimization)")
    parser.add_argument(
        'brand_urls',
        nargs='+',
        help='List of brand URLs for training data'
    )
    parser.add_argument(
        '--model',
        default='meta-llama/Llama-3.1-8B',
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
        default='./grpo_model_output',
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
        '--learning_rate',
        type=float,
        default=None,  # Will be auto-set based on model
        help='Learning rate'
    )
    parser.add_argument(
        '--max_length',
        type=int,
        default=512,
        help='Maximum sequence length'
    )
    
    args = parser.parse_args()
    
    # Auto-adjust settings for large models
    learning_rate = args.learning_rate
    if "llama" in args.model.lower() and "8b" in args.model.lower():
        logger.info("🔥 Detected Llama 8B model - auto-adjusting settings for large model")
        if args.gradient_accumulation_steps == 1:
            logger.info(f"   Setting gradient accumulation steps to 4")
            args.gradient_accumulation_steps = 4
        if not args.use_lora:
            logger.info(f"   Auto-enabling LoRA")
            args.use_lora = True
        if learning_rate is None:
            learning_rate = 1e-6
            logger.info(f"   Setting learning rate to {learning_rate}")
    elif learning_rate is None:
        learning_rate = 1e-5  # Default for smaller models
    
    # Create config
    config = GRPOConfig(
        model_name=args.model,
        reward_model_path=args.reward_model_path,
        num_epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=learning_rate,
        output_dir=args.output_dir,
        use_lora=args.use_lora,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        max_length=args.max_length
    )
    
    # Load training data from MongoDB
    try:
        train_data = asyncio.run(load_training_data(args.brand_urls))
    except Exception as e:
        logger.error(f"Failed to load training data: {e}")
        sys.exit(1)
    
    # Initialize GRPO trainer
    trainer = GRPOTrainer(config)
    
    # Start training
    try:
        asyncio.run(trainer.train(train_data))
    except Exception as e:
        logger.error(f"Training failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
