# AFI Feature Extraction Quick Reference

## Feature Categories (43 features total)

### FREQ - Transaction Frequency (10 features)
| Feature | Description | Type | Window |
|---------|-------------|------|--------|
| `tx_count_7d` | Transaction count | int | 7 days |
| `tx_count_30d` | Transaction count | int | 30 days |
| `tx_count_90d` | Transaction count | int | 90 days |
| `avg_daily_tx_7d` | Average daily transactions | float | 7 days |
| `avg_daily_tx_30d` | Average daily transactions | float | 30 days |
| `max_daily_tx_7d` | Maximum daily transactions | int | 7 days |
| `max_daily_tx_30d` | Maximum daily transactions | int | 30 days |
| `days_active_7d` | Number of days with activity | int | 7 days |
| `days_active_30d` | Number of days with activity | int | 30 days |
| `tx_frequency_cv` | Coefficient of variation of daily tx | float | 30 days |

### CP - Counterparty Breadth (7 features)
| Feature | Description | Type | Window |
|---------|-------------|------|--------|
| `unique_counterparties_7d` | Unique counterparties | int | 7 days |
| `unique_counterparties_30d` | Unique counterparties | int | 30 days |
| `unique_counterparties_90d` | Unique counterparties | int | 90 days |
| `top_counterparty_share_30d` | Share of tx with top counterparty | float 0-1 | 30 days |
| `counterparty_hhi_30d` | Herfindahl-Hirschman Index | float 0-1 | 30 days |
| `repeat_counterparty_rate_30d` | Rate of repeat interactions | float 0-1 | 30 days |
| `new_counterparty_rate_7d` | Rate of new counterparties | float 0-1 | 7 days |

### APS - Average Payment Size (12 features)
| Feature | Description | Type | Window |
|---------|-------------|------|--------|
| `avg_payment_usd_7d` | Average payment in USD | float | 7 days |
| `avg_payment_usd_30d` | Average payment in USD | float | 30 days |
| `median_payment_usd_7d` | Median payment in USD | float | 7 days |
| `median_payment_usd_30d` | Median payment in USD | float | 30 days |
| `max_payment_usd_7d` | Maximum payment in USD | float | 7 days |
| `max_payment_usd_30d` | Maximum payment in USD | float | 30 days |
| `min_payment_usd_7d` | Minimum payment in USD | float | 7 days |
| `min_payment_usd_30d` | Minimum payment in USD | float | 30 days |
| `total_volume_usd_7d` | Total volume in USD | float | 7 days |
| `total_volume_usd_30d` | Total volume in USD | float | 30 days |
| `payment_size_cv_30d` | Coefficient of variation | float | 30 days |
| `large_payment_count_30d` | Payments >90th percentile | int | 30 days |

### SLAT - Settlement Latency (9 features)
| Feature | Description | Type | Window |
|---------|-------------|------|--------|
| `avg_latency_seconds_7d` | Average settlement latency | float | 7 days |
| `avg_latency_seconds_30d` | Average settlement latency | float | 30 days |
| `median_latency_seconds_7d` | Median settlement latency | float | 7 days |
| `median_latency_seconds_30d` | Median settlement latency | float | 30 days |
| `max_latency_seconds_7d` | Maximum settlement latency | float | 7 days |
| `max_latency_seconds_30d` | Maximum settlement latency | float | 30 days |
| `fast_settlement_rate_30d` | % settled within 60s | float 0-1 | 30 days |
| `settlement_failure_rate_30d` | % failed settlements | float 0-1 | 30 days |
| `confirmed_settlements_30d` | Confirmed settlement count | int | 30 days |

### BURST - Burstiness Indicators (5 features)
| Feature | Description | Type | Window |
|---------|-------------|------|--------|
| `max_hourly_tx_24h` | Maximum hourly transactions | int | 24 hours |
| `hourly_burst_ratio_24h` | Max hourly / avg hourly | float | 24 hours |
| `hourly_tx_cv_24h` | CV of hourly transactions | float | 24 hours |
| `idle_hours_7d` | Hours with no activity | int | 7 days |
| `inter_tx_time_std_7d` | Std dev of time between tx (sec) | float | 7 days |

## DuckDB Usage

### Extract All Features
```sql
-- Execute combined query from server/models.ts
-- Output: wallet_features.parquet with all 43 features
```

