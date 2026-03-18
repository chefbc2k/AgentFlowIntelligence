/**
 * AFI Machine Learning Models & Feature Extraction
 *
 * This module provides:
 * 1. Feature extraction queries (DuckDB-ready SQL)
 * 2. Interfaces for ML model integration
 * 3. Placeholder stubs for Python/scikit-learn models
 *
 * IMPORTANT: Actual ML models (IsolationForest, KMeans) require Python/scikit-learn.
 * This module defines the TypeScript interface and provides SQL-based feature extraction
 * that can feed into Python-based model training/inference pipelines.
 *
 * Workflow:
 * 1. Export AFI packets to Parquet via Subagent04
 * 2. Run feature extraction queries (defined below) in DuckDB
 * 3. Export features to Python for ML model training
 * 4. Load trained models and use inference stubs below
 */

import type { InteractionRecord } from "./types";

// ============================================================================
// FEATURE EXTRACTION INTERFACES
// ============================================================================

/**
 * Transaction frequency features (FREQ)
 * Measures transaction velocity and patterns over time windows
 */
export interface TransactionFrequencyFeatures {
  wallet_address: string;
  tx_count_7d: number;
  tx_count_30d: number;
  tx_count_90d: number;
  avg_daily_tx_7d: number;
  avg_daily_tx_30d: number;
  max_daily_tx_7d: number;
  max_daily_tx_30d: number;
  days_active_7d: number;
  days_active_30d: number;
  /** Coefficient of variation of daily transaction counts */
  tx_frequency_cv: number;
}

/**
 * Counterparty breadth features (CP)
 * Measures diversity and concentration of interactions
 */
export interface CounterpartyBreadthFeatures {
  wallet_address: string;
  unique_counterparties_7d: number;
  unique_counterparties_30d: number;
  unique_counterparties_90d: number;
  /** Share of transactions with top counterparty */
  top_counterparty_share_30d: number;
  /** Herfindahl-Hirschman Index for counterparty concentration */
  counterparty_hhi_30d: number;
  repeat_counterparty_rate_30d: number;
  new_counterparty_rate_7d: number;
}

/**
 * Average payment size features (APS)
 * Measures payment amounts and volatility in USD
 */
export interface AveragePaymentSizeFeatures {
  wallet_address: string;
  avg_payment_usd_7d: number;
  avg_payment_usd_30d: number;
  median_payment_usd_7d: number;
  median_payment_usd_30d: number;
  max_payment_usd_7d: number;
  max_payment_usd_30d: number;
  min_payment_usd_7d: number;
  min_payment_usd_30d: number;
  total_volume_usd_7d: number;
  total_volume_usd_30d: number;
  /** Coefficient of variation of payment amounts */
  payment_size_cv_30d: number;
  /** Number of payments above 90th percentile */
  large_payment_count_30d: number;
}

/**
 * Settlement latency features (SLAT)
 * Measures time delays between interaction and settlement
 */
export interface SettlementLatencyFeatures {
  wallet_address: string;
  avg_latency_seconds_7d: number;
  avg_latency_seconds_30d: number;
  median_latency_seconds_7d: number;
  median_latency_seconds_30d: number;
  max_latency_seconds_7d: number;
  max_latency_seconds_30d: number;
  /** Percentage of settlements completed within 60 seconds */
  fast_settlement_rate_30d: number;
  /** Percentage of settlements that failed */
  settlement_failure_rate_30d: number;
  /** Number of confirmed settlements */
  confirmed_settlements_30d: number;
}

/**
 * Burstiness indicators
 * Detects sudden spikes or unusual temporal patterns
 */
export interface BurstinessFeatures {
  wallet_address: string;
  /** Maximum hourly transaction count in last 24h */
  max_hourly_tx_24h: number;
  /** Ratio of max hourly to average hourly transactions */
  hourly_burst_ratio_24h: number;
  /** Coefficient of variation of hourly transactions */
  hourly_tx_cv_24h: number;
  /** Number of hours with zero transactions in last 7 days */
  idle_hours_7d: number;
  /** Standard deviation of inter-transaction time (seconds) */
  inter_tx_time_std_7d: number;
}

/**
 * Combined feature vector for ML models
 */
export interface WalletFeatureVector
  extends TransactionFrequencyFeatures,
    CounterpartyBreadthFeatures,
    AveragePaymentSizeFeatures,
    SettlementLatencyFeatures,
    BurstinessFeatures {
  computed_at: string;
  observation_window_days: number;
}

// ============================================================================
// DUCKDB FEATURE EXTRACTION QUERIES
// ============================================================================

