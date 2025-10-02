#!/usr/bin/env python3

import os
import sys
import json
import argparse
import numpy as np
import matplotlib.pyplot as plt
from typing import List, Tuple, Dict, Any
from dataclasses import dataclass
from datetime import datetime
import pickle

# Add the parent directory to the path to import from lib
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load environment variables
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env.local'))

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

import pymongo
from pymongo import MongoClient

@dataclass
class TrainingConfig:
    """Configuration for training parameters"""
    train_ratio: float = 0.8
    val_ratio: float = 0.2
    epochs: int = 15
    batch_size: int = 32
    learning_rate: float = 0.001
    max_sentences: int = 20
    embedding_dim: int = 1536  # OpenAI text-embedding-3-small dimension
    hidden_dims: List[int] = None
    dropout: float = 0.2
    weight_decay: float = 1e-5
    patience: int = 5  # Early stopping patience
    
    def __post_init__(self):
        if self.hidden_dims is None:
            self.hidden_dims = [1024, 512, 256, 128]

class VisibilityDataset(Dataset):
    """Dataset for prompt-domain-sentences visibility prediction"""
    
    def __init__(self, embeddings: List[np.ndarray], labels: List[float]):
        self.embeddings = embeddings
        self.labels = labels
    
    def __len__(self):
        return len(self.embeddings)
    
    def __getitem__(self, idx):
        return torch.FloatTensor(self.embeddings[idx]), torch.FloatTensor([self.labels[idx]])

class VisibilityMLP(nn.Module):
    """Multi-layer perceptron for visibility prediction"""
    
    def __init__(self, input_dim: int, hidden_dims: List[int], dropout: float = 0.2):
        super(VisibilityMLP, self).__init__()
        
        layers = []
        prev_dim = input_dim
        
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.ReLU(),
                nn.BatchNorm1d(hidden_dim),
                nn.Dropout(dropout)
            ])
            prev_dim = hidden_dim
        
        # Output layer
        layers.append(nn.Linear(prev_dim, 1))
        layers.append(nn.Sigmoid())
        
        self.network = nn.Sequential(*layers)
    
    def forward(self, x):
        return self.network(x)

