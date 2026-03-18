# AFI ML Scripts

Python scripts for training and running machine learning models on AFI wallet behavior data.

## Setup

```bash
# Install Python dependencies
pip install -r ../requirements.txt

# Create directories
mkdir -p ../data ../models
```

## Quick Start

### 1. Generate Test Data

```bash
python generate_test_features.py \
  --output ../data/test_wallet_features.parquet \
  --n-wallets 1000 \
  --anomaly-rate 0.1
```

### 2. Train Anomaly Detection Model

```bash
python train_anomaly_model.py \
  --input ../data/test_wallet_features.parquet \
  --output-model ../models/isolation_forest.pkl \
  --output-scaler ../models/scaler.pkl \
  --contamination 0.1 \
  --n-estimators 100
```

### 3. Run Anomaly Detection

```bash
python predict_anomalies.py \
  --input ../data/test_wallet_features.parquet \
  --output ../data/anomaly_results.parquet \
  --model ../models/isolation_forest.pkl \
  --scaler ../models/scaler.pkl
```

### 4. Inspect Results

```bash
# Using DuckDB
duckdb -c "SELECT * FROM read_parquet('../data/anomaly_results.parquet') WHERE is_anomaly = true LIMIT 10"

# Or Python
python -c "import pandas as pd; print(pd.read_parquet('../data/anomaly_results.parquet').head())"
```

## Scripts

### generate_test_features.py

Generates synthetic wallet feature data for testing.

**Options:**
- `--output PATH` - Output Parquet file (default: `data/test_wallet_features.parquet`)
- `--n-wallets INT` - Number of wallets (default: 1000)
- `--anomaly-rate FLOAT` - Proportion of anomalies (default: 0.1)
- `--random-state INT` - Random seed (default: 42)

**Anomaly Types:**
- **high_frequency** - Burst of transactions (50-200 tx in 7 days)
- **high_value** - Large payments ($10k-$100k average)
- **suspicious_latency** - Slow settlements (5-60 min average)

### train_anomaly_model.py

Trains IsolationForest model for anomaly detection.

**Options:**
- `--input PATH` - Input features (default: `data/wallet_features.parquet`)
- `--output-model PATH` - Model file (default: `models/isolation_forest.pkl`)
- `--output-scaler PATH` - Scaler file (default: `models/scaler.pkl`)
- `--contamination FLOAT` - Expected anomaly rate (default: 0.1)
- `--n-estimators INT` - Number of trees (default: 100)
- `--random-state INT` - Random seed (default: 42)

**Outputs:**
- `models/isolation_forest.pkl` - Trained model
- `models/scaler.pkl` - Feature scaler
- `models/isolation_forest_metadata.json` - Training metadata

### predict_anomalies.py

Runs anomaly detection on wallet features.

**Options:**
- `--input PATH` - Input features (required)
- `--output PATH` - Output predictions (required)
- `--model PATH` - Trained model (default: `models/isolation_forest.pkl`)
- `--scaler PATH` - Fitted scaler (default: `models/scaler.pkl`)
- `--top-features INT` - Contributing features to identify (default: 3)

**Output Schema:**
- `wallet_address` - Wallet identifier
- `anomaly_score` - IsolationForest score (lower = more anomalous)
- `is_anomaly` - Boolean flag
- `contributing_features` - Top features causing anomaly
- `timestamp` - Prediction timestamp

## Integration with AFI

### Production Workflow

1. **Export AFI packets to Parquet** (Subagent04)
   ```bash
   npm run dev:server -- export-parquet
   ```

2. **Extract features with DuckDB**
   ```bash
   duckdb << EOF
   $(node -p "require('./server/models.ts').exportFeatureQueriesToSQL()")
   EOF
   ```

3. **Train models** (periodic, e.g., weekly)
   ```bash
   python scripts/train_anomaly_model.py \
     --input data/wallet_features.parquet
   ```

4. **Run inference** (on-demand or scheduled)
   ```bash
   python scripts/predict_anomalies.py \
     --input data/wallet_features.parquet \
     --output data/anomaly_results.parquet
   ```

5. **Serve results via API**
   ```typescript
   // In server/index.ts
   app.get('/api/ml/anomalies/:wallet', async (req, res) => {
     const results = await loadParquetResults('data/anomaly_results.parquet');
     const wallet = results.find(r => r.wallet_address === req.params.wallet);
     res.json(wallet);
   });
   ```

## Model Retraining

Retrain models when:
- New behavior patterns emerge
- Anomaly detection rate drifts significantly
- Sufficient new data accumulated (e.g., +20% samples)

Recommended schedule: Weekly or bi-weekly

## Monitoring

Track these metrics in production:
- Anomaly detection rate (should match contamination parameter)
- Score distribution (check for drift)
- Feature importance shifts
- Model prediction latency

## Troubleshooting

### "ModuleNotFoundError: No module named 'sklearn'"

Install dependencies:
```bash
pip install -r ../requirements.txt
```

### "FileNotFoundError: [Errno 2] No such file or directory: 'models/...'"

Train the model first:
```bash
python scripts/train_anomaly_model.py
```

### "ValueError: Found array with 0 sample(s)"

Ensure input Parquet file contains data:
```bash
duckdb -c "SELECT COUNT(*) FROM read_parquet('data/wallet_features.parquet')"
```

### High memory usage

For large datasets (>1M wallets), use batch processing or increase system RAM.

## Future Enhancements

- [ ] KMeans clustering implementation
- [ ] DBSCAN for density-based anomaly detection
- [ ] Time-series forecasting (Prophet, ARIMA)
- [ ] Graph-based anomaly detection (NetworkX)
- [ ] Real-time inference API (FastAPI)
- [ ] Model monitoring dashboard (Streamlit)
