# AFI Machine Learning Integration Guide

## Overview

This document describes the machine learning pipeline for Agent Flow Intelligence (AFI), including feature extraction, model training, and deployment workflows.

## Architecture

```
┌─────────────────┐
│ SQLite Database │
│  (AFI Packets)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│ Parquet Export      │  ← Subagent04
│ (afi_packets.parquet)│
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ DuckDB              │
│ Feature Extraction  │  ← server/models.ts (SQL queries)
│ (wallet_features.   │
│  parquet)           │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ Python/scikit-learn │
│ - IsolationForest   │  ← ML model training & inference
│ - KMeans            │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ Model Artifacts     │
│ (pickle/joblib)     │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ AFI API             │
│ Anomaly/Cluster     │  ← server/index.ts (endpoints)
│ Detection Results   │
└─────────────────────┘
```

## Workflow

### Phase 1: Data Export (Subagent04)

**Status**: Pending Subagent04 completion

Export AFI packets from SQLite to Parquet format:

```typescript
import { Store } from "./server/store";
import { buildPortableInteractionPacket } from "./server/packet";

// Pseudo-code for Parquet export
const store = new Store(/* ... */);
const interactions = store.listAllInteractions();
const packets = interactions.map(i => buildPortableInteractionPacket(store, i));

// Export to Parquet using DuckDB or Apache Arrow
// Output: afi_packets.parquet
```

Expected Parquet schema:
- `interaction.*` - All fields from `InteractionRecord`
- `controls.*` - Control metrics
- `protocol.*` - Protocol-specific data
- `evidence.*` - Evidence timeline
- `correlations.*` - Related entities
- `summary.*` - Packet summary

### Phase 2: Feature Extraction (DuckDB)

**Location**: `server/models.ts`

Run SQL queries to compute behavioral features:

```bash
# Install DuckDB CLI
brew install duckdb  # macOS
# or download from duckdb.org

# Execute feature extraction
duckdb << EOF
-- Load Parquet export
CREATE TABLE afi_packets AS
SELECT * FROM read_parquet('afi_packets.parquet');

-- Run feature queries from server/models.ts
-- See exportFeatureQueriesToSQL() function

-- Export features
COPY wallet_features TO 'wallet_features.parquet' (FORMAT PARQUET);
EOF
```

Feature categories:

1. **FREQ** (Transaction Frequency)
   - `tx_count_7d`, `tx_count_30d`, `tx_count_90d`
   - `avg_daily_tx_7d`, `avg_daily_tx_30d`
   - `max_daily_tx_7d`, `max_daily_tx_30d`
   - `tx_frequency_cv` (coefficient of variation)

2. **CP** (Counterparty Breadth)
   - `unique_counterparties_7d`, `unique_counterparties_30d`
   - `top_counterparty_share_30d`
   - `counterparty_hhi_30d` (Herfindahl-Hirschman Index)
   - `repeat_counterparty_rate_30d`

3. **APS** (Average Payment Size)
   - `avg_payment_usd_7d`, `avg_payment_usd_30d`
   - `median_payment_usd_7d`, `median_payment_usd_30d`
   - `total_volume_usd_7d`, `total_volume_usd_30d`
   - `payment_size_cv_30d`
   - `large_payment_count_30d`

4. **SLAT** (Settlement Latency)
   - `avg_latency_seconds_7d`, `avg_latency_seconds_30d`
   - `median_latency_seconds_7d`, `median_latency_seconds_30d`
   - `fast_settlement_rate_30d` (% settled within 60s)
   - `settlement_failure_rate_30d`

5. **BURST** (Burstiness Indicators)
   - `max_hourly_tx_24h`
   - `hourly_burst_ratio_24h`
   - `hourly_tx_cv_24h`
   - `idle_hours_7d`
   - `inter_tx_time_std_7d`

### Phase 3: Model Training (Python/scikit-learn)

**Status**: Stub implementations in `server/models.ts`

#### Anomaly Detection (IsolationForest)

Create `scripts/train_anomaly_model.py`:

```python
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import pandas as pd
import joblib

# Load features
features_df = pd.read_parquet('wallet_features.parquet')

# Exclude metadata columns
feature_cols = [col for col in features_df.columns
                if col not in ['wallet_address', 'computed_at', 'observation_window_days']]
X = features_df[feature_cols]

# Standardize
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Train IsolationForest
model = IsolationForest(
    contamination=0.1,      # 10% expected anomalies
    n_estimators=100,
    max_samples='auto',
    random_state=42
)
model.fit(X_scaled)

# Save model and scaler
joblib.dump(model, 'models/isolation_forest.pkl')
joblib.dump(scaler, 'models/scaler.pkl')

print(f"Trained on {len(X)} wallets with {len(feature_cols)} features")
```

