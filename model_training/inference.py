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
from policy_model import PolicyModel

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
        checkpoint = torch.load(model_path, map_location=self.device)
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
        checkpoint = torch.load(model_path, map_location=self.device)
        config = checkpoint['config']
        
        # Load tokenizer
        tokenizer = AutoTokenizer.from_pretrained(config.model_name)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        
        # Load model
        model = PolicyModel(config.model_name)
        model.load_state_dict(checkpoint['model_state_dict'])
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
    
    def generate_improved_sentences(
        self, 
        sentences: list, 
        dimension: str, 
        domain: str,
        max_new_tokens: int = 256
    ) -> list:
        """Generate improved sentences using policy model"""
        if self.policy_model is None:
            raise ValueError("Policy model not loaded")
        
        # Prepare input prompt
        sentences_json = json.dumps(sentences)
        prompt = f"Modify the following sentences to improve brand visibility:\nSentences: {sentences_json}\nDimension: {dimension}\nDomain: {domain}\nModified sentences:"
        
        # Tokenize
        encoding = self.policy_tokenizer(
            prompt,
            truncation=True,
            max_length=512,
            return_tensors='pt'
        )
        
        # Generate
        with torch.no_grad():
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
            
            # Decode
            generated_text = self.policy_tokenizer.decode(outputs[0], skip_special_tokens=True)
            
            # Extract modified sentences
            try:
                if "Modified sentences:" in generated_text:
                    json_part = generated_text.split("Modified sentences:")[-1].strip()
                    modified_sentences = json.loads(json_part)
                    if isinstance(modified_sentences, list):
                        return modified_sentences
                    else:
                        return [str(modified_sentences)]
                else:
                    return sentences  # Fallback to original
            except:
                return sentences  # Fallback on parsing error
    
    def optimize_sentences(
        self, 
        sentences: list, 
        dimension: str, 
        domain: str,
        iterations: int = 3
    ) -> dict:
        """Iteratively optimize sentences using both models"""
        if self.reward_model is None or self.policy_model is None:
            raise ValueError("Both models must be loaded for optimization")
        
        results = {
            'original_sentences': sentences,
            'iterations': [],
            'final_sentences': sentences,
            'final_score': 0.0
        }
        
        current_sentences = sentences
        
        for i in range(iterations):
            # Predict current visibility
            current_score = self.predict_visibility(current_sentences, dimension, domain)
            
            # Generate improved sentences
            improved_sentences = self.generate_improved_sentences(
                current_sentences, dimension, domain
            )
            
            # Predict improved visibility
            improved_score = self.predict_visibility(improved_sentences, dimension, domain)
            
            # Store iteration results
            results['iterations'].append({
                'iteration': i + 1,
                'sentences': current_sentences,
                'score': current_score,
                'improved_sentences': improved_sentences,
                'improved_score': improved_score,
                'improvement': improved_score - current_score
            })
            
            # Use improved sentences for next iteration if better
            if improved_score > current_score:
                current_sentences = improved_sentences
                print(f"Iteration {i+1}: Score improved from {current_score:.4f} to {improved_score:.4f}")
            else:
                print(f"Iteration {i+1}: No improvement (score: {improved_score:.4f})")
        
        results['final_sentences'] = current_sentences
        results['final_score'] = self.predict_visibility(current_sentences, dimension, domain)
        
        return results

def main():
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
        default='./policy_model_output/policy_model_epoch_5.pt',
        help='Path to trained policy model'
    )
    
    # Task selection
    parser.add_argument(
        '--task',
        choices=['predict', 'generate', 'optimize'],
        default='optimize',
        help='Task to perform'
    )
    
    # Input data
    parser.add_argument(
        '--sentences',
        nargs='+',
        required=True,
        help='List of sentences to process'
    )
    parser.add_argument(
        '--dimension',
        required=True,
        help='Content dimension'
    )
    parser.add_argument(
        '--domain',
        required=True,
        help='Domain name'
    )
    
    # Generation parameters
    parser.add_argument(
        '--iterations',
        type=int,
        default=3,
        help='Number of optimization iterations'
    )
    
    args = parser.parse_args()
    
    # Initialize inference
    inference = ModelInference(
        reward_model_path=args.reward_model,
        policy_model_path=args.policy_model
    )
    
    print(f"\n🎯 Task: {args.task}")
    print(f"📝 Sentences: {args.sentences}")
    print(f"🏷️ Dimension: {args.dimension}")
    print(f"🌐 Domain: {args.domain}")
    print("-" * 50)
    
    try:
        if args.task == 'predict':
            # Predict visibility
            score = inference.predict_visibility(args.sentences, args.dimension, args.domain)
            print(f"📊 Predicted Visibility Score: {score:.4f}")
        
        elif args.task == 'generate':
            # Generate improved sentences
            improved = inference.generate_improved_sentences(
                args.sentences, args.dimension, args.domain
            )
            print(f"✨ Improved Sentences: {improved}")
            
            # Also show scores if reward model available
            if inference.reward_model:
                original_score = inference.predict_visibility(args.sentences, args.dimension, args.domain)
                improved_score = inference.predict_visibility(improved, args.dimension, args.domain)
                print(f"📊 Original Score: {original_score:.4f}")
                print(f"📊 Improved Score: {improved_score:.4f}")
                print(f"📈 Improvement: {improved_score - original_score:.4f}")
        
        elif args.task == 'optimize':
            # Iterative optimization
            results = inference.optimize_sentences(
                args.sentences, args.dimension, args.domain, args.iterations
            )
            
            print(f"🚀 Optimization Results:")
            print(f"   Original Score: {results['iterations'][0]['score']:.4f}")
            print(f"   Final Score: {results['final_score']:.4f}")
            print(f"   Total Improvement: {results['final_score'] - results['iterations'][0]['score']:.4f}")
            print(f"\n📝 Final Sentences: {results['final_sentences']}")
            
            # Show iteration details
            print(f"\n🔄 Iteration Details:")
            for iteration in results['iterations']:
                print(f"   Iteration {iteration['iteration']}: {iteration['score']:.4f} → {iteration['improved_score']:.4f} ({iteration['improvement']:+.4f})")
    
    except Exception as e:
        print(f"❌ Error: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())
