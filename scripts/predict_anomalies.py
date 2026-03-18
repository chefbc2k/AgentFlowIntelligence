#!/usr/bin/env python3
"""
AFI Anomaly Detection Inference

Runs trained IsolationForest model on wallet features to detect anomalies.

Usage:
    python scripts/predict_anomalies.py [options]

Options:
    --input PATH        Input Parquet file with features (required)
    --output PATH       Output Parquet file with predictions (required)
    --model PATH        Trained model file (default: models/isolation_forest.pkl)
    --scaler PATH       Fitted scaler file (default: models/scaler.pkl)
    --top-features INT  Number of contributing features to identify (default: 3)
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler


def parse_args():
    parser = argparse.ArgumentParser(description="Run AFI anomaly detection")
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Input Parquet file with wallet features",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Output Parquet file for predictions",
    )
    parser.add_argument(
        "--model",
        type=Path,
        default=Path("models/isolation_forest.pkl"),
        help="Trained IsolationForest model",
    )
    parser.add_argument(
        "--scaler",
        type=Path,
        default=Path("models/scaler.pkl"),
        help="Fitted StandardScaler",
    )
    parser.add_argument(
        "--top-features",
        type=int,
        default=3,
        help="Number of top contributing features to identify",
    )
    return parser.parse_args()


def load_artifacts(
    model_path: Path, scaler_path: Path
) -> tuple[IsolationForest, StandardScaler]:
    """Load trained model and scaler."""
    print(f"Loading model from {model_path}...")
    model = joblib.load(model_path)

    print(f"Loading scaler from {scaler_path}...")
    scaler = joblib.load(scaler_path)

    return model, scaler


def load_features(path: Path) -> tuple[pd.DataFrame, list[str]]:
    """Load features from Parquet."""
    print(f"Loading features from {path}...")
    df = pd.read_parquet(path)
    print(f"Loaded {len(df)} wallets")

    # Identify feature columns (exclude metadata)
    metadata_cols = {"wallet_address", "computed_at", "observation_window_days"}
    feature_cols = [col for col in df.columns if col not in metadata_cols]
    print(f"Using {len(feature_cols)} features")

    return df, feature_cols


def identify_contributing_features(
    X_scaled: np.ndarray,
    feature_cols: list[str],
    is_anomaly: np.ndarray,
    top_n: int = 3,
) -> list[str]:
    """
    Identify features contributing most to anomaly classification.

    For anomalies, identifies features with highest absolute deviation from mean.
    """
    contributing_features = []

    for idx, anomaly_flag in enumerate(is_anomaly):
        if anomaly_flag:
            # Get absolute deviations for this sample
            deviations = np.abs(X_scaled[idx])

            # Get indices of top-N most deviated features
            top_indices = np.argsort(deviations)[-top_n:][::-1]

            # Get feature names
            top_feature_names = [feature_cols[i] for i in top_indices]

            contributing_features.append(",".join(top_feature_names))
        else:
            contributing_features.append("")

    return contributing_features


def predict_anomalies(
    model: IsolationForest,
    scaler: StandardScaler,
    df: pd.DataFrame,
    feature_cols: list[str],
    top_n: int,
) -> pd.DataFrame:
    """Run anomaly detection and build results dataframe."""
    print("\nRunning anomaly detection...")

    # Extract and scale features
    X = df[feature_cols].values

    # Handle missing values
    if np.isnan(X).any():
        print("Warning: Found NaN values, filling with 0")
        X = np.nan_to_num(X, nan=0.0)

    X_scaled = scaler.transform(X)

    # Predict
    predictions = model.predict(X_scaled)  # -1 = anomaly, 1 = normal
    scores = model.decision_function(X_scaled)  # Lower = more anomalous

    # Identify anomalies
    is_anomaly = predictions == -1
    n_anomalies = is_anomaly.sum()

    print(f"Detected {n_anomalies} anomalies ({n_anomalies / len(predictions):.2%})")

    # Identify contributing features for anomalies
    print(f"Identifying top {top_n} contributing features for anomalies...")
    contributing_features = identify_contributing_features(
        X_scaled, feature_cols, is_anomaly, top_n
    )

    # Build results dataframe
    results_df = pd.DataFrame(
        {
            "wallet_address": df["wallet_address"],
            "anomaly_score": scores,
            "is_anomaly": is_anomaly,
            "contributing_features": contributing_features,
            "timestamp": datetime.now().isoformat(),
        }
    )

    return results_df


def save_results(results_df: pd.DataFrame, output_path: Path) -> None:
    """Save results to Parquet."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"\nSaving results to {output_path}...")
    results_df.to_parquet(output_path, index=False)

    # Print summary statistics
    print("\nResults summary:")
    print(f"  Total wallets: {len(results_df)}")
    print(f"  Anomalies: {results_df['is_anomaly'].sum()}")
    print(f"  Anomaly rate: {results_df['is_anomaly'].mean():.2%}")
    print(f"  Score range: [{results_df['anomaly_score'].min():.3f}, {results_df['anomaly_score'].max():.3f}]")

    # Show most anomalous wallets
    top_anomalies = results_df[results_df["is_anomaly"]].nsmallest(5, "anomaly_score")
    if len(top_anomalies) > 0:
        print("\nTop 5 most anomalous wallets:")
        for idx, row in top_anomalies.iterrows():
            print(f"  {row['wallet_address'][:16]}...")
            print(f"    Score: {row['anomaly_score']:.3f}")
            print(f"    Key features: {row['contributing_features']}")


def main():
    args = parse_args()

    # Load model and scaler
    model, scaler = load_artifacts(args.model, args.scaler)

    # Load features
    df, feature_cols = load_features(args.input)

    # Run predictions
    results_df = predict_anomalies(model, scaler, df, feature_cols, args.top_features)

    # Save results
    save_results(results_df, args.output)

    print("\n✓ Anomaly detection complete!")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)