class VisibilityTrainer:
    """Main trainer class for visibility prediction model"""
    
    def __init__(self, config: TrainingConfig):
        self.config = config
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"Using device: {self.device}")
        
        # Initialize MongoDB connection
        self.mongo_client = MongoClient(os.getenv('MONGODB_URI'))
        self.db = self.mongo_client['springbrand-ai']
        self.collection = self.db['prompt_domain_sentences_visibility_training_data']
        
        # Training statistics
        self.train_losses = []
        self.val_losses = []
        self.train_accuracies = []
        self.val_accuracies = []
        self.train_f1_scores = []
        self.val_f1_scores = []
        self.val_auc_scores = []
        
        self.best_val_loss = float('inf')
        self.best_model_state = None
        self.patience_counter = 0
    
    
    def load_data(self) -> Tuple[List[np.ndarray], List[float]]:
        """Load pre-computed embeddings and labels from MongoDB"""
        print("Loading pre-computed embeddings from MongoDB...")
        
        # Get all documents from the collection
        documents = list(self.collection.find({}))
        print(f"Found {len(documents)} documents in MongoDB")
        
        if len(documents) == 0:
            raise ValueError("No training data found in MongoDB")
        
        embeddings = []
        labels = []
        
        for i, doc in enumerate(documents):
            try:
                embedding = doc['embedding']
                visibility = doc['visibility']
                
                if i % 100 == 0:  # Progress update every 100 documents
                    print(f"Loading document {i+1}/{len(documents)}")
                
                # Convert embedding to numpy array
                feature_vector = np.array(embedding, dtype=np.float32)
                
                embeddings.append(feature_vector)
                labels.append(visibility)
                
            except Exception as e:
                print(f"Error processing document {i}: {e}")
                continue
        
        print(f"Successfully loaded {len(embeddings)} pre-computed embeddings")
        if len(embeddings) > 0:
            print(f"Embedding dimension: {len(embeddings[0])}")
        return embeddings, labels
    
    def prepare_datasets(self, embeddings: List[np.ndarray], labels: List[float]) -> Tuple[DataLoader, DataLoader]:
        """Split data and create DataLoaders"""
        print("Preparing datasets...")
        
        # Split data
        X_train, X_val, y_train, y_val = train_test_split(
            embeddings, labels, 
            test_size=self.config.val_ratio, 
            random_state=42,
            stratify=None  # Can't stratify continuous labels
        )
        
        print(f"Training samples: {len(X_train)}")
        print(f"Validation samples: {len(X_val)}")
        
        # Create datasets
        train_dataset = VisibilityDataset(X_train, y_train)
        val_dataset = VisibilityDataset(X_val, y_val)
        
        # Create data loaders
        train_loader = DataLoader(
            train_dataset, 
            batch_size=self.config.batch_size, 
            shuffle=True,
            num_workers=0  # Set to 0 to avoid multiprocessing issues
        )
        val_loader = DataLoader(
            val_dataset, 
            batch_size=self.config.batch_size, 
            shuffle=False,
            num_workers=0
        )
        
        return train_loader, val_loader
    
    def create_model(self, input_dim: int) -> VisibilityMLP:
        """Create and initialize the model"""
        model = VisibilityMLP(
            input_dim=input_dim,
            hidden_dims=self.config.hidden_dims,
            dropout=self.config.dropout
        )
        return model.to(self.device)
    
    def train_epoch(self, model: nn.Module, train_loader: DataLoader, 
                   optimizer: optim.Optimizer, criterion: nn.Module) -> Tuple[float, float, float]:
        """Train for one epoch"""
        model.train()
        total_loss = 0.0
        all_predictions = []
        all_labels = []
        
        for batch_idx, (data, target) in enumerate(train_loader):
            data, target = data.to(self.device), target.to(self.device)
            
            optimizer.zero_grad()
            output = model(data)
            loss = criterion(output, target)
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            
            # Convert to binary predictions for accuracy calculation
            predictions = (output > 0.5).float()
            all_predictions.extend(predictions.cpu().numpy())
            all_labels.extend(target.cpu().numpy())
        
        avg_loss = total_loss / len(train_loader)
        accuracy = accuracy_score(all_labels, all_predictions)
        f1 = f1_score(all_labels, all_predictions, average='binary', zero_division=0)
        
        return avg_loss, accuracy, f1
    
    def validate_epoch(self, model: nn.Module, val_loader: DataLoader, 
                      criterion: nn.Module) -> Tuple[float, float, float, float]:
        """Validate for one epoch"""
        model.eval()
        total_loss = 0.0
        all_predictions = []
        all_labels = []
        all_probabilities = []
        
        with torch.no_grad():
            for data, target in val_loader:
                data, target = data.to(self.device), target.to(self.device)
                output = model(data)
                loss = criterion(output, target)
                total_loss += loss.item()
                
                # Store predictions and probabilities
                predictions = (output > 0.5).float()
                all_predictions.extend(predictions.cpu().numpy())
                all_labels.extend(target.cpu().numpy())
                all_probabilities.extend(output.cpu().numpy())
        
        avg_loss = total_loss / len(val_loader)
        accuracy = accuracy_score(all_labels, all_predictions)
        f1 = f1_score(all_labels, all_predictions, average='binary', zero_division=0)
        
        # Calculate AUC if we have both classes
        try:
            auc = roc_auc_score(all_labels, all_probabilities)
        except ValueError:
            auc = 0.0  # If only one class present
        
        return avg_loss, accuracy, f1, auc
    
    def save_model(self, model: nn.Module, epoch: int, is_best: bool = False):
        """Save model checkpoint"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': model.state_dict(),
            'config': self.config,
            'train_losses': self.train_losses,
            'val_losses': self.val_losses,
            'train_accuracies': self.train_accuracies,
            'val_accuracies': self.val_accuracies,
            'train_f1_scores': self.train_f1_scores,
            'val_f1_scores': self.val_f1_scores,
            'val_auc_scores': self.val_auc_scores,
        }
        
        # Save epoch checkpoint
        epoch_path = f'visibility_model_epoch_{epoch}_{timestamp}.pth'
        torch.save(checkpoint, epoch_path)
        print(f"Saved epoch {epoch} model to {epoch_path}")
        
        # Save best model
        if is_best:
            best_path = f'visibility_model_best_{timestamp}.pth'
            torch.save(checkpoint, best_path)
            print(f"Saved best model to {best_path}")
            self.best_model_state = checkpoint
    
    def plot_training_stats(self):
        """Plot training and validation statistics"""
        epochs = range(1, len(self.train_losses) + 1)
        
        fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 10))
        
        # Loss plot
        ax1.plot(epochs, self.train_losses, 'b-', label='Training Loss')
        ax1.plot(epochs, self.val_losses, 'r-', label='Validation Loss')
        ax1.set_title('Training and Validation Loss')
        ax1.set_xlabel('Epoch')
        ax1.set_ylabel('Loss')
        ax1.legend()
        ax1.grid(True)
        
        # Accuracy plot
        ax2.plot(epochs, self.train_accuracies, 'b-', label='Training Accuracy')
        ax2.plot(epochs, self.val_accuracies, 'r-', label='Validation Accuracy')
        ax2.set_title('Training and Validation Accuracy')
        ax2.set_xlabel('Epoch')
        ax2.set_ylabel('Accuracy')
        ax2.legend()
        ax2.grid(True)
        
        # F1 Score plot
        ax3.plot(epochs, self.train_f1_scores, 'b-', label='Training F1')
        ax3.plot(epochs, self.val_f1_scores, 'r-', label='Validation F1')
        ax3.set_title('Training and Validation F1 Score')
        ax3.set_xlabel('Epoch')
        ax3.set_ylabel('F1 Score')
        ax3.legend()
        ax3.grid(True)
        
        # AUC plot
        ax4.plot(epochs, self.val_auc_scores, 'r-', label='Validation AUC')
        ax4.set_title('Validation AUC Score')
        ax4.set_xlabel('Epoch')
        ax4.set_ylabel('AUC')
        ax4.legend()
        ax4.grid(True)
        
        plt.tight_layout()
        
        # Save plot
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        plot_path = f'training_stats_{timestamp}.png'
        plt.savefig(plot_path, dpi=300, bbox_inches='tight')
        print(f"Saved training statistics plot to {plot_path}")
        plt.show()
    
    def train(self):
        """Main training loop"""
        print("Starting visibility prediction model training...")
        
        # Load and prepare data
        embeddings, labels = self.load_data()
        train_loader, val_loader = self.prepare_datasets(embeddings, labels)
        
        # Calculate input dimension
        input_dim = len(embeddings[0])
        print(f"Input dimension: {input_dim}")
        
        # Create model
        model = self.create_model(input_dim)
        print(f"Model architecture:\n{model}")
        
        # Setup training
        criterion = nn.BCELoss()
        optimizer = optim.Adam(
            model.parameters(), 
            lr=self.config.learning_rate,
            weight_decay=self.config.weight_decay
        )
        
        print(f"\nStarting training for {self.config.epochs} epochs...")
        print(f"Batch size: {self.config.batch_size}")
        print(f"Learning rate: {self.config.learning_rate}")
        
        # Training loop
        for epoch in range(1, self.config.epochs + 1):
            print(f"\nEpoch {epoch}/{self.config.epochs}")
            print("-" * 50)
            
            # Train
            train_loss, train_acc, train_f1 = self.train_epoch(
                model, train_loader, optimizer, criterion
            )
            
            # Validate
            val_loss, val_acc, val_f1, val_auc = self.validate_epoch(
                model, val_loader, criterion
            )
            
            # Store statistics
            self.train_losses.append(train_loss)
            self.val_losses.append(val_loss)
            self.train_accuracies.append(train_acc)
            self.val_accuracies.append(val_acc)
            self.train_f1_scores.append(train_f1)
            self.val_f1_scores.append(val_f1)
            self.val_auc_scores.append(val_auc)
            
            # Print statistics
            print(f"Train Loss: {train_loss:.4f}, Train Acc: {train_acc:.4f}, Train F1: {train_f1:.4f}")
            print(f"Val Loss: {val_loss:.4f}, Val Acc: {val_acc:.4f}, Val F1: {val_f1:.4f}, Val AUC: {val_auc:.4f}")
            
            # Check for best model
            is_best = val_loss < self.best_val_loss
            if is_best:
                self.best_val_loss = val_loss
                self.patience_counter = 0
                print("New best model!")
            else:
                self.patience_counter += 1
            
            # Save model
            self.save_model(model, epoch, is_best)
            
            # Early stopping
            if self.patience_counter >= self.config.patience:
                print(f"Early stopping triggered after {epoch} epochs")
                break
        
        print("\nTraining completed!")
        print(f"Best validation loss: {self.best_val_loss:.4f}")
        
        # Plot training statistics
        self.plot_training_stats()
        
        # Close MongoDB connection
        self.mongo_client.close()

def main():
    parser = argparse.ArgumentParser(description='Train prompt-domain-sentences visibility prediction model')
    parser.add_argument('--train_ratio', type=float, default=0.8, help='Training data ratio')
    parser.add_argument('--val_ratio', type=float, default=0.2, help='Validation data ratio')
    parser.add_argument('--epochs', type=int, default=15, help='Number of training epochs')
    parser.add_argument('--batch_size', type=int, default=32, help='Batch size')
    parser.add_argument('--learning_rate', type=float, default=0.001, help='Learning rate')
    parser.add_argument('--max_sentences', type=int, default=20, help='Maximum number of sentences to process')
    parser.add_argument('--dropout', type=float, default=0.2, help='Dropout rate')
    parser.add_argument('--weight_decay', type=float, default=1e-5, help='Weight decay')
    parser.add_argument('--patience', type=int, default=5, help='Early stopping patience')
    
    args = parser.parse_args()
    
    # Check required environment variables
    required_env_vars = ['MONGODB_URI']
    for var in required_env_vars:
        if not os.getenv(var):
            print(f"Error: {var} environment variable is required")
            sys.exit(1)
    
    # Create config
    config = TrainingConfig(
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        max_sentences=args.max_sentences,
        dropout=args.dropout,
        weight_decay=args.weight_decay,
        patience=args.patience
    )
    
    print("Training Configuration:")
    print(f"  Train/Val ratio: {config.train_ratio}/{config.val_ratio}")
    print(f"  Epochs: {config.epochs}")
    print(f"  Batch size: {config.batch_size}")
    print(f"  Learning rate: {config.learning_rate}")
    print(f"  Max sentences: {config.max_sentences}")
    print(f"  Hidden dimensions: {config.hidden_dims}")
    print(f"  Dropout: {config.dropout}")
    print(f"  Weight decay: {config.weight_decay}")
    print(f"  Patience: {config.patience}")
    
    # Create trainer and start training
    trainer = VisibilityTrainer(config)
    trainer.train()

if __name__ == "__main__":
    main()
