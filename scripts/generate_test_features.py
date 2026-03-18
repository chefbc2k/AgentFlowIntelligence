#!/usr/bin/env python3
"""
Generate synthetic wallet features for testing ML pipeline.

This creates a sample dataset with normal and anomalous wallet patterns.

Usage:
    python scripts/generate_test_features.py [--output PATH] [--n-wallets INT]
"""

import argparse
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd


def parse_args():
    parser = argparse.ArgumentParser(description="Generate test wallet features")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/test_wallet_features.parquet"),
        help="Output Parquet file",
    )
    parser.add_argument(
        "--n-wallets", type=int, default=1000, help="Number of wallets to generate"
    )
    parser.add_argument(
        "--anomaly-rate",
        type=float,
        default=0.1,
        help="Proportion of anomalous wallets",
    )
    parser.add_argument("--random-state", type=int, default=42, help="Random seed")
    return parser.parse_args()


def generate_normal_wallets(n: int, rng: np.random.Generator) -> pd.DataFrame:
    """Generate normal wallet behavior patterns."""
    return pd.DataFrame(
        {
            # FREQ features
            "tx_count_7d": rng.poisson(5, n),
            "tx_count_30d": rng.poisson(20, n),
            "tx_count_90d": rng.poisson(60, n),
            "avg_daily_tx_7d": rng.normal(0.7, 0.3, n).clip(0),
            "avg_daily_tx_30d": rng.normal(0.67, 0.25, n).clip(0),
            "max_daily_tx_7d": rng.poisson(3, n),
            "max_daily_tx_30d": rng.poisson(5, n),
            "days_active_7d": rng.integers(1, 8, n),
            "days_active_30d": rng.integers(5, 31, n),
            "tx_frequency_cv": rng.normal(0.5, 0.2, n).clip(0, 2),
            # CP features
            "unique_counterparties_7d": rng.poisson(3, n),
            "unique_counterparties_30d": rng.poisson(8, n),
            "unique_counterparties_90d": rng.poisson(15, n),
            "top_counterparty_share_30d": rng.beta(2, 5, n),
            "counterparty_hhi_30d": rng.beta(2, 8, n),
            "repeat_counterparty_rate_30d": rng.beta(3, 2, n),
            "new_counterparty_rate_7d": rng.beta(2, 3, n),
            # APS features (in USD)
            "avg_payment_usd_7d": rng.lognormal(3, 1, n),  # ~$20-$200
            "avg_payment_usd_30d": rng.lognormal(3, 1, n),
            "median_payment_usd_7d": rng.lognormal(2.5, 0.8, n),
            "median_payment_usd_30d": rng.lognormal(2.5, 0.8, n),
            "max_payment_usd_7d": rng.lognormal(4, 1.5, n),
            "max_payment_usd_30d": rng.lognormal(4.5, 1.5, n),
            "min_payment_usd_7d": rng.lognormal(1, 0.5, n),
            "min_payment_usd_30d": rng.lognormal(1, 0.5, n),
            "total_volume_usd_7d": rng.lognormal(4, 1.5, n),
            "total_volume_usd_30d": rng.lognormal(5, 1.5, n),
            "payment_size_cv_30d": rng.normal(0.6, 0.3, n).clip(0, 3),
            "large_payment_count_30d": rng.poisson(2, n),
            # SLAT features (in seconds)
            "avg_latency_seconds_7d": rng.normal(45, 15, n).clip(5, 300),
            "avg_latency_seconds_30d": rng.normal(45, 15, n).clip(5, 300),
            "median_latency_seconds_7d": rng.normal(40, 12, n).clip(5, 200),
            "median_latency_seconds_30d": rng.normal(40, 12, n).clip(5, 200),
            "max_latency_seconds_7d": rng.normal(90, 30, n).clip(20, 600),
            "max_latency_seconds_30d": rng.normal(100, 35, n).clip(20, 600),
            "fast_settlement_rate_30d": rng.beta(8, 2, n),  # Most settle quickly
            "settlement_failure_rate_30d": rng.beta(1, 20, n),  # Low failure rate
            "confirmed_settlements_30d": rng.poisson(18, n),
            # BURST features
            "max_hourly_tx_24h": rng.poisson(2, n),
            "hourly_burst_ratio_24h": rng.normal(1.5, 0.5, n).clip(1, 5),
            "hourly_tx_cv_24h": rng.normal(0.8, 0.3, n).clip(0, 3),
            "idle_hours_7d": rng.integers(24, 144, n),
            "inter_tx_time_std_7d": rng.normal(3600, 1800, n).clip(600, 86400),
        }
    )


