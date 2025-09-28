#!/usr/bin/env python3
"""
Inference script for trained reward and policy models

This script allows you to:
1. Predict visibility scores using the trained reward model
2. Generate improved sentences using the trained policy model
"""

import argparse
import json
import os
import torch
from transformers import AutoTokenizer
from reward_model import RewardModel
from policy_model import GRPOModel, GRPOConfig
import pymongo
import asyncio
from typing import Dict, List
from dotenv import load_dotenv
import datetime

# Load environment variables
load_dotenv('../.env.local')

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

class ModelInference:
    """Inference wrapper for trained models"""
    
    def __init__(self, reward_model_path: str = None, policy_model_path: str = None):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # Load reward model
        if reward_model_path and os.path.exists(reward_model_path):
            self.reward_model, self.reward_tokenizer = self.load_reward_model(reward_model_path)
            print(f"✅ Loaded reward model from {reward_model_path}")
        else:
            self.reward_model = None
            self.reward_tokenizer = None
            print("⚠️ No reward model loaded")
        
        # Load policy model
        if policy_model_path and os.path.exists(policy_model_path):
            self.policy_model, self.policy_tokenizer = self.load_policy_model(policy_model_path)
            print(f"✅ Loaded policy model from {policy_model_path}")
        else:
            self.policy_model = None
            self.policy_tokenizer = None
            print("⚠️ No policy model loaded")
    
    def load_reward_model(self, model_path: str):
        """Load trained reward model"""
        checkpoint = torch.load(model_path, map_location=self.device, weights_only=False)
        config = checkpoint['config']
        
        # Load tokenizer
        tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        
        # Load model
        model = RewardModel(config.model_name)
        model.load_state_dict(checkpoint['model_state_dict'])
        model.to(self.device)
        model.eval()
        
        return model, tokenizer
    
    def load_policy_model(self, model_path: str):
        """Load trained policy model"""
        checkpoint = torch.load(model_path, map_location=self.device, weights_only=False)
        config = checkpoint['config']
        
        # Load tokenizer
        tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        
        # Load model - use GRPOModel with appropriate parameters
        use_lora = getattr(config, 'use_lora', False)
        use_qlora = getattr(config, 'use_qlora', False)
        
        # Create model without device_map to avoid multi-GPU distribution
        model = GRPOModel(config.model_name, use_lora=use_lora, use_qlora=use_qlora, distributed=False, force_single_device=True)
        
        # Load state dict
        state_dict = checkpoint['model_state_dict']
        model.load_state_dict(state_dict)
        
        # Move entire model to single device
        model.to(self.device)
        model.eval()
        
        return model, tokenizer
    
    def predict_visibility(self, sentences: list, dimension: str, domain: str) -> float:
        """Predict visibility score for given sentences"""
        if self.reward_model is None:
            raise ValueError("Reward model not loaded")
        
        # Prepare input
        sentences_json = json.dumps(sentences)
        input_text = f"Sentences: {sentences_json}\nDimension: {dimension}\nDomain: {domain}"
        
        # Tokenize
        encoding = self.reward_tokenizer(
            input_text,
            truncation=True,
            padding='max_length',
            max_length=512,
            return_tensors='pt'
        )
        
        # Predict
        with torch.no_grad():
            input_ids = encoding['input_ids'].to(self.device)
            attention_mask = encoding['attention_mask'].to(self.device)
            
            prediction = self.reward_model(input_ids, attention_mask)
            return prediction.item()
    
    async def predict_visibility_tmp(self, sentences: list, dimension: str, domain: str, brand_name: str = "Unknown Brand") -> float:
        """Predict visibility score using two-component system: quality assessment + length measurement"""
        try:
            # Skip empty sentence lists
            if not sentences or len(sentences) == 0:
                return 0.0
            
            # Large site list (same as policy model)
            LARGE_SITE_LIST = [
                'wikipedia.org',
                'youtube.com',
                'reddit.com',
                'quora.com',
                'instagram.com',
                'tiktok.com',
                'x.com',
                'linkedin.com',
                'forbes.com',
                'medium.com',
                'g2.com'
            ]
            
            # COMPONENT 1: Quality assessment using GPT-4o
            quality_score = await self._assess_content_quality_with_gpt4o(
                sentences, brand_name, dimension, domain
            )
            
            # COMPONENT 2: Length-based measurement
            length_score = self._calculate_length_score(sentences)
            
            # Combine components: 0.2 * quality + 0.3 * length
            base_visibility_score = 0.2 * quality_score + 0.3 * length_score
            
            # Domain bonus: multiply by 1.2 if domain is in large site list
            normalized_domain = domain.lower()
            if any(large_site in normalized_domain for large_site in LARGE_SITE_LIST):
                final_score = base_visibility_score * 1.2
                print(f"Domain bonus applied: {domain} is in large site list (score: {base_visibility_score:.4f} → {final_score:.4f})")
            else:
                final_score = base_visibility_score
            
            # Ensure score stays within 0-1 range
            final_score = min(1.0, max(0.0, final_score))
            
            print(f"Visibility score breakdown - Quality: {quality_score:.4f}, Length: {length_score:.4f}, Final: {final_score:.4f}")
            return final_score
            
        except Exception as e:
            print(f"Error calculating visibility score: {e}")
            return 0.0
    
    async def _assess_content_quality_with_gpt4o(
        self,
        sentences: list,
        brand_name: str,
        dimension: str,
        domain: str
    ) -> float:
        """
        Component 1: Assess content quality using GPT-4o based on:
        - Quality and usefulness of sentences
        - Relevance to brand and dimension  
        - Clarity and readability
        - Credibility and trustworthiness
        - Specificity vs vague generalities
        """
        try:
            # Format sentences for evaluation as JSON list
            import json
            sentences_text = json.dumps(sentences, indent=2)
            
            # Create quality assessment prompt
            prompt = f"""
You are an AI content quality evaluator. Your task is to assess the quality of content sentences for brand visibility.

CONTEXT:
- Brand: {brand_name}
- Content Dimension: {dimension}
- Source Domain: {domain}

CONTENT SENTENCES TO EVALUATE:
{sentences_text}

EVALUATION TASK:
Rate the quality (0.0 to 1.0) of these sentences based on the following criteria:

QUALITY CRITERIA:
1. The quality and usefulness of the sentences
2. The relevance to the brand and dimension
3. The clarity and readability of the sentences
4. The credibility and trustworthiness of the sentences
5. The specificity vs vague generalities of the sentences

SCORING GUIDELINES:
- 0.9-1.0: Exceptional quality, highly relevant, very specific and credible
- 0.7-0.8: Good quality, relevant, clear and trustworthy
- 0.5-0.6: Average quality, somewhat relevant, moderately clear
- 0.3-0.4: Below average quality, limited relevance, vague
- 0.0-0.2: Poor quality, irrelevant, unclear or untrustworthy

PAY ATTENTION: Be conservative in your scoring. Focus purely on content quality, not length.

Return ONLY a single floating point number between 0.0 and 1.0 representing the quality score.
"""

            # Call OpenRouter GPT-4o API
            quality_score = await self._call_openrouter_for_reward(prompt)
            return quality_score
            
        except Exception as e:
            print(f"Error assessing content quality: {e}")
            return 0.0
    
    def _calculate_length_score(self, sentences: list) -> float:
        """
        Component 2: Calculate length-based score considering:
        - Average sentence length (in words)
        - Number of sentences in the list
        Returns a score between 0.0 and 1.0 where longer is better
        """
        try:
            if not sentences or len(sentences) == 0:
                return 0.0
            
            # Calculate average sentence length in words
            total_words = sum(len(sentence.split()) for sentence in sentences)
            avg_sentence_length = total_words / len(sentences)
            
            # Calculate sentence count
            sentence_count = len(sentences)
            
            # Normalize average sentence length (assume 30 words is very good, 5 is minimum)
            # Using sigmoid-like scaling: score increases with length but plateaus
            length_component = min(1.0, max(0.0, (avg_sentence_length - 5) / 25))  # 5-30 word range
            
            # Normalize sentence count (assume 10 sentences is very good, 0 is minimum)
            # Using log scaling to avoid linear explosion
            import math
            count_component = min(1.0, max(0.0, sentence_count / 10))  # log scale 0-10 range
            
            # Combine both factors: 50% average length, 50% sentence count
            length_score = 0.3 * length_component + 0.7 * count_component
            
            print(f"Length analysis - Avg words/sentence: {avg_sentence_length:.1f}, Count: {sentence_count}, Score: {length_score:.4f}")
            return length_score
            
        except Exception as e:
            print(f"Error calculating length score: {e}")
            return 0.0
    
    async def _call_openrouter_for_reward(self, prompt: str) -> float:
        """
        Call OpenRouter GPT-4o API to get reward score (same as policy model)
        
        Args:
            prompt: Evaluation prompt for GPT-4o
            
        Returns:
            Reward score between 0.0 and 1.0
        """
        try:
            # Check for API key
            openrouter_api_key = os.getenv('OPENROUTER_API_KEY')
            if not openrouter_api_key:
                print("OPENROUTER_API_KEY not found in environment")
                return 0.0
            
            # Prepare request
            headers = {
                'Authorization': f'Bearer {openrouter_api_key}',
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/your-repo',
                'X-Title': 'GEO Inference'
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
            import requests
            response = requests.post(
                'https://openrouter.ai/api/v1/chat/completions',
                headers=headers,
                json=data,
                timeout=30
            )
            
            if response.status_code != 200:
                print(f"OpenRouter API error: {response.status_code} - {response.text}")
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
                print(f"Could not parse reward score from: '{content}'")
                return 0.0
                
        except Exception as e:
            print(f"Error calling OpenRouter API: {e}")
            return 0.0
    
    async def _clean_suggestions_with_gpt4o(
        self,
        raw_generated_text: str,
        original_sentences: list,
        brand_name: str,
        dimension: str,
        domain: str
    ) -> str:
        """
        Clean up raw generated text from policy model to produce well-formed modification suggestions
        
        Args:
            raw_generated_text: The raw text generated by the policy model
            original_sentences: The original input sentences for context
            brand_name: Brand name for context
            dimension: Content dimension for context
            domain: Domain for context
            
        Returns:
            Clean, well-formed modification suggestions as a paragraph
        """
        try:
            # Check for API key
            openrouter_api_key = os.getenv('OPENROUTER_API_KEY')
            if not openrouter_api_key:
                print("OPENROUTER_API_KEY not found in environment")
                return raw_generated_text.strip()  # Fallback to raw text
            
            # Create cleaning prompt
            original_json = json.dumps(original_sentences)
            cleaning_prompt = f"""
You are a content modification assistant. Your task is to clean up and reformat raw AI-generated text into clear, well-structured modification suggestions.

CONTEXT:
- Brand: {brand_name}
- Dimension: {dimension}
- Domain: {domain}
- Original content: {original_json}

RAW GENERATED TEXT:
{raw_generated_text}

TASK:
Clean up the raw generated text and convert it into clear, well-structured modification suggestions. The output should be a coherent paragraph that includes:
- Keywords to add/remove
- Style improvements to adopt
- Sentence structure recommendations
- Content/topics to add/remove
- Specific guidance when applicable to individual sentences

GUIDELINES:
- Make the suggestions clear and actionable
- Ensure proper grammar and formatting
- Remove any incomplete thoughts or garbled text
- Keep the core meaning and intent of the original suggestions
- Format as a single coherent paragraph

Return ONLY the cleaned modification suggestions as a well-formatted paragraph, nothing else.
"""

            # Prepare request
            headers = {
                'Authorization': f'Bearer {openrouter_api_key}',
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/your-repo',
                'X-Title': 'GEO Suggestion Cleaning'
            }
            
            data = {
                'model': 'openai/gpt-4o',
                'messages': [
                    {
                        'role': 'user',
                        'content': cleaning_prompt
                    }
                ],
                'temperature': 0.1,
                'max_tokens': 400  # Enough for well-formed suggestions
            }
            
            # Make API call
            import requests
            response = requests.post(
                'https://openrouter.ai/api/v1/chat/completions',
                headers=headers,
                json=data,
                timeout=30
            )
            
            if response.status_code != 200:
                print(f"OpenRouter API error during suggestion cleaning: {response.status_code} - {response.text}")
                return raw_generated_text.strip()  # Fallback to raw text
            
            result = response.json()
            
            # Extract and return cleaned suggestions
            content = result.get('choices', [{}])[0].get('message', {}).get('content', raw_generated_text)
            cleaned_suggestions = content.strip()
            
            print(f"Successfully cleaned suggestions using GPT-4o")
            return cleaned_suggestions
                
        except Exception as e:
            print(f"Error cleaning suggestions with GPT-4o: {e}")
            return raw_generated_text.strip()  # Fallback to raw text
    
    async def _extract_and_apply_suggestions_with_gpt4o(
        self, 
        suggestions: str, 
        original_sentences: list, 
        brand_name: str, 
        dimension: str, 
        domain: str
    ) -> list:
        """
        Apply modification suggestions to create modified sentences using GPT-4o (same as policy model)
        
        Args:
            suggestions: The modification suggestions text
            original_sentences: The original input sentences
            brand_name: Brand name for context
            dimension: Content dimension for context
            domain: Domain for context
            
        Returns:
            List of modified sentences based on the suggestions
        """
        try:
            # Check for API key
            openrouter_api_key = os.getenv('OPENROUTER_API_KEY')
            if not openrouter_api_key:
                print("OPENROUTER_API_KEY not found in environment")
                return original_sentences  # Fallback to original sentences
            
            # Create application prompt (same as policy model)
            original_json = json.dumps(original_sentences)
            application_prompt = f"""
You are a sentence modification assistant. Your task is to apply the given modification suggestions to improve the original sentences.

CONTEXT:
- Brand: {brand_name}
- Dimension: {dimension}
- Domain: {domain}
- Original sentences: {original_json}

MODIFICATION SUGGESTIONS:
{suggestions}

TASK:
Apply the modification suggestions to get a new list of sentences. Create modified sentences that:
1. Follow the suggestions provided
2. Maintain the same meaning as the original sentences
3. For existing sentences, the modified sentence should be in the same order as the original sentences
4. Newly added sentences should be added to the end of the modified original sentences
5. Are returned as a JSON array of strings

GUIDELINES:
- If suggestions mention specific sentences, apply changes only to those sentences
- If suggestions are general, apply them to all sentences appropriately
- Focus on improving keywords, style, structure, and content as suggested
- Keep the core meaning intact while enhancing brand visibility

Return ONLY a valid JSON array of strings, nothing else. Do not wrap in markdown code blocks or add any other formatting.

Expected Output format: ["Enhanced sentence 1 with better keywords", "Improved sentence 2 with better structure","newly added sentence",...]

"""

            # Prepare request
            headers = {
                'Authorization': f'Bearer {openrouter_api_key}',
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/your-repo',
                'X-Title': 'GEO Sentence Modification'
            }
            
            data = {
                'model': 'openai/gpt-4o',
                'messages': [
                    {
                        'role': 'user',
                        'content': application_prompt
                    }
                ],
                'temperature': 0.1,
                'max_tokens': 800  # Enough for sentence modification
            }
            
            # Make API call
            import requests
            response = requests.post(
                'https://openrouter.ai/api/v1/chat/completions',
                headers=headers,
                json=data,
                timeout=30
            )
            
            if response.status_code != 200:
                print(f"OpenRouter API error during suggestion application: {response.status_code} - {response.text}")
                return original_sentences  # Fallback to original sentences
            
            result = response.json()
            
            # Extract and parse response
            content = result.get('choices', [{}])[0].get('message', {}).get('content', json.dumps(original_sentences))
            
            # Clean the content - remove markdown code blocks if present
            content = content.strip()
            if content.startswith('```json'):
                # Remove ```json from start
                content = content[7:]
            elif content.startswith('```'):
                # Remove ``` from start
                content = content[3:]
            
            if content.endswith('```'):
                # Remove ``` from end
                content = content[:-3]
            
            content = content.strip()
            
            # Parse the JSON response
            try:
                modified_sentences = json.loads(content)
                if isinstance(modified_sentences, list):
                    # Ensure all items are strings
                    sentences = [str(sentence) for sentence in modified_sentences]
                    print(f"Successfully applied suggestions to create {len(sentences)} modified sentences using GPT-4o")
                    return sentences
                else:
                    print(f"GPT-4o returned non-list: {modified_sentences}")
                    return original_sentences
            except json.JSONDecodeError as e:
                print(f"Could not parse JSON from GPT-4o suggestion application: '{content}' - {e}")
                return original_sentences
                
        except Exception as e:
            print(f"Error applying suggestions with GPT-4o: {e}")
            return original_sentences  # Fallback to original sentences
    
    async def generate_improved_sentences(
        self, 
        sentences: list, 
        dimension: str, 
        domain: str,
        brand_name: str = "Unknown Brand",
        max_new_tokens: int = 256
    ) -> dict:
        """Generate improved sentences using policy model and return both suggestions and modified sentences"""
        if self.policy_model is None:
            raise ValueError("Policy model not loaded")
        
        # Prepare input prompt (same format as policy model training)
        sentences_json = json.dumps(sentences)
        prompt = f"""The following sentences is published on {domain} and is about {dimension} for brand {brand_name}. You need to give modification suggestions for the list of sentences to improve brand visibility:
Sentences: {sentences_json}

Your suggestion include keywords to add/remove, style to adopt, sentence structure to adopt, content/topics to add/remove, etc.
When your suggestion is only applied to one sentence, you need to specify which sentence to modify, or your suggestion is considered general for all sentences.
When suggesting new content, you do not need to write specific content, you can point out which aspect/topics of the content to improve.
When sentence list is empty, you can suggest new content/aspects/topics to add.
All the suggested new content/topics/aspects should still be related to the brand {brand_name} and {dimension}.
Output the modification suggestions as a paragraph after semicolon:"""
        
        # Tokenize
        encoding = self.policy_tokenizer(
            prompt,
            truncation=True,
            max_length=512,
            return_tensors='pt'
        )
        
        # Generate
        with torch.no_grad():
            # Move inputs to the model's device
            input_ids = encoding['input_ids'].to(self.device)
            attention_mask = encoding['attention_mask'].to(self.device)
            
            outputs = self.policy_model.generate(
                input_ids=input_ids,
                attention_mask=attention_mask,
                max_new_tokens=max_new_tokens,
                do_sample=True,
                temperature=0.7,
                pad_token_id=self.policy_tokenizer.pad_token_id
            )
            
            # Decode only the generated part
            input_length = encoding['input_ids'].shape[1]
            generated_text = self.policy_tokenizer.decode(outputs[0][input_length:], skip_special_tokens=True)
            
            # Clean up the raw generated text using GPT-4o to get well-formed suggestions
            suggestions = await self._clean_suggestions_with_gpt4o(
                generated_text, sentences, brand_name, dimension, domain
            )
            
            # Apply suggestions using GPT-4o to get modified sentences (same as policy model)
            modified_sentences = await self._extract_and_apply_suggestions_with_gpt4o(
                suggestions, sentences, brand_name, dimension, domain
            )
            
            return {
                'suggestions': suggestions,
                'modified_sentences': modified_sentences,
                'original_sentences': sentences
            }
    
    async def optimize_sentences(
        self, 
        sentences: list, 
        dimension: str, 
        domain: str,
        iterations: int = 3,
        brand_name: str = "Unknown Brand"
    ) -> dict:
        """Optimize sentences by trying multiple iterations from original sentences and keeping the best result"""
        if self.policy_model is None:
            raise ValueError("Policy model must be loaded for optimization")
        
        # Calculate original score once
        raw_original_score = await self.predict_visibility_tmp(sentences, dimension, domain, brand_name)
        
        # Subtract a random number from 0-0.2 but keep it above 0
        #import random
        random_penalty = 0#random.uniform(0, 0.2)
        original_score = max(0.0, raw_original_score - random_penalty)
        
        
        results = {
            'original_sentences': sentences,
            'original_score': original_score,  # Adjusted score used for optimization
            'iterations': [],
            'final_sentences': sentences,  # Start with original as best
            'final_score': original_score,  # Start with original score as best
            'final_suggestions': ''
        }
        
        best_sentences = sentences
        best_score = original_score
        best_suggestions = ''
        
        for i in range(iterations):
            print(f"Iteration {i+1}: Starting from original sentences")
            
            # Always start from original sentences for each iteration
            generation_results = await self.generate_improved_sentences(
                sentences, dimension, domain, brand_name  # Always use original sentences
            )
            
            iteration_sentences = generation_results['modified_sentences']
            suggestions = generation_results['suggestions']
            
            # Predict visibility for this iteration's result
            iteration_score = await self.predict_visibility_tmp(iteration_sentences, dimension, domain, brand_name)
            
            # Store iteration results
            results['iterations'].append({
                'iteration': i + 1,
                'base_sentences': sentences,  # Always original
                'base_score': original_score,
                'generated_sentences': iteration_sentences,
                'generated_score': iteration_score,
                'improvement': iteration_score - original_score,
                'suggestions': suggestions
            })
            
            # Check if this iteration produced the best result so far
            if iteration_score > best_score:
                best_sentences = iteration_sentences
                best_score = iteration_score
                best_suggestions = suggestions
                print(f"Iteration {i+1}: New best score! {best_score:.4f} (improvement: {iteration_score - original_score:+.4f})")
            else:
                print(f"Iteration {i+1}: Score {iteration_score:.4f} (improvement: {iteration_score - original_score:+.4f}) - not better than current best {best_score:.4f}")
        
        # Set final results to the best iteration
        results['final_sentences'] = best_sentences
        results['final_score'] = best_score
        results['final_suggestions'] = best_suggestions
        
        print(f"Optimization complete: Best score {best_score:.4f} vs original {original_score:.4f} (total improvement: {best_score - original_score:+.4f})")
        
        return results
    
    async def optimize_all_brand(self, brand_url: str, iterations: int = 3) -> Dict:
        """
        Optimize all web content for a brand and update MongoDB FullWebContentCache
        
        Args:
            brand_url: Brand URL to optimize
            iterations: Number of optimization iterations per domain/dimension
            
        Returns:
            Dictionary with optimization results and statistics
        """
        if self.policy_model is None:
            raise ValueError("Policy model must be loaded for optimization")
        
        print(f"🚀 Starting brand optimization for: {brand_url}")
        
        # Normalize brand URL
        normalized_brand_url = normalize_url(brand_url)
        
        # Connect to MongoDB
        db = await get_mongodb_connection()
        collection = db['full_web_content']
        
        # Find brand document
        brand_doc = collection.find_one({'normalizedBrandUrl': normalized_brand_url})
        if not brand_doc:
            # Try with original URL as fallback
            brand_doc = collection.find_one({'brandUrl': brand_url})
        
        if not brand_doc:
            raise ValueError(f"Brand not found in database: {brand_url}")
        
        brand_name = brand_doc['brandName']
        website_content = brand_doc['websiteContent']
        
        print(f"📊 Found brand: {brand_name}")
        print(f"📏 Dimensions: {len(website_content)}")
        
        # Track optimization results
        results = {
            'brand_name': brand_name,
            'brand_url': brand_url,
            'normalized_brand_url': normalized_brand_url,
            'total_domains': 0,
            'total_optimized': 0,
            'total_improved': 0,
            'dimensions': {}
        }
        
        # Process each dimension
        for dimension, dimension_content in website_content.items():
            print(f"\n🎯 Processing dimension: {dimension}")
            
            dimension_results = {
                'domains': 0,
                'optimized': 0,
                'improved': 0,
                'details': []
            }
            
            # Process each domain in this dimension
            for domain, domain_data in dimension_content.items():
                results['total_domains'] += 1
                dimension_results['domains'] += 1
                
                # Get original sentences
                original_sentences = domain_data.get('sentences', [])
                
                # Skip if no sentences
                if not original_sentences:
                    print(f"  ⏭️ Skipping {domain} (no sentences)")
                    
                    # Store detailed results for skipped domain
                    domain_detail = {
                        'domain': domain,
                        'status': 'skipped',
                        'original_sentences_count': 0,
                        'original_score': None,
                        'modified_sentences_count': 0,
                        'modified_score': None,
                        'improvement': None,
                        'final_suggestions': None,
                        'error': 'No sentences to optimize',
                        'mongodb_updated': False
                    }
                    dimension_results['details'].append(domain_detail)
                    continue
                
                print(f"  🔄 Optimizing {domain} ({len(original_sentences)} sentences)")
                
                try:
                    # Calculate original visibility score
                    original_score = await self.predict_visibility_tmp(
                        original_sentences, dimension, domain, brand_name
                    )
                    
                    # Optimize sentences
                    optimization_results = await self.optimize_sentences(
                        original_sentences, dimension, domain, iterations, brand_name
                    )
                    
                    modified_sentences = optimization_results['final_sentences']
                    modified_score = optimization_results['final_score']
                    final_suggestions = optimization_results['final_suggestions']
                    
                    # Update domain data with new scores, modified sentences, and suggestions
                    domain_data['visibility'] = original_score
                    domain_data['modifiedSentences'] = modified_sentences
                    domain_data['modifiedVisibility'] = modified_score
                    domain_data['modificationSuggestions'] = final_suggestions
                    
                    # Update MongoDB immediately for this domain
                    try:
                        # First, get the current document to modify it properly
                        current_doc = collection.find_one({'normalizedBrandUrl': normalized_brand_url})
                        if current_doc:
                            # Update the specific domain in the in-memory document
                            if 'websiteContent' not in current_doc:
                                current_doc['websiteContent'] = {}
                            if dimension not in current_doc['websiteContent']:
                                current_doc['websiteContent'][dimension] = {}
                            
                            # Set the domain data directly (this preserves dots in domain names)
                            current_doc['websiteContent'][dimension][domain] = domain_data
                            current_doc['sampledTime'] = datetime.datetime.utcnow()
                            
                            # Replace the entire document
                            domain_update_result = collection.replace_one(
                                {'normalizedBrandUrl': normalized_brand_url},
                                current_doc
                            )
                        else:
                            print(f"    ❌ Document not found for brand: {normalized_brand_url}")
                            mongodb_success = False
                            domain_update_result = None
                        
                        if domain_update_result:
                            mongodb_success = domain_update_result.modified_count > 0
                        else:
                            mongodb_success = False
                        print(f"    💾 MongoDB update: {'✅ success' if mongodb_success else '⚠️ no changes'}")
                        
                    except Exception as mongo_error:
                        print(f"    💾 MongoDB update: ❌ failed - {mongo_error}")
                        mongodb_success = False
                    
                    results['total_optimized'] += 1
                    dimension_results['optimized'] += 1
                    
                    improvement = modified_score - original_score
                    if improvement > 0:
                        results['total_improved'] += 1
                        dimension_results['improved'] += 1
                    
                    # Store detailed results for successful optimization
                    domain_detail = {
                        'domain': domain,
                        'status': 'success',
                        'original_sentences_count': len(original_sentences),
                        'original_score': original_score,
                        'modified_sentences_count': len(modified_sentences),
                        'modified_score': modified_score,
                        'improvement': improvement,
                        'final_suggestions': final_suggestions,
                        'error': None,
                        'mongodb_updated': mongodb_success
                    }
                    dimension_results['details'].append(domain_detail)
                    
                    print(f"    ✅ {domain}: {original_score:.4f} → {modified_score:.4f} ({improvement:+.4f})")
                    
                    # Print detailed information for this domain
                    print(f"    📝 Original Sentences ({len(original_sentences)}):")
                    for i, sentence in enumerate(original_sentences, 1):
                        print(f"        {i}. {sentence}")
                    
                    print(f"    📊 Original Score: {original_score:.4f}")
                    
                    print(f"    💡 Final Suggestions:")
                    print(f"        {final_suggestions}")
                    
                    print(f"    ✨ Modified Sentences ({len(modified_sentences)}):")
                    for i, sentence in enumerate(modified_sentences, 1):
                        print(f"        {i}. {sentence}")
                    
                    print(f"    📈 Modified Score: {modified_score:.4f}")
                    print(f"    🎯 Improvement: {improvement:+.4f}")
                    print("    " + "-" * 80)
                    
                except Exception as e:
                    error_msg = str(e)
                    print(f"    ❌ Error optimizing {domain}: {error_msg}")
                    
                    # Store detailed results for failed optimization
                    domain_detail = {
                        'domain': domain,
                        'status': 'failed',
                        'original_sentences_count': len(original_sentences) if original_sentences else 0,
                        'original_score': None,
                        'modified_sentences_count': 0,
                        'modified_score': None,
                        'improvement': None,
                        'final_suggestions': None,
                        'error': error_msg,
                        'mongodb_updated': False
                    }
                    dimension_results['details'].append(domain_detail)
                    continue
            
            results['dimensions'][dimension] = dimension_results
            print(f"  📊 Dimension {dimension}: {dimension_results['optimized']}/{dimension_results['domains']} optimized, {dimension_results['improved']} improved")
        
        # Calculate MongoDB update statistics from domain-level updates
        successful_updates = sum(len([d for d in dim_data['details'] if d.get('mongodb_updated', False)]) 
                                for dim_data in results['dimensions'].values())
        failed_updates = sum(len([d for d in dim_data['details'] 
                                 if d['status'] == 'success' and not d.get('mongodb_updated', False)]) 
                            for dim_data in results['dimensions'].values())
        
        mongodb_update_result = {
            'strategy': 'per_domain_updates',
            'successful_domain_updates': successful_updates,
            'failed_domain_updates': failed_updates,
            'total_attempted_updates': successful_updates + failed_updates
        }
        
        # Add MongoDB update result to the final results
        results['mongodb_update'] = mongodb_update_result
        
        print(f"\n💾 MongoDB Update Summary:")
        print(f"   ✅ Successful domain updates: {successful_updates}")
        print(f"   ❌ Failed domain updates: {failed_updates}")
        print(f"   📊 Total update attempts: {mongodb_update_result['total_attempted_updates']}")
        
        # Calculate detailed statistics
        total_skipped = sum(len([d for d in dim_data['details'] if d['status'] == 'skipped']) 
                           for dim_data in results['dimensions'].values())
        total_failed = sum(len([d for d in dim_data['details'] if d['status'] == 'failed']) 
                          for dim_data in results['dimensions'].values())
        total_success = sum(len([d for d in dim_data['details'] if d['status'] == 'success']) 
                           for dim_data in results['dimensions'].values())
        
        # Print final summary
        print(f"\n🎉 Brand optimization completed!")
        print(f"   📊 Total domains processed: {results['total_domains']}")
        print(f"   ✅ Total domains optimized: {results['total_optimized']} ({total_success} successful)")
        print(f"   ⏭️ Total domains skipped: {total_skipped}")
        print(f"   ❌ Total domains failed: {total_failed}")
        print(f"   📈 Total domains improved: {results['total_improved']}")
        print(f"   📉 Success rate: {(total_success/max(results['total_domains'], 1)*100):.1f}%")
        print(f"   📈 Improvement rate: {(results['total_improved']/max(results['total_optimized'], 1)*100):.1f}%")
        print(f"   💾 MongoDB update: {mongodb_update_result['status']}")
        
        # Print dimension breakdown with detailed status
        print(f"\n📏 Detailed Dimension Breakdown:")
        for dimension, dim_results in results['dimensions'].items():
            dim_success = len([d for d in dim_results['details'] if d['status'] == 'success'])
            dim_skipped = len([d for d in dim_results['details'] if d['status'] == 'skipped'])
            dim_failed = len([d for d in dim_results['details'] if d['status'] == 'failed'])
            
            print(f"   {dimension}:")
            print(f"     🎯 Total: {dim_results['domains']}")
            print(f"     ✅ Success: {dim_success} ({dim_results['improved']} improved)")
            print(f"     ⏭️ Skipped: {dim_skipped}")
            print(f"     ❌ Failed: {dim_failed}")
        
        return results

async def main():
    """Main inference function"""
    parser = argparse.ArgumentParser(description="Run inference with trained models")
    
    # Model paths
    parser.add_argument(
        '--reward_model',
        default='./reward_model_output/reward_model_epoch_10.pt',
        help='Path to trained reward model'
    )
    parser.add_argument(
        '--policy_model',
        default='./grpo_model_output/grpo_model_epoch_2.pt',
        help='Path to trained policy model'
    )
    
    # Task selection
    parser.add_argument(
        '--task',
        choices=['predict', 'generate', 'optimize', 'optimize_all'],
        default='optimize',
        help='Task to perform'
    )
    
    # Input data
    parser.add_argument(
        '--sentences',
        nargs='+',
        help='List of sentences to process (required for predict, generate, optimize)'
    )
    parser.add_argument(
        '--dimension',
        help='Content dimension (required for predict, generate, optimize)'
    )
    parser.add_argument(
        '--domain',
        help='Domain name (required for predict, generate, optimize)'
    )
    parser.add_argument(
        '--brand_name',
        default='Unknown Brand',
        help='Brand name for visibility scoring'
    )
    parser.add_argument(
        '--brand_url',
        help='Brand URL for optimize_all task'
    )
    
    # Generation parameters
    parser.add_argument(
        '--iterations',
        type=int,
        default=3,
        help='Number of optimization iterations'
    )
    
    args = parser.parse_args()
    
    # Validate arguments based on task
    if args.task in ['predict', 'generate', 'optimize']:
        if not args.sentences or not args.dimension or not args.domain:
            parser.error(f"Task '{args.task}' requires --sentences, --dimension, and --domain")
    elif args.task == 'optimize_all':
        if not args.brand_url:
            parser.error("Task 'optimize_all' requires --brand_url")
    
    # Initialize inference
    inference = ModelInference(
        reward_model_path=args.reward_model,
        policy_model_path=args.policy_model
    )
    
    print(f"\n🎯 Task: {args.task}")
    if args.task == 'optimize_all':
        print(f"🏢 Brand URL: {args.brand_url}")
    else:
        print(f"📝 Sentences: {args.sentences}")
        print(f"🏷️ Dimension: {args.dimension}")
        print(f"🌐 Domain: {args.domain}")
        print(f"🏢 Brand: {args.brand_name}")
    print("-" * 50)
    
    try:
        if args.task == 'predict':
            # Predict visibility using OpenRouter API
            score = await inference.predict_visibility_tmp(args.sentences, args.dimension, args.domain, args.brand_name)
            print(f"📊 Predicted Visibility Score: {score:.4f}")
        
        elif args.task == 'generate':
            # Generate improved sentences and suggestions
            generation_results = await inference.generate_improved_sentences(
                args.sentences, args.dimension, args.domain, args.brand_name
            )
            improved = generation_results['modified_sentences']
            suggestions = generation_results['suggestions']
            
            print(f"💡 Modification Suggestions: {suggestions}")
            print(f"✨ Improved Sentences: {improved}")
            
            # Also show scores using OpenRouter API
            original_score = await inference.predict_visibility_tmp(args.sentences, args.dimension, args.domain, args.brand_name)
            improved_score = await inference.predict_visibility_tmp(improved, args.dimension, args.domain, args.brand_name)
            print(f"📊 Original Score: {original_score:.4f}")
            print(f"📊 Improved Score: {improved_score:.4f}")
            print(f"📈 Improvement: {improved_score - original_score:.4f}")
        
        elif args.task == 'optimize':
            # Iterative optimization
            results = await inference.optimize_sentences(
                args.sentences, args.dimension, args.domain, args.iterations, args.brand_name
            )
            
            print(f"🚀 Optimization Results:")
            print(f"   Raw Original Score: {results['raw_original_score']:.4f}")
            print(f"   Adjusted Original Score: {results['original_score']:.4f} (penalty: {results['random_penalty']:.4f})")
            print(f"   Final Score: {results['final_score']:.4f}")
            print(f"   Total Improvement: {results['final_score'] - results['original_score']:.4f}")
            print(f"   Improvement vs Raw: {results['final_score'] - results['raw_original_score']:.4f}")
            print(f"\n📝 Final Sentences: {results['final_sentences']}")
            print(f"\n💡 Final Suggestions: {results['final_suggestions']}")
            
            # Show iteration details
            print(f"\n🔄 Iteration Details:")
            for iteration in results['iterations']:
                print(f"   Iteration {iteration['iteration']}: {iteration['generated_score']:.4f} (improvement: {iteration['improvement']:+.4f})")
        
        elif args.task == 'optimize_all':
            # Optimize entire brand and update MongoDB
            results = await inference.optimize_all_brand(args.brand_url, args.iterations)
            
            # The function already prints detailed results, just add a final status
            mongodb_info = results.get('mongodb_update', {})
            successful_updates = mongodb_info.get('successful_domain_updates', 0)
            failed_updates = mongodb_info.get('failed_domain_updates', 0)
            total_attempts = mongodb_info.get('total_attempted_updates', 0)
            
            if total_attempts == 0:
                print(f"\n⚠️ No MongoDB updates were attempted")
            elif failed_updates == 0:
                print(f"\n✅ All MongoDB domain updates successful! ({successful_updates}/{total_attempts})")
            elif successful_updates == 0:
                print(f"\n❌ All MongoDB domain updates failed! ({failed_updates}/{total_attempts})")
            else:
                print(f"\n⚠️ Mixed MongoDB update results: {successful_updates} success, {failed_updates} failed")
            
            # Show final JSON output for programmatic access
            print(f"\n📋 Results JSON available in returned object for programmatic access")
    
    except Exception as e:
        print(f"❌ Error: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    import asyncio
    exit(asyncio.run(main()))
