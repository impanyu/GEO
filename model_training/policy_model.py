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

# Load environment variables from multiple possible locations
import os
from pathlib import Path

# Try loading from multiple locations
env_paths = [
    '../.env.local',  # From model_training directory
    '.env.local',     # From current directory
    '.env',           # Standard .env file
]

for env_path in env_paths:
    if Path(env_path).exists():
        load_dotenv(env_path)
        print(f"✅ Loaded environment from: {env_path}")
        break
else:
    print("⚠️ No .env file found. Make sure to set HF_TOKEN, MONGODB_URI, and OPENROUTER_API_KEY as environment variables.")

# Debug: Check if critical environment variables are loaded
hf_token_check = os.getenv('HF_TOKEN')
if hf_token_check:
    print(f"✅ HF_TOKEN loaded: {hf_token_check[:10]}...")
else:
    print("❌ HF_TOKEN not found in environment variables")

mongodb_uri_check = os.getenv('MONGODB_URI')
if mongodb_uri_check:
    print(f"✅ MONGODB_URI loaded: {mongodb_uri_check[:20]}...")
else:
    print("❌ MONGODB_URI not found in environment variables")

# MongoDB connection setup
import urllib.parse

def normalize_url(url: str) -> str:
    """Normalize URL for consistent comparison - matches PromptCache.ts logic"""
    # Remove protocol if present
    normalized = url
    if normalized.startswith('https://'):
        normalized = normalized[8:]  # Remove 'https://'
    elif normalized.startswith('http://'):
        normalized = normalized[7:]   # Remove 'http://'
    
    # Remove www. if present
    if normalized.startswith('www.'):
        normalized = normalized[4:]   # Remove 'www.'
    
    # Remove trailing slash
    if normalized.endswith('/'):
        normalized = normalized[:-1]  # Remove trailing '/'
    
    # Convert to lowercase for consistent comparison
    return normalized.lower()

async def get_mongodb_connection():
    """Get MongoDB connection"""
    mongodb_uri = os.getenv('MONGODB_URI')
    if not mongodb_uri:
        raise ValueError("MONGODB_URI environment variable not set")
    
    client = pymongo.MongoClient(mongodb_uri)
    db = client['springbrand-ai']
    return db

import torch
import torch.nn as nn
import torch.optim as optim
import torch.distributed as dist
import torch.multiprocessing as mp
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import Dataset, DataLoader
from torch.utils.data.distributed import DistributedSampler
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
from reward_model import RewardModel, TrainingConfig as RewardConfig

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def setup_distributed(rank: int, world_size: int, master_addr: str = "localhost", master_port: str = "12355"):
    """Initialize distributed training environment"""
    try:
        os.environ['MASTER_ADDR'] = master_addr
        os.environ['MASTER_PORT'] = master_port
        
        # Set the current CUDA device first
        torch.cuda.set_device(rank)
        
        # Initialize the process group with timeout
        dist.init_process_group(
            "nccl", 
            rank=rank, 
            world_size=world_size,
            timeout=torch.distributed.default_pg_timeout
        )
        
        logger.info(f"🚀 Distributed training initialized: rank {rank}/{world_size}")
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize distributed training for rank {rank}: {e}")
        raise

def cleanup_distributed():
    """Clean up distributed training environment"""
    try:
        if dist.is_initialized():
            dist.destroy_process_group()
            logger.debug("🧹 Distributed training cleaned up")
    except Exception as e:
        logger.warning(f"⚠️ Error during distributed cleanup: {e}")

