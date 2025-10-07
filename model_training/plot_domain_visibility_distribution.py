#!/usr/bin/env python3

import os
import sys
from collections import defaultdict
import matplotlib.pyplot as plt
import numpy as np

# Load environment variables
from dotenv import load_dotenv
load_dotenv('.env.local')

import pymongo
from pymongo import MongoClient

def plot_domain_visibility_distribution():
    """Plot the distribution of domains' visibility from training data"""
    
    try:
        # Connect to MongoDB
        client = MongoClient(os.getenv('MONGODB_URI'))
        db = client['springbrand-ai']
        collection = db['prompt_domain_sentences_visibility_training_data']
        
        print("📊 Loading training data documents...")
        
        # Get all documents
        documents = list(collection.find({}))
        print(f"Found {len(documents)} training data documents")
        
        if len(documents) == 0:
            print("❌ No training data found")
            return
        
        # Aggregate visibility by domain
        domain_visibility = defaultdict(float)
        domain_count = defaultdict(int)
        
        for doc in documents:
            domain = doc.get('domain', 'unknown')
            visibility = doc.get('visibility', 0)
            
            # Convert visibility to binary: > 0 becomes 1, == 0 stays 0
            binary_visibility = 1 if visibility > 0 else 0
            
            domain_visibility[domain] += binary_visibility
            domain_count[domain] += 1
        
        print(f"📈 Found {len(domain_visibility)} unique domains")
        
        # Sort domains by total visibility (descending)
        sorted_domains = sorted(domain_visibility.items(), key=lambda x: x[1], reverse=True)
        
        # Calculate total visibility across all domains for normalization
        total_visibility = sum(domain_visibility.values())
        
        # Extract data for plotting with normalization
        domains = [item[0] for item in sorted_domains]
        raw_visibilities = [item[1] for item in sorted_domains]
        normalized_visibilities = [vis / total_visibility if total_visibility > 0 else 0 for vis in raw_visibilities]
        counts = [domain_count[domain] for domain in domains]
        
        # Print top domains
        print(f"\n🔝 Top 10 domains by total visibility:")
        for i, (domain, total_vis) in enumerate(sorted_domains[:10], 1):
            avg_vis = total_vis / domain_count[domain] if domain_count[domain] > 0 else 0
            normalized_vis = total_vis / total_visibility if total_visibility > 0 else 0
            print(f"  {i:2d}. {domain:30} | Total: {total_vis:6.0f} | Count: {domain_count[domain]:3d} | Avg: {avg_vis:.3f} | Normalized: {normalized_vis:.3f}")
        
        # Create the plot with larger figure size to accommodate vertical legend
        plt.figure(figsize=(24, 16))  # Increased width and height for better legend visibility
        
        # Create bars
        bars = plt.bar(range(len(domains)), normalized_visibilities, alpha=0.7, color='steelblue', edgecolor='black', linewidth=0.5)
        
        # Customize the plot
        plt.title('Domain Visibility Distribution', fontsize=16, fontweight='bold')
        plt.xlabel('Domains (ordered by total visibility)', fontsize=12)
        plt.ylabel('Normalized Visibility Score (proportion of total)', fontsize=12)
        
        # Remove x-axis labels to avoid clutter
        plt.xticks([])
        
        # Add grid for better readability
        plt.grid(axis='y', alpha=0.3, linestyle='--')
        
        # Create legend for all domains with visibility > 0
        domains_with_visibility = [(domain, total_vis) for domain, total_vis in sorted_domains if total_vis > 0]
        legend_labels = []
        legend_colors = []
        
        print(f"\n📊 Found {len(domains_with_visibility)} domains with visibility > 0")
        
        # Create color map for all domains with visibility > 0
        # Use multiple colormaps to get enough distinct colors
        n_domains = len(domains_with_visibility)
        if n_domains <= 20:
            colors = plt.cm.tab20(np.linspace(0, 1, n_domains))
        elif n_domains <= 40:
            colors1 = plt.cm.tab20(np.linspace(0, 1, 20))
            colors2 = plt.cm.Set3(np.linspace(0, 1, 12))
            colors3 = plt.cm.Pastel1(np.linspace(0, 1, n_domains - 32))
            colors = np.concatenate([colors1, colors2, colors3])
        else:
            # For more than 40 domains, cycle through multiple colormaps
            colors1 = plt.cm.tab20(np.linspace(0, 1, 20))
            colors2 = plt.cm.Set3(np.linspace(0, 1, 12))
            colors3 = plt.cm.Pastel1(np.linspace(0, 1, 9))
            colors4 = plt.cm.Dark2(np.linspace(0, 1, 8))
            colors5 = plt.cm.Accent(np.linspace(0, 1, 8))
            base_colors = np.concatenate([colors1, colors2, colors3, colors4, colors5])
            # Repeat colors if we have more domains than base colors
            colors = np.tile(base_colors, (n_domains // len(base_colors) + 1, 1))[:n_domains]
        
        for i, (domain, total_vis) in enumerate(domains_with_visibility):
            normalized_vis = total_vis / total_visibility if total_visibility > 0 else 0
            legend_labels.append(f'{domain[:25]} ({total_vis:.0f}, {normalized_vis:.3f})')
            legend_colors.append(colors[i])
            
            # Color the corresponding bar (find the index in the full sorted list)
            domain_index = domains.index(domain)
            if domain_index < len(bars):
                bars[domain_index].set_color(colors[i])
        
        # Add legend - positioned at upper right with all domains listed vertically
        legend_handles = [plt.Rectangle((0,0),1,1, color=color) for color in legend_colors]
        
        # Use larger fonts and single column layout for better readability
        fontsize = 10  # Larger font size
        title_fontsize = 12  # Larger title font size
        ncol = 1  # Always use single column for vertical listing
            
        plt.legend(legend_handles, legend_labels, loc='upper right', 
                  fontsize=fontsize, title=f'All {n_domains} Domains with Visibility > 0\n(domain, total, normalized)', 
                  title_fontsize=title_fontsize, ncol=ncol, bbox_to_anchor=(1, 1),
                  framealpha=0.9, fancybox=True, shadow=True)
        
        # Add statistics text box - moved to bottom right
        stats_text = f"""Statistics:
Total Domains: {len(domains)}
Total Documents: {len(documents)}
Total Visibility (binary): {total_visibility:.0f}
Domains with Visibility > 0: {sum(1 for v in raw_visibilities if v > 0)}
Max Normalized Visibility: {max(normalized_visibilities):.3f}
Average Normalized Visibility: {np.mean(normalized_visibilities):.3f}"""
        
        plt.text(0.98, 0.02, stats_text, transform=plt.gca().transAxes, fontsize=10,
                verticalalignment='bottom', horizontalalignment='right', 
                bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
        
        # Adjust layout to prevent label cutoff
        plt.tight_layout()
        
        # Save the plot
        plot_filename = 'domain_visibility_distribution_normalized.png'
        plt.savefig(plot_filename, dpi=300, bbox_inches='tight', facecolor='white')
        print(f"\n💾 Plot saved as: {plot_filename}")
        
        # Show the plot
        plt.show()
        
        # Print summary statistics
        print(f"\n📊 Summary Statistics:")
        print(f"  Total domains: {len(domains)}")
        print(f"  Total training documents: {len(documents)}")
        print(f"  Total visibility (binary): {total_visibility:.0f}")
        print(f"  Domains with visibility > 0: {sum(1 for v in raw_visibilities if v > 0)}")
        print(f"  Domains with visibility = 0: {sum(1 for v in raw_visibilities if v == 0)}")
        print(f"  Max normalized visibility: {max(normalized_visibilities):.3f}")
        print(f"  Min normalized visibility: {min(normalized_visibilities):.3f}")
        print(f"  Average normalized visibility: {np.mean(normalized_visibilities):.3f}")
        print(f"  Median normalized visibility: {np.median(normalized_visibilities):.3f}")
        
        # Close MongoDB connection
        client.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    plot_domain_visibility_distribution()
