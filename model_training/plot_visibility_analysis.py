#!/usr/bin/env python3
"""
Plot visibility analysis from MongoDB training data.

This script creates three plots:
1. Average visibility as a function of prompts (sorted from highest to lowest)
2. Average visibility as a function of sentences (sorted from highest to lowest)
3. Average visibility as a function of domains (sorted from highest to lowest)
"""

import os
import sys
from typing import Dict, List, Tuple
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment variables from parent directory's .env.local
parent_dir = Path(__file__).parent.parent
env_file = parent_dir / ".env.local"

if env_file.exists():
    load_dotenv(env_file)
    print(f"✅ Loaded environment from: {env_file}")
else:
    # Try current directory as fallback
    load_dotenv()
    print("⚠️  Using environment variables from current directory or system")

# Set style for better-looking plots
sns.set_style("whitegrid")
plt.rcParams['figure.figsize'] = (14, 6)
plt.rcParams['font.size'] = 10


def connect_to_mongodb() -> MongoClient:
    """Connect to MongoDB using environment variable."""
    mongodb_uri = os.getenv('MONGODB_URI')
    if not mongodb_uri:
        raise ValueError("MONGODB_URI environment variable is not set")
    
    print(f"🔗 Connecting to MongoDB...")
    client = MongoClient(mongodb_uri)
    return client


def fetch_training_data(client: MongoClient) -> List[Dict]:
    """Fetch all training data from MongoDB."""
    db = client['springbrand-ai']
    collection = db['prompt_domain_sentences_visibility_training_data']
    
    print(f"📊 Fetching training data...")
    data = list(collection.find({}))
    print(f"✅ Loaded {len(data)} training examples")
    
    return data


def calculate_average_visibility_by_category(
    data: List[Dict], 
    category: str
) -> Tuple[List[str], List[float], List[int]]:
    """
    Calculate average visibility for a given category.
    
    Args:
        data: List of training data documents
        category: Field to group by ('prompt', 'sentence', or 'domain')
    
    Returns:
        Tuple of (categories, average_visibilities, counts)
    """
    # Group visibility scores by category
    visibility_by_category = defaultdict(list)
    
    for doc in data:
        if category in doc and 'visibility' in doc:
            visibility_by_category[doc[category]].append(doc['visibility'])
    
    # Calculate averages
    categories = []
    avg_visibilities = []
    counts = []
    
    for cat, visibilities in visibility_by_category.items():
        categories.append(cat)
        avg_visibilities.append(np.mean(visibilities))
        counts.append(len(visibilities))
    
    # Sort by average visibility (descending)
    sorted_indices = np.argsort(avg_visibilities)[::-1]
    categories = [categories[i] for i in sorted_indices]
    avg_visibilities = [avg_visibilities[i] for i in sorted_indices]
    counts = [counts[i] for i in sorted_indices]
    
    return categories, avg_visibilities, counts


def truncate_label(label: str, max_length: int = 50) -> str:
    """Truncate long labels for better display."""
    if len(label) > max_length:
        return label[:max_length-3] + "..."
    return label