def generate_anomalous_wallets(n: int, rng: np.random.Generator) -> pd.DataFrame:
    """Generate anomalous wallet behavior patterns."""
    # Different anomaly types
    anomaly_type = rng.choice(["high_frequency", "high_value", "suspicious_latency"], n)

    features = generate_normal_wallets(n, rng)

    for i, atype in enumerate(anomaly_type):
        if atype == "high_frequency":
            # Burst of transactions
            features.loc[i, "tx_count_7d"] = rng.integers(50, 200)
            features.loc[i, "tx_count_30d"] = rng.integers(200, 500)
            features.loc[i, "max_hourly_tx_24h"] = rng.integers(20, 50)
            features.loc[i, "hourly_burst_ratio_24h"] = rng.uniform(10, 30)
            features.loc[i, "tx_frequency_cv"] = rng.uniform(2, 5)

        elif atype == "high_value":
            # Unusually large payments
            features.loc[i, "avg_payment_usd_7d"] = rng.uniform(10000, 100000)
            features.loc[i, "avg_payment_usd_30d"] = rng.uniform(10000, 100000)
            features.loc[i, "max_payment_usd_7d"] = rng.uniform(50000, 500000)
            features.loc[i, "total_volume_usd_30d"] = rng.uniform(100000, 1000000)
            features.loc[i, "large_payment_count_30d"] = rng.integers(15, 30)

        elif atype == "suspicious_latency":
            # Unusual settlement patterns
            features.loc[i, "avg_latency_seconds_30d"] = rng.uniform(300, 3600)
            features.loc[i, "max_latency_seconds_30d"] = rng.uniform(1800, 7200)
            features.loc[i, "fast_settlement_rate_30d"] = rng.uniform(0, 0.2)
            features.loc[i, "settlement_failure_rate_30d"] = rng.uniform(0.3, 0.7)

    return features


def main():
    args = parse_args()

    rng = np.random.default_rng(args.random_state)

    # Generate wallets
    n_normal = int(args.n_wallets * (1 - args.anomaly_rate))
    n_anomalous = args.n_wallets - n_normal

    print(f"Generating {n_normal} normal wallets...")
    normal_features = generate_normal_wallets(n_normal, rng)

    print(f"Generating {n_anomalous} anomalous wallets...")
    anomalous_features = generate_anomalous_wallets(n_anomalous, rng)

    # Combine and shuffle
    all_features = pd.concat([normal_features, anomalous_features], ignore_index=True)

    # Add metadata
    all_features["wallet_address"] = [
        f"0x{rng.bytes(20).hex()}" for _ in range(len(all_features))
    ]
    all_features["computed_at"] = datetime.now().isoformat()
    all_features["observation_window_days"] = 30

    # Shuffle
    all_features = all_features.sample(frac=1, random_state=args.random_state).reset_index(
        drop=True
    )

    # Save
    args.output.parent.mkdir(parents=True, exist_ok=True)
    print(f"\nSaving {len(all_features)} wallets to {args.output}...")
    all_features.to_parquet(args.output, index=False)

    print("\n✓ Test data generated successfully!")
    print(f"\nTo train a model on this data:")
    print(f"  python scripts/train_anomaly_model.py --input {args.output}")


if __name__ == "__main__":
    main()