/**
 * DuckDB query for transaction frequency features (FREQ)
 *
 * Assumes Parquet schema with columns:
 * - interaction.wallet_address
 * - interaction.created_at
 * - interaction.id
 *
 * Usage in DuckDB:
 * ```sql
 * CREATE TABLE freq_features AS
 * SELECT * FROM read_parquet('afi_packets.parquet')
 * WHERE <paste query below>
 * ```
 */
export const FREQ_FEATURE_QUERY = `
WITH time_windows AS (
  SELECT
    CURRENT_TIMESTAMP AS analysis_time,
    CURRENT_TIMESTAMP - INTERVAL '7 days' AS window_7d,
    CURRENT_TIMESTAMP - INTERVAL '30 days' AS window_30d,
    CURRENT_TIMESTAMP - INTERVAL '90 days' AS window_90d
),
wallet_transactions AS (
  SELECT
    interaction.wallet_address,
    interaction.created_at::TIMESTAMP AS created_at,
    interaction.id,
    DATE_TRUNC('day', interaction.created_at::TIMESTAMP) AS tx_day,
    DATE_TRUNC('hour', interaction.created_at::TIMESTAMP) AS tx_hour
  FROM read_parquet('afi_packets.parquet')
  WHERE interaction.wallet_address IS NOT NULL
),
daily_counts AS (
  SELECT
    wallet_address,
    tx_day,
    COUNT(*) AS daily_tx_count
  FROM wallet_transactions
  GROUP BY wallet_address, tx_day
),
freq_metrics AS (
  SELECT
    wt.wallet_address,
    -- 7-day metrics
    COUNT(CASE WHEN wt.created_at >= tw.window_7d THEN 1 END) AS tx_count_7d,
    COUNT(DISTINCT CASE WHEN wt.created_at >= tw.window_7d THEN wt.tx_day END) AS days_active_7d,
    COUNT(CASE WHEN wt.created_at >= tw.window_7d THEN 1 END)::FLOAT / 7.0 AS avg_daily_tx_7d,
    MAX(CASE WHEN wt.created_at >= tw.window_7d THEN dc.daily_tx_count ELSE 0 END) AS max_daily_tx_7d,
    -- 30-day metrics
    COUNT(CASE WHEN wt.created_at >= tw.window_30d THEN 1 END) AS tx_count_30d,
    COUNT(DISTINCT CASE WHEN wt.created_at >= tw.window_30d THEN wt.tx_day END) AS days_active_30d,
    COUNT(CASE WHEN wt.created_at >= tw.window_30d THEN 1 END)::FLOAT / 30.0 AS avg_daily_tx_30d,
    MAX(CASE WHEN wt.created_at >= tw.window_30d THEN dc.daily_tx_count ELSE 0 END) AS max_daily_tx_30d,
    -- 90-day metrics
    COUNT(CASE WHEN wt.created_at >= tw.window_90d THEN 1 END) AS tx_count_90d,
    -- Coefficient of variation (30-day)
    STDDEV(CASE WHEN wt.created_at >= tw.window_30d THEN dc.daily_tx_count END) /
      NULLIF(AVG(CASE WHEN wt.created_at >= tw.window_30d THEN dc.daily_tx_count END), 0) AS tx_frequency_cv
  FROM wallet_transactions wt
  CROSS JOIN time_windows tw
  LEFT JOIN daily_counts dc ON wt.wallet_address = dc.wallet_address AND wt.tx_day = dc.tx_day
  GROUP BY wt.wallet_address
)
SELECT * FROM freq_metrics;
`;

/**
 * DuckDB query for counterparty breadth features (CP)
 *
 * Assumes Parquet schema with columns:
 * - interaction.wallet_address
 * - interaction.counterparty
 * - interaction.created_at
 */