Run training:

```bash
python scripts/train_anomaly_model.py
```

#### Clustering (KMeans)

Create `scripts/train_clustering_model.py`:

```python
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score
import pandas as pd
import numpy as np
import joblib

# Load features
features_df = pd.read_parquet('wallet_features.parquet')

# Exclude metadata columns
feature_cols = [col for col in features_df.columns
                if col not in ['wallet_address', 'computed_at', 'observation_window_days']]
X = features_df[feature_cols]

# Standardize
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# Find optimal k using silhouette score
silhouette_scores = []
K_range = range(2, 11)

for k in K_range:
    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(X_scaled)
    score = silhouette_score(X_scaled, labels)
    silhouette_scores.append(score)
    print(f"k={k}, silhouette={score:.3f}")

# Train with optimal k
optimal_k = K_range[np.argmax(silhouette_scores)]
model = KMeans(n_clusters=optimal_k, random_state=42, n_init=10)
model.fit(X_scaled)

# Define cluster labels based on analysis
cluster_labels = {
    0: "high_frequency_trader",
    1: "occasional_user",
    2: "high_value_merchant",
    3: "automated_bot",
    4: "dormant_reactivated",
    # ... extend based on cluster characteristics
}

# Save model, scaler, and labels
joblib.dump(model, 'models/kmeans.pkl')
joblib.dump(scaler, 'models/scaler.pkl')
joblib.dump(cluster_labels, 'models/cluster_labels.pkl')

print(f"Trained {optimal_k} clusters on {len(X)} wallets")
```

### Phase 4: Model Inference (Python Scripts)

Create `scripts/predict_anomalies.py`:

```python
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import pandas as pd
import joblib
import sys

# Load model and scaler
model = joblib.load('models/isolation_forest.pkl')
scaler = joblib.load('models/scaler.pkl')

# Load features
features_df = pd.read_parquet(sys.argv[1])  # Input parquet path

# Extract feature columns
feature_cols = [col for col in features_df.columns
                if col not in ['wallet_address', 'computed_at', 'observation_window_days']]
X = features_df[feature_cols]

# Standardize and predict
X_scaled = scaler.transform(X)
predictions = model.predict(X_scaled)  # -1 = anomaly, 1 = normal
scores = model.decision_function(X_scaled)

# Identify contributing features for anomalies
# (Simple heuristic: features > 2 std from mean)
contributing_features = []
for idx, is_anomaly in enumerate(predictions == -1):
    if is_anomaly:
        feature_deviations = np.abs(X_scaled[idx])
        top_features = [feature_cols[i] for i in np.argsort(feature_deviations)[-3:]]
        contributing_features.append(','.join(top_features))
    else:
        contributing_features.append('')

# Build results
results_df = pd.DataFrame({
    'wallet_address': features_df['wallet_address'],
    'anomaly_score': scores,
    'is_anomaly': predictions == -1,
    'contributing_features': contributing_features,
    'timestamp': pd.Timestamp.now().isoformat()
})

# Save results
results_df.to_parquet(sys.argv[2])  # Output parquet path
print(f"Detected {(predictions == -1).sum()} anomalies out of {len(predictions)} wallets")
```

Create `scripts/predict_clusters.py`:

```python
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import pandas as pd
import joblib
import sys

# Load model, scaler, and labels
model = joblib.load('models/kmeans.pkl')
scaler = joblib.load('models/scaler.pkl')
cluster_labels = joblib.load('models/cluster_labels.pkl')

# Load features
features_df = pd.read_parquet(sys.argv[1])

# Extract feature columns
feature_cols = [col for col in features_df.columns
                if col not in ['wallet_address', 'computed_at', 'observation_window_days']]
X = features_df[feature_cols]

# Standardize and predict
X_scaled = scaler.transform(X)
labels = model.predict(X_scaled)
distances = model.transform(X_scaled).min(axis=1)

# Build results
results_df = pd.DataFrame({
    'wallet_address': features_df['wallet_address'],
    'cluster_id': labels,
    'cluster_label': [cluster_labels.get(label, 'unknown') for label in labels],
    'distance_to_centroid': distances,
    'timestamp': pd.Timestamp.now().isoformat()
})

# Save results
results_df.to_parquet(sys.argv[2])
print(f"Clustered {len(labels)} wallets into {len(set(labels))} groups")
```

### Phase 5: API Integration

Add endpoints to `server/index.ts`:

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { exportFeatureQueriesToSQL } from './models';

const execAsync = promisify(exec);

