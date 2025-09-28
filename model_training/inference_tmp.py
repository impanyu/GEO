#!/usr/bin/env python3
"""
Temporary inference script for targeted optimization
Optimizes only wikipedia.org, reddit.com, quora.com under Functionality dimension
"""

import argparse
import asyncio
import datetime
import json
import os
import sys
import torch
from typing import Dict, List

# Add the current directory to Python path to import modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from inference import ModelInference, normalize_url, get_mongodb_connection
from policy_model import GRPOConfig, GRPOModel, GRPOTrainer
from reward_model import RewardModel
from dotenv import load_dotenv

# Make classes available at module level for pickle loading
import policy_model
import reward_model

# Load environment variables
load_dotenv('../.env.local')

# Target domains to optimize
TARGET_DOMAINS = [
    'wikipedia.org',
    'reddit.com', 
    'quora.com'
]

# Target dimension
TARGET_DIMENSION = 'Functionality'

async def optimize_targeted_domains(brand_url: str, iterations: int = 3) -> Dict:
    """
    Optimize only the target domains under Functionality dimension for a specific brand
    
    Args:
        brand_url: Brand URL to optimize
        iterations: Number of optimization iterations per domain
        
    Returns:
        Dictionary with optimization results and statistics
    """
    print(f"🎯 Starting targeted optimization for: {brand_url}")
    print(f"📋 Target domains: {', '.join(TARGET_DOMAINS)}")
    print(f"📏 Target dimension: {TARGET_DIMENSION}")
    
    # Initialize inference with models (use absolute paths to avoid import issues)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    reward_model_path = os.path.join(current_dir, 'reward_model_output', 'reward_model_epoch_10.pt')
    policy_model_path = os.path.join(current_dir, 'grpo_model_output', 'grpo_model_epoch_2.pt')
    
    # Check if model files exist
    if not os.path.exists(policy_model_path):
        raise ValueError(f"Policy model not found at: {policy_model_path}")
    
    inference = ModelInference(
        reward_model_path=reward_model_path if os.path.exists(reward_model_path) else None,
        policy_model_path=policy_model_path
    )
    
    if inference.policy_model is None:
        raise ValueError("Policy model must be loaded for optimization")
    
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
    
    # Check if target dimension exists
    if TARGET_DIMENSION not in website_content:
        raise ValueError(f"Dimension '{TARGET_DIMENSION}' not found for brand {brand_name}")
    
    dimension_content = website_content[TARGET_DIMENSION]
    
    # Track optimization results
    results = {
        'brand_name': brand_name,
        'brand_url': brand_url,
        'normalized_brand_url': normalized_brand_url,
        'target_dimension': TARGET_DIMENSION,
        'target_domains': TARGET_DOMAINS,
        'total_domains': 0,
        'total_optimized': 0,
        'total_improved': 0,
        'total_skipped': 0,
        'total_failed': 0,
        'details': []
    }
    
    print(f"\n🎯 Processing dimension: {TARGET_DIMENSION}")
    
    # Process each target domain
    for target_domain in TARGET_DOMAINS:
        results['total_domains'] += 1
        
        if target_domain not in dimension_content:
            print(f"  ❌ Domain {target_domain} not found in {TARGET_DIMENSION}")
            results['total_skipped'] += 1
            
            # Store detailed results for missing domain
            domain_detail = {
                'domain': target_domain,
                'status': 'skipped',
                'original_sentences_count': 0,
                'original_score': None,
                'modified_sentences_count': 0,
                'modified_score': None,
                'improvement': None,
                'final_suggestions': None,
                'error': 'Domain not found in dimension',
                'mongodb_updated': False
            }
            results['details'].append(domain_detail)
            continue
        
        domain_data = dimension_content[target_domain]
        
        # Get original sentences
        original_sentences = domain_data.get('sentences', [])
        
        # Skip if no sentences
        if not original_sentences:
            print(f"  ⏭️ Skipping {target_domain} (no sentences)")
            results['total_skipped'] += 1
            
            # Store detailed results for skipped domain
            domain_detail = {
                'domain': target_domain,
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
            results['details'].append(domain_detail)
            continue
        
        print(f"  🔄 Optimizing {target_domain} ({len(original_sentences)} sentences)")
        
        try:
            # Calculate original visibility score
            original_score = await inference.predict_visibility_tmp(
                original_sentences, TARGET_DIMENSION, target_domain, brand_name
            )
            
            # Optimize sentences
            optimization_results = await inference.optimize_sentences(
                original_sentences, TARGET_DIMENSION, target_domain, iterations, brand_name
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
                    if TARGET_DIMENSION not in current_doc['websiteContent']:
                        current_doc['websiteContent'][TARGET_DIMENSION] = {}
                    
                    # Set the domain data directly (this preserves dots in domain names)
                    current_doc['websiteContent'][TARGET_DIMENSION][target_domain] = domain_data
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
            
            improvement = modified_score - original_score
            if improvement > 0:
                results['total_improved'] += 1
            
            # Store detailed results for successful optimization
            domain_detail = {
                'domain': target_domain,
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
            results['details'].append(domain_detail)
            
            print(f"    ✅ {target_domain}: {original_score:.4f} → {modified_score:.4f} ({improvement:+.4f})")
            
            # Print detailed information for this domain
            print(f"    📝 Original Content ({len(original_sentences)}):")
            for i, sentence in enumerate(original_sentences, 1):
                print(f"        {i}. {sentence}")
            
            print(f"    📊 Original Score: {original_score:.4f}")
            
            print(f"    💡 Final Suggestions:")
            print(f"        {final_suggestions}")
            
            print(f"    ✨ Modified Content ({len(modified_sentences)}):")
            for i, sentence in enumerate(modified_sentences, 1):
                print(f"        {i}. {sentence}")
            
            print(f"    📈 Modified Score: {modified_score:.4f}")
            print(f"    🎯 Improvement: {improvement:+.4f}")
            print("    " + "-" * 80)
            
        except Exception as e:
            error_msg = str(e)
            print(f"    ❌ Error optimizing {target_domain}: {error_msg}")
            results['total_failed'] += 1
            
            # Store detailed results for failed optimization
            domain_detail = {
                'domain': target_domain,
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
            results['details'].append(domain_detail)
            continue
    
    # Calculate MongoDB update statistics
    successful_updates = len([d for d in results['details'] if d.get('mongodb_updated', False)])
    failed_updates = len([d for d in results['details'] 
                         if d['status'] == 'success' and not d.get('mongodb_updated', False)])
    
    # Print final summary
    print(f"\n🎉 Targeted optimization completed!")
    print(f"   📊 Target domains processed: {results['total_domains']}")
    print(f"   ✅ Domains optimized: {results['total_optimized']}")
    print(f"   ⏭️ Domains skipped: {results['total_skipped']}")
    print(f"   ❌ Domains failed: {results['total_failed']}")
    print(f"   📈 Domains improved: {results['total_improved']}")
    print(f"   💾 MongoDB updates: {successful_updates} success, {failed_updates} failed")
    
    if results['total_optimized'] > 0:
        success_rate = (results['total_optimized'] / results['total_domains']) * 100
        improvement_rate = (results['total_improved'] / results['total_optimized']) * 100
        print(f"   📉 Success rate: {success_rate:.1f}%")
        print(f"   📈 Improvement rate: {improvement_rate:.1f}%")
    
    return results

async def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Targeted optimization for specific domains")
    
    # Required argument
    parser.add_argument(
        'brand_url',
        help='Brand URL to optimize (e.g., https://www.sendbird.com)'
    )
    
    # Optional arguments
    parser.add_argument(
        '--iterations',
        type=int,
        default=3,
        help='Number of optimization iterations per domain (default: 3)'
    )
    
    args = parser.parse_args()
    
    print(f"🎯 Targeted Domain Optimization")
    print(f"🏢 Brand URL: {args.brand_url}")
    print(f"📋 Target domains: {', '.join(TARGET_DOMAINS)}")
    print(f"📏 Target dimension: {TARGET_DIMENSION}")
    print(f"🔄 Iterations: {args.iterations}")
    print("-" * 80)
    
    try:
        results = await optimize_targeted_domains(args.brand_url, args.iterations)
        
        # Show final status
        if results['total_failed'] == 0 and results['total_optimized'] > 0:
            print(f"\n✅ All targeted domains optimized successfully!")
        elif results['total_optimized'] > 0:
            print(f"\n⚠️ Partial success: {results['total_optimized']} optimized, {results['total_failed']} failed")
        else:
            print(f"\n❌ No domains were successfully optimized")
        
        return 0
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return 1

if __name__ == "__main__":
    exit(asyncio.run(main()))