export const CP_FEATURE_QUERY = `
WITH time_windows AS (
  SELECT
    CURRENT_TIMESTAMP AS analysis_time,
    CURRENT_TIMESTAMP - INTERVAL '7 days' AS window_7d,
    CURRENT_TIMESTAMP - INTERVAL '30 days' AS window_30d,
    CURRENT_TIMESTAMP - INTERVAL '90 days' AS window_90d
),
wallet_counterparties AS (
  SELECT
    interaction.wallet_address,
    interaction.counterparty,
    interaction.created_at::TIMESTAMP AS created_at
  FROM read_parquet('afi_packets.parquet')
  WHERE interaction.wallet_address IS NOT NULL
    AND interaction.counterparty IS NOT NULL
),
counterparty_counts_30d AS (
  SELECT
    wc.wallet_address,
    wc.counterparty,
    COUNT(*) AS interaction_count
  FROM wallet_counterparties wc
  CROSS JOIN time_windows tw
  WHERE wc.created_at >= tw.window_30d
  GROUP BY wc.wallet_address, wc.counterparty
),
cp_metrics AS (
  SELECT
    wc.wallet_address,
    -- Unique counterparties
    COUNT(DISTINCT CASE WHEN wc.created_at >= tw.window_7d THEN wc.counterparty END) AS unique_counterparties_7d,
    COUNT(DISTINCT CASE WHEN wc.created_at >= tw.window_30d THEN wc.counterparty END) AS unique_counterparties_30d,
    COUNT(DISTINCT CASE WHEN wc.created_at >= tw.window_90d THEN wc.counterparty END) AS unique_counterparties_90d,
    -- Top counterparty concentration (30-day)
    MAX(cc30.interaction_count)::FLOAT / NULLIF(SUM(cc30.interaction_count), 0) AS top_counterparty_share_30d,
    -- HHI (sum of squared market shares)
    SUM(POWER(cc30.interaction_count::FLOAT / NULLIF(SUM(cc30.interaction_count) OVER (PARTITION BY cc30.wallet_address), 0), 2)) AS counterparty_hhi_30d,
    -- Repeat vs new counterparties
    COUNT(CASE WHEN wc.created_at >= tw.window_30d THEN 1 END)::FLOAT /
      NULLIF(COUNT(DISTINCT CASE WHEN wc.created_at >= tw.window_30d THEN wc.counterparty END), 0) - 1 AS repeat_counterparty_rate_30d,
    COUNT(DISTINCT CASE
      WHEN wc.created_at >= tw.window_7d
        AND wc.counterparty NOT IN (
          SELECT counterparty FROM wallet_counterparties wc2
          WHERE wc2.wallet_address = wc.wallet_address
            AND wc2.created_at < tw.window_7d
        )
      THEN wc.counterparty
    END)::FLOAT / NULLIF(COUNT(DISTINCT CASE WHEN wc.created_at >= tw.window_7d THEN wc.counterparty END), 0) AS new_counterparty_rate_7d
  FROM wallet_counterparties wc
  CROSS JOIN time_windows tw
  LEFT JOIN counterparty_counts_30d cc30 ON wc.wallet_address = cc30.wallet_address AND wc.counterparty = cc30.counterparty
  GROUP BY wc.wallet_address
)
SELECT * FROM cp_metrics;
`;

/**
 * DuckDB query for average payment size features (APS)
 *
 * Assumes Parquet schema with columns:
 * - interaction.wallet_address
 * - interaction.amountUSD
 * - interaction.created_at
 */
export const APS_FEATURE_QUERY = `
WITH time_windows AS (
  SELECT
    CURRENT_TIMESTAMP AS analysis_time,
    CURRENT_TIMESTAMP - INTERVAL '7 days' AS window_7d,
    CURRENT_TIMESTAMP - INTERVAL '30 days' AS window_30d
),
wallet_payments AS (
  SELECT
    interaction.wallet_address,
    interaction.amountUSD,
    interaction.created_at::TIMESTAMP AS created_at
  FROM read_parquet('afi_packets.parquet')
  WHERE interaction.wallet_address IS NOT NULL
    AND interaction.amountUSD IS NOT NULL
    AND interaction.amountUSD > 0
),
percentiles_30d AS (
  SELECT
    wallet_address,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY amountUSD) AS p90_amount
  FROM wallet_payments wp
  CROSS JOIN time_windows tw
  WHERE wp.created_at >= tw.window_30d
  GROUP BY wallet_address
),
aps_metrics AS (
  SELECT
    wp.wallet_address,
    -- 7-day metrics
    AVG(CASE WHEN wp.created_at >= tw.window_7d THEN wp.amountUSD END) AS avg_payment_usd_7d,
    MEDIAN(CASE WHEN wp.created_at >= tw.window_7d THEN wp.amountUSD END) AS median_payment_usd_7d,
    MAX(CASE WHEN wp.created_at >= tw.window_7d THEN wp.amountUSD END) AS max_payment_usd_7d,
    MIN(CASE WHEN wp.created_at >= tw.window_7d THEN wp.amountUSD END) AS min_payment_usd_7d,
    SUM(CASE WHEN wp.created_at >= tw.window_7d THEN wp.amountUSD ELSE 0 END) AS total_volume_usd_7d,
    -- 30-day metrics
    AVG(CASE WHEN wp.created_at >= tw.window_30d THEN wp.amountUSD END) AS avg_payment_usd_30d,
    MEDIAN(CASE WHEN wp.created_at >= tw.window_30d THEN wp.amountUSD END) AS median_payment_usd_30d,
    MAX(CASE WHEN wp.created_at >= tw.window_30d THEN wp.amountUSD END) AS max_payment_usd_30d,
    MIN(CASE WHEN wp.created_at >= tw.window_30d THEN wp.amountUSD END) AS min_payment_usd_30d,
    SUM(CASE WHEN wp.created_at >= tw.window_30d THEN wp.amountUSD ELSE 0 END) AS total_volume_usd_30d,
    -- Coefficient of variation (30-day)
    STDDEV(CASE WHEN wp.created_at >= tw.window_30d THEN wp.amountUSD END) /
      NULLIF(AVG(CASE WHEN wp.created_at >= tw.window_30d THEN wp.amountUSD END), 0) AS payment_size_cv_30d,
    -- Large payment count (above 90th percentile)
    COUNT(CASE
      WHEN wp.created_at >= tw.window_30d
        AND wp.amountUSD >= p90.p90_amount
      THEN 1
    END) AS large_payment_count_30d
  FROM wallet_payments wp
  CROSS JOIN time_windows tw
  LEFT JOIN percentiles_30d p90 ON wp.wallet_address = p90.wallet_address
  GROUP BY wp.wallet_address
)
SELECT * FROM aps_metrics;
`;

