#!/usr/bin/env python3
"""
AFI Anomaly Detection Model Training

Trains an IsolationForest model on wallet behavioral features
to detect anomalous transaction patterns.

Usage:
    python scripts/train_anomaly_model.py [options]

Options:
    --input PATH          Input Parquet file with features (default: data/wallet_features.parquet)
    --output-model PATH   Output model file (default: models/isolation_forest.pkl)
    --output-scaler PATH  Output scaler file (default: models/scaler.pkl)
    --contamination FLOAT Expected proportion of anomalies (default: 0.1)
    --n-estimators INT    Number of trees (default: 100)
    --random-state INT    Random seed (default: 42)
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler


def parse_args():
    parser = argparse.ArgumentParser(description="Train AFI anomaly detection model")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data/wallet_features.parquet"),
        help="Input Parquet file with wallet features",
    )
    parser.add_argument(
        "--output-model",
        type=Path,
        default=Path("models/isolation_forest.pkl"),
        help="Output model file",
    )
    parser.add_argument(
        "--output-scaler",
        type=Path,
        default=Path("models/scaler.pkl"),
        help="Output scaler file",
    )
    parser.add_argument(
        "--contamination",
        type=float,
        default=0.1,
        help="Expected proportion of anomalies (0.0-0.5)",
    )
    parser.add_argument(
        "--n-estimators",
        type=int,
        default=100,
        help="Number of trees in the forest",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random seed for reproducibility",
    )
    return parser.parse_args()


def load_features(path: Path) -> tuple[pd.DataFrame, list[str]]:
    """Load features from Parquet and identify feature columns."""
    print(f"Loading features from {path}...")
    df = pd.read_parquet(path)
    print(f"Loaded {len(df)} wallets")

    # Identify feature columns (exclude metadata)
    metadata_cols = {"wallet_address", "computed_at", "observation_window_days"}
    feature_cols = [col for col in df.columns if col not in metadata_cols]
    print(f"Using {len(feature_cols)} features")

    return df, feature_cols


def train_model(
    X: np.ndarray,
    contamination: float,
    n_estimators: int,
    random_state: int,
) -> IsolationForest:
    """Train IsolationForest model."""
    print("\nTraining IsolationForest model...")
    print(f"  Contamination: {contamination}")
    print(f"  N estimators: {n_estimators}")
    print(f"  Random state: {random_state}")

    model = IsolationForest(
        contamination=contamination,
        n_estimators=n_estimators,
        max_samples="auto",
        random_state=random_state,
        n_jobs=-1,  # Use all CPU cores
        verbose=1,
    )

    model.fit(X)
    print("Training complete!")

    return model


def evaluate_model(model: IsolationForest, X: np.ndarray) -> dict:
    """Evaluate model and compute metrics."""
    print("\nEvaluating model...")

    predictions = model.predict(X)
    scores = model.decision_function(X)

    n_anomalies = (predictions == -1).sum()
    anomaly_rate = n_anomalies / len(predictions)

    metrics = {
        "n_samples": len(predictions),
        "n_anomalies": int(n_anomalies),
        "anomaly_rate": float(anomaly_rate),
        "score_mean": float(scores.mean()),
        "score_std": float(scores.std()),
        "score_min": float(scores.min()),
        "score_max": float(scores.max()),
    }

    print(f"  Detected {n_anomalies} anomalies ({anomaly_rate:.2%})")
    print(f"  Score range: [{metrics['score_min']:.3f}, {metrics['score_max']:.3f}]")

    return metrics


def save_artifacts(
    model: IsolationForest,
    scaler: StandardScaler,
    feature_cols: list[str],
    metrics: dict,
    args: argparse.Namespace,
) -> None:
    """Save model, scaler, and metadata."""
    # Create output directories
    args.output_model.parent.mkdir(parents=True, exist_ok=True)
    args.output_scaler.parent.mkdir(parents=True, exist_ok=True)

    # Save model
    print(f"\nSaving model to {args.output_model}...")
    joblib.dump(model, args.output_model)

    # Save scaler
    print(f"Saving scaler to {args.output_scaler}...")
    joblib.dump(scaler, args.output_scaler)

    # Save metadata
    metadata_path = args.output_model.parent / "isolation_forest_metadata.json"
    metadata = {
        "model_type": "isolation_forest",
        "version": "1.0.0",
        "trained_at": datetime.now().isoformat(),
        "training_samples": metrics["n_samples"],
        "hyperparameters": {
            "contamination": args.contamination,
            "n_estimators": args.n_estimators,
            "random_state": args.random_state,
        },
        "features": feature_cols,
        "metrics": metrics,
    }

    print(f"Saving metadata to {metadata_path}...")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)

    print("\nAll artifacts saved successfully!")


def main():
    args = parse_args()

    # Load data
    df, feature_cols = load_features(args.input)
    X = df[feature_cols].values

    # Check for missing values
    if np.isnan(X).any():
        print("Warning: Found NaN values, filling with 0")
        X = np.nan_to_num(X, nan=0.0)

    # Standardize features
    print("\nStandardizing features...")
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    print(f"Feature mean: {X_scaled.mean():.3f}, std: {X_scaled.std():.3f}")

    # Train model
    model = train_model(
        X_scaled,
        args.contamination,
        args.n_estimators,
        args.random_state,
    )

    # Evaluate
    metrics = evaluate_model(model, X_scaled)

    # Save artifacts
    save_artifacts(model, scaler, feature_cols, metrics, args)

    print("\n✓ Training pipeline complete!")
    print(f"\nTo run inference:")
    print(f"  python scripts/predict_anomalies.py \\")
    print(f"    --model {args.output_model} \\")
    print(f"    --scaler {args.output_scaler} \\")
    print(f"    --input data/wallet_features.parquet \\")
    print(f"    --output data/anomaly_results.parquet")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)