def plot_visibility_by_category(
    categories: List[str],
    avg_visibilities: List[float],
    counts: List[int],
    title: str,
    xlabel: str,
    output_file: str,
    top_n: int = 30
):
    """
    Plot average visibility for a category.
    
    Args:
        categories: List of category names
        avg_visibilities: List of average visibility scores (as decimals, e.g., 0.05 for 5%)
        counts: Number of samples per category
        title: Plot title
        xlabel: X-axis label
        output_file: Output filename
        top_n: Number of top items to display
    """
    # Store full dataset statistics before limiting
    total_categories_full = len(categories)
    total_samples_full = sum(counts)
    median_visibility_full = np.median(avg_visibilities)
    mean_visibility_full = np.mean(avg_visibilities)
    
    # Limit to top N for display
    display_categories = categories
    display_visibilities = avg_visibilities
    display_counts = counts
    
    if len(categories) > top_n:
        display_categories = categories[:top_n]
        display_visibilities = avg_visibilities[:top_n]
        display_counts = counts[:top_n]
    
    # Convert to percentage
    display_visibilities_pct = [v * 100 for v in display_visibilities]
    
    # Truncate labels if needed
    display_labels = [truncate_label(cat, max_length=60) for cat in display_categories]
    
    # Create figure
    fig, ax = plt.subplots(figsize=(16, 10))
    
    # Create color gradient based on visibility (higher = more green)
    colors = plt.cm.RdYlGn(np.linspace(0.3, 0.9, len(display_visibilities_pct)))
    
    # Create horizontal bar chart
    y_pos = np.arange(len(display_labels))
    bars = ax.barh(y_pos, display_visibilities_pct, color=colors, alpha=0.8)
    
    # Add value labels on bars
    for i, (bar, count, visibility) in enumerate(zip(bars, display_counts, display_visibilities_pct)):
        width = bar.get_width()
        ax.text(width + 0.2, bar.get_y() + bar.get_height()/2, 
                f'{visibility:.2f}% (n={count})',
                ha='left', va='center', fontsize=9, fontweight='bold')
    
    # Customize plot
    ax.set_yticks(y_pos)
    ax.set_yticklabels(display_labels, fontsize=9)
    ax.invert_yaxis()  # Highest at top
    ax.set_xlabel('Average Visibility (%)', fontsize=12, fontweight='bold')
    ax.set_ylabel(xlabel, fontsize=12, fontweight='bold')
    ax.set_title(title, fontsize=14, fontweight='bold', pad=20)
    
    # Add grid for better readability
    ax.grid(axis='x', alpha=0.3, linestyle='--')
    
    # Add statistics text box using FULL dataset statistics
    stats_text = f'Total {xlabel}: {total_categories_full}'
    if len(display_categories) < total_categories_full:
        stats_text += f' (showing top {len(display_categories)})'
    stats_text += f'\nTotal Samples: {total_samples_full}\n'
    stats_text += f'Mean Visibility: {mean_visibility_full*100:.2f}%\n'
    stats_text += f'Median Visibility: {median_visibility_full*100:.2f}%'
    
    ax.text(0.98, 0.02, stats_text, transform=ax.transAxes,
            fontsize=10, verticalalignment='bottom', horizontalalignment='right',
            bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
    
    plt.tight_layout()
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"✅ Saved plot: {output_file}")
    
    return fig


def plot_visibility_distribution(
    categories: List[str],
    avg_visibilities: List[float],
    title: str,
    output_file: str
):
    """
    Plot distribution of visibility scores.
    
    Args:
        categories: List of category names
        avg_visibilities: List of average visibility scores
        title: Plot title
        output_file: Output filename
    """
    # Convert to percentage
    avg_visibilities_pct = [v * 100 for v in avg_visibilities]
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6))
    
    # Histogram
    ax1.hist(avg_visibilities_pct, bins=50, color='steelblue', alpha=0.7, edgecolor='black')
    ax1.set_xlabel('Average Visibility (%)', fontsize=12, fontweight='bold')
    ax1.set_ylabel('Frequency', fontsize=12, fontweight='bold')
    ax1.set_title(f'{title} - Distribution', fontsize=14, fontweight='bold')
    ax1.grid(axis='y', alpha=0.3)
    
    # Add statistics
    mean_vis = np.mean(avg_visibilities_pct)
    median_vis = np.median(avg_visibilities_pct)
    std_vis = np.std(avg_visibilities_pct)
    
    ax1.axvline(mean_vis, color='red', linestyle='--', linewidth=2, label=f'Mean: {mean_vis:.2f}%')
    ax1.axvline(median_vis, color='green', linestyle='--', linewidth=2, label=f'Median: {median_vis:.2f}%')
    ax1.legend()
    
    # Cumulative distribution
    sorted_vis = np.sort(avg_visibilities_pct)
    cumulative = np.arange(1, len(sorted_vis) + 1) / len(sorted_vis) * 100
    
    ax2.plot(sorted_vis, cumulative, color='steelblue', linewidth=2)
    ax2.set_xlabel('Average Visibility (%)', fontsize=12, fontweight='bold')
    ax2.set_ylabel('Cumulative Percentage (%)', fontsize=12, fontweight='bold')
    ax2.set_title(f'{title} - Cumulative Distribution', fontsize=14, fontweight='bold')
    ax2.grid(alpha=0.3)
    
    # Add percentile markers
    percentiles = [25, 50, 75, 90, 95]
    for p in percentiles:
        val = np.percentile(avg_visibilities_pct, p)
        ax2.axhline(p, color='red', linestyle=':', alpha=0.3)
        ax2.axvline(val, color='red', linestyle=':', alpha=0.3)
        ax2.text(val, p, f'  P{p}: {val:.2f}%', fontsize=8, 
                verticalalignment='bottom')
    
    plt.tight_layout()
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"✅ Saved distribution plot: {output_file}")
    
    return fig