/**
 * DuckDB query for settlement latency features (SLAT)
 *
 * Assumes Parquet schema with columns:
 * - interaction.wallet_address
 * - interaction.created_at
 * - correlations.settlement.status
 * - correlations.baseTransaction.created_at
 */
export const SLAT_FEATURE_QUERY = `
WITH time_windows AS (
  SELECT
    CURRENT_TIMESTAMP AS analysis_time,
    CURRENT_TIMESTAMP - INTERVAL '7 days' AS window_7d,
    CURRENT_TIMESTAMP - INTERVAL '30 days' AS window_30d
),
wallet_settlements AS (
  SELECT
    interaction.wallet_address,
    interaction.created_at::TIMESTAMP AS interaction_created_at,
    correlations.settlement.status AS settlement_status,
    correlations.baseTransaction.created_at::TIMESTAMP AS settlement_created_at,
    CASE
      WHEN correlations.settlement.status = 'confirmed'
        AND correlations.baseTransaction.created_at IS NOT NULL
      THEN EPOCH(correlations.baseTransaction.created_at::TIMESTAMP - interaction.created_at::TIMESTAMP)
      ELSE NULL
    END AS latency_seconds
  FROM read_parquet('afi_packets.parquet')
  WHERE interaction.wallet_address IS NOT NULL
),
slat_metrics AS (
  SELECT
    ws.wallet_address,
    -- 7-day latency metrics
    AVG(CASE WHEN ws.interaction_created_at >= tw.window_7d THEN ws.latency_seconds END) AS avg_latency_seconds_7d,
    MEDIAN(CASE WHEN ws.interaction_created_at >= tw.window_7d THEN ws.latency_seconds END) AS median_latency_seconds_7d,
    MAX(CASE WHEN ws.interaction_created_at >= tw.window_7d THEN ws.latency_seconds END) AS max_latency_seconds_7d,
    -- 30-day latency metrics
    AVG(CASE WHEN ws.interaction_created_at >= tw.window_30d THEN ws.latency_seconds END) AS avg_latency_seconds_30d,
    MEDIAN(CASE WHEN ws.interaction_created_at >= tw.window_30d THEN ws.latency_seconds END) AS median_latency_seconds_30d,
    MAX(CASE WHEN ws.interaction_created_at >= tw.window_30d THEN ws.latency_seconds END) AS max_latency_seconds_30d,
    -- Fast settlement rate (within 60 seconds)
    COUNT(CASE
      WHEN ws.interaction_created_at >= tw.window_30d
        AND ws.latency_seconds IS NOT NULL
        AND ws.latency_seconds <= 60
      THEN 1
    END)::FLOAT / NULLIF(COUNT(CASE WHEN ws.interaction_created_at >= tw.window_30d AND ws.latency_seconds IS NOT NULL THEN 1 END), 0) AS fast_settlement_rate_30d,
    -- Settlement status metrics
    COUNT(CASE
      WHEN ws.interaction_created_at >= tw.window_30d
        AND ws.settlement_status = 'failed'
      THEN 1
    END)::FLOAT / NULLIF(COUNT(CASE WHEN ws.interaction_created_at >= tw.window_30d AND ws.settlement_status IS NOT NULL THEN 1 END), 0) AS settlement_failure_rate_30d,
    COUNT(CASE
      WHEN ws.interaction_created_at >= tw.window_30d
        AND ws.settlement_status = 'confirmed'
      THEN 1
    END) AS confirmed_settlements_30d
  FROM wallet_settlements ws
  CROSS JOIN time_windows tw
  GROUP BY ws.wallet_address
)
SELECT * FROM slat_metrics;
`;

