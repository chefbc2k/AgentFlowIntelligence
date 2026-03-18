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

import { computeAgentMetrics } from "./metrics";
import type {
  BehaviorContribution,
  BehaviorFeatureHighlights,
  BehaviorFlag,
  BehaviorFlagKey,
  BehaviorFlagSeverity,
  InteractionRecord,
  WalletBehaviorModel,
} from "./types";
import type { Store } from "./store";

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

/**
 * Runtime contract for Python-backed model implementations.
 *
 * The TypeScript layer intentionally exposes the absence of a native ML runtime
 * instead of pretending the model methods are available locally.
 */
export const PYTHON_MODEL_RUNTIME = Object.freeze({
  runtime: "python",
  library: "scikit-learn",
  serializers: ["pickle", "joblib"] as const,
} as const);

export type PythonModelRuntime = typeof PYTHON_MODEL_RUNTIME;

export type PythonModelName = "AnomalyDetectionModel" | "ClusteringModel";
export type PythonModelOperation = "load" | "train" | "predict";

export interface PythonModelRequirement {
  model: PythonModelName;
  operation: PythonModelOperation;
  runtime: PythonModelRuntime;
  message: string;
}

export class PythonModelImplementationRequiredError extends Error {
  readonly requirement: PythonModelRequirement;

  constructor(requirement: PythonModelRequirement) {
    super(`${requirement.model}.${requirement.operation} is only available in the ${requirement.runtime.runtime} runtime.`);
    this.name = "PythonModelImplementationRequiredError";
    this.requirement = requirement;
  }
}

