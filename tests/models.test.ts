import { describe, expect, it } from "vitest";
import {
  AnomalyDetectionModel,
  ClusteringModel,
  PYTHON_MODEL_RUNTIME,
  PythonModelImplementationRequiredError,
  computeWalletBehaviorModel,
  exportFeatureQueriesToSQL,
  extractBasicFeatures,
  validateFeatureVector,
  type WalletFeatureVector,
} from "../server/models";
import { Store } from "../server/store";
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

  it("computes a low-signal emerging wallet behavior model", () => {
    const store = new Store({ dbPath: ":memory:", dataDir: "/tmp/afi-models-empty" });

    expect(computeWalletBehaviorModel(store, "0xempty")).toEqual(
      expect.objectContaining({
        wallet: "0xempty",
        anomaly: expect.objectContaining({
          label: "normal",
          score: 0,
        }),
        cluster: expect.objectContaining({
          label: "emerging_wallet",
        }),
        flags: [],
        topSignals: [],
        features: expect.objectContaining({
          txCount7d: 0,
          txCount30d: 0,
          uniqueCounterparties30d: 0,
          evidenceDensity: 0,
          controlFailureRate: 0,
        }),
        provenance: expect.objectContaining({
          source: "afi_heuristic",
          featureSource: "sqlite_runtime",
          modelVersion: "afi-heuristic/v1",
        }),
      }),
    );
  });

  it("computes elevated wallet behavior with explainable flags and contributors", () => {
    const store = new Store({ dbPath: ":memory:", dataDir: "/tmp/afi-models-elevated" });

    store.upsertPrice({
      id: "8453:0xtoken",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "USDC",
      price_usd: "2",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });

    store.upsertInteraction({
      id: "i-1",
      created_at: "2024-01-30T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc-a",
      protocol: "x402",
      summary: { paymentRequired: { amount: "10", asset: "0xtoken", network: "8453" } },
    });
    store.upsertWalletSnapshot({
      id: "ws-1",
      interaction_id: "i-1",
      wallet_address: "0xwallet",
      allowance: "5",
      max_tx: "8",
      approvals_required: true,
      metadata: {},
      created_at: "2024-01-30T00:00:00Z",
    });
    store.upsertSettlement({
      id: "s-1",
      interaction_id: "i-1",
      tx_hash: "0xtx-1",
      status: "failed",
      metadata: {},
    });

    store.upsertInteraction({
      id: "i-2",
      created_at: "2024-01-30T00:05:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc-a",
      protocol: "x402",
      summary: { paymentRequired: { amount: "50", asset: "0xtoken", network: "8453" } },
    });
    store.upsertWalletSnapshot({
      id: "ws-2",
      interaction_id: "i-2",
      wallet_address: "0xwallet",
      allowance: "100",
      max_tx: "100",
      approvals_required: false,
      metadata: {},
      created_at: "2024-01-30T00:05:00Z",
    });
    store.upsertSettlement({
      id: "s-2",
      interaction_id: "i-2",
      tx_hash: "0xtx-2",
      status: "confirmed",
      metadata: {},
    });
    store.upsertBaseTransaction({
      tx_hash: "0xtx-2",
      status: "confirmed",
      from: "0xwallet",
      to: "0xmerchant",
      raw: {},
      created_at: "2024-01-30T00:25:00Z",
    });

    store.upsertInteraction({
      id: "i-3",
      created_at: "2024-01-30T12:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc-b",
      protocol: "x402",
      summary: { paymentRequired: { amount: "1", asset: "0xtoken", network: "8453" } },
    });
    store.upsertWalletSnapshot({
      id: "ws-3",
      interaction_id: "i-3",
      wallet_address: "0xwallet",
      allowance: "10",
      max_tx: "10",
      approvals_required: false,
      metadata: {},
      created_at: "2024-01-30T12:00:00Z",
    });
    store.upsertReceipts([
      {
        id: "receipt-1",
        interaction_id: "i-3",
        tx_hash: "0xtx-3",
        raw: {},
        created_at: "2024-01-30T12:00:30Z",
      },
    ]);

    const result = computeWalletBehaviorModel(store, "0xwallet");

    expect(result.anomaly.label).toBe("elevated");
    expect(result.cluster.label).toBe("bursty_explorer");
    expect(result.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "burst_activity" }),
        expect.objectContaining({ key: "control_friction" }),
        expect.objectContaining({ key: "high_failure_rate" }),
      ]),
    );
    expect(result.topSignals[0]).toEqual(expect.objectContaining({ label: expect.any(String), impact: expect.any(Number) }));
    expect(result.features).toEqual(
      expect.objectContaining({
        txCount7d: 3,
        uniqueCounterparties30d: 2,
        settlementFailureRate30d: 0.5,
      }),
    );
  });

  it("assigns the high-value settler cluster when volume and settlement quality are strong", () => {
    const store = new Store({ dbPath: ":memory:", dataDir: "/tmp/afi-models-high-value" });

    store.upsertPrice({
      id: "8453:0xtoken",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "USDC",
      price_usd: "10",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });

    for (const index of [1, 2, 3]) {
      const interactionId = `hv-${index}`;
      store.upsertInteraction({
        id: interactionId,
        created_at: `2024-02-0${index}T00:00:00Z`,
        wallet_address: "0xvalue",
        counterparty: "svc-value",
        protocol: "x402",
        summary: { paymentRequired: { amount: "100", asset: "0xtoken", network: "8453" } },
      });
      store.upsertSettlement({
        id: `settlement-${interactionId}`,
        interaction_id: interactionId,
        tx_hash: `0xtx-hv-${index}`,
        status: "confirmed",
        metadata: {},
      });
      store.upsertBaseTransaction({
        tx_hash: `0xtx-hv-${index}`,
        status: "confirmed",
        from: "0xvalue",
        to: "0xmerchant",
        raw: {},
        created_at: `2024-02-0${index}T00:00:20Z`,
      });
      store.upsertReceipts([
        {
          id: `receipt-${interactionId}`,
          interaction_id: interactionId,
          tx_hash: `0xtx-hv-${index}`,
          raw: {},
          created_at: `2024-02-0${index}T00:00:10Z`,
        },
      ]);
    }

    const result = computeWalletBehaviorModel(store, "0xvalue");

    expect(result.cluster.label).toBe("high_value_settler");
    expect(result.features.totalVolumeUsd30d).toBe(3000);
    expect(["normal", "elevated"]).toContain(result.anomaly.label);
  });

  it("assigns the concentrated power user cluster when one service dominates activity", () => {
    const store = new Store({ dbPath: ":memory:", dataDir: "/tmp/afi-models-concentrated" });

    for (const [index, createdAt] of ["2024-01-01T00:00:00Z", "2024-01-10T00:00:00Z", "2024-01-20T00:00:00Z"].entries()) {
      store.upsertInteraction({
        id: `cp-${index}`,
        created_at: createdAt,
        wallet_address: "0xfocus",
        counterparty: "svc-focus",
        protocol: "x402",
        summary: { paymentRequired: { amount: "5", asset: "0xmissing", network: "8453" } },
      });
    }

    const result = computeWalletBehaviorModel(store, "0xfocus");

    expect(result.cluster.label).toBe("concentrated_power_user");
    expect(result.features.topCounterpartyShare30d).toBe(1);
    expect(result.features.hourlyBurstRatio24h).toBe(0);
    expect(result.flags).toEqual(expect.arrayContaining([expect.objectContaining({ key: "high_counterparty_concentration" })]));
  });

  it("assigns the steady operator cluster when activity is repeatable without sparse false bursts", () => {
    const store = new Store({ dbPath: ":memory:", dataDir: "/tmp/afi-models-steady" });

    store.upsertPrice({
      id: "8453:0xtoken-steady",
      token_address: "0xtoken-steady",
      chain_id: 8453,
      symbol: "USDC",
      price_usd: "1",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });

    for (const item of [
      { id: "steady-1", created_at: "2024-01-10T00:00:00Z", counterparty: "svc-a", amount: "10" },
      { id: "steady-2", created_at: "2024-01-24T00:00:00Z", counterparty: "svc-a", amount: "12" },
      { id: "steady-3", created_at: "2024-01-30T00:00:00Z", counterparty: "svc-b", amount: "11" },
    ]) {
      store.upsertInteraction({
        id: item.id,
        created_at: item.created_at,
        wallet_address: "0xsteady",
        counterparty: item.counterparty,
        protocol: "x402",
        summary: { paymentRequired: { amount: item.amount, asset: "0xtoken-steady", network: "8453" } },
      });
      store.upsertWalletSnapshot({
        id: `snapshot-${item.id}`,
        interaction_id: item.id,
        wallet_address: "0xsteady",
        allowance: "100",
        max_tx: "100",
        approvals_required: false,
        metadata: {},
        created_at: item.created_at,
      });
      store.upsertSettlement({
        id: `settlement-${item.id}`,
        interaction_id: item.id,
        tx_hash: `tx-${item.id}`,
        status: "confirmed",
        metadata: {},
      });
      store.upsertBaseTransaction({
        tx_hash: `tx-${item.id}`,
        status: "confirmed",
        from: "0xsteady",
        to: "0xmerchant",
        raw: {},
        created_at: item.created_at.replace("00:00:00Z", "00:00:30Z"),
      });
      store.upsertReceipts([
        {
          id: `receipt-${item.id}`,
          interaction_id: item.id,
          tx_hash: `tx-${item.id}`,
          raw: {},
          created_at: item.created_at.replace("00:00:00Z", "00:00:10Z"),
        },
        {
          id: `receipt-extra-${item.id}`,
          interaction_id: item.id,
          tx_hash: `tx-${item.id}`,
          raw: {},
          created_at: item.created_at.replace("00:00:00Z", "00:00:20Z"),
        },
        {
          id: `receipt-third-${item.id}`,
          interaction_id: item.id,
          tx_hash: `tx-${item.id}`,
          raw: {},
          created_at: item.created_at.replace("00:00:00Z", "00:00:25Z"),
        },
      ]);
    }

    const result = computeWalletBehaviorModel(store, "0xsteady");

    expect(result.cluster.label).toBe("steady_operator");
    expect(result.features.hourlyBurstRatio24h).toBe(0);
    expect(result.features.newCounterpartyRate7d).toBe(0.5);
    expect(result.anomaly.label).toBe("normal");
  });

  it("computes anomalous behavior with mixed flag severities when risk signals stack", () => {
    const store = new Store({ dbPath: ":memory:", dataDir: "/tmp/afi-models-anomalous" });

    store.upsertPrice({
      id: "8453:0xtoken-risk",
      token_address: "0xtoken-risk",
      chain_id: 8453,
      symbol: "USDC",
      price_usd: "1",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });

    for (const item of [
      { id: "risk-1", created_at: "2024-03-01T00:00:00Z", amount: "1", status: "failed" as const, settledAt: null },
      { id: "risk-2", created_at: "2024-03-01T00:05:00Z", amount: "3", status: "failed" as const, settledAt: null },
      { id: "risk-3", created_at: "2024-03-01T00:10:00Z", amount: "7", status: "failed" as const, settledAt: null },
      { id: "risk-4", created_at: "2024-03-01T00:15:00Z", amount: "20", status: "confirmed" as const, settledAt: "2024-03-01T00:35:00Z" },
    ]) {
      store.upsertInteraction({
        id: item.id,
        created_at: item.created_at,
        wallet_address: "0xrisk",
        counterparty: "svc-risk",
        protocol: "x402",
        summary: { paymentRequired: { amount: item.amount, asset: "0xtoken-risk", network: "8453" } },
      });
      store.upsertWalletSnapshot({
        id: `snapshot-${item.id}`,
        interaction_id: item.id,
        wallet_address: "0xrisk",
        allowance: "0.5",
        max_tx: "0.5",
        approvals_required: true,
        metadata: {},
        created_at: item.created_at,
      });
      store.upsertSettlement({
        id: `settlement-${item.id}`,
        interaction_id: item.id,
        tx_hash: `tx-${item.id}`,
        status: item.status,
        metadata: {},
      });
      if (item.settledAt) {
        store.upsertBaseTransaction({
          tx_hash: `tx-${item.id}`,
          status: "confirmed",
          from: "0xrisk",
          to: "0xmerchant",
          raw: {},
          created_at: item.settledAt,
        });
      }
    }

    const result = computeWalletBehaviorModel(store, "0xrisk");

    expect(result.anomaly.label).toBe("anomalous");
    expect(result.cluster.label).toBe("concentrated_power_user");
    expect(result.flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "high_counterparty_concentration", severity: "high" }),
        expect.objectContaining({ key: "high_failure_rate", severity: "high" }),
        expect.objectContaining({ key: "high_settlement_latency", severity: "medium" }),
        expect.objectContaining({ key: "thin_evidence", severity: "medium" }),
        expect.objectContaining({ key: "control_friction", severity: "high" }),
      ]),
    );
    expect(result.topSignals).toHaveLength(3);
    expect(result.features.paymentSizeCv30d).toBeGreaterThan(0.9);
    expect(result.features.controlFailureRate).toBe(1);
  });

  it("gracefully handles invalid timestamps, missing prices, and zero-value payments", () => {
    const store = new Store({ dbPath: ":memory:", dataDir: "/tmp/afi-models-edge-cases" });

    store.upsertPrice({
      id: "8453:0xtoken-zero",
      token_address: "0xtoken-zero",
      chain_id: 8453,
      symbol: "USDC",
      price_usd: "0",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });

    store.upsertInteraction({
      id: "edge-1",
      created_at: "not-a-date",
      wallet_address: "0xedge",
      protocol: "x402",
      summary: { paymentRequired: { amount: "5", asset: "0xmissing", network: "8453" } },
    });
    store.upsertInteraction({
      id: "edge-2",
      created_at: "still-not-a-date",
      wallet_address: "0xedge",
      counterparty: "svc-edge",
      protocol: "x402",
      summary: { paymentRequired: { amount: "oops", asset: "0xtoken-zero", network: "8453" } },
    });
    store.upsertInteraction({
      id: "edge-3",
      created_at: "also-not-a-date",
      wallet_address: "0xedge",
      counterparty: "svc-edge",
      protocol: "x402",
      summary: { paymentRequired: { amount: "0", asset: "0xtoken-zero", network: "8453" } },
    });

    const result = computeWalletBehaviorModel(store, "0xedge");

    expect(result.features.txCount30d).toBe(3);
    expect(result.features.totalVolumeUsd30d).toBe(0);
    expect(result.features.avgPaymentUsd30d).toBe(0);
    expect(result.features.paymentSizeCv30d).toBe(0);
    expect(result.features.avgLatencySeconds30d).toBe(0);
    expect(result.provenance.computedAt).toMatch(/T/);
  });
});
