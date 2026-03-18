import { describe, expect, it } from "vitest";
import {
  AnomalyDetectionModel,
  ClusteringModel,
  PYTHON_MODEL_RUNTIME,
  PythonModelImplementationRequiredError,
  exportFeatureQueriesToSQL,
  extractBasicFeatures,
  validateFeatureVector,
  type WalletFeatureVector,
} from "../server/models";
import type { InteractionRecord } from "../server/types";

const EXPECTED_PYTHON_BACKED_MODEL_ERRORS = [
  {
    label: "anomaly load",
    operation: () => new AnomalyDetectionModel().load("/tmp/anomaly.pkl"),
    requirement: {
      model: "AnomalyDetectionModel",
      operation: "load",
      message: "Use scikit-learn IsolationForest with pickle/joblib serialization.",
    },
  },
  {
    label: "anomaly train",
    operation: () => new AnomalyDetectionModel().train([]),
    requirement: {
      model: "AnomalyDetectionModel",
      operation: "train",
      message: "Use scikit-learn IsolationForest with StandardScaler preprocessing.",
    },
  },
  {
    label: "anomaly predict",
    operation: () => new AnomalyDetectionModel().predict([]),
    requirement: {
      model: "AnomalyDetectionModel",
      operation: "predict",
      message: "Use scikit-learn IsolationForest.predict() and decision_function().",
    },
  },
  {
    label: "clustering load",
    operation: () => new ClusteringModel().load("/tmp/clustering.pkl"),
    requirement: {
      model: "ClusteringModel",
      operation: "load",
      message: "Use scikit-learn KMeans with pickle/joblib serialization.",
    },
  },
  {
    label: "clustering train",
    operation: () => new ClusteringModel().train([]),
    requirement: {
      model: "ClusteringModel",
      operation: "train",
      message:
        "Use scikit-learn KMeans with StandardScaler preprocessing and silhouette_score for optimal k.",
    },
  },
  {
    label: "clustering predict",
    operation: () => new ClusteringModel().predict([]),
    requirement: {
      model: "ClusteringModel",
      operation: "predict",
      message: "Use scikit-learn KMeans.predict() and transform() for distances.",
    },
  },
] as const;

describe("models", () => {
  it("describes the Python-backed runtime contract explicitly", () => {
    expect(PYTHON_MODEL_RUNTIME).toEqual({
      runtime: "python",
      library: "scikit-learn",
      serializers: ["pickle", "joblib"],
    });
  });

  it("reports null metadata until a Python model is loaded", () => {
    expect(new AnomalyDetectionModel().getMetadata()).toBeNull();
    expect(new ClusteringModel().getMetadata()).toBeNull();
  });

  it.each(EXPECTED_PYTHON_BACKED_MODEL_ERRORS)("$label rejects with a structured Python-only error", async ({ operation, requirement }) => {
    const result = operation();
    await expect(result).rejects.toBeInstanceOf(PythonModelImplementationRequiredError);
    await expect(result).rejects.toMatchObject({
      name: "PythonModelImplementationRequiredError",
      requirement: {
        ...requirement,
        runtime: PYTHON_MODEL_RUNTIME,
      },
    });
  });

  it("extracts the minimal feature contract without pretending the ML features already exist", () => {
    const interaction: InteractionRecord = {
      id: "interaction-1",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: {},
    };

    expect(extractBasicFeatures(interaction)).toMatchObject({
      wallet_address: "unknown",
      observation_window_days: 30,
    });
  });

  it("validates a minimal wallet feature vector contract", () => {
    const completeFeatureVector = {
      wallet_address: "0xabc",
      tx_count_7d: 1,
      tx_count_30d: 2,
      unique_counterparties_7d: 3,
      avg_payment_usd_7d: 4,
      avg_latency_seconds_7d: 5,
      computed_at: "2024-01-01T00:00:00Z",
    } satisfies Partial<WalletFeatureVector>;

    expect(validateFeatureVector(completeFeatureVector)).toBe(true);
    expect(validateFeatureVector({ wallet_address: "0xabc", tx_count_7d: 1 })).toBe(false);
  });

  it("exports DuckDB feature queries as SQL text", () => {
    const sql = exportFeatureQueriesToSQL();

    expect(sql).toContain("CREATE OR REPLACE TABLE freq_features");
    expect(sql).toContain("CREATE OR REPLACE TABLE cp_features");
  });
});
