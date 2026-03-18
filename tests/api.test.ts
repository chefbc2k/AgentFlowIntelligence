import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../server/config";

vi.mock("../server/db.js", async () => import("../server/db"));
vi.mock("../server/parquet-export", () => ({
  ParquetExporter: class {
    async exportInteractions() {
      return { filePath: "", rowCount: 0, timestamp: new Date().toISOString() };
    }
    async exportSettlements() {
      return { filePath: "", rowCount: 0, timestamp: new Date().toISOString() };
    }
    async exportEvidence() {
      return { filePath: "", rowCount: 0, timestamp: new Date().toISOString() };
    }
    async exportWalletSnapshots() {
      return { filePath: "", rowCount: 0, timestamp: new Date().toISOString() };
    }
    async exportReceipts() {
      return { filePath: "", rowCount: 0, timestamp: new Date().toISOString() };
    }
    async exportAttestations() {
      return { filePath: "", rowCount: 0, timestamp: new Date().toISOString() };
    }
    async exportBaseTransactions() {
      return { filePath: "", rowCount: 0, timestamp: new Date().toISOString() };
    }
    async exportTokenTransfers() {
      return { filePath: "", rowCount: 0, timestamp: new Date().toISOString() };
    }
  },
}));

const [{ createApi, createApp, createRouteHandlers, send }, { Store }, { QueryCache }] = await Promise.all([
  import("../server/index"),
  import("../server/store"),
  import("../server/query-cache"),
]);

const okJson = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

const notOk = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
});

function createTestStore() {
  const dataDir = mkdtempSync(join(tmpdir(), "afi-api-"));
  return new Store({ dbPath: ":memory:", dataDir });
}

function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: "0",
    dbPath: ":memory:",
    dataDir: "/tmp",
    locusBaseUrl: "https://beta-api.paywithlocus.com",
    easBaseUrl: "https://base.easscan.org/graphql",
    easSepoliaUrl: "https://base-sepolia.easscan.org/graphql",
    enableBackgroundJobs: false,
    enableParquetExport: false,
    ...overrides,
  };
}

function stubFetchForHappyPath() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);

      if (url.hostname === "beta-api.paywithlocus.com") {
        switch (url.pathname) {
          case "/api/status":
            return okJson({ address: "0xwallet", balance: "1", status: "ok" });
          case "/api/pay/balance":
            return okJson({ balance: "10", allowance: "1", maxTx: "1", approvalsRequired: false });
          case "/api/pay/transactions":
            return okJson([
              {
                id: "tx-1",
                amount: "1",
                currency: "USDC",
                status: "confirmed",
                createdAt: "2024-01-01T00:00:00Z",
                txHash: "0xtx",
                counterparty: "svc",
              },
              {
                amount: "2",
                currency: "USDC",
                status: "confirmed",
                txHash: "0xtx",
                counterparty: "svc",
              },
            ]);
          case "/api/register":
            return okJson({ registered: true, body: init?.body ? JSON.parse(String(init.body)) : null });
          case "/api/pay/send":
            return okJson({ sent: true });
          case "/api/wrapped/md":
            return okJson({ markdown: "# Catalog" });
          case "/api/x402/demo":
            return okJson({ ok: true });
          case "/api/checkout/agent/preflight/sess":
            return okJson({ ok: true });
          case "/api/checkout/agent/pay/sess":
            return okJson({ ok: true });
          case "/api/checkout/agent/payments/tx-1":
            return okJson({ ok: true });
          default:
            if (url.pathname.startsWith("/api/wrapped/")) return okJson({ ok: true });
            return okJson({ ok: true });
        }
      }

      if (url.hostname === "base.blockscout.com") {
        const action = url.searchParams.get("action");
        if (action === "eth_getTransactionByHash") {
          return okJson({
            result: {
              hash: url.searchParams.get("txhash"),
              blockNumber: "0x1",
              from: "0xaaa",
              to: "0xbbb",
              value: "1",
            },
          });
        }
        if (action === "txlist") {
          return okJson({
            result: [
              {
                hash: "0xtx",
                timeStamp: "1",
                blockNumber: "10",
                isError: "0",
                from: "0xaaa",
                to: "0xbbb",
                value: "1",
              },
              { hash: "0xunknown", from: "0xaaa", to: "0xbbb", value: "1", isError: "0" },
              { timeStamp: "1" },
              { hash: "0xfail", timeStamp: "1", isError: "1" },
            ],
          });
        }
        if (action === "tokentx") {
          return okJson({
            result: [
              {
                hash: "0xtx",
                logIndex: "0",
                contractAddress: "0xtoken",
                tokenSymbol: "USDC",
                from: "0xaaa",
                to: "0xbbb",
                value: "1",
                timeStamp: "1",
              },
              { hash: "0xtx2", contractAddress: "0xtoken", tokenSymbol: "USDC", from: "0xaaa", to: "0xbbb", value: "1" },
              {},
            ],
          });
        }
      }

      if (url.hostname === "base.easscan.org") {
        return okJson({
          data: {
            attestations: [
              {
                id: "a1",
                attester: "0xwallet",
                recipient: "0xsvc",
                schemaId: "s1",
                txid: "0xtx",
                time: "1",
                data: {},
              },
            ],
          },
        });
      }

      if (url.hostname === "api.dune.com") {
        if (url.pathname === "/api/v1/sql/execute") {
          return okJson({ execution_id: "exec-1" });
        }
        if (url.pathname === "/api/v1/execution/exec-1/results") {
          return okJson({
            state: "QUERY_STATE_COMPLETED",
            result: {
              rows: [
                {
                  blockTime: "2024-01-01T00:00:00Z",
                  txHash: "0xtx",
                  protocolName: "EscrowX",
                  category: "Escrow",
                  contractAddress: "0xcontract",
                  chainId: 8453,
                },
              ],
            },
          });
        }
      }

      return notOk(404);
    }),
  );
}