def generate_summary_report(
    prompt_data: Tuple[List[str], List[float], List[int]],
    sentence_data: Tuple[List[str], List[float], List[int]],
    domain_data: Tuple[List[str], List[float], List[int]],
    output_file: str = "visibility_summary_report.txt"
):
    """Generate a text summary report of the visibility analysis."""
    
    def calculate_stats(visibilities: List[float], name: str) -> str:
        vis_pct = [v * 100 for v in visibilities]
        return f"""
{name} Statistics:
{'=' * 50}
Count: {len(visibilities)}
Mean Visibility: {np.mean(vis_pct):.2f}%
Median Visibility: {np.median(vis_pct):.2f}%
Std Dev: {np.std(vis_pct):.2f}%
Min Visibility: {np.min(vis_pct):.2f}%
Max Visibility: {np.max(vis_pct):.2f}%
25th Percentile: {np.percentile(vis_pct, 25):.2f}%
75th Percentile: {np.percentile(vis_pct, 75):.2f}%
90th Percentile: {np.percentile(vis_pct, 90):.2f}%
95th Percentile: {np.percentile(vis_pct, 95):.2f}%
"""
    
    with open(output_file, 'w') as f:
        f.write("="*70 + "\n")
        f.write("VISIBILITY ANALYSIS SUMMARY REPORT\n")
        f.write("="*70 + "\n\n")
        
        # Overall statistics
        f.write(calculate_stats(prompt_data[1], "PROMPTS"))
        f.write("\n" + calculate_stats(sentence_data[1], "SENTENCES"))
        f.write("\n" + calculate_stats(domain_data[1], "DOMAINS"))
        
        # Top performers
        f.write("\n\n" + "="*70 + "\n")
        f.write("TOP 10 BY VISIBILITY\n")
        f.write("="*70 + "\n\n")
        
        f.write("Top 10 Prompts:\n" + "-"*70 + "\n")
        for i, (prompt, vis, count) in enumerate(zip(prompt_data[0][:10], prompt_data[1][:10], prompt_data[2][:10]), 1):
            f.write(f"{i}. [{vis*100:.2f}%, n={count}] {prompt[:100]}\n")
        
        f.write("\n\nTop 10 Sentences:\n" + "-"*70 + "\n")
        for i, (sent, vis, count) in enumerate(zip(sentence_data[0][:10], sentence_data[1][:10], sentence_data[2][:10]), 1):
            f.write(f"{i}. [{vis*100:.2f}%, n={count}] {sent[:100]}\n")
        
        f.write("\n\nTop 10 Domains:\n" + "-"*70 + "\n")
        for i, (domain, vis, count) in enumerate(zip(domain_data[0][:10], domain_data[1][:10], domain_data[2][:10]), 1):
            f.write(f"{i}. [{vis*100:.2f}%, n={count}] {domain}\n")
    
    print(f"✅ Saved summary report: {output_file}")