### Export SQL to File
```typescript
import { exportFeatureQueriesToSQL } from './server/models';
const sql = exportFeatureQueriesToSQL();
// Write to feature_queries.sql
```

### Run in DuckDB
```bash
duckdb << EOF
$(cat feature_queries.sql)
EOF
```

## Anomaly Detection Patterns

### High Frequency Bot
- ↑ `tx_count_7d` > 50
- ↑ `max_hourly_tx_24h` > 20
- ↑ `hourly_burst_ratio_24h` > 10
- ↑ `tx_frequency_cv` > 2

### High Value Merchant
- ↑ `avg_payment_usd_30d` > $10,000
- ↑ `max_payment_usd_30d` > $50,000
- ↑ `total_volume_usd_30d` > $100,000
- ↑ `large_payment_count_30d` > 15

### Suspicious Settlement
- ↑ `avg_latency_seconds_30d` > 300 (5 min)
- ↓ `fast_settlement_rate_30d` < 0.2
- ↑ `settlement_failure_rate_30d` > 0.3

### Sybil Attack
- ↑ `unique_counterparties_30d` > 50
- ↓ `top_counterparty_share_30d` < 0.1
- ↓ `repeat_counterparty_rate_30d` < 0.1
- ↑ `new_counterparty_rate_7d` > 0.8

### Dormant Reactivation
- `tx_count_90d` > 20
- `tx_count_30d` < 2
- `tx_count_7d` > 10 (sudden spike)

## Feature Importance Rankings

**For Anomaly Detection:**
1. `payment_size_cv_30d` - Detects unusual payment patterns
2. `tx_frequency_cv` - Detects burst behavior
3. `hourly_burst_ratio_24h` - Catches bot activity
4. `settlement_failure_rate_30d` - Flags problematic wallets
5. `counterparty_hhi_30d` - Identifies concentrated activity

**For Clustering:**
1. `avg_payment_usd_30d` - Separates casual from high-value users
2. `tx_count_30d` - Distinguishes frequency tiers
3. `unique_counterparties_30d` - Identifies interaction breadth
4. `avg_latency_seconds_30d` - Groups by settlement speed
5. `repeat_counterparty_rate_30d` - Separates one-time vs recurring

## Expected Value Ranges (Normal Wallets)

| Feature | Min | P25 | Median | P75 | Max |
|---------|-----|-----|--------|-----|-----|
| `tx_count_30d` | 1 | 8 | 20 | 35 | 80 |
| `avg_payment_usd_30d` | $5 | $15 | $40 | $120 | $500 |
| `unique_counterparties_30d` | 1 | 3 | 8 | 15 | 30 |
| `avg_latency_seconds_30d` | 10s | 30s | 45s | 65s | 150s |
| `hourly_burst_ratio_24h` | 1.0 | 1.2 | 1.5 | 2.2 | 4.0 |

## Quick Commands

```bash
# Generate test data
python scripts/generate_test_features.py --n-wallets 1000

# Train model
python scripts/train_anomaly_model.py --input data/test_wallet_features.parquet

# Detect anomalies
python scripts/predict_anomalies.py \
  --input data/test_wallet_features.parquet \
  --output data/results.parquet

# View top anomalies
duckdb -c "
  SELECT wallet_address, anomaly_score, contributing_features
  FROM read_parquet('data/results.parquet')
  WHERE is_anomaly = true
  ORDER BY anomaly_score
  LIMIT 10
"

# Feature statistics
duckdb -c "
  SUMMARIZE SELECT * FROM read_parquet('data/wallet_features.parquet')
"
```

## TypeScript Integration

```typescript
import {
  WalletFeatureVector,
  AnomalyDetectionModel,
  validateFeatureVector
} from './server/models';

// Extract features (simplified)
const features: Partial<WalletFeatureVector> = {
  wallet_address: '0x123...',
  tx_count_7d: 42,
  avg_payment_usd_7d: 125.50,
  // ... other features from DuckDB
  computed_at: new Date().toISOString(),
  observation_window_days: 30
};

// Validate completeness
if (validateFeatureVector(features)) {
  // Run ML model (requires Python backend)
  const model = new AnomalytectionModel();
  // model.predict([features]); // Throws - needs Python
}
```

## References

- **Feature Queries**: `/server/models.ts` (lines 1-500)
- **Python Training**: `/scripts/train_anomaly_model.py`
- **Python Inference**: `/scripts/predict_anomalies.py`
- **Full Guide**: `/ML_INTEGRATION.md`