def is_main_process(rank: int = None) -> bool:
    """Check if this is the main process (rank 0)"""
    if rank is not None:
        return rank == 0
    return not dist.is_initialized() or dist.get_rank() == 0

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
    num_samples_per_input: int = 5  # Number of sequences to sample per input
    # Multi-GPU configuration
    distributed: bool = False  # Enable distributed training
    world_size: int = 1  # Total number of processes (GPUs)
    rank: int = 0  # Current process rank
    local_rank: int = 0  # Local GPU rank
    master_addr: str = "localhost"  # Master node address
    master_port: str = "12355"  # Master node port

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
        
        # Tokenize with consistent padding
        encoding = self.tokenizer(
            prompt,
            truncation=True,
            padding='max_length',
            max_length=self.max_length,
            return_tensors='pt'
        )
        
        return {
            'input_ids': encoding['input_ids'].squeeze(0),  # Remove batch dimension but keep tensor
            'attention_mask': encoding['attention_mask'].squeeze(0),  # Remove batch dimension but keep tensor
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
        
        # Get HF token for authenticated models
        hf_token = os.getenv('HF_TOKEN')
        tokenizer_kwargs = {}
        if hf_token:
            tokenizer_kwargs['token'] = hf_token
        
        # Also initialize the tokenizer for consistent inference
        if "llama" in config.model_name.lower():
            from transformers import AutoTokenizer
            self.reward_tokenizer = AutoTokenizer.from_pretrained(config.model_name, **tokenizer_kwargs)
        elif "gpt2" in config.model_name.lower():
            from transformers import GPT2Tokenizer
            self.reward_tokenizer = GPT2Tokenizer.from_pretrained(config.model_name, **tokenizer_kwargs)
        else:
            from transformers import AutoTokenizer
            self.reward_tokenizer = AutoTokenizer.from_pretrained(config.model_name, **tokenizer_kwargs)
        
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
    
    def __init__(self, model_name: str, use_lora: bool = False, distributed: bool = False):
        super().__init__()
        self.model_name = model_name
        self.use_lora = use_lora
        self.distributed = distributed
        
        # Load model based on architecture
        logger.info(f"Loading GRPO model: {model_name}")
        
        # Get HF token for authenticated models
        hf_token = os.getenv('HF_TOKEN')
        model_kwargs = {}
        if hf_token:
            model_kwargs['token'] = hf_token
        
        if "llama" in model_name.lower():
            # Choose loading strategy based on distributed training requirements
            try:
                if distributed:
                    # For multi-GPU: Load on GPU 0, let DataParallel handle distribution
                    self.backbone = LlamaForCausalLM.from_pretrained(
                        model_name,
                        dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                        attn_implementation="flash_attention_2",
                        low_cpu_mem_usage=True,
                        **model_kwargs
                    )
                    logger.info("✅ Multi-GPU: Loaded on single device for DataParallel")
                else:
                    # For single GPU: Use device_map for memory efficiency
                    self.backbone = LlamaForCausalLM.from_pretrained(
                        model_name,
                        dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                        device_map="auto" if torch.cuda.is_available() else None,
                        attn_implementation="flash_attention_2",
                        low_cpu_mem_usage=True,
                        **model_kwargs
                    )
                    logger.info("✅ Single GPU: Using device_map='auto'")
                logger.info("✅ Using Flash Attention 2 for memory efficiency")
            except Exception as e:
                logger.warning(f"⚠️ Flash Attention 2 not available: {e}")
                logger.info("🔄 Falling back to standard attention")
                if distributed:
                    # Multi-GPU fallback: Load on single device for DataParallel
                    self.backbone = LlamaForCausalLM.from_pretrained(
                        model_name,
                        dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                        low_cpu_mem_usage=True,
                        **model_kwargs
                    )
                    logger.info("✅ Multi-GPU fallback: Loaded on single device for DataParallel")
                else:
                    # Single GPU fallback: Use device_map for memory efficiency
                    self.backbone = LlamaForCausalLM.from_pretrained(
                        model_name,
                        dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                        device_map="auto" if torch.cuda.is_available() else None,
                        low_cpu_mem_usage=True,
                        **model_kwargs
                    )
                    logger.info("✅ Single GPU fallback: Using device_map='auto'")
        else:
            # Generic causal LM (GPT-2, DialoGPT, etc.)
            self.backbone = AutoModelForCausalLM.from_pretrained(
                model_name,
                **model_kwargs
            )
        
        # No value head needed for pure GRPO!
        
        # Enable gradient checkpointing for memory efficiency
        if torch.cuda.is_available():
            self.backbone.gradient_checkpointing_enable()
            logger.info("✅ Gradient checkpointing enabled for memory efficiency")
        
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
        
        # Set memory allocation configuration for better memory management
        if torch.cuda.is_available():
            import os
            os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
            logger.info("✅ Set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True for memory efficiency")
        
        # Setup distributed training if enabled
        if config.distributed:
            setup_distributed(config.rank, config.world_size, config.master_addr, config.master_port)
            self.device = torch.device(f'cuda:{config.local_rank}')
            self.is_main_process = config.rank == 0
        else:
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            self.is_main_process = True
        
        if self.is_main_process:
            logger.info(f"Using device: {self.device}")
            if config.distributed:
                logger.info(f"🎯 Distributed training: {config.world_size} GPUs")
        
        # Set seed
        set_seed(config.seed)
        
        # Get HF token for authenticated models
        hf_token = os.getenv('HF_TOKEN')
        
        # Initialize tokenizer based on model type
        tokenizer_kwargs = {}
        if hf_token:
            tokenizer_kwargs['token'] = hf_token
            
        if "llama" in config.model_name.lower():
            # Use AutoTokenizer for better compatibility with Llama models
            self.tokenizer = AutoTokenizer.from_pretrained(config.model_name, **tokenizer_kwargs)
        elif "gpt2" in config.model_name.lower():
            self.tokenizer = GPT2Tokenizer.from_pretrained(config.model_name, **tokenizer_kwargs)
        else:
            self.tokenizer = AutoTokenizer.from_pretrained(config.model_name, **tokenizer_kwargs)
        
        # Set pad token if not exists
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        
        # Auto-determine LoRA usage for large models (unless explicitly disabled)
        use_lora = config.use_lora
        if not use_lora and "llama" in config.model_name.lower() and "8b" in config.model_name.lower():
            use_lora = True
            logger.info("🔥 Auto-enabling LoRA for Llama 8B model")
        
        # Initialize GRPO model (no value head)
        self.model = GRPOModel(config.model_name, use_lora=use_lora, distributed=config.distributed)
        
        # Setup multi-GPU training
        if config.distributed:
            try:
                # Try to move model to GPU 0 first, then wrap with DataParallel
                self.model.to(torch.device('cuda:0'))
                available_gpus = list(range(torch.cuda.device_count()))
                self.model = torch.nn.DataParallel(self.model, device_ids=available_gpus)
                if self.is_main_process:
                    logger.info(f"✅ Model moved to cuda:0 and wrapped with DataParallel across {len(available_gpus)} GPUs")
                    logger.info(f"🎯 Using DataParallel for multi-GPU training")
            except torch.cuda.OutOfMemoryError as e:
                if self.is_main_process:
                    logger.error(f"❌ Model too large for single GPU: {e}")
                    logger.info("🔄 Falling back to single GPU training with device_map")
                # Fall back to single GPU training
                config.distributed = False
                self.is_main_process = True
        
        if not config.distributed:
            # Single GPU or CPU training
            if not torch.cuda.is_available() or not use_lora:
                self.model.to(self.device)
            else:
                if self.is_main_process:
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
    
    async def generate_and_score(self, batch) -> Tuple[List[torch.Tensor], List[float], List[float]]:
        """
        Generate sentences and calculate log probabilities for GRPO using hybrid approach:
        1. Use model.generate() for text generation (non-differentiable)
        2. Use model.forward() on generated sequences for differentiable log probs
        3. Sample multiple sequences per input for proper GRPO loss calculation
        
        Args:
            batch: Input batch containing 'input_ids', 'attention_mask', 'brand_name', 'dimension', 'domain'
            
        Returns:
            Tuple of:
            - all_log_probs: List of log prob tensors for all samples [input_i_sample_j_log_prob, ...]
            - all_rewards: List of reward scores for all samples [input_i_sample_j_reward, ...]
            - all_advantages: List of advantages for all samples [input_i_sample_j_advantage, ...]
        """
        # Store current training mode
        was_training = self.model.training
        
        # Determine target device - handle DDP and DataParallel wrappers
        if isinstance(self.model, (DDP, torch.nn.DataParallel)):
            target_device = next(self.model.module.parameters()).device
        else:
            target_device = next(self.model.parameters()).device
        
        # Store ALL samples across all inputs for proper GRPO loss calculation
        all_log_probs = []  # List of log prob tensors for ALL samples
        all_rewards = []    # List of reward values for ALL samples  
        all_advantages = [] # List of advantage values for ALL samples
        
        for i in range(len(batch['input_ids'])):
            # Move to correct device
            input_ids = batch['input_ids'][i:i+1].to(target_device)
            attention_mask = batch['attention_mask'][i:i+1].to(target_device)
            
            input_sample_rewards = []  # Collect rewards for this input to calculate baseline
            input_sample_log_probs = []  # Collect log probs for this input
            
            # Sample multiple sequences for this input
            for sample_idx in range(self.config.num_samples_per_input):
                # Step 1: Generate sequence using model.generate() (non-differentiable)
                self.model.eval()
                with torch.no_grad():
                    # Handle DDP and DataParallel wrapper for generation
                    model_for_generation = self.model.module if isinstance(self.model, (DDP, torch.nn.DataParallel)) else self.model
                    outputs = model_for_generation.generate(
                        input_ids=input_ids,
                        attention_mask=attention_mask,
                        max_new_tokens=self.config.max_new_tokens,
                        do_sample=True,
                        temperature=self.config.temperature,
                        top_k=self.config.top_k,
                        top_p=self.config.top_p,
                        pad_token_id=self.tokenizer.pad_token_id,
                    )
                
                # Extract generated sequence (includes input + new tokens)
                generated_sequence = outputs[0]  # Full sequence
                input_length = input_ids.shape[1]
                
                # Step 2: Use model.forward() on generated sequence for differentiable log probs
                self.model.train()  # Switch to train mode for differentiable forward pass
                
                # Forward pass on the full generated sequence
                forward_outputs = self.model(
                    input_ids=generated_sequence.unsqueeze(0), 
                    attention_mask=torch.ones_like(generated_sequence).unsqueeze(0)
                )
                
                # Calculate log probabilities for the new tokens only
                logits = forward_outputs.logits[0]  # [seq_len, vocab_size]
                log_probs = torch.log_softmax(logits, dim=-1)  # [seq_len, vocab_size]
                
                # Get log probs for the actual generated tokens (excluding input part)
                new_token_ids = generated_sequence[input_length:]
                if len(new_token_ids) > 0:
                    # Get log probs for each new token at its position
                    new_token_log_probs = []
                    for j, token_id in enumerate(new_token_ids):
                        pos = input_length + j - 1  # Position in logits (shifted by 1)
                        if pos >= 0 and pos < logits.shape[0]:
                            token_log_prob = log_probs[pos, token_id]
                            new_token_log_probs.append(token_log_prob)
                    
                    if new_token_log_probs:
                        # Sum log probabilities for the sequence
                        sequence_log_prob = torch.stack(new_token_log_probs).sum()
                    else:
                        sequence_log_prob = torch.tensor(0.0, device=target_device, requires_grad=True)
                else:
                    sequence_log_prob = torch.tensor(0.0, device=target_device, requires_grad=True)
                
                # Step 3: Decode and extract sentences for reward calculation
                generated_text = self.tokenizer.decode(generated_sequence, skip_special_tokens=True)
                
                try:
                    if "Modified sentences:" in generated_text:
                        json_part = generated_text.split("Modified sentences:")[-1].strip()
                        modified_sentences = json.loads(json_part)
                        if isinstance(modified_sentences, list):
                            sentences = modified_sentences
                        else:
                            sentences = [str(modified_sentences)]
                    else:
                        sentences = batch['original_sentences'][i]
                except:
                    sentences = batch['original_sentences'][i]
                
                # Step 4: Calculate reward using calculate_rewards_tmp
                sample_batch = {
                    'brand_name': [batch['brand_name'][i]],
                    'dimension': [batch['dimension'][i]],
                    'domain': [batch['domain'][i]]
                }
                rewards = await self.calculate_rewards_tmp(sample_batch, [sentences])
                reward = rewards[0]
                
                # Store for this input's baseline calculation
                input_sample_rewards.append(reward)
                input_sample_log_probs.append(sequence_log_prob)
                
                # Clear GPU cache after each sample to prevent memory buildup
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    # Additional memory cleanup
                    if hasattr(torch.cuda, 'synchronize'):
                        torch.cuda.synchronize()
            
            # Calculate baseline for this input (mean of all its samples)
            input_baseline = sum(input_sample_rewards) / len(input_sample_rewards)
            
            # Calculate advantages for all samples of this input and add to global lists
            for j in range(len(input_sample_rewards)):
                advantage = input_sample_rewards[j] - input_baseline
                all_log_probs.append(input_sample_log_probs[j])
                all_rewards.append(input_sample_rewards[j])
                all_advantages.append(advantage)
        
        # Restore original training mode
        if was_training:
            self.model.train()
        else:
            self.model.eval()
        
        return all_log_probs, all_rewards, all_advantages
    
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
    
    def grpo_loss(self, all_log_probs: List[torch.Tensor], all_advantages: List[float]) -> torch.Tensor:
        """
        Compute GRPO loss: -sum(log_prob * advantage) for all samples
        
        This is the core of GRPO - we increase probability of actions that 
        got advantages above 0, decrease probability of actions below 0.
        
        Args:
            all_log_probs: List of log probability tensors for all samples (requires_grad=True)
            all_advantages: List of advantage values for all samples (reward - baseline)
        """
        if not all_log_probs or not all_advantages:
            return torch.tensor(0.0, device=self.device, requires_grad=True)
        
        # Stack all log probs (these have gradients) and get their device
        log_probs_tensor = torch.stack(all_log_probs)
        target_device = log_probs_tensor.device
        
        # Convert advantages to tensor on the same device as log_probs
        advantages_tensor = torch.tensor(all_advantages, device=target_device, requires_grad=False)
        
        # GRPO gradient: ∇θ J = ∇θ Σ log π(a_i|s_i) * A_i
        # where A_i = R_i - b_i (advantage for sample i)
        loss = -(log_probs_tensor * advantages_tensor).sum()
        
        # Normalize by number of samples for stable gradients
        loss = loss / len(all_log_probs)
        
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
            # Generate all samples and get log probabilities, rewards, and advantages
            all_log_probs, all_rewards, all_advantages = await self.generate_and_score(batch)
            
            # Calculate average reward for tracking
            avg_reward = sum(all_rewards) / len(all_rewards) if all_rewards else 0.0
            total_reward += avg_reward
            num_batches += 1
            
            # Update global baseline (exponential moving average) for tracking only
            # Use the same device as the first log_prob tensor if available
            baseline_device = all_log_probs[0].device if all_log_probs else self.device
            rewards_tensor = torch.tensor(all_rewards, dtype=torch.float32, device=baseline_device)
            self.update_baseline(rewards_tensor)
            
            # Compute GRPO loss using all samples and their advantages
            loss = self.grpo_loss(all_log_probs, all_advantages)
            
            # Scale loss for gradient accumulation
            loss = loss / accumulation_steps
            
            # Backward pass with memory management
            try:
                loss.backward()
            except torch.cuda.OutOfMemoryError as e:
                logger.warning(f"⚠️ CUDA OOM during backward pass: {e}")
                logger.info("🧹 Attempting memory cleanup and retry")
                # Clear cache and retry
                torch.cuda.empty_cache()
                if hasattr(torch.cuda, 'synchronize'):
                    torch.cuda.synchronize()
                # Reduce computation temporarily
                with torch.autograd.set_detect_anomaly(False):
                    loss.backward()
            
            # Store loss
            self.policy_losses.append(loss.item() * accumulation_steps)
            
            # Log statistics
            num_samples = len(all_rewards)
            positive_advantages = sum(1 for adv in all_advantages if adv > 0)
            logger.debug(f"Step {step}: {num_samples} samples, {positive_advantages}/{num_samples} positive advantages, avg_reward={avg_reward:.3f}")
            
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
        # Handle DDP and DataParallel wrapper for state_dict
        model_for_saving = self.model.module if isinstance(self.model, (DDP, torch.nn.DataParallel)) else self.model
        
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': model_for_saving.state_dict(),
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
    
    def collate_fn(self, batch):
        """Custom collate function to handle batching"""
        # Since dataset already pads to max_length, we just need to stack tensors
        input_ids = torch.stack([item['input_ids'] for item in batch])
        attention_masks = torch.stack([item['attention_mask'] for item in batch])
        original_sentences = [item['original_sentences'] for item in batch]
        dimensions = [item['dimension'] for item in batch]
        domains = [item['domain'] for item in batch]
        brand_names = [item['brand_name'] for item in batch]
        
        return {
            'input_ids': input_ids,
            'attention_mask': attention_masks,
            'original_sentences': original_sentences,
            'dimension': dimensions,
            'domain': domains,
            'brand_name': brand_names
        }

    async def train(self, train_data: List[Dict]):
        """Main GRPO training loop"""
        if self.is_main_process:
            logger.info("Starting GRPO (Generative Reinforcement Policy Optimization) training")
            logger.info(f"🔬 Proper GRPO: {self.config.num_samples_per_input} samples per input, all samples used for loss")
            logger.info(f"🎯 Using differentiable forward pass for log probabilities")
            logger.info(f"📊 Loss: -Σ(log_prob_i * advantage_i) for all samples")
        
        # Create dataset and dataloader with custom collate function
        dataset = SentenceModificationDataset(train_data, self.tokenizer, self.config.max_length)
        
        # Use DistributedSampler for multi-GPU training
        if self.config.distributed:
            sampler = DistributedSampler(
                dataset, 
                num_replicas=self.config.world_size, 
                rank=self.config.rank,
                shuffle=True
            )
            data_loader = DataLoader(
                dataset, 
                batch_size=self.config.batch_size, 
                sampler=sampler,
                collate_fn=self.collate_fn
            )
        else:
            data_loader = DataLoader(
                dataset, 
                batch_size=self.config.batch_size, 
                shuffle=True,
                collate_fn=self.collate_fn
            )
        
        # Setup optimizer - get parameters from the correct model
        model_for_optimizer = self.model.module if isinstance(self.model, (DDP, torch.nn.DataParallel)) else self.model
        optimizer = optim.AdamW(model_for_optimizer.parameters(), lr=self.config.learning_rate)
        
        # Training loop
        for epoch in range(1, self.config.num_epochs + 1):
            if self.is_main_process:
                logger.info(f"GRPO Epoch {epoch}/{self.config.num_epochs}")
            
            # Set epoch for DistributedSampler
            if self.config.distributed:
                sampler.set_epoch(epoch)
            
            avg_reward = await self.train_epoch(data_loader, optimizer)
            
            if self.is_main_process:
                logger.info(f"Average Reward: {avg_reward:.4f}, Global Baseline: {self.running_baseline:.4f}")
                
                # Save checkpoint
                if epoch % self.config.save_every == 0:
                    self.save_model(epoch)
        
        if self.is_main_process:
            # Plot results and save final model
            self.plot_training_history()
            self.save_model(self.config.num_epochs)
            logger.info("GRPO training completed!")
        
        # Clean up distributed training
        if self.config.distributed:
            cleanup_distributed()

async def load_training_data(brand_urls: List[str]) -> List[Dict]:
    """Load training data from MongoDB FullWebContentCache"""
    logger.info(f"Loading training data for {len(brand_urls)} brand URLs...")
    
    training_data = []
    db = await get_mongodb_connection()
    collection = db['full_web_content']
    
    for brand_url in brand_urls:
        try:
            # Normalize URL
            normalized_url = normalize_url(brand_url)
            logger.info(f"Loading data for {brand_url} (normalized: {normalized_url})")
            
            # Get data from MongoDB
            web_content_doc = collection.find_one({'normalizedBrandUrl': normalized_url})
            if not web_content_doc:
                # Try with original URL as fallback
                web_content_doc = collection.find_one({'brandUrl': brand_url})
            
            if not web_content_doc:
                logger.warning(f"No web content found for {brand_url}")
                continue
                
            brand_name = web_content_doc['brandName']
            website_content = web_content_doc['websiteContent']
            
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

def train_worker(rank: int, world_size: int, args, train_data: List[Dict]):
    """Worker function for distributed training"""
    # Create config with distributed settings
    config = GRPOConfig(
        model_name=args.model,
        reward_model_path=args.reward_model_path,
        num_epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate if args.learning_rate else (1e-6 if "llama" in args.model.lower() and "8b" in args.model.lower() else 1e-5),
        output_dir=args.output_dir,
        use_lora=args.use_lora,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        max_length=args.max_length,
        num_samples_per_input=args.num_samples_per_input,
        # Distributed settings
        distributed=True,
        world_size=world_size,
        rank=rank,
        local_rank=rank,  # Assuming single node
        master_addr="localhost",
        master_port="12355"
    )
    
    # Initialize trainer and start training
    trainer = GRPOTrainer(config)
    asyncio.run(trainer.train(train_data))

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
        default='meta-llama/Llama-3.1-8B-Instruct',
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
        '--no_lora',
        action='store_true',
        help='Force disable LoRA even for large models'
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
    parser.add_argument(
        '--num_samples_per_input',
        type=int,
        default=5,
        help='Number of sequences to sample per input for baseline estimation'
    )
    parser.add_argument(
        '--num_gpus',
        type=int,
        default=1,
        help='Number of GPUs to use for distributed training (default: 1 for single GPU)'
    )
    parser.add_argument(
        '--world_size',
        type=int,
        default=None,
        help='Total number of processes for distributed training (auto-detected from num_gpus if not specified)'
    )
    
    args = parser.parse_args()
    
    # Auto-adjust settings for large models
    learning_rate = args.learning_rate
    if "llama" in args.model.lower() and "8b" in args.model.lower():
        logger.info("🔥 Detected Llama 8B model - auto-adjusting settings for large model")
        if args.gradient_accumulation_steps <= 4:
            logger.info(f"   Setting gradient accumulation steps to 8 for memory efficiency")
            args.gradient_accumulation_steps = 8
        if args.batch_size > 1:
            logger.info(f"   Reducing batch size from {args.batch_size} to 1 for memory efficiency")
            args.batch_size = 1
        if not args.use_lora and not args.no_lora:
            logger.info(f"   Auto-enabling LoRA")
            args.use_lora = True
        elif args.no_lora:
            logger.info(f"   LoRA explicitly disabled with --no_lora")
            args.use_lora = False
        if learning_rate is None:
            learning_rate = 1e-6
            logger.info(f"   Setting learning rate to {learning_rate}")
    elif learning_rate is None:
        learning_rate = 1e-5  # Default for smaller models
    
    # Determine world size
    world_size = args.world_size if args.world_size is not None else args.num_gpus
    
    # Load training data from MongoDB (only once, before spawning processes)
    try:
        train_data = asyncio.run(load_training_data(args.brand_urls))
    except Exception as e:
        logger.error(f"Failed to load training data: {e}")
        sys.exit(1)
    
    # Check if using multi-GPU training
    if world_size > 1:
        logger.info(f"🚀 Starting distributed training with {world_size} GPUs")
        
        # Verify GPU availability
        if not torch.cuda.is_available():
            logger.error("CUDA is not available for multi-GPU training")
            sys.exit(1)
        
        available_gpus = torch.cuda.device_count()
        if world_size > available_gpus:
            logger.error(f"Requested {world_size} GPUs but only {available_gpus} are available")
            sys.exit(1)
        
        # Use torch.multiprocessing.spawn for distributed training
        mp.spawn(
            train_worker,
            args=(world_size, args, train_data),
            nprocs=world_size,
            join=True
        )
        
    else:
        # Single GPU/CPU training
        logger.info("🎯 Starting single GPU training")
        
        config = GRPOConfig(
            model_name=args.model,
            reward_model_path=args.reward_model_path,
            num_epochs=args.epochs,
            batch_size=args.batch_size,
            learning_rate=learning_rate,
            output_dir=args.output_dir,
            use_lora=args.use_lora,
            gradient_accumulation_steps=args.gradient_accumulation_steps,
            max_length=args.max_length,
            num_samples_per_input=args.num_samples_per_input,
            distributed=False
        )
        
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