/**
 * DuckDB query for burstiness features
 *
 * Assumes Parquet schema with columns:
 * - interaction.wallet_address
 * - interaction.created_at
 */
export const BURST_FEATURE_QUERY = `
WITH time_windows AS (
  SELECT
    CURRENT_TIMESTAMP AS analysis_time,
    CURRENT_TIMESTAMP - INTERVAL '24 hours' AS window_24h,
    CURRENT_TIMESTAMP - INTERVAL '7 days' AS window_7d
),
wallet_transactions AS (
  SELECT
    interaction.wallet_address,
    interaction.created_at::TIMESTAMP AS created_at,
    DATE_TRUNC('hour', interaction.created_at::TIMESTAMP) AS tx_hour
  FROM read_parquet('afi_packets.parquet')
  WHERE interaction.wallet_address IS NOT NULL
),
hourly_counts AS (
  SELECT
    wallet_address,
    tx_hour,
    COUNT(*) AS hourly_tx_count
  FROM wallet_transactions
  GROUP BY wallet_address, tx_hour
),
inter_tx_times AS (
  SELECT
    wallet_address,
    created_at,
    EPOCH(created_at - LAG(created_at) OVER (PARTITION BY wallet_address ORDER BY created_at)) AS inter_tx_seconds
  FROM wallet_transactions
),
burst_metrics AS (
  SELECT
    wt.wallet_address,
    -- 24-hour burst metrics
    MAX(CASE WHEN wt.created_at >= tw.window_24h THEN hc.hourly_tx_count ELSE 0 END) AS max_hourly_tx_24h,
    MAX(CASE WHEN wt.created_at >= tw.window_24h THEN hc.hourly_tx_count ELSE 0 END)::FLOAT /
      NULLIF(AVG(CASE WHEN wt.created_at >= tw.window_24h THEN hc.hourly_tx_count END), 0) AS hourly_burst_ratio_24h,
    STDDEV(CASE WHEN wt.created_at >= tw.window_24h THEN hc.hourly_tx_count END) /
      NULLIF(AVG(CASE WHEN wt.created_at >= tw.window_24h THEN hc.hourly_tx_count END), 0) AS hourly_tx_cv_24h,
    -- Idle hours in last 7 days
    (7 * 24) - COUNT(DISTINCT CASE WHEN wt.created_at >= tw.window_7d THEN wt.tx_hour END) AS idle_hours_7d,
    -- Inter-transaction time variability
    STDDEV(CASE WHEN itt.created_at >= tw.window_7d THEN itt.inter_tx_seconds END) AS inter_tx_time_std_7d
  FROM wallet_transactions wt
  CROSS JOIN time_windows tw
  LEFT JOIN hourly_counts hc ON wt.wallet_address = hc.wallet_address AND wt.tx_hour = hc.tx_hour
  LEFT JOIN inter_tx_times itt ON wt.wallet_address = itt.wallet_address AND wt.created_at = itt.created_at
  GROUP BY wt.wallet_address
)
SELECT * FROM burst_metrics;
`;

/**
 * Combined feature extraction query
 * Joins all feature sets for a complete feature vector
 */