// Generate feature extraction SQL
app.get('/api/ml/feature-queries', (req, res) => {
  const sql = exportFeatureQueriesToSQL();
  res.type('text/plain').send(sql);
});

// Run anomaly detection
app.post('/api/ml/detect-anomalies', async (req, res) => {
  try {
    // 1. Extract features to Parquet
    await execAsync('duckdb -c "$(cat feature_queries.sql)"');

    // 2. Run Python anomaly detection
    const { stdout } = await execAsync(
      'python scripts/predict_anomalies.py wallet_features.parquet anomaly_results.parquet'
    );

    // 3. Load results
    const results = await loadParquetResults('anomaly_results.parquet');

    res.json({ status: 'ok', results, log: stdout });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run clustering
app.post('/api/ml/cluster-wallets', async (req, res) => {
  try {
    // Similar to anomaly detection
    await execAsync('duckdb -c "$(cat feature_queries.sql)"');
    const { stdout } = await execAsync(
      'python scripts/predict_clusters.py wallet_features.parquet clustering_results.parquet'
    );
    const results = await loadParquetResults('clustering_results.parquet');
    res.json({ status: 'ok', results, log: stdout });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

## Dependencies

### TypeScript/Node.js
- Existing AFI dependencies (express, zod, etc.)
- DuckDB CLI for feature extraction

### Python (ML Pipeline)
```bash
pip install -r requirements.txt
```

Create `requirements.txt`:
```
pandas>=2.0.0
pyarrow>=12.0.0
scikit-learn>=1.3.0
numpy>=1.24.0
joblib>=1.3.0
```

## File Structure

```
AgentFlowIntelligence/
├── server/
│   ├── models.ts              ← Feature extraction queries & ML stubs
│   ├── index.ts               ← API endpoints (add ML routes)
│   └── ...
├── scripts/
│   ├── train_anomaly_model.py       ← Train IsolationForest
│   ├── train_clustering_model.py    ← Train KMeans
│   ├── predict_anomalies.py         ← Inference script
│   └── predict_clusters.py          ← Inference script
├── models/
│   ├── isolation_forest.pkl         ← Serialized models
│   ├── kmeans.pkl
│   ├── scaler.pkl
│   └── cluster_labels.pkl
├── data/
│   ├── afi_packets.parquet          ← Exported from SQLite
│   ├── wallet_features.parquet      ← Extracted features
│   ├── anomaly_results.parquet      ← Detection results
│   └── clustering_results.parquet   ← Clustering results
├── requirements.txt                  ← Python dependencies
└── ML_INTEGRATION.md                ← This file
```

## Development Workflow

1. **Wait for Subagent04** to complete Parquet export implementation
2. **Extract features** using DuckDB queries from `server/models.ts`
3. **Train models** using Python scripts (one-time or periodic retraining)
4. **Deploy inference** via API endpoints that call Python scripts
5. **Monitor results** in AFI UI or via API

## Testing

```bash
# 1. Export test data (after Subagent04 completion)
npm run dev:server -- export-parquet

# 2. Extract features
duckdb << EOF
$(node -e "import('./server/models.ts').then(m => console.log(m.exportFeatureQueriesToSQL()))")
EOF

# 3. Train models
python scripts/train_anomaly_model.py
python scripts/train_clustering_model.py

# 4. Test inference
python scripts/predict_anomalies.py data/wallet_features.parquet data/test_anomalies.parquet
python scripts/predict_clusters.py data/wallet_features.parquet data/test_clusters.parquet

# 5. Verify results
duckdb -c "SELECT * FROM read_parquet('data/test_anomalies.parquet') LIMIT 10"
```

## Next Steps

1. [ ] **Subagent04**: Implement Parquet export from SQLite
2. [ ] **Validate queries**: Test DuckDB feature extraction on sample data
3. [ ] **Create Python scripts**: Implement model training/inference
4. [ ] **Add API endpoints**: Integrate ML pipeline into AFI server
5. [ ] **Build UI**: Visualize anomaly scores and cluster assignments
6. [ ] **Schedule retraining**: Set up periodic model updates

## Notes

- **Why Python?**: scikit-learn is the industry standard for IsolationForest and KMeans
- **Why DuckDB?**: Efficient SQL-based feature engineering on Parquet files
- **Why Parquet?**: Columnar format optimized for analytical queries, smaller than JSON
- **Scalability**: DuckDB can handle millions of rows efficiently on a single machine
- **Alternative**: For very large datasets, consider Apache Spark with MLlib

## References

- [DuckDB Documentation](https://duckdb.org/docs/)
- [scikit-learn IsolationForest](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html)
- [scikit-learn KMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html)
- [Apache Parquet Format](https://parquet.apache.org/)