function raisePythonModelImplementationRequiredError(
  model: PythonModelName,
  operation: PythonModelOperation,
  message: string,
): never {
  throw new PythonModelImplementationRequiredError({
    model,
    operation,
    runtime: PYTHON_MODEL_RUNTIME,
    message,
  });
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
  async load(_modelPath: string): Promise<void> {
    raisePythonModelImplementationRequiredError(
      "AnomalyDetectionModel",
      "load",
      "Use scikit-learn IsolationForest with pickle/joblib serialization.",
    );
  }

  /**
   * Train new model on features
   * In Python: IsolationForest.fit()
   */
  async train(_features: WalletFeatureVector[], _options?: { contamination?: number }): Promise<void> {
    raisePythonModelImplementationRequiredError(
      "AnomalyDetectionModel",
      "train",
      "Use scikit-learn IsolationForest with StandardScaler preprocessing.",
    );
  }

  /**
   * Predict anomalies for wallet features
   * In Python: IsolationForest.predict() and decision_function()
   */
  async predict(_features: WalletFeatureVector[]): Promise<AnomalyDetectionResult[]> {
    raisePythonModelImplementationRequiredError(
      "AnomalyDetectionModel",
      "predict",
      "Use scikit-learn IsolationForest.predict() and decision_function().",
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
  async load(_modelPath: string): Promise<void> {
    raisePythonModelImplementationRequiredError(
      "ClusteringModel",
      "load",
      "Use scikit-learn KMeans with pickle/joblib serialization.",
    );
  }

  /**
   * Train new model on features
   * In Python: KMeans.fit()
   */
  async train(_features: WalletFeatureVector[], _options?: { n_clusters?: number }): Promise<void> {
    raisePythonModelImplementationRequiredError(
      "ClusteringModel",
      "train",
      "Use scikit-learn KMeans with StandardScaler preprocessing and silhouette_score for optimal k.",
    );
  }

  /**
   * Predict cluster assignments for wallet features
   * In Python: KMeans.predict() and transform()
   */
  async predict(_features: WalletFeatureVector[]): Promise<ClusteringResult[]> {
    raisePythonModelImplementationRequiredError(
      "ClusteringModel",
      "predict",
      "Use scikit-learn KMeans.predict() and transform() for distances.",
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
// RUNTIME HEURISTIC MODEL
// ============================================================================

const BEHAVIOR_MODEL_VERSION = "afi-heuristic/v1";

type WindowedInteraction = {
  createdAt: number;
  counterparty?: string;
  amountUsd: number | null;
  receiptCount: number;
  hasControlViolation: boolean;
  settlementStatus?: string;
  settlementLatencySeconds: number | null;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseTimestamp(value: string) {
  return Date.parse(value);
}

function daysToMs(days: number) {
  return days * 24 * 60 * 60 * 1000;
}

function normalizeAbove(value: number, floor: number, ceiling: number) {
  if (value <= floor) return 0;
  return clamp((value - floor) / (ceiling - floor));
}

function normalizeBelow(value: number, floor: number, ceiling: number) {
  if (value >= ceiling) return 0;
  return clamp((ceiling - value) / (ceiling - floor));
}

function toSeverity(impact: number): BehaviorFlagSeverity {
  if (impact >= 0.12) return "high";
  if (impact >= 0.06) return "medium";
  return "low";
}

function createBehaviorFlag(
  key: BehaviorFlagKey,
  label: string,
  value: number,
  threshold: number,
  direction: "above" | "below",
  explanation: string,
  impact: number,
): BehaviorFlag {
  return {
    key,
    label,
    severity: toSeverity(impact),
    value: round(value),
    threshold,
    direction,
    explanation,
  };
}

function buildWindowedInteractions(store: Store, wallet: string, now: number): WindowedInteraction[] {
  return store.listInteractionsByWallet(wallet).map((interaction) => {
    const createdAt = parseTimestamp(interaction.created_at);
    const walletSnapshot = store.getWalletSnapshot(interaction.id);
    const controls = deriveRuntimeControls(interaction, walletSnapshot);
    const settlement = store.getSettlement(interaction.id);
    const baseTx = settlement?.tx_hash ? store.getBaseTransaction(settlement.tx_hash) : undefined;
    const amountUsd = getInteractionAmountUsd(store, interaction);
    const settlementLatencySeconds =
      settlement?.status === "confirmed" && baseTx
        ? Math.max(0, (parseTimestamp(baseTx.created_at) - createdAt) / 1000)
        : null;

    return {
      createdAt: Number.isFinite(createdAt) ? createdAt : now,
      counterparty: interaction.counterparty,
      amountUsd,
      receiptCount: store.listReceiptsByInteraction(interaction.id).length,
      hasControlViolation: controls.withinAllowance === false || controls.withinMaxTx === false,
      settlementStatus: settlement?.status,
      settlementLatencySeconds:
        settlementLatencySeconds !== null && Number.isFinite(settlementLatencySeconds) ? settlementLatencySeconds : null,
    };
  });
}

function getInteractionAmountUsd(store: Store, interaction: InteractionRecord): number | null {
  const paymentRequired = (interaction.summary?.paymentRequired ?? null) as
    | { amount?: unknown; asset?: unknown; network?: unknown }
    | null;

  if (!paymentRequired || typeof paymentRequired.amount !== "string" || typeof paymentRequired.asset !== "string") {
    return null;
  }

  const amount = Number(paymentRequired.amount);
  const chainId = Number(paymentRequired.network);
  if (!Number.isFinite(amount) || !Number.isFinite(chainId)) {
    return null;
  }

  const price = store.getLatestPrice(paymentRequired.asset, chainId);
  const priceUsd = Number(price?.price_usd);
  return Number.isFinite(priceUsd) ? amount * priceUsd : null;
}

function deriveRuntimeControls(
  interaction: InteractionRecord,
  walletSnapshot: { allowance?: string; max_tx?: string; approvals_required?: boolean } | undefined,
) {
  const paymentRequired = (interaction.summary?.paymentRequired ?? null) as { amount?: unknown } | null;
  const amount = paymentRequired && typeof paymentRequired.amount === "string" ? Number(paymentRequired.amount) : null;
  const allowance = walletSnapshot?.allowance ? Number(walletSnapshot.allowance) : null;
  const maxTx = walletSnapshot?.max_tx ? Number(walletSnapshot.max_tx) : null;

  return {
    withinAllowance: amount !== null && allowance !== null && Number.isFinite(amount) && Number.isFinite(allowance) ? amount <= allowance : null,
    withinMaxTx: amount !== null && maxTx !== null && Number.isFinite(amount) && Number.isFinite(maxTx) ? amount <= maxTx : null,
  };
}

function getAnalysisNow(interactions: InteractionRecord[]) {
  const latest = interactions.reduce((max, interaction) => {
    const timestamp = parseTimestamp(interaction.created_at);
    return Number.isFinite(timestamp) ? Math.max(max, timestamp) : max;
  }, 0);

  return latest || Date.now();
}

function filterByWindow(rows: WindowedInteraction[], now: number, days: number) {
  const cutoff = now - daysToMs(days);
  return rows.filter((row) => row.createdAt >= cutoff);
}

function calculateTopCounterpartyShare(rows: WindowedInteraction[]) {
  if (rows.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const counterparty = row.counterparty ?? "unknown";
    counts.set(counterparty, (counts.get(counterparty) ?? 0) + 1);
  }
  const topCount = Math.max(...counts.values());
  return topCount / rows.length;
}

function calculateNewCounterpartyRate(rows7d: WindowedInteraction[], priorRows: WindowedInteraction[]) {
  const current = new Set(rows7d.map((row) => row.counterparty).filter((value): value is string => Boolean(value)));
  if (current.size === 0) return 0;
  const prior = new Set(priorRows.map((row) => row.counterparty).filter((value): value is string => Boolean(value)));
  let newCount = 0;
  for (const counterparty of current) {
    if (!prior.has(counterparty)) {
      newCount += 1;
    }
  }
  return newCount / current.size;
}

function calculateHourlyBurstRatio(rows24h: WindowedInteraction[]) {
  if (rows24h.length < 3) return 0;
  const hourlyCounts = new Map<string, number>();
  for (const row of rows24h) {
    const bucket = new Date(row.createdAt).toISOString().slice(0, 13);
    hourlyCounts.set(bucket, (hourlyCounts.get(bucket) ?? 0) + 1);
  }
  const counts = Array.from(hourlyCounts.values());
  const maxCount = Math.max(...counts);
  const average = rows24h.length / 24;
  return maxCount / average;
}

function calculatePaymentStats(rows30d: WindowedInteraction[]) {
  const amounts = rows30d.map((row) => row.amountUsd).filter((value): value is number => value !== null && Number.isFinite(value));
  if (amounts.length === 0) {
    return { totalVolumeUsd30d: 0, avgPaymentUsd30d: 0, paymentSizeCv30d: 0 };
  }
  const total = amounts.reduce((sum, value) => sum + value, 0);
  const average = total / amounts.length;
  const variance = amounts.reduce((sum, value) => sum + (value - average) ** 2, 0) / amounts.length;
  const stdDev = Math.sqrt(variance);
  return {
    totalVolumeUsd30d: total,
    avgPaymentUsd30d: average,
    paymentSizeCv30d: average > 0 ? stdDev / average : 0,
  };
}

function calculateSettlementStats(rows30d: WindowedInteraction[]) {
  const settled = rows30d.filter((row) => row.settlementStatus !== undefined);
  const failures = settled.filter((row) => row.settlementStatus === "failed").length;
  const latencies = settled
    .map((row) => row.settlementLatencySeconds)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  return {
    settlementFailureRate30d: settled.length > 0 ? failures / settled.length : 0,
    avgLatencySeconds30d: latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
  };
}

function calculateFeatureHighlights(store: Store, wallet: string, now: number): BehaviorFeatureHighlights {
  const rows = buildWindowedInteractions(store, wallet, now);
  const rows7d = filterByWindow(rows, now, 7);
  const rows30d = filterByWindow(rows, now, 30);
  const priorRows = rows.filter((row) => row.createdAt < now - daysToMs(7));
  const paymentStats = calculatePaymentStats(rows30d);
  const settlementStats = calculateSettlementStats(rows30d);
  const agentMetrics = computeAgentMetrics(store, wallet);

  return {
    txCount7d: rows7d.length,
    txCount30d: rows30d.length,
    uniqueCounterparties30d: new Set(rows30d.map((row) => row.counterparty).filter((value): value is string => Boolean(value))).size,
    topCounterpartyShare30d: calculateTopCounterpartyShare(rows30d),
    totalVolumeUsd30d: paymentStats.totalVolumeUsd30d,
    avgPaymentUsd30d: paymentStats.avgPaymentUsd30d,
    paymentSizeCv30d: paymentStats.paymentSizeCv30d,
    avgLatencySeconds30d: settlementStats.avgLatencySeconds30d,
    settlementFailureRate30d: settlementStats.settlementFailureRate30d,
    hourlyBurstRatio24h: calculateHourlyBurstRatio(filterByWindow(rows, now, 1)),
    newCounterpartyRate7d: calculateNewCounterpartyRate(rows7d, priorRows),
    evidenceDensity: agentMetrics.evidenceDensity,
    controlFailureRate: agentMetrics.controls.overall.total > 0 ? 1 - agentMetrics.controls.overall.rate : 0,
  };
}

function buildContributors(features: BehaviorFeatureHighlights, agentMetrics: ReturnType<typeof computeAgentMetrics>): BehaviorContribution[] {
  if (agentMetrics.throughput.totalInteractions === 0) {
    return [];
  }

  const weighted = [
    {
      key: "burstiness" as const,
      label: "Burstiness",
      value: agentMetrics.throughput.burstiness,
      impact: normalizeAbove(agentMetrics.throughput.burstiness, 0.75, 2.5) * 0.18,
      explanation: `Daily activity burstiness is ${agentMetrics.throughput.burstiness.toFixed(2)}.`,
    },
    {
      key: "counterparty_concentration" as const,
      label: "Counterparty concentration",
      value: features.topCounterpartyShare30d,
      impact: normalizeAbove(features.topCounterpartyShare30d, 0.45, 0.9) * 0.18,
      explanation: `Top counterparty share is ${(features.topCounterpartyShare30d * 100).toFixed(0)}%.`,
    },
    {
      key: "settlement_failure_rate" as const,
      label: "Settlement failure rate",
      value: features.settlementFailureRate30d,
      impact: normalizeAbove(features.settlementFailureRate30d, 0.1, 0.6) * 0.18,
      explanation: `Settlement failure rate is ${(features.settlementFailureRate30d * 100).toFixed(0)}%.`,
    },
    {
      key: "control_friction" as const,
      label: "Control friction",
      value: features.controlFailureRate,
      impact: normalizeAbove(features.controlFailureRate, 0.1, 0.7) * 0.14,
      explanation: `Control failure rate is ${(features.controlFailureRate * 100).toFixed(0)}%.`,
    },
    {
      key: "evidence_density" as const,
      label: "Evidence density",
      value: features.evidenceDensity,
      impact: normalizeBelow(features.evidenceDensity, 0.75, 2.5) * 0.1,
      explanation: `Evidence density is ${features.evidenceDensity.toFixed(2)} artifacts per interaction.`,
    },
    {
      key: "settlement_latency" as const,
      label: "Settlement latency",
      value: features.avgLatencySeconds30d,
      impact: normalizeAbove(features.avgLatencySeconds30d, 60, 600) * 0.1,
      explanation: `Average confirmed settlement latency is ${features.avgLatencySeconds30d.toFixed(0)} seconds.`,
    },
    {
      key: "payment_volatility" as const,
      label: "Payment volatility",
      value: features.paymentSizeCv30d,
      impact: normalizeAbove(features.paymentSizeCv30d, 0.5, 2) * 0.06,
      explanation: `Payment size CV is ${features.paymentSizeCv30d.toFixed(2)}.`,
    },
    {
      key: "new_counterparty_rate" as const,
      label: "New counterparty surge",
      value: features.newCounterpartyRate7d,
      impact: normalizeAbove(features.newCounterpartyRate7d, 0.4, 1) * 0.06,
      explanation: `New counterparty rate over 7d is ${(features.newCounterpartyRate7d * 100).toFixed(0)}%.`,
    },
  ];

  return weighted
    .filter((entry) => entry.impact > 0)
    .sort((left, right) => right.impact - left.impact)
    .map((entry) => ({
      ...entry,
      value: round(entry.value),
      impact: round(entry.impact),
    }));
}

function buildFlags(
  features: BehaviorFeatureHighlights,
  agentMetrics: ReturnType<typeof computeAgentMetrics>,
  contributors: BehaviorContribution[],
): BehaviorFlag[] {
  const flags: BehaviorFlag[] = [];
  const byKey = new Map(contributors.map((contributor) => [contributor.key, contributor]));

  const concentration = byKey.get("counterparty_concentration");
  const concentrationImpact = concentration?.impact ?? round(normalizeAbove(features.topCounterpartyShare30d, 0.65, 0.95) * 0.18);
  if (features.topCounterpartyShare30d >= 0.65) {
    flags.push(
      createBehaviorFlag(
        "high_counterparty_concentration",
        "High counterparty concentration",
        features.topCounterpartyShare30d,
        0.65,
        "above",
        `Top counterparty share is ${(features.topCounterpartyShare30d * 100).toFixed(0)}%.`,
        concentrationImpact,
      ),
    );
  }

  const volatility = byKey.get("payment_volatility");
  const volatilityImpact = volatility?.impact ?? round(normalizeAbove(features.paymentSizeCv30d, 1, 2.5) * 0.06);
  if (features.paymentSizeCv30d >= 1) {
    flags.push(
      createBehaviorFlag(
        "high_payment_volatility",
        "High payment volatility",
        features.paymentSizeCv30d,
        1,
        "above",
        `Payment size CV is ${features.paymentSizeCv30d.toFixed(2)}.`,
        volatilityImpact,
      ),
    );
  }

  const latency = byKey.get("settlement_latency");
  const latencyImpact = latency?.impact ?? round(normalizeAbove(features.avgLatencySeconds30d, 120, 900) * 0.1);
  if (features.avgLatencySeconds30d >= 120) {
    flags.push(
      createBehaviorFlag(
        "high_settlement_latency",
        "Slow settlement",
        features.avgLatencySeconds30d,
        120,
        "above",
        `Average confirmed settlement latency is ${features.avgLatencySeconds30d.toFixed(0)} seconds.`,
        latencyImpact,
      ),
    );
  }

  const failures = byKey.get("settlement_failure_rate");
  const failureImpact = failures?.impact ?? round(normalizeAbove(features.settlementFailureRate30d, 0.25, 0.75) * 0.18);
  if (features.settlementFailureRate30d >= 0.25) {
    flags.push(
      createBehaviorFlag(
        "high_failure_rate",
        "Settlement failures",
        features.settlementFailureRate30d,
        0.25,
        "above",
        `Settlement failure rate is ${(features.settlementFailureRate30d * 100).toFixed(0)}%.`,
        failureImpact,
      ),
    );
  }

  const burst = byKey.get("burstiness");
  const burstImpact = burst?.impact ?? round(normalizeAbove(Math.max(features.hourlyBurstRatio24h, agentMetrics.throughput.burstiness), 2, 6) * 0.18);
  if (features.hourlyBurstRatio24h >= 2 || agentMetrics.throughput.burstiness >= 1.25) {
    flags.push(
      createBehaviorFlag(
        "burst_activity",
        "Burst activity",
        Math.max(features.hourlyBurstRatio24h, agentMetrics.throughput.burstiness),
        2,
        "above",
        `Hourly burst ratio is ${features.hourlyBurstRatio24h.toFixed(2)} and daily burstiness is ${agentMetrics.throughput.burstiness.toFixed(2)}.`,
        burstImpact,
      ),
    );
  }

  const newCounterparties = byKey.get("new_counterparty_rate");
  const newCounterpartyImpact = newCounterparties?.impact ?? round(normalizeAbove(features.newCounterpartyRate7d, 0.6, 1) * 0.06);
  if (features.newCounterpartyRate7d >= 0.6) {
    flags.push(
      createBehaviorFlag(
        "new_counterparty_surge",
        "New counterparty surge",
        features.newCounterpartyRate7d,
        0.6,
        "above",
        `New counterparty rate over 7d is ${(features.newCounterpartyRate7d * 100).toFixed(0)}%.`,
        newCounterpartyImpact,
      ),
    );
  }

  const evidence = byKey.get("evidence_density");
  const evidenceImpact = evidence?.impact ?? round(normalizeBelow(features.evidenceDensity, 0.75, 1.5) * 0.1);
  if (features.evidenceDensity <= 1 && agentMetrics.throughput.totalInteractions > 0) {
    flags.push(
      createBehaviorFlag(
        "thin_evidence",
        "Thin evidence coverage",
        features.evidenceDensity,
        1,
        "below",
        `Evidence density is ${features.evidenceDensity.toFixed(2)} artifacts per interaction.`,
        evidenceImpact,
      ),
    );
  }

  const controls = byKey.get("control_friction");
  const controlImpact = controls?.impact ?? round(normalizeAbove(features.controlFailureRate, 0.25, 0.75) * 0.14);
  if (features.controlFailureRate >= 0.25 && agentMetrics.controls.overall.total > 0) {
    flags.push(
      createBehaviorFlag(
        "control_friction",
        "Control friction",
        features.controlFailureRate,
        0.25,
        "above",
        `Control failure rate is ${(features.controlFailureRate * 100).toFixed(0)}%.`,
        controlImpact,
      ),
    );
  }

  return flags.sort((left, right) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[left.severity] - order[right.severity];
  });
}

function buildCluster(
  features: BehaviorFeatureHighlights,
  agentMetrics: ReturnType<typeof computeAgentMetrics>,
): WalletBehaviorModel["cluster"] {
  if (agentMetrics.throughput.totalInteractions < 3) {
    return {
      id: "emerging_wallet",
      label: "emerging_wallet",
      explanation: "Too little historical AFI activity exists yet to support a stronger cohort assignment.",
    };
  }

  if (features.totalVolumeUsd30d >= 1000 && agentMetrics.settlement.successRate >= 0.75) {
    return {
      id: "high_value_settler",
      label: "high_value_settler",
      explanation: "This wallet shows sustained high-value volume with mostly successful settlement outcomes.",
    };
  }

  if (features.topCounterpartyShare30d >= 0.75 || agentMetrics.counterparty.repeatRate >= 0.6) {
    return {
      id: "concentrated_power_user",
      label: "concentrated_power_user",
      explanation: "Activity is concentrated around a narrow service set with repeated counterparties.",
    };
  }

  if (features.hourlyBurstRatio24h >= 2 || agentMetrics.throughput.burstiness >= 1.25 || features.newCounterpartyRate7d >= 0.6) {
    return {
      id: "bursty_explorer",
      label: "bursty_explorer",
      explanation: "Recent activity arrives in bursts and/or expands quickly into new counterparties.",
    };
  }

  return {
    id: "steady_operator",
    label: "steady_operator",
    explanation: "Activity is comparatively steady with repeat behavior and moderate risk signals.",
  };
}

export function computeWalletBehaviorModel(store: Store, wallet: string): WalletBehaviorModel {
  const interactions = store.listInteractionsByWallet(wallet);
  const now = getAnalysisNow(interactions);
  const agentMetrics = computeAgentMetrics(store, wallet);
  const features = calculateFeatureHighlights(store, wallet, now);
  const contributors = buildContributors(features, agentMetrics);
  const normalizedScore = clamp(contributors.reduce((sum, contributor) => sum + contributor.impact, 0));
  const anomalyLabel = normalizedScore >= 0.75 ? "anomalous" : normalizedScore >= 0.45 ? "elevated" : "normal";
  const topSignals = contributors.slice(0, 3);
  const cluster = buildCluster(features, agentMetrics);

  return {
    wallet,
    anomaly: {
      score: round(normalizedScore * 100, 2),
      normalizedScore: round(normalizedScore),
      label: anomalyLabel,
      explanation:
        topSignals.length > 0
          ? `Primary drivers: ${topSignals.map((contributor) => contributor.label.toLowerCase()).join(", ")}.`
          : "No elevated behavioral risk signals are currently present in AFI.",
    },
    cluster,
    flags: buildFlags(features, agentMetrics, contributors),
    topSignals,
    features,
    provenance: {
      source: "afi_heuristic",
      computedAt: new Date(now).toISOString(),
      observationWindowDays: 30,
      featureSource: "sqlite_runtime",
      modelVersion: BEHAVIOR_MODEL_VERSION,
    },
  };
}

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
