# Model Training for GEO Visibility Optimization

This directory contains the training pipeline for two machine learning models used in the GEO (Generative Engine Optimization) system:

1. **Reward Model**: Predicts visibility scores for content sentences
2. **Policy Model**: Uses reinforcement learning (GRPO) to modify sentences for improved visibility

## 🏗️ Architecture Overview

### Reward Model
- **Input**: JSON list of sentences + content dimension + domain
- **Output**: Visibility score (0.0 to 1.0)
- **Purpose**: Learns to predict how visible content will be based on FullWebContentCache data
- **Architecture**: Fine-tuned transformer (default: DialoGPT-medium) with regression head

### Policy Model  
- **Input**: JSON list of sentences + content dimension + domain
- **Output**: Modified sentence list
- **Purpose**: Learns to modify sentences to improve visibility using reinforcement learning
- **Architecture**: Fine-tuned transformer with value head using GRPO (Generative Reinforcement Policy Optimization)

### Reward Calculation
The policy model uses a dual reward system:

1. **Modification Reward** (via GPT-4o):
   - For modified sentences: Binary score (0/1) if modification preserves meaning
   - For new sentences: Relevance score (0-1) to brand and content dimension
   - For deletions: Score of 1.0 (considered valid)

2. **Visibility Reward** (via trained reward model):
   - Predicts visibility score for the modified sentence list

**Final Reward = Modification Reward × Visibility Reward**

## 📋 Requirements

### System Requirements
- Python 3.8+
- PyTorch 2.0+
- CUDA GPU (recommended for training)
- 16GB+ RAM (depending on model size)

### Environment Variables
Create a `.env.local` file in the parent directory with:
```bash
MONGODB_URI=mongodb://localhost:27017/springbrand-ai
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### Python Dependencies
Install required packages:
```bash
pip install -r requirements.txt
```

## 🚀 Quick Start

### 1. Train Both Models (Recommended)
```bash
python train_models.py https://www.sendbird.com https://www.twilio.com --train_both
```

### 2. Train Reward Model Only
```bash
python train_models.py https://www.sendbird.com https://www.twilio.com --train_reward
```

### 3. Train Policy Model Only (requires pre-trained reward model)
```bash
python train_models.py https://www.sendbird.com https://www.twilio.com --train_policy
```

## 📊 Training Parameters

### Reward Model Parameters
```bash
python reward_model.py brand_urls [options]

Options:
  --model TEXT              Base model (default: microsoft/DialoGPT-medium)
  --batch_size INTEGER      Batch size (default: 8)
  --epochs INTEGER          Training epochs (default: 10)
  --learning_rate FLOAT     Learning rate (default: 2e-5)
  --output_dir TEXT         Output directory (default: ./reward_model_output)
```

### Policy Model Parameters
```bash
python policy_model.py brand_urls [options]

Options:
  --model TEXT              Base model (default: microsoft/DialoGPT-medium)
  --reward_model_path TEXT  Path to trained reward model
  --batch_size INTEGER      Batch size (default: 4)
  --epochs INTEGER          Training epochs (default: 5)
  --output_dir TEXT         Output directory (default: ./policy_model_output)
```

## 📁 Output Structure

After training, you'll find:

```
model_training/
├── reward_model_output/
│   ├── reward_model_epoch_*.pt     # Model checkpoints
│   └── training_history.png        # Training plots
├── policy_model_output/
│   ├── policy_model_epoch_*.pt     # Model checkpoints
│   └── policy_training_history.png # Training plots
└── logs/                           # Training logs
```

## 🔍 Data Pipeline

### Reward Model Training Data
1. **Source**: FullWebContentCache MongoDB collection
2. **Processing**: Extract (sentences, dimension, domain, visibility) tuples
3. **Format**: JSON list of sentences + metadata → visibility score
4. **Split**: 80% train, 20% validation

### Policy Model Training Data
1. **Source**: Same as reward model
2. **Processing**: Use sentences as input for modification task
3. **Rewards**: Calculated using GPT-4o + trained reward model
4. **Training**: GRPO reinforcement learning

## 📈 Monitoring Training

### Reward Model Metrics
- **Training Loss**: MSE loss on visibility prediction
- **Validation Loss**: MSE loss on held-out data
- **Validation MAE**: Mean absolute error on visibility scores

### Policy Model Metrics
- **Episode Rewards**: Average reward per training episode
- **Policy Loss**: PPO policy gradient loss
- **Value Loss**: Value function approximation loss

### Visualizations
Training plots are automatically generated and saved:
- `training_history.png`: Loss curves and metrics
- `policy_training_history.png`: Reward and loss curves

## 🎯 Usage Examples

### Example 1: Train on Communication Platforms
```bash
python train_models.py \
  https://www.sendbird.com \
  https://www.twilio.com \
  https://www.cometchat.com \
  https://www.pubnub.com \
  --train_both \
  --reward_epochs 15 \
  --policy_epochs 8 \
  --batch_size 16