export const COMBINED_FEATURE_QUERY = `
WITH freq AS (${FREQ_FEATURE_QUERY}),
     cp AS (${CP_FEATURE_QUERY}),
     aps AS (${APS_FEATURE_QUERY}),
     slat AS (${SLAT_FEATURE_QUERY}),
     burst AS (${BURST_FEATURE_QUERY})
SELECT
  COALESCE(freq.wallet_address, cp.wallet_address, aps.wallet_address, slat.wallet_address, burst.wallet_address) AS wallet_address,
  CURRENT_TIMESTAMP AS computed_at,
  30 AS observation_window_days,
  -- FREQ features
  COALESCE(freq.tx_count_7d, 0) AS tx_count_7d,
  COALESCE(freq.tx_count_30d, 0) AS tx_count_30d,
  COALESCE(freq.tx_count_90d, 0) AS tx_count_90d,
  COALESCE(freq.avg_daily_tx_7d, 0) AS avg_daily_tx_7d,
  COALESCE(freq.avg_daily_tx_30d, 0) AS avg_daily_tx_30d,
  COALESCE(freq.max_daily_tx_7d, 0) AS max_daily_tx_7d,
  COALESCE(freq.max_daily_tx_30d, 0) AS max_daily_tx_30d,
  COALESCE(freq.days_active_7d, 0) AS days_active_7d,
  COALESCE(freq.days_active_30d, 0) AS days_active_30d,
  COALESCE(freq.tx_frequency_cv, 0) AS tx_frequency_cv,
  -- CP features
  COALESCE(cp.unique_counterparties_7d, 0) AS unique_counterparties_7d,
  COALESCE(cp.unique_counterparties_30d, 0) AS unique_counterparties_30d,
  COALESCE(cp.unique_counterparties_90d, 0) AS unique_counterparties_90d,
  COALESCE(cp.top_counterparty_share_30d, 0) AS top_counterparty_share_30d,
  COALESCE(cp.counterparty_hhi_30d, 0) AS counterparty_hhi_30d,
  COALESCE(cp.repeat_counterparty_rate_30d, 0) AS repeat_counterparty_rate_30d,
  COALESCE(cp.new_counterparty_rate_7d, 0) AS new_counterparty_rate_7d,
  -- APS features
  COALESCE(aps.avg_payment_usd_7d, 0) AS avg_payment_usd_7d,
  COALESCE(aps.avg_payment_usd_30d, 0) AS avg_payment_usd_30d,
  COALESCE(aps.median_payment_usd_7d, 0) AS median_payment_usd_7d,
  COALESCE(aps.median_payment_usd_30d, 0) AS median_payment_usd_30d,
  COALESCE(aps.max_payment_usd_7d, 0) AS max_payment_usd_7d,
  COALESCE(aps.max_payment_usd_30d, 0) AS max_payment_usd_30d,
  COALESCE(aps.min_payment_usd_7d, 0) AS min_payment_usd_7d,
  COALESCE(aps.min_payment_usd_30d, 0) AS min_payment_usd_30d,
  COALESCE(aps.total_volume_usd_7d, 0) AS total_volume_usd_7d,
  COALESCE(aps.total_volume_usd_30d, 0) AS total_volume_usd_30d,
  COALESCE(aps.payment_size_cv_30d, 0) AS payment_size_cv_30d,
  COALESCE(aps.large_payment_count_30d, 0) AS large_payment_count_30d,
  -- SLAT features
  COALESCE(slat.avg_latency_seconds_7d, 0) AS avg_latency_seconds_7d,
  COALESCE(slat.avg_latency_seconds_30d, 0) AS avg_latency_seconds_30d,
  COALESCE(slat.median_latency_seconds_7d, 0) AS median_latency_seconds_7d,
  COALESCE(slat.median_latency_seconds_30d, 0) AS median_latency_seconds_30d,
  COALESCE(slat.max_latency_seconds_7d, 0) AS max_latency_seconds_7d,
  COALESCE(slat.max_latency_seconds_30d, 0) AS max_latency_seconds_30d,
  COALESCE(slat.fast_settlement_rate_30d, 0) AS fast_settlement_rate_30d,
  COALESCE(slat.settlement_failure_rate_30d, 0) AS settlement_failure_rate_30d,
  COALESCE(slat.confirmed_settlements_30d, 0) AS confirmed_settlements_30d,
  -- BURST features
  COALESCE(burst.max_hourly_tx_24h, 0) AS max_hourly_tx_24h,
  COALESCE(burst.hourly_burst_ratio_24h, 0) AS hourly_burst_ratio_24h,
  COALESCE(burst.hourly_tx_cv_24h, 0) AS hourly_tx_cv_24h,
  COALESCE(burst.idle_hours_7d, 0) AS idle_hours_7d,
  COALESCE(burst.inter_tx_time_std_7d, 0) AS inter_tx_time_std_7d
FROM freq
FULL OUTER JOIN cp ON freq.wallet_address = cp.wallet_address
FULL OUTER JOIN aps ON COALESCE(freq.wallet_address, cp.wallet_address) = aps.wallet_address
FULL OUTER JOIN slat ON COALESCE(freq.wallet_address, cp.wallet_address, aps.wallet_address) = slat.wallet_address
FULL OUTER JOIN burst ON COALESCE(freq.wallet_address, cp.wallet_address, aps.wallet_address, slat.wallet_address) = burst.wallet_address;
`;

// ============================================================================
// ML MODEL INTERFACES
// ============================================================================

/**
 * Anomaly detection result
 */
export interface AnomalyDetectionResult {
  wallet_address: string;
  anomaly_score: number;
  is_anomaly: boolean;
  contributing_features: string[];
  timestamp: string;
}

/**
 * Clustering result
 */
export interface ClusteringResult {
  wallet_address: string;
  cluster_id: number;
  cluster_label: string;
  distance_to_centroid: number;
  timestamp: string;
}

/**
 * Model metadata
 */
export interface ModelMetadata {
  model_type: "isolation_forest" | "kmeans" | "other";
  version: string;
  trained_at: string;
  training_samples: number;
  hyperparameters: Record<string, unknown>;
}

