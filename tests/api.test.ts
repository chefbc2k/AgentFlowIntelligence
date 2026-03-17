import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi, createApp, createRouteHandlers, send } from "../server/index";
import type { AppConfig } from "../server/config";
import { Store } from "../server/store";

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

      return notOk(404);
    }),
  );
}

describe("server api logic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(ingest.body.ok).toBe(true);

    const detail = api.getInteraction((ingest.body as { interactionId: string }).interactionId);
    expect(detail.status).toBe(200);
    expect((detail.body as { interaction: { counterparty?: string; service?: string } }).interaction).toEqual(
      expect.objectContaining({ counterparty: "example.com", service: "/paid" }),
    );
    expect((detail.body as { receipts: unknown[] }).receipts).toHaveLength(1);
    expect((detail.body as { settlement: { status: string } }).settlement.status).toBe("confirmed");
    expect((detail.body as { x402: { challenge: { present: boolean } } }).x402.challenge.present).toBe(true);
    expect((detail.body as { baseTransaction: { tx_hash: string } }).baseTransaction.tx_hash).toBe("0xtx");
    expect((detail.body as { controls: { amount: number | null; source: string } }).controls).toEqual(
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
    const attestations = (detail.body as { attestations: Array<{ id: string }> }).attestations;
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

    const detail = api.getInteraction(interactionId);
    expect(detail.status).toBe(200);
    expect((detail.body as { settlement: { status: string; tx_hash?: string } }).settlement).toEqual(
      expect.objectContaining({ status: "confirmed", tx_hash: "0xtx" }),
    );
    expect((detail.body as { x402: { settlement: { txHash?: string; present: boolean } } }).x402).toEqual(
      expect.objectContaining({
        settlement: expect.objectContaining({ present: true, txHash: "0xtx" }),
      }),
    );
    expect(
      (detail.body as { evidence: Array<{ kind: string }> }).evidence.some((row) => row.kind === "base_tx"),
    ).toBe(true);
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
      (detail.body as { interaction: { protocolName?: string; protocolCategory?: string } }).interaction,
    ).toEqual(expect.objectContaining({ protocolName: "EscrowX", protocolCategory: "escrow" }));
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
    const challengeDetail = api.getInteraction((challengeOnly.body as { interactionId: string }).interactionId);
    expect((challengeDetail.body as { x402: { challenge: { present: boolean }; settlement: { present: boolean } } }).x402).toEqual(
      expect.objectContaining({
        challenge: expect.objectContaining({ present: true }),
        settlement: expect.objectContaining({ present: false }),
      }),
    );
    expect((challengeDetail.body as { baseTransaction?: unknown }).baseTransaction).toBeUndefined();

    const settled = await api.ingestX402({
      headers: {
        "payment-required": "{\"amount\":\"1\",\"network\":\"base\",\"payTo\":\"0xmerchant\"}",
        "payment-response": "{\"success\":true,\"transaction\":\"0xtx\",\"payer\":\"0xpayer\"}",
      },
      paymentSignature: "{\"payer\":\"0xpayer\"}",
      url: "https://example.com/paid",
    });
    const settledDetail = api.getInteraction((settled.body as { interactionId: string }).interactionId);
    expect((settledDetail.body as { x402: { authorization: { hasSignature: boolean }; settlement: { success: boolean | null; txHash?: string } } }).x402).toEqual(
      expect.objectContaining({
        authorization: expect.objectContaining({ hasSignature: true }),
        settlement: expect.objectContaining({ success: true, txHash: "0xtx" }),
      }),
    );
    expect((settledDetail.body as { baseTransaction: { status: string } }).baseTransaction.status).toBe("confirmed");
  });

  it("sanitizes non-string ids and retains string metadata fields", async () => {
    stubFetchForHappyPath();
    const store = createTestStore();
    const api = createApi({
      config: createTestConfig(),
      store,
    });

    const ingest = await api.ingestX402({
      headers: { "payment-required": "{\"amount\":\"1\"}" },
      agentId: "agent-1",
      walletAddress: "0xwallet",
      counterparty: "svc",
      service: "/paid",
      txHash: 123,
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

    const ingest2 = await api.ingestX402({
      headers: {},
      agentId: 123,
      walletAddress: 456,
      counterparty: true,
      service: { bad: true },
      url: 789,
    });
    const detail2 = api.getInteraction((ingest2.body as { interactionId: string }).interactionId);
    expect(
      (
        detail2.body as {
          interaction: {
            agent_id?: string | null;
            wallet_address?: string | null;
            counterparty?: string | null;
            service?: string | null;
          };
        }
      ).interaction.agent_id == null,
    ).toBe(true);
    expect(
      (
        detail2.body as {
          interaction: {
            counterparty?: string | null;
            service?: string | null;
          };
        }
      ).interaction.service == null,
    ).toBe(true);
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

    const ingest = await api.ingestX402({
      headers: { "peac-receipt": "{not-json}" },
      txHash: 123,
    } as unknown as Record<string, unknown>);
    expect(ingest.status).toBe(200);

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
    expect((detail.body as { evidence: Array<{ kind: string }> }).evidence.some((row) => row.kind === "peac")).toBe(true);

    expect((await api.agentMetrics("0xwallet")).body).toEqual(expect.objectContaining({ wallet: "0xwallet" }));
    expect((await api.counterpartyMetrics("svc")).body).toEqual(expect.objectContaining({ counterparty: "svc" }));
  });

  it("omits x402 transcript details for locus interactions", async () => {
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

    const detail = api.getInteraction("locus-1");
    expect(detail.status).toBe(200);
    expect((detail.body as { x402?: unknown }).x402).toBeUndefined();
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
    createApp({ config: createTestConfig(), store });

    process.emit("SIGTERM");
    process.emit("SIGINT");

    expect(logSpy).toHaveBeenCalledWith("SIGTERM received, stopping background jobs");
    expect(logSpy).toHaveBeenCalledWith("SIGINT received, stopping background jobs");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