```

### Example 2: Custom Model and Hyperparameters
```bash
python train_models.py \
  https://www.sendbird.com \
  --train_reward \
  --reward_model "microsoft/DialoGPT-large" \
  --learning_rate 1e-5 \
  --batch_size 4 \
  --reward_epochs 20
```

### Example 3: Resume Policy Training
```bash
python policy_model.py \
  https://www.sendbird.com \
  --reward_model_path ./reward_model_output/reward_model_epoch_15.pt \
  --epochs 10 \
  --batch_size 2
```

## 🔧 Advanced Configuration

### Custom Content Dimensions
The models use 15 predefined content dimensions. To modify them, edit `CONTENT_DIMENSIONS_DESCRIPTIONS` in `policy_model.py`.

### Reward Function Tuning
Adjust reward calculation in `RewardCalculator.calculate_total_reward()`:
- Modify GPT-4o prompts for better evaluation
- Change reward combination formula
- Add additional reward signals

### Model Architecture
Customize the models by modifying:
- Base transformer model (`--model` parameter)
- Hidden dimensions and layers
- Value head architecture
- PPO hyperparameters

## 🐛 Troubleshooting

### Common Issues

**MongoDB Connection Error**
```bash
Error: MONGODB_URI not found in environment variables
```
Solution: Set MONGODB_URI in `.env.local`

**CUDA Out of Memory**
```bash
RuntimeError: CUDA out of memory
```
Solution: Reduce batch size or use CPU training

**OpenRouter API Error**
```bash
Error calling GPT-4o: 401 Unauthorized
```
Solution: Check OPENROUTER_API_KEY in `.env.local`

**No Training Data Found**
```bash
ValueError: No training data found
```
Solution: Ensure FullWebContentCache has data for the specified brand URLs

### Performance Tips

1. **GPU Training**: Use CUDA for faster training
2. **Batch Size**: Start small and increase based on available memory
3. **Learning Rate**: Use learning rate scheduling for better convergence
4. **Data Quality**: Ensure high-quality visibility labels in FullWebContentCache

## 📚 Technical Details

### Reward Model Architecture
```python
Input: "Sentences: ['sent1', 'sent2']\nDimension: Functionality\nDomain: example.com"
↓
Tokenizer (max_length=512)
↓
DialoGPT Backbone
↓
Linear Layer (hidden_size → 1)
↓
Sigmoid Activation
↓
Output: visibility_score ∈ [0, 1]
```

### Policy Model GRPO Training
```python
1. Generate modified sentences using current policy
2. Calculate rewards using GPT-4o + reward model
3. Compute advantages using GAE (Generalized Advantage Estimation)
4. Update policy using PPO (Proximal Policy Optimization)
5. Update value function
6. Repeat for multiple epochs
```

### Reward Signal Calculation
```python
def final_reward(original_sentences, modified_sentences, brand, dimension, domain):
    # GPT-4o evaluation
    modification_score = gpt4o_evaluate_modifications(original_sentences, modified_sentences, brand, dimension)
    
    # Reward model prediction
    visibility_score = reward_model.predict(modified_sentences, dimension, domain)
    
    return modification_score * visibility_score
```

## 🔮 Future Improvements

1. **Multi-objective Optimization**: Add more reward signals (readability, engagement, etc.)
2. **Active Learning**: Iteratively improve data quality
3. **Model Ensemble**: Combine multiple reward models
4. **Online Learning**: Continuous model updates with new data
5. **Advanced RL**: Implement more sophisticated RL algorithms (SAC, TD3)

## 📖 References

- [GRPO Paper](https://arxiv.org/abs/policy-optimization)
- [Transformers Library](https://huggingface.co/transformers/)
- [PyTorch Documentation](https://pytorch.org/docs/)
- [Proximal Policy Optimization](https://arxiv.org/abs/1707.06347)

---

For questions or issues, please check the troubleshooting section or create an issue in the repository.