// ============================================================================
// ML MODEL STUBS (REQUIRE PYTHON/SCIKIT-LEARN IMPLEMENTATION)
// ============================================================================

/**
 * Anomaly Detection Model (IsolationForest)
 *
 * STUB IMPLEMENTATION - Requires Python/scikit-learn
 *
 * Python implementation would use:
 * ```python
 * from sklearn.ensemble import IsolationForest
 * from sklearn.preprocessing import StandardScaler
 * import pandas as pd
 * import pyarrow.parquet as pq
 *
 * # Load features
 * features_df = pd.read_parquet('wallet_features.parquet')
 *
 * # Select feature columns
 * feature_cols = [col for col in features_df.columns if col not in ['wallet_address', 'computed_at', 'observation_window_days']]
 * X = features_df[feature_cols]
 *
 * # Standardize features
 * scaler = StandardScaler()
 * X_scaled = scaler.fit_transform(X)
 *
 * # Train IsolationForest
 * model = IsolationForest(
 *     contamination=0.1,      # Expected proportion of anomalies
 *     n_estimators=100,       # Number of trees
 *     max_samples='auto',     # Samples per tree
 *     random_state=42
 * )
 * model.fit(X_scaled)
 *
 * # Predict anomalies
 * predictions = model.predict(X_scaled)  # -1 for anomalies, 1 for normal
 * scores = model.decision_function(X_scaled)  # Anomaly scores
 *
 * # Save results
 * results_df = pd.DataFrame({
 *     'wallet_address': features_df['wallet_address'],
 *     'anomaly_score': scores,
 *     'is_anomaly': predictions == -1,
 *     'timestamp': pd.Timestamp.now().isoformat()
 * })
 * results_df.to_parquet('anomaly_results.parquet')
 * ```
 */
export class AnomalyDetectionModel {
  private metadata: ModelMetadata | null = null;

  /**
   * Load trained model from file
   * In Python: pickle.load() or joblib.load()
   */
  async load(modelPath: string): Promise<void> {
    // STUB: In production, this would load a serialized scikit-learn model
    // via a Python bridge (e.g., using child_process to call Python script)
    throw new Error(
      "AnomalyDetectionModel.load() requires Python implementation. " +
        "Use scikit-learn IsolationForest with pickle/joblib serialization."
    );
  }

  /**
   * Train new model on features
   * In Python: IsolationForest.fit()
   */
  async train(features: WalletFeatureVector[], options?: { contamination?: number }): Promise<void> {
    // STUB: In production, this would:
    // 1. Export features to Parquet
    // 2. Call Python script to train IsolationForest
    // 3. Serialize model with pickle/joblib
    throw new Error(
      "AnomalyDetectionModel.train() requires Python implementation. " +
        "Use scikit-learn IsolationForest with StandardScaler preprocessing."
    );
  }

  /**
   * Predict anomalies for wallet features
   * In Python: IsolationForest.predict() and decision_function()
   */
  async predict(features: WalletFeatureVector[]): Promise<AnomalyDetectionResult[]> {
    // STUB: In production, this would:
    // 1. Export features to Parquet
    // 2. Call Python script to run model.predict()
    // 3. Load results from Parquet
    throw new Error(
      "AnomalyDetectionModel.predict() requires Python implementation. " +
        "Use scikit-learn IsolationForest.predict() and decision_function()."
    );
  }

  /**
   * Get model metadata
   */
  getMetadata(): ModelMetadata | null {
    return this.metadata;
  }
}

/**
 * Clustering Model (KMeans)
 *
 * STUB IMPLEMENTATION - Requires Python/scikit-learn
 *
 * Python implementation would use:
 * ```python
 * from sklearn.cluster import KMeans
 * from sklearn.preprocessing import StandardScaler
 * from sklearn.metrics import silhouette_score
 * import pandas as pd
 * import numpy as np
 *
 * # Load features
 * features_df = pd.read_parquet('wallet_features.parquet')
 *
 * # Select feature columns
 * feature_cols = [col for col in features_df.columns if col not in ['wallet_address', 'computed_at', 'observation_window_days']]
 * X = features_df[feature_cols]
 *
 * # Standardize features
 * scaler = StandardScaler()
 * X_scaled = scaler.fit_transform(X)
 *
 * # Determine optimal k using elbow method or silhouette score
 * silhouette_scores = []
 * K_range = range(2, 11)
 * for k in K_range:
 *     kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
 *     labels = kmeans.fit_predict(X_scaled)
 *     score = silhouette_score(X_scaled, labels)
 *     silhouette_scores.append(score)
 *
 * # Train KMeans with optimal k
 * optimal_k = K_range[np.argmax(silhouette_scores)]
 * model = KMeans(n_clusters=optimal_k, random_state=42, n_init=10)
 * model.fit(X_scaled)
 *
 * # Predict clusters
 * labels = model.predict(X_scaled)
 * distances = model.transform(X_scaled).min(axis=1)
 *
 * # Define cluster labels based on dominant characteristics
 * cluster_labels = {
 *     0: "high_frequency_trader",
 *     1: "occasional_user",
 *     2: "high_value_merchant",
 *     # ... etc
 * }
 *
 * # Save results
 * results_df = pd.DataFrame({
 *     'wallet_address': features_df['wallet_address'],
 *     'cluster_id': labels,
 *     'cluster_label': [cluster_labels.get(label, 'unknown') for label in labels],
 *     'distance_to_centroid': distances,
 *     'timestamp': pd.Timestamp.now().isoformat()
 * })
 * results_df.to_parquet('clustering_results.parquet')
 * ```
 */