def main():
    """Main function to generate all plots."""
    print("="*70)
    print("VISIBILITY ANALYSIS - PLOTTING SCRIPT")
    print("="*70)
    
    try:
        # Connect to MongoDB
        client = connect_to_mongodb()
        
        # Fetch data
        data = fetch_training_data(client)
        
        if len(data) == 0:
            print("❌ No training data found in database!")
            sys.exit(1)
        
        print(f"\n📊 Analyzing {len(data)} training examples...")
        
        # Calculate average visibility by category
        print("\n🔍 Calculating visibility by prompt...")
        prompt_categories, prompt_visibilities, prompt_counts = calculate_average_visibility_by_category(data, 'prompt')
        print(f"   Found {len(prompt_categories)} unique prompts")
        
        print("\n🔍 Calculating visibility by sentence...")
        sentence_categories, sentence_visibilities, sentence_counts = calculate_average_visibility_by_category(data, 'sentence')
        print(f"   Found {len(sentence_categories)} unique sentences")
        
        print("\n🔍 Calculating visibility by domain...")
        domain_categories, domain_visibilities, domain_counts = calculate_average_visibility_by_category(data, 'domain')
        print(f"   Found {len(domain_categories)} unique domains")
        
        # Create output directory if it doesn't exist
        output_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Generate plots
        print("\n📈 Generating plots...")
        
        # Plot 1: Prompts
        plot_visibility_by_category(
            prompt_categories,
            prompt_visibilities,
            prompt_counts,
            "Average Visibility by Prompt (Top 30)",
            "Prompts",
            os.path.join(output_dir, "visibility_by_prompts.png"),
            top_n=30
        )
        
        # Plot 2: Sentences
        plot_visibility_by_category(
            sentence_categories,
            sentence_visibilities,
            sentence_counts,
            "Average Visibility by Sentence (Top 30)",
            "Sentences",
            os.path.join(output_dir, "visibility_by_sentences.png"),
            top_n=1000
        )
        
        # Plot 3: Domains
        plot_visibility_by_category(
            domain_categories,
            domain_visibilities,
            domain_counts,
            "Average Visibility by Domain",
            "Domains",
            os.path.join(output_dir, "visibility_by_domains.png"),
            top_n=100  # Show more domains since they're shorter
        )
        
        # Plot distributions
        print("\n📊 Generating distribution plots...")
        
        plot_visibility_distribution(
            prompt_categories,
            prompt_visibilities,
            "Prompt Visibility",
            os.path.join(output_dir, "visibility_distribution_prompts.png")
        )
        
        plot_visibility_distribution(
            sentence_categories,
            sentence_visibilities,
            "Sentence Visibility",
            os.path.join(output_dir, "visibility_distribution_sentences.png")
        )
        
        plot_visibility_distribution(
            domain_categories,
            domain_visibilities,
            "Domain Visibility",
            os.path.join(output_dir, "visibility_distribution_domains.png")
        )
        
        # Generate summary report
        print("\n📝 Generating summary report...")
        generate_summary_report(
            (prompt_categories, prompt_visibilities, prompt_counts),
            (sentence_categories, sentence_visibilities, sentence_counts),
            (domain_categories, domain_visibilities, domain_counts),
            os.path.join(output_dir, "visibility_summary_report.txt")
        )
        
        # Close MongoDB connection
        client.close()
        
        print("\n" + "="*70)
        print("✅ ALL PLOTS GENERATED SUCCESSFULLY!")
        print("="*70)
        print(f"\nOutput files saved in: {output_dir}")
        print("\nGenerated files:")
        print("  1. visibility_by_prompts.png")
        print("  2. visibility_by_sentences.png")
        print("  3. visibility_by_domains.png")
        print("  4. visibility_distribution_prompts.png")
        print("  5. visibility_distribution_sentences.png")
        print("  6. visibility_distribution_domains.png")
        print("  7. visibility_summary_report.txt")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