describe("server api logic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sends ApiResponse payloads to JsonResponder", () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    send(res, { status: 201, body: { ok: true } });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it("covers createApp route wiring", () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const processOnSpy = vi.spyOn(process, "on");
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    createApp({
      config: createTestConfig(),
      store,
    });
    expect(true).toBe(true);
    const signalHandlers = new Map(
      processOnSpy.mock.calls.map(([signal, handler]) => [signal, handler as () => void]),
    );
    signalHandlers.get("SIGTERM")?.();
    signalHandlers.get("SIGINT")?.();
    expect(processExitSpy).toHaveBeenCalledWith(0);

    const dataDir = mkdtempSync(join(tmpdir(), "afi-app-"));
    const prior = {
      AFI_DB_PATH: process.env.AFI_DB_PATH,
      AFI_DATA_DIR: process.env.AFI_DATA_DIR,
      AFI_LOCUS_BASE_URL: process.env.AFI_LOCUS_BASE_URL,
      AFI_EAS_BASE_URL: process.env.AFI_EAS_BASE_URL,
      AFI_EAS_SEPOLIA_URL: process.env.AFI_EAS_SEPOLIA_URL,
      AFI_ENABLE_BACKGROUND_JOBS: process.env.AFI_ENABLE_BACKGROUND_JOBS,
    };
    process.env.AFI_DB_PATH = ":memory:";
    process.env.AFI_DATA_DIR = dataDir;
    process.env.AFI_LOCUS_BASE_URL = "https://beta-api.paywithlocus.com";
    process.env.AFI_EAS_BASE_URL = "https://base.easscan.org/graphql";
    process.env.AFI_EAS_SEPOLIA_URL = "https://base-sepolia.easscan.org/graphql";
    process.env.AFI_ENABLE_BACKGROUND_JOBS = "false";
    try {
      createApp();
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      processOnSpy.mockRestore();
      processExitSpy.mockRestore();
    }
  });

  it("exposes health and interactions", () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    expect(api.health().status).toBe(200);
    expect(api.listInteractions().body).toEqual([]);
    expect(api.getInteraction("missing").status).toBe(404);
  });

  it("reuses an injected query cache for metrics and invalidates it on ingestion", async () => {
    const store = createTestStore();
    const queryCache = new QueryCache({
      agentMetricsTTL: 60,
      counterpartyMetricsTTL: 60,
      flowAggregateTTL: 60,
      interactionListTTL: 60,
      enablePerformanceMonitoring: true,
    });
    const getAgentMetricsSpy = vi.spyOn(queryCache, "getAgentMetrics");
    const getCounterpartyMetricsSpy = vi.spyOn(queryCache, "getCounterpartyMetrics");
    const getFlowAggregatesSpy = vi.spyOn(queryCache, "getFlowAggregates");
    const invalidateSpy = vi.spyOn(queryCache, "invalidateOnIngestion");

    const api = createApi({
      config: createTestConfig(),
      store,
      queryCache,
    });

    api.agentMetrics("0xABC");
    api.counterpartyMetrics("service1");
    api.flowAggregates({ wallet: "0xABC", protocol: "locus" });

    expect(getAgentMetricsSpy).toHaveBeenCalledWith(store, "0xABC");
    expect(getCounterpartyMetricsSpy).toHaveBeenCalledWith(store, "service1");
    expect(getFlowAggregatesSpy).toHaveBeenCalledWith(store, { wallet: "0xABC", protocol: "locus" });

    await api.ingestX402({
      headers: {},
      walletAddress: "0xABC",
      counterparty: "service1",
      service: "/pay/send",
    });

    expect(invalidateSpy).toHaveBeenCalledWith(["0xABC"], ["service1"]);
  });

  it("exposes parquet and cache admin endpoints", async () => {
    const store = createTestStore();
    const queryCache = new QueryCache();
    vi.spyOn(store, "bootstrapParquetExport").mockResolvedValue({
      success: true,
      results: {},
      errors: [],
    });
    vi.spyOn(store, "batchExportToParquet")
      .mockResolvedValueOnce({ interactions: { filePath: "ok.parquet", rowCount: 1, timestamp: "2024-01-01T00:00:00Z" } })
      .mockRejectedValueOnce("batch failed");
    const statsSpy = vi.spyOn(queryCache, "getStats");
    const invalidateSpy = vi.spyOn(queryCache, "invalidateAll");

    const api = createApi({
      config: createTestConfig(),
      store,
      queryCache,
    });
    const handlers = createRouteHandlers(api);
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    expect(await api.parquetBootstrap()).toEqual(
      expect.objectContaining({ status: 200, body: { success: true, results: {}, errors: [] } }),
    );
    expect(await api.parquetBatchExport()).toEqual(
      expect.objectContaining({
        status: 200,
        body: { interactions: { filePath: "ok.parquet", rowCount: 1, timestamp: "2024-01-01T00:00:00Z" } },
      }),
    );
    expect(await api.parquetBatchExport()).toEqual(expect.objectContaining({ status: 500, body: { error: "batch failed" } }));
    expect(api.flowAggregates({ wallet: "0xwallet" }).status).toBe(200);
    expect(api.cacheStats().status).toBe(200);
    expect(api.cacheInvalidate()).toEqual(expect.objectContaining({ status: 200, body: { ok: true, message: "cache_invalidated" } }));
    expect(statsSpy).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalled();

    await handlers.parquetBootstrap({}, res);
    await handlers.parquetBatchExport({}, res);
    handlers.flowAggregates({ query: { wallet: "0xwallet", startDate: "2024-01-01", endDate: "2024-01-02" } }, res);
    handlers.flowAggregates({ query: { counterparty: ["service1"], protocol: ["x402"] } }, res);
    handlers.cacheStats({}, res);
    handlers.cacheInvalidate({}, res);
    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it("runs query cache cleanup on the app interval", () => {
    vi.useFakeTimers();
    const queryCache = new QueryCache();
    const cleanupSpy = vi.spyOn(queryCache, "cleanup");

    createApp({
      config: createTestConfig(),
      store: createTestStore(),
      queryCache,
    });

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(cleanupSpy).toHaveBeenCalled();
  });

  it("returns enriched interaction rows from the list read model", () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "listed-1",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {
        paymentRequired: {
          amount: "2",
          asset: "0xtoken",
          network: 8453,
        },
      },
    });
    store.upsertPrice({
      id: "8453:0xtoken",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "TOK",
      price_usd: "1.5",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });
    store.upsertProtocolLabel({
      id: "8453:0xcontract",
      contract_address: "0xcontract",
      chain_id: 8453,
      protocol_name: "EscrowX",
      protocol_category: "escrow",
      source: "dune",
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    });

    const api = createApi({
      config: createTestConfig(),
      store,
    });

    expect(api.listInteractions().body).toEqual([
      expect.objectContaining({
        id: "listed-1",
        amountUSD: 3,
        protocolName: "EscrowX",
        protocolCategory: "escrow",
      }),
    ]);
  });

  it("ingests x402 interactions, including peac receipt and base enrichment", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const ingest = await api.ingestX402({
      headers: { "payment-required": "{\"amount\":\"1\"}", "peac-receipt": "{\"ok\":true}" },
      txHash: "0xtx",
      url: "https://example.com/paid?token=redacted",
      walletSnapshot: { id: "ws1", wallet_address: "0xwallet" },
    });
    expect((ingest.body as { ok: boolean }).ok).toBe(true);

    const detail = api.getInteractionPacket((ingest.body as { interactionId: string }).interactionId);
    expect(detail.status).toBe(200);
    expect((detail.body as unknown as { interaction: { counterparty?: string; service?: string } }).interaction).toEqual(
      expect.objectContaining({ counterparty: "example.com", service: "/paid" }),
    );
    expect((detail.body as unknown as { evidence: { receipts: unknown[] } }).evidence.receipts).toHaveLength(1);
    expect((detail.body as unknown as { correlations: { settlement: { status: string } } }).correlations.settlement.status).toBe(
      "confirmed",
    );
    expect(
      (detail.body as unknown as { protocol: { x402: { packet: { challenge: { present: boolean } } } } }).protocol.x402.packet.challenge.present,
    ).toBe(true);
    expect(
      (detail.body as unknown as { correlations: { baseTransaction: { tx_hash: string } } }).correlations.baseTransaction.tx_hash,
    ).toBe("0xtx");
    expect((detail.body as unknown as { version: string }).version).toBe("afi.packet/v1");
    expect((detail.body as unknown as { summary: { handshakeStatus: string } }).summary.handshakeStatus).toBe("challenge-only");
    expect((detail.body as unknown as { references: { transaction: { explorerUrl: string } } }).references.transaction.explorerUrl).toBe(
      "https://basescan.org/tx/0xtx",
    );
    expect((detail.body as unknown as { controls: { amount: number | null; source: string } }).controls).toEqual(
      expect.objectContaining({ amount: 1, source: "wallet_snapshot" }),
    );
    expect(store.getBaseTransaction("0xtx")?.tx_hash).toBe("0xtx");
    expect(store.getBaseTransaction("0xmissing")).toBeUndefined();

    store.upsertBaseTransaction({
      tx_hash: "0xblank",
      status: "confirmed",
      raw: { ok: true },
      created_at: "2024-01-01T00:00:00Z",
    });
    const blank = store.getBaseTransaction("0xblank");
    expect(blank?.block_number).toBeUndefined();
   expect(blank?.from).toBeUndefined();
   expect(blank?.to).toBeUndefined();
   expect(blank?.value).toBeUndefined();
  });

  it("correlates tx-hash receipts and transcript captures onto exported packets", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const ingest = await api.ingestX402({
      headers: {},
      transcript: {
        requestUrl: "https://example.com/paid",
        challenge: {
          status: 402,
          headers: {
            paymentRequired: "{\"amount\":\"1\",\"network\":\"base\"}",
          },
        },
        authorization: {
          paymentSignature: "{\"payer\":\"0xpayer\"}",
        },
        settlement: {
          status: 200,
          headers: {
            paymentResponse: "{\"success\":true,\"transaction\":\"0xtx-transcript\"}",
          },
        },
      },
    });

    await api.peacReceipt({ receipt: "{\"ok\":true}", txHash: "0xtx-transcript" });

    const packet = api.getInteractionPacket((ingest.body as { interactionId: string }).interactionId);

    expect(packet.status).toBe(200);
    expect((packet.body as unknown as { protocol: { x402: { transcript: { requestUrl: string } } } }).protocol.x402.transcript.requestUrl).toBe(
      "https://example.com/paid",
    );
    expect((packet.body as unknown as { evidence: { receipts: Array<{ id: string }> } }).evidence.receipts).toEqual([
      expect.objectContaining({ id: expect.any(String) }),
    ]);
  });

  it("correlates stored attestations onto interaction packets (case-insensitive)", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const ingest = await api.ingestX402({
      headers: {},
      txHash: "0xtx",
      walletAddress: "0xWALLET",
    });
    const interactionId = (ingest.body as { interactionId: string }).interactionId;

    store.upsertAttestations([
      {
        id: "att-1",
        attester: "0xwallet",
        recipient: "0xsvc",
        schema_id: "schema",
        tx_hash: "0xTX",
        chain_id: 8453,
        raw: { ok: true },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const detail = api.getInteraction(interactionId);
    const attestations = (detail.body as unknown as { attestations: Array<{ id: string }> }).attestations;
    expect(attestations.filter((row) => row.id === "att-1")).toHaveLength(1);
  });

  it("infers txHash from payment-response header during x402 ingestion", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const ingest = await api.ingestX402({
      headers: { "payment-response": "{\"transaction\":\"0xtx\"}" },
    });
    const interactionId = (ingest.body as { interactionId: string }).interactionId;

    const detail = api.getInteractionPacket(interactionId);
    expect(detail.status).toBe(200);
    expect((detail.body as unknown as { correlations: { settlement: { status: string; tx_hash?: string } } }).correlations.settlement).toEqual(
      expect.objectContaining({ status: "confirmed", tx_hash: "0xtx" }),
    );
    expect(
      (
        detail.body as unknown as {
          protocol: { x402: { packet: { settlement: { txHash?: string; present: boolean } } } };
        }
      ).protocol.x402.packet,
    ).toEqual(
      expect.objectContaining({
        settlement: expect.objectContaining({ present: true, txHash: "0xtx" }),
      }),
    );
    expect((detail.body as unknown as { evidence: { timeline: Array<{ kind: string }> } }).evidence.timeline.some((row) => row.kind === "base_tx")).toBe(
      true,
    );
  });

  it("returns enriched interaction detail with USD pricing from stored price snapshots", async () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "i-enriched",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {
        paymentRequired: {
          amount: "2",
          asset: "0xtoken",
          network: "8453",
        },
      },
    });
    store.upsertPrice({
      id: "8453:0xtoken",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "USDC",
      price_usd: "1.25",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });
    store.upsertProtocolLabel({
      id: "8453:0xcontract",
      contract_address: "0xcontract",
      chain_id: 8453,
      protocol_name: "EscrowX",
      protocol_category: "escrow",
      source: "dune",
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    });

    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const detail = api.getInteractionEnriched("i-enriched");
    expect(detail.status).toBe(200);
    expect((detail.body as { amountUSD: number | null }).amountUSD).toBe(2.5);
    expect(
      (
        detail.body as {
          interaction: {
            protocolName?: string;
            protocolCategory?: string;
            protocolLabel?: { source: string; labeledAt: string; metadata: Record<string, unknown> };
          };
        }
      ).interaction,
    ).toEqual(
      expect.objectContaining({
        protocolName: "EscrowX",
        protocolCategory: "escrow",
        protocolLabel: expect.objectContaining({
          source: "dune",
          labeledAt: "2024-01-01T00:00:00Z",
          metadata: {},
        }),
      }),
    );
  });

  it("refreshes protocol labels for a selected interaction and exposes provenance on packet export", async () => {
    vi.useFakeTimers();
    stubFetchForHappyPath();

    const store = createTestStore();
    store.upsertInteraction({
      id: "i-refresh",
      created_at: "2024-01-02T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {},
    });

    const api = createApi({
      config: createTestConfig({ duneApiKey: "test-dune-key" }),
      store,
    });

    const refreshPromise = api.enrichProtocolLabel("i-refresh");
    await vi.runAllTimersAsync();
    const refresh = await refreshPromise;
    const refreshBody = refresh.body as unknown as {
      refreshed: boolean;
      message: string;
      contractAddress: string;
      protocolLabel: { source: string; protocol_name?: string; metadata: Record<string, unknown> };
    };

    expect(refresh.status).toBe(200);
    expect(refreshBody).toEqual(
      expect.objectContaining({
        refreshed: true,
        message: "Protocol label refreshed",
        contractAddress: "0xcontract",
        protocolLabel: expect.objectContaining({
          source: "dune",
          protocol_name: "EscrowX",
          metadata: expect.objectContaining({
            refreshMode: "interaction",
            matchedBy: "contract",
          }),
        }),
      }),
    );

    const packet = api.getInteractionPacket("i-refresh");
    expect(packet.status).toBe(200);
    expect(
      (
        packet.body as {
          correlations: {
            protocolLabel?: { source: string; contract?: string; labeledAt: string; metadata: Record<string, unknown> };
          };
        }
      ).correlations.protocolLabel,
    ).toEqual(
      expect.objectContaining({
        source: "dune",
        contract: "0xcontract",
        labeledAt: expect.any(String),
        metadata: expect.objectContaining({
          refreshMode: "interaction",
        }),
      }),
    );
  });

  it("returns protocol refresh errors for missing contract and missing enrichment config", async () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "i-no-contract",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: {},
    });
    store.upsertInteraction({
      id: "i-no-config",
      created_at: "2024-01-01T00:00:00Z",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {},
    });

    const api = createApi({
      config: createTestConfig(),
      store,
    });

    expect((await api.enrichProtocolLabel("missing")).body).toEqual({ error: "not_found" });
    expect((await api.enrichProtocolLabel("i-no-contract")).body).toEqual({ error: "missing_protocol_contract" });
    expect((await api.enrichProtocolLabel("i-no-config")).body).toEqual({ error: "missing_protocol_enrichment_config" });
  });

  it("returns a deterministic unresolved protocol refresh result when no Dune match is found", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname === "api.dune.com" && url.pathname === "/api/v1/sql/execute") {
          return okJson({ execution_id: "exec-1" });
        }
        if (url.hostname === "api.dune.com" && url.pathname === "/api/v1/execution/exec-1/results") {
          return okJson({
            state: "QUERY_STATE_COMPLETED",
            result: {
              rows: [{ protocolName: "EscrowX", contractAddress: "0xother", chainId: 8453 }],
            },
          });
        }
        return notOk(404);
      }),
    );

    const store = createTestStore();
    store.upsertInteraction({
      id: "i-unresolved",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {},
    });

    const api = createApi({
      config: createTestConfig({ duneApiKey: "test-dune-key" }),
      store,
    });

    const refreshPromise = api.enrichProtocolLabel("i-unresolved");
    await vi.runAllTimersAsync();
    const refresh = await refreshPromise;

    expect(refresh.status).toBe(200);
    expect(refresh.body).toEqual({
      ok: true,
      refreshed: false,
      interactionId: "i-unresolved",
      contractAddress: "0xcontract",
      message: "Protocol label not resolved",
    });
  });

  it("falls back to Base chain pricing only when the asset is present and keeps invalid prices null", () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "i-enriched-fallback",
      created_at: "2024-01-01T00:00:00Z",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {
        paymentRequired: {
          amount: "2",
          asset: "0xtoken",
          network: "base",
        },
      },
    });
    store.upsertSettlement({
      id: "i-enriched-fallback:settlement",
      interaction_id: "i-enriched-fallback",
      tx_hash: "0xtx",
      status: "confirmed",
      metadata: {},
    });
    store.upsertPrice({
      id: "8453:0xtoken",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "TOK",
      price_usd: "not-a-number",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });
    store.upsertAttestations([
      {
        id: "att-by-tx",
        attester: "0xattester",
        recipient: "0xrecipient",
        schema_id: "schema",
        tx_hash: "0xtx",
        chain_id: 8453,
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const detail = api.getInteractionEnriched("i-enriched-fallback");
    expect(detail.status).toBe(200);
    expect((detail.body as { amountUSD: number | null }).amountUSD).toBeNull();
    expect((detail.body as { attestations: Array<{ id: string }> }).attestations).toEqual([
      expect.objectContaining({ id: "att-by-tx" }),
    ]);
  });

  it("returns x402 packet sections for challenge-only then full handshake ingestion", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const challengeOnly = await api.ingestX402({
      headers: { "payment-required": "{\"amount\":\"1\",\"network\":\"base\"}" },
      url: "https://example.com/paid",
    });
    const challengeDetail = api.getInteractionPacket((challengeOnly.body as { interactionId: string }).interactionId);
    expect(
      (
        challengeDetail.body as unknown as {
          protocol: { x402: { packet: { challenge: { present: boolean }; settlement: { present: boolean } } } };
        }
      ).protocol.x402.packet,
    ).toEqual(
      expect.objectContaining({
        challenge: expect.objectContaining({ present: true }),
        settlement: expect.objectContaining({ present: false }),
      }),
    );
    expect((challengeDetail.body as unknown as { correlations: { baseTransaction?: unknown } }).correlations.baseTransaction).toBeUndefined();

    const settled = await api.ingestX402({
      headers: {
        "payment-required": "{\"amount\":\"1\",\"network\":\"base\",\"payTo\":\"0xmerchant\"}",
        "payment-response": "{\"success\":true,\"transaction\":\"0xtx\",\"payer\":\"0xpayer\"}",
      },
      paymentSignature: "{\"payer\":\"0xpayer\"}",
      url: "https://example.com/paid",
    });
    const settledDetail = api.getInteractionPacket((settled.body as { interactionId: string }).interactionId);
    expect(
      (
        settledDetail.body as unknown as {
          protocol: {
            x402: { packet: { authorization: { hasSignature: boolean }; settlement: { success: boolean | null; txHash?: string } } };
          };
        }
      ).protocol.x402.packet,
    ).toEqual(
      expect.objectContaining({
        authorization: expect.objectContaining({ hasSignature: true }),
        settlement: expect.objectContaining({ success: true, txHash: "0xtx" }),
      }),
    );
    expect((settledDetail.body as unknown as { correlations: { baseTransaction: { status: string } } }).correlations.baseTransaction.status).toBe(
      "confirmed",
    );
  });

  it("sanitizes non-string ids and retains string metadata fields", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    // Test that validation rejects invalid txHash type
    const invalidIngest = await api.ingestX402({
      headers: { "payment-required": "{\"amount\":\"1\"}" },
      agentId: "agent-1",
      walletAddress: "0xwallet",
      counterparty: "svc",
      service: "/paid",
      txHash: 123,
      locusMetadata: { ok: true },
      walletSnapshot: { id: "ws1", wallet_address: "0xwallet" },
    } as unknown as Record<string, unknown>);
    expect(invalidIngest.status).toBe(400);

    // Test with valid types
    const ingest = await api.ingestX402({
      headers: { "payment-required": "{\"amount\":\"1\"}" },
      agentId: "agent-1",
      walletAddress: "0xwallet",
      counterparty: "svc",
      service: "/paid",
      txHash: "0xtx",
      locusMetadata: { ok: true },
      walletSnapshot: { id: "ws1", wallet_address: "0xwallet" },
    });
    const interactionId = (ingest.body as { interactionId: string }).interactionId;
    const detail = api.getInteraction(interactionId);
    expect(
      (
        detail.body as {
          interaction: { agent_id?: string; wallet_address?: string; counterparty?: string; service?: string };
        }
      ).interaction,
    ).toEqual(
      expect.objectContaining({ agent_id: "agent-1", wallet_address: "0xwallet", counterparty: "svc", service: "/paid" }),
    );

    // Test that validation rejects invalid types for all string fields
    const ingest2 = await api.ingestX402({
      headers: {},
      agentId: 123,
      walletAddress: 456,
      counterparty: true,
      service: { bad: true },
      url: 789,
    } as unknown as Record<string, unknown>);
    // Validation should reject this as a 400 error
    expect(ingest2.status).toBe(400);
    expect((ingest2.body as { error: string }).error).toContain("validation_error");
  });

  it("infers service identity from ingest urls and service metadata", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const fromUrl = await api.ingestX402({
      headers: { "payment-required": "{\"amount\":\"1\"}" },
      url: "https://payments.example.com/v1/quote?asset=usdc",
    });
    const urlInteraction = api.getInteraction((fromUrl.body as { interactionId: string }).interactionId);
    expect(
      (urlInteraction.body as { interaction: { counterparty?: string; service?: string } }).interaction,
    ).toEqual(expect.objectContaining({ counterparty: "payments.example.com", service: "/v1/quote" }));

    const fromLocusMetadata = await api.ingestX402({
      headers: { "payment-required": "{\"amount\":\"1\"}" },
      locusMetadata: { provider: "github", endpoint: "/repos/openai/codex" },
    });
    const metadataInteraction = api.getInteraction((fromLocusMetadata.body as { interactionId: string }).interactionId);
    expect(
      (metadataInteraction.body as { interaction: { counterparty?: string; service?: string } }).interaction,
    ).toEqual(expect.objectContaining({ counterparty: "github", service: "/repos/openai/codex" }));
  });

  it("keeps ingestion alive when base enrichment fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname === "base.blockscout.com" && url.searchParams.get("action") === "eth_getTransactionByHash") {
          return notOk(503);
        }
        return okJson({ ok: true });
      }),
    );
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const ingest = await api.ingestX402({ headers: {}, txHash: "0xtx" });
    expect(ingest.status).toBe(200);
  });

  it("covers PEAC receipt branches during x402 ingestion", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    // Test that validation now rejects invalid types
    const invalidIngest = await api.ingestX402({
      headers: { "peac-receipt": "{not-json}" },
      txHash: 123,
    } as unknown as Record<string, unknown>);
    expect(invalidIngest.status).toBe(400);
    expect((invalidIngest.body as { error: string }).error).toContain("validation_error");

    // Test with valid types
    const ingest = await api.ingestX402({
      headers: { "peac-receipt": "{not-json}" },
      txHash: "0xtx",
    });
    expect(ingest.status).toBe(200);
    expect(store.listReceiptsByInteraction((ingest.body as { interactionId: string }).interactionId)).toHaveLength(1);

    const ingest2 = await api.ingestX402({});
    expect(ingest2.status).toBe(200);
  });

  it("covers base and locus adapters through api helpers", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });

    expect((await api.enrichBase({})).status).toBe(400);
    expect((await api.enrichBase({ txHash: "0xtx" })).status).toBe(200);
    expect((await api.baseTx("0xtx")).body).toEqual(expect.objectContaining({ txHash: "0xtx" }));

    const history = await api.baseTxHistory("0xwallet");
    expect((history.body as unknown[]).length).toBe(4);
    expect(store.listBaseTransactionsByWallet("0xaaa").length).toBeGreaterThan(0);

    const transfers = await api.baseTransfers("0xwallet");
    expect((transfers.body as unknown[]).length).toBeGreaterThan(0);
    expect(store.listTokenTransfersByWallet("0xaaa").length).toBeGreaterThan(0);

    expect((await api.locusStatus()).status).toBe(200);
    expect((await api.locusTransactions()).status).toBe(200);
    expect((await api.locusRegister({ ok: true })).status).toBe(200);
    expect((await api.locusBalance()).status).toBe(200);
    expect((await api.locusSend({ amount: "1" })).status).toBe(200);
    expect((await api.locusWrappedMd()).status).toBe(200);
    expect((await api.locusWrappedCall("demo", "path", { ok: true })).status).toBe(200);
    expect((await api.locusX402("demo", { ok: true })).status).toBe(200);
    expect((await api.locusCheckoutPreflight("sess")).status).toBe(200);
    expect((await api.locusCheckoutPay("sess", { ok: true })).status).toBe(200);
    expect((await api.locusCheckoutPayment("tx-1")).status).toBe(200);
    expect((await api.locusIngestTransactions()).status).toBe(200);
  });

  it("persists live locus actions immediately and returns AFI capture metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname !== "beta-api.paywithlocus.com") return notOk(404);

        if (url.pathname === "/api/status") return okJson({ address: "0xwallet-live", status: "ok" });
        if (url.pathname === "/api/pay/balance") return okJson({ balance: "8", allowance: "4", maxTx: "2", approvalsRequired: false });
        if (url.pathname === "/api/pay/send") return okJson({ id: "send-1", txHash: "0xsend", status: "pending", counterparty: "0xrecipient" });
        if (url.pathname === "/api/wrapped/demo/path") return okJson({ id: "wrapped-1", amount: "3", currency: "USDC", status: "confirmed" });
        if (url.pathname === "/api/x402/demo") return okJson({ id: "x402-1", txHash: "0xx402", payTo: "0xmerchant", status: "confirmed" });
        if (url.pathname === "/api/checkout/agent/pay/sess") return okJson({ txId: "checkout-1", transaction: { hash: "0xcheckout" } });

        return notOk(404);
      }),
    );

    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key", locusAgentId: "agent-live" }),
      store,
    });

    const send = await api.locusSend({ amount: "1", currency: "USDC", to: "0xrecipient" });
    const wrapped = await api.locusWrappedCall("demo", "path", { amount: "3", currency: "USDC" });
    const x402 = await api.locusX402("demo", { amount: "4" });
    const checkout = await api.locusCheckoutPay("sess", { amount: "5" });

    expect(send.body).toEqual(expect.objectContaining({ afi: expect.objectContaining({ txHash: "0xsend", service: "/pay/send" }) }));
    expect(wrapped.body).toEqual(expect.objectContaining({ afi: expect.objectContaining({ counterparty: "demo", service: "path" }) }));
    expect(x402.body).toEqual(expect.objectContaining({ afi: expect.objectContaining({ counterparty: "0xmerchant", service: "demo" }) }));
    expect(checkout.body).toEqual(expect.objectContaining({ afi: expect.objectContaining({ txHash: "0xcheckout", service: "/checkout/sess/pay" }) }));

    const interactions = store.listInteractions();
    expect(interactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ wallet_address: "0xwallet-live", counterparty: "0xrecipient", service: "/pay/send", protocol: "locus" }),
        expect.objectContaining({ wallet_address: "0xwallet-live", counterparty: "demo", service: "path", protocol: "locus" }),
        expect.objectContaining({ wallet_address: "0xwallet-live", counterparty: "0xmerchant", service: "demo", protocol: "locus" }),
        expect.objectContaining({ wallet_address: "0xwallet-live", service: "/checkout/sess/pay", protocol: "locus" }),
      ]),
    );

    for (const result of [send, wrapped, x402, checkout]) {
      const interactionId = (result.body as { afi: { interactionId: string } }).afi.interactionId;
      expect(store.getInteraction(interactionId)).toBeDefined();
      expect(store.getWalletSnapshot(interactionId)).toEqual(expect.objectContaining({ wallet_address: "0xwallet-live" }));
      expect(store.getEvidence(interactionId).some((row) => row.kind === "locus")).toBe(true);
    }
  });

  it("keeps repeated thin live locus responses from collapsing into one interaction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname !== "beta-api.paywithlocus.com") return notOk(404);

        if (url.pathname === "/api/status") return okJson({ address: "0xwallet-thin", status: "ok" });
        if (url.pathname === "/api/pay/balance") return okJson({ balance: "8" });
        if (url.pathname === "/api/wrapped/demo/path") return okJson({ ok: true });

        return notOk(404);
      }),
    );

    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });

    const first = await api.locusWrappedCall("demo", "path", { ok: true });
    const second = await api.locusWrappedCall("demo", "path", { ok: true });

    const firstId = (first.body as { afi: { interactionId: string } }).afi.interactionId;
    const secondId = (second.body as { afi: { interactionId: string } }).afi.interactionId;

    expect(firstId).not.toBe(secondId);
    expect(
      store
        .listInteractions()
        .filter((row) => row.counterparty === "demo" && row.service === "path" && row.wallet_address === "0xwallet-thin"),
    ).toHaveLength(2);
  });

  it("keeps AFI capture observable when live snapshot enrichment fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname !== "beta-api.paywithlocus.com") return notOk(404);

        if (url.pathname === "/api/wrapped/demo/path") return okJson("queued");
        if (url.pathname === "/api/status") return notOk(500);
        if (url.pathname === "/api/pay/balance") return notOk(500);

        return notOk(404);
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });

    const result = await api.locusWrappedCall("demo", "path", { ok: true });
    const interactionId = (result.body as { afi: { interactionId: string } }).afi.interactionId;

    expect(result.body).toEqual(expect.objectContaining({ result: "queued" }));
    expect(store.getInteraction(interactionId)).toEqual(expect.objectContaining({ counterparty: "demo", service: "path" }));
    expect(store.getWalletSnapshot(interactionId)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("locus_snapshot_capture_failed", expect.objectContaining({ interactionId: expect.any(String) }));
  });

  it("falls back to status-derived live wallet snapshot values when Locus omits address and balance details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname !== "beta-api.paywithlocus.com") return notOk(404);

        if (url.pathname === "/api/status") return okJson({ balance: "11", status: "ok" });
        if (url.pathname === "/api/pay/balance") return okJson({ allowance: "2" });
        if (url.pathname === "/api/pay/send") return okJson({ id: "send-fallback" });

        return notOk(404);
      }),
    );

    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });

    const result = await api.locusSend({ amount: "1" });
    const interactionId = (result.body as { afi: { interactionId: string } }).afi.interactionId;
    const snapshot = store.getWalletSnapshot(interactionId);

    expect(snapshot?.id).toContain("wallet:unknown:");
    expect(snapshot?.wallet_address).toBeUndefined();
    expect(snapshot?.balance).toBe("11");
    expect(snapshot?.allowance).toBe("2");
  });

  it("covers locus ingest defaulting branches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname !== "beta-api.paywithlocus.com") return notOk(404);

        if (url.pathname === "/api/status") return okJson({ balance: "9", status: "ok" });
        if (url.pathname === "/api/pay/balance") return okJson({ allowance: "1" });
        if (url.pathname === "/api/pay/transactions") return okJson([{ txHash: "0xtx", counterparty: "svc" }]);

        return notOk(404);
      }),
    );

    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });

    const result = await api.locusIngestTransactions();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, count: 1 });

    const snapshot = store.getWalletSnapshot("locus:sync:unknown");
    expect(snapshot?.id.startsWith("wallet:unknown:")).toBe(true);
    expect(snapshot?.wallet_address).toBeUndefined();
    expect(snapshot?.balance).toBe("9");
    expect(snapshot?.approvals_required).toBe(false);
    expect(store.listInteractions().some((row) => row.protocol === "locus")).toBe(true);
  });

  it("captures provider/endpoint and slug service hints during locus ingestion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname !== "beta-api.paywithlocus.com") return notOk(404);

        if (url.pathname === "/api/status") return okJson({ address: "0xwallet", status: "ok" });
        if (url.pathname === "/api/pay/balance") return okJson({ balance: "2" });
        if (url.pathname === "/api/pay/transactions") {
          return okJson([
            { id: "wrapped-1", provider: "github", endpoint: "/repos/openai/codex", txHash: "0xtx1" },
            { id: "x402-1", slug: "demo-paid-endpoint", txHash: "0xtx2" },
          ]);
        }

        return notOk(404);
      }),
    );

    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });

    const result = await api.locusIngestTransactions();
    expect(result.status).toBe(200);

    const wrapped = store.listInteractions().find((row) => row.service === "/repos/openai/codex");
    const slugged = store.listInteractions().find((row) => row.service === "demo-paid-endpoint");

    expect(wrapped).toEqual(expect.objectContaining({ counterparty: "github", service: "/repos/openai/codex" }));
    expect(slugged).toEqual(expect.objectContaining({ service: "demo-paid-endpoint" }));
  });

  it("covers locus sync nullish fallbacks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.hostname === "beta-api.paywithlocus.com") {
          if (url.pathname === "/api/status") return okJson({ balance: "9", status: "ok" });
          if (url.pathname === "/api/pay/balance") return okJson({ allowance: "1" });
          if (url.pathname === "/api/pay/transactions") return okJson([]);
        }
        return notOk(404);
      }),
    );
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });

    const result = await api.locusIngestTransactions();
    expect(result.status).toBe(200);
  });

  it("routes call into api handlers without opening sockets", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });
    const handlers = createRouteHandlers(api);
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    handlers.health({}, res);
    handlers.listInteractions({}, res);
    handlers.getInteraction({ params: { id: "missing" } }, res);
    handlers.getInteractionEnriched({ params: { id: "missing" } }, res);
    handlers.getInteractionPacket({ params: { id: "missing" } }, res);
    await handlers.enrichProtocolLabel({ params: { id: "missing" } }, res);
    await handlers.ingestX402({ body: { headers: {}, txHash: "0xtx" } }, res);
    await handlers.enrichBase({ body: { txHash: "0xtx" } }, res);
    await handlers.baseTx({ params: { hash: "0xtx" } }, res);
    await handlers.baseTxHistory({ params: { address: "0xwallet" } }, res);
    await handlers.baseTransfers({ params: { address: "0xwallet" } }, res);

    await handlers.locusStatus({}, res);
    await handlers.locusTransactions({}, res);
    await handlers.locusRegister({ body: { ok: true } }, res);
    await handlers.locusRegister({}, res);
    await handlers.locusBalance({}, res);
    await handlers.locusSend({ body: { amount: "1" } }, res);
    await handlers.locusSend({}, res);
    await handlers.locusWrappedMd({}, res);
    await handlers.locusWrappedCall({ params: { provider: "demo", endpoint: "path" }, body: { ok: true } }, res);
    await handlers.locusWrappedCall({ params: { provider: "demo", endpoint: "path" } }, res);
    await handlers.locusX402({ params: { slug: "demo" }, body: { ok: true } }, res);
    await handlers.locusX402({ params: { slug: "demo" } }, res);
    await handlers.locusCheckoutPreflight({ params: { sessionId: "sess" } }, res);
    await handlers.locusCheckoutPay({ params: { sessionId: "sess" }, body: { ok: true } }, res);
    await handlers.locusCheckoutPay({ params: { sessionId: "sess" } }, res);
    await handlers.locusCheckoutPayment({ params: { txId: "tx-1" } }, res);
    await handlers.locusIngestTransactions({}, res);

    await handlers.easAttestations({ query: { address: "0xwallet" } }, res);
    await handlers.easAttestations({ query: {} }, res);
    await handlers.peacReceipt({ body: { receipt: "{\"ok\":true}" } }, res);
    await handlers.peacReceipt({}, res);
    await handlers.agentMetrics({ params: { wallet: "0xwallet" } }, res);
    await handlers.counterpartyMetrics({ params: { id: "svc" } }, res);

    expect(res.status).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it("handles eas, peac, and metrics endpoints", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "key" }),
      store,
    });

    expect((await api.easAttestations("")).status).toBe(400);
    const attestations = await api.easAttestations("0xwallet");
    expect((attestations.body as unknown[]).length).toBe(1);
    expect(store.listAttestationsByWallet("0xwallet")).toHaveLength(1);

    expect((await api.peacReceipt({})).status).toBe(400);
    expect((await api.peacReceipt({ receipt: 123 })).status).toBe(400);
    const ingest = await api.ingestX402({ headers: {} });
    const interactionId = (ingest.body as { interactionId: string }).interactionId;
    expect((await api.peacReceipt({ receipt: "{\"ok\":true}", interactionId, txHash: "0xtx" })).status).toBe(200);
    expect((await api.peacReceipt({ receipt: "not-json", interactionId })).status).toBe(200);
    expect((await api.peacReceipt({ receipt: "{\"ok\":true}", interactionId: "" })).status).toBe(200);
    const detail = api.getInteraction(interactionId);
    expect((detail.body as unknown as { evidence: Array<{ kind: string }> }).evidence.some((row) => row.kind === "peac")).toBe(
      true,
    );

    expect((await api.agentMetrics("0xwallet")).body).toEqual(expect.objectContaining({ wallet: "0xwallet" }));
    expect((await api.counterpartyMetrics("svc")).body).toEqual(expect.objectContaining({ counterparty: "svc" }));
  });

  it("omits x402 packet details for locus interactions", async () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "locus-1",
      created_at: "2024-01-01T00:00:00Z",
      agent_id: "agent-1",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/wrapped",
      protocol: "locus",
      summary: { locusTx: { id: "tx-1" } },
    });

    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const detail = api.getInteractionPacket("locus-1");
    expect(detail.status).toBe(200);
    expect((detail.body as unknown as { protocol: { kind: string; x402?: unknown } }).protocol).toEqual(
      expect.objectContaining({ kind: "locus", x402: undefined }),
    );
  });

  it("validates API request bodies with Zod schemas", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig({ locusApiKey: "test-key" }),
      store,
    });

    // Test ingestX402 validation - should accept valid input
    const validX402 = await api.ingestX402({
      headers: { "payment-required": "1" },
      txHash: "0xvalid",
      agentId: "agent-1",
      walletAddress: "0xwallet",
      counterparty: "service",
      service: "api",
      url: "https://example.com",
    });
    expect(validX402.status).toBe(200);

    // Test ingestX402 validation - should accept minimal valid input
    const minimalX402 = await api.ingestX402({ headers: {} });
    expect(minimalX402.status).toBe(200);

    // Test ingestX402 validation - should accept transcript
    const withTranscript = await api.ingestX402({
      headers: {},
      transcript: {
        requestUrl: "https://example.com/paid",
        challenge: { status: 402, headers: { paymentRequired: "1" } },
        authorization: { paymentSignature: "sig123" },
        settlement: { status: 200, headers: { paymentResponse: "ok" } },
      },
    });
    expect(withTranscript.status).toBe(200);

    // Test ingestX402 validation - should accept wallet snapshot
    const withSnapshot = await api.ingestX402({
      headers: {},
      walletSnapshot: {
        id: "snap-1",
        wallet_address: "0xwallet",
        balance: "100",
        allowance: "50",
        max_tx: "10",
        approvals_required: true,
      },
    });
    expect(withSnapshot.status).toBe(200);

    const withLegacyNumericSnapshot = await api.ingestX402({
      headers: {},
      walletSnapshot: {
        id: "snap-legacy",
        wallet_address: "0xwallet",
        approvals_required: 1,
      },
    });
    expect(withLegacyNumericSnapshot.status).toBe(200);
    expect(
      store.getWalletSnapshot((withLegacyNumericSnapshot.body as { interactionId: string }).interactionId)?.approvals_required,
    ).toBe(true);

    // Test ingestX402 validation - should reject invalid types
    const invalidX402Headers = await api.ingestX402({
      headers: "invalid", // should be object
    });
    expect(invalidX402Headers.status).toBe(400);
    expect((invalidX402Headers.body as { error: string }).error).toContain("validation_error");

    const invalidX402Transcript = await api.ingestX402({
      headers: {},
      transcript: "invalid", // should be object
    });
    expect(invalidX402Transcript.status).toBe(400);
    expect((invalidX402Transcript.body as { error: string }).error).toContain("validation_error");

    // Test peacReceipt validation - should accept valid input
    // First create an interaction to associate the receipt with
    const testIngest = await api.ingestX402({ headers: {} });
    const testInteractionId = (testIngest.body as { interactionId: string }).interactionId;

    const validReceipt = await api.peacReceipt({
      receipt: "{\"ok\":true}",
      interactionId: testInteractionId,
      txHash: "0xtx",
    });
    expect(validReceipt.status).toBe(200);

    // Test peacReceipt validation - should accept minimal valid input (receipt only)
    const minimalReceipt = await api.peacReceipt({
      receipt: "{\"data\":\"test\"}",
    });
    expect(minimalReceipt.status).toBe(200);

    // Test peacReceipt validation - should reject missing receipt
    const missingReceipt = await api.peacReceipt({});
    expect(missingReceipt.status).toBe(400);
    expect((missingReceipt.body as { error: string }).error).toContain("validation_error");

    // Test peacReceipt validation - should reject invalid receipt type
    const invalidReceiptType = await api.peacReceipt({
      receipt: 123, // should be string
    });
    expect(invalidReceiptType.status).toBe(400);
    expect((invalidReceiptType.body as { error: string }).error).toContain("validation_error");

    // Test peacReceipt validation - should reject invalid interactionId type
    const invalidInteractionIdType = await api.peacReceipt({
      receipt: "{\"ok\":true}",
      interactionId: 456, // should be string
    });
    expect(invalidInteractionIdType.status).toBe(400);
    expect((invalidInteractionIdType.body as { error: string }).error).toContain("validation_error");

    // Test peacReceipt validation - should reject invalid txHash type
    const invalidTxHashType = await api.peacReceipt({
      receipt: "{\"ok\":true}",
      txHash: true, // should be string
    });
    expect(invalidTxHashType.status).toBe(400);
    expect((invalidTxHashType.body as { error: string }).error).toContain("validation_error");

    const invalidReceipt = await api.peacReceipt({
      receipt: "",
    });
    expect(invalidReceipt.status).toBe(400);
    expect((invalidReceipt.body as { error: string }).error).toBe("invalid_receipt");
  });

  it("rejects locus calls when the key is missing", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const result = await api.locusStatus();
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("missing_locus_key");
  });

  it("returns enriched interaction details and exercises graceful shutdown hooks", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    store.upsertInteraction({
      id: "priced-1",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/quote",
      protocol: "x402",
      summary: { paymentRequired: { amount: "2", asset: "0xtoken", network: 8453 } },
    });
    store.upsertSettlement({
      id: "priced-1:settlement",
      interaction_id: "priced-1",
      tx_hash: "0xtx",
      status: "confirmed",
      metadata: {},
    });
    store.upsertPrice({
      id: "price-1",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "TOK",
      price_usd: "3",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });

    const api = createApi({ config: createTestConfig(), store });
    const enriched = api.getInteractionEnriched("priced-1");
    expect(enriched.status).toBe(200);
    expect((enriched.body as { amountUSD: number }).amountUSD).toBe(6);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    createApp({ config: createTestConfig({ duneApiKey: "test-key" }), store });

    process.emit("SIGTERM");
    process.emit("SIGINT");

    expect(logSpy).toHaveBeenCalledWith("SIGTERM received, stopping background jobs");
    expect(logSpy).toHaveBeenCalledWith("SIGINT received, stopping background jobs");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("lists interactions through the enriched read model callback", () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "list-1",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/quote",
      protocol: "x402",
      summary: { paymentRequired: { amount: "1", asset: "0xtoken", network: 8453 } },
    });
    store.upsertPrice({
      id: "list-price-1",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "TOK",
      price_usd: "5",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });

    const result = createApi({ config: createTestConfig(), store }).listInteractions();

    expect(result.status).toBe(200);
    expect(result.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "list-1",
          amountUSD: 5,
          service: "/quote",
        }),
      ]),
    );
  });

  it("parses string chain ids in enriched interactions and falls back when wallet attestations are absent", () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "priced-2",
      created_at: "2024-01-01T00:00:00Z",
      counterparty: "svc",
      service: "/quote",
      protocol: "x402",
      summary: { paymentRequired: { amount: "2", asset: "0xtoken", network: "8453" } },
    });
    store.upsertSettlement({
      id: "priced-2:settlement",
      interaction_id: "priced-2",
      tx_hash: "0xtx",
      status: "confirmed",
      metadata: {},
    });
    store.upsertPrice({
      id: "price-2",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "TOK",
      price_usd: "4",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });
    store.upsertAttestations([
      {
        id: "att-tx",
        tx_hash: "0xtx",
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const api = createApi({ config: createTestConfig(), store });
    const enriched = api.getInteractionEnriched("priced-2");

    expect(enriched.status).toBe(200);
    expect((enriched.body as { amountUSD: number }).amountUSD).toBe(8);
    expect((enriched.body as { attestations: unknown[] }).attestations).toHaveLength(1);
  });

  it("leaves enriched USD empty when payment fields are malformed or missing price data", () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "priced-bad-amount",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: { paymentRequired: { amount: 2, asset: "0xtoken", network: "oops" } },
    });
    store.upsertInteraction({
      id: "priced-no-price",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: { paymentRequired: { amount: "2", asset: "0xtoken" } },
    });

    expect((createApi({ config: createTestConfig(), store }).getInteractionEnriched("priced-bad-amount").body as { amountUSD: null }).amountUSD).toBeNull();
    expect((createApi({ config: createTestConfig(), store }).getInteractionEnriched("priced-no-price").body as { amountUSD: null }).amountUSD).toBeNull();
  });

  it("applies the read-model enrichment when listing interactions", () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "list-1",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/quote",
      protocol: "x402",
      summary: { paymentRequired: { amount: "2", asset: "0xtoken", network: 8453 } },
    });
    store.upsertPrice({
      id: "price-list-1",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "TOK",
      price_usd: "2",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });

    const result = createApi({ config: createTestConfig(), store }).listInteractions();
    expect(result.status).toBe(200);
    expect((result.body as Array<{ amountUSD: number }>)[0]?.amountUSD).toBe(4);
  });
});