export class ClusteringModel {
  private metadata: ModelMetadata | null = null;

  /**
   * Load trained model from file
   * In Python: pickle.load() or joblib.load()
   */
  async load(modelPath: string): Promise<void> {
    // STUB: In production, this would load a serialized scikit-learn model
    throw new Error(
      "ClusteringModel.load() requires Python implementation. " +
        "Use scikit-learn KMeans with pickle/joblib serialization."
    );
  }

  /**
   * Train new model on features
   * In Python: KMeans.fit()
   */
  async train(features: WalletFeatureVector[], options?: { n_clusters?: number }): Promise<void> {
    // STUB: In production, this would:
    // 1. Export features to Parquet
    // 2. Call Python script to train KMeans
    // 3. Serialize model with pickle/joblib
    throw new Error(
      "ClusteringModel.train() requires Python implementation. " +
        "Use scikit-learn KMeans with StandardScaler preprocessing and silhouette_score for optimal k."
    );
  }

  /**
   * Predict cluster assignments for wallet features
   * In Python: KMeans.predict() and transform()
   */
  async predict(features: WalletFeatureVector[]): Promise<ClusteringResult[]> {
    // STUB: In production, this would:
    // 1. Export features to Parquet
    // 2. Call Python script to run model.predict()
    // 3. Load results from Parquet
    throw new Error(
      "ClusteringModel.predict() requires Python implementation. " +
        "Use scikit-learn KMeans.predict() and transform() for distances."
    );
  }

  /**
   * Get model metadata
   */
  getMetadata(): ModelMetadata | null {
    return this.metadata;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract feature vector from interaction record
 * (Simplified version - full features come from DuckDB queries)
 */
export function extractBasicFeatures(interaction: InteractionRecord): Partial<WalletFeatureVector> {
  // This is a simplified version. Full feature extraction requires
  // running DuckDB queries on the Parquet export.
  return {
    wallet_address: interaction.wallet_address ?? "unknown",
    computed_at: new Date().toISOString(),
    observation_window_days: 30,
  };
}

/**
 * Validate feature vector completeness
 */
export function validateFeatureVector(features: Partial<WalletFeatureVector>): features is WalletFeatureVector {
  const requiredFields: (keyof WalletFeatureVector)[] = [
    "wallet_address",
    "tx_count_7d",
    "tx_count_30d",
    "unique_counterparties_7d",
    "avg_payment_usd_7d",
    "avg_latency_seconds_7d",
    "computed_at",
  ];

  return requiredFields.every((field) => field in features && features[field] !== undefined);
}

/**
 * Export feature queries to SQL file for DuckDB execution
 */
export function exportFeatureQueriesToSQL(): string {
  return `
-- AFI Feature Extraction Queries
-- Generated from server/models.ts
-- Execute in DuckDB after Parquet export

-- 1. Transaction Frequency Features (FREQ)
CREATE OR REPLACE TABLE freq_features AS
${FREQ_FEATURE_QUERY}

-- 2. Counterparty Breadth Features (CP)
CREATE OR REPLACE TABLE cp_features AS
${CP_FEATURE_QUERY}

-- 3. Average Payment Size Features (APS)
CREATE OR REPLACE TABLE aps_features AS
${APS_FEATURE_QUERY}

-- 4. Settlement Latency Features (SLAT)
CREATE OR REPLACE TABLE slat_features AS
${SLAT_FEATURE_QUERY}

-- 5. Burstiness Features (BURST)
CREATE OR REPLACE TABLE burst_features AS
${BURST_FEATURE_QUERY}

-- 6. Combined Feature Vector
CREATE OR REPLACE TABLE wallet_features AS
${COMBINED_FEATURE_QUERY}

-- Export combined features to Parquet for ML training
COPY wallet_features TO 'wallet_features.parquet' (FORMAT PARQUET);
`.trim();
}
