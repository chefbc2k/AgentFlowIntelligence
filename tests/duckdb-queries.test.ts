import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBQueryEngine, FeatureExtractor } from "../server/duckdb-queries";
import { Store } from "../server/store";
import type { InteractionRecord, SettlementRecord } from "../server/types";

describe("DuckDBQueryEngine", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: Store;
  let engine: DuckDBQueryEngine;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "duckdb-test-"));
    dbPath = join(tmpDir, "test.db");
    store = new Store({ dbPath, dataDir: tmpDir });
    engine = new DuckDBQueryEngine(dbPath);
  });

  const upsertInteraction = (
    overrides: Partial<InteractionRecord> & Pick<InteractionRecord, "id" | "created_at">,
  ) => {
    store.upsertInteraction({
      protocol: "x402",
      summary: {},
      ...overrides,
    });
  };

  const upsertSettlement = (
    overrides: Partial<SettlementRecord> &
      Pick<SettlementRecord, "id" | "interaction_id" | "metadata"> & {
        status?: SettlementRecord["status"];
        created_at?: string;
      },
  ) => {
    const { created_at: _createdAt, status = "unknown", ...record } = overrides;
    store.upsertSettlement({
      status,
      ...record,
    });
  };

  afterEach(() => {
    engine.close();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("constructor and basic queries", () => {
    it("creates engine with memory database", () => {
      const memEngine = new DuckDBQueryEngine();
      expect(memEngine).toBeInstanceOf(DuckDBQueryEngine);
      memEngine.close();
    });

    it("creates engine with file database", () => {
      expect(engine).toBeInstanceOf(DuckDBQueryEngine);
    });

    it("wraps non-error query failures", () => {
      const prepareSpy = vi.spyOn((engine as unknown as { db: { prepare: (sql: string) => unknown } }).db, "prepare");
      prepareSpy.mockImplementation(() => {
        throw "boom";
      });

      expect(() => engine.query("select 1")).toThrow("Query failed: boom");
    });

    it("executes raw SQL query", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = engine.query<{ id: string }>("SELECT id FROM interactions");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("int-1");
    });

    it("executes query with parameters", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = engine.query<{ id: string }>("SELECT id FROM interactions WHERE wallet_address = ?", [
        "0xwallet",
      ]);
      expect(result).toHaveLength(1);
    });

    it("throws error on invalid SQL", () => {
      expect(() => engine.query("INVALID SQL")).toThrow("Query failed");
    });
  });

  describe("getInteractionCountByDate", () => {
    it("returns empty array for no interactions", () => {
      const result = engine.getInteractionCountByDate();
      expect(result).toEqual([]);
    });

    it("counts interactions by date", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T14:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-3",
        created_at: "2024-01-16T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = engine.getInteractionCountByDate();
      expect(result).toHaveLength(2);
      expect(result[0].date).toBe("2024-01-16");
      expect(result[0].count).toBe(1);
      expect(result[1].date).toBe("2024-01-15");
      expect(result[1].count).toBe(2);
    });
  });

  describe("getTopWalletsByInteractionCount", () => {
    it("returns empty array for no interactions", () => {
      const result = engine.getTopWalletsByInteractionCount();
      expect(result).toEqual([]);
    });

    it("returns top wallets by interaction count", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-3",
        created_at: "2024-01-15T12:00:00Z",
        wallet_address: "0xwallet2",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = engine.getTopWalletsByInteractionCount(10);
      expect(result).toHaveLength(2);
      expect(result[0].wallet_address).toBe("0xwallet1");
      expect(result[0].count).toBe(2);
      expect(result[1].wallet_address).toBe("0xwallet2");
      expect(result[1].count).toBe(1);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        upsertInteraction({
          id: `int-${i}`,
          created_at: "2024-01-15T10:00:00Z",
          wallet_address: `0xwallet${i}`,
          counterparty: "merchant-1",
          service: "service-1",
          summary: {},
        });
      }

      const result = engine.getTopWalletsByInteractionCount(3);
      expect(result).toHaveLength(3);
    });

    it("excludes null wallet addresses", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = engine.getTopWalletsByInteractionCount();
      expect(result).toEqual([]);
    });
  });

  describe("getTopCounterparties", () => {
    it("returns empty array for no interactions", () => {
      const result = engine.getTopCounterparties();
      expect(result).toEqual([]);
    });

    it("returns top counterparties by interaction count", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-3",
        created_at: "2024-01-15T12:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-2",
        service: "service-1",
        summary: {},
      });

      const result = engine.getTopCounterparties(10);
      expect(result).toHaveLength(2);
      expect(result[0].counterparty).toBe("merchant-1");
      expect(result[0].count).toBe(2);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        upsertInteraction({
          id: `int-${i}`,
          created_at: "2024-01-15T10:00:00Z",
          wallet_address: "0xwallet",
          counterparty: `merchant-${i}`,
          service: "service-1",
          summary: {},
        });
      }

      const result = engine.getTopCounterparties(3);
      expect(result).toHaveLength(3);
    });
  });

  describe("getSettlementSuccessRate", () => {
    it("returns empty array for no settlements", () => {
      const result = engine.getSettlementSuccessRate();
      expect(result).toEqual([]);
    });

    it("calculates settlement success rate by counterparty", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertSettlement({
        id: "settlement-1",
        interaction_id: "int-1",
        status: "confirmed",
        metadata: {},
        created_at: "2024-01-15T10:01:00Z",
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertSettlement({
        id: "settlement-2",
        interaction_id: "int-2",
        status: "failed",
        metadata: {},
        created_at: "2024-01-15T11:01:00Z",
      });

      const result = engine.getSettlementSuccessRate();
      expect(result).toHaveLength(1);
      expect(result[0].counterparty).toBe("merchant-1");
      expect(result[0].total).toBe(2);
      expect(result[0].confirmed).toBe(1);
      expect(result[0].rate).toBe(0.5);
    });
  });

  describe("getProtocolUsage", () => {
    it("returns empty array for no protocols", () => {
      const result = engine.getProtocolUsage();
      expect(result).toEqual([]);
    });

    it("counts protocol usage", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        protocol: "x402",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        protocol: "x402",
        summary: {},
      });

      upsertInteraction({
        id: "int-3",
        created_at: "2024-01-15T12:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        protocol: "locus",
        summary: {},
      });

      const result = engine.getProtocolUsage();
      expect(result).toHaveLength(2);
      expect(result[0].protocol).toBe("x402");
      expect(result[0].count).toBe(2);
    });
  });

  describe("getWalletActivitySummary", () => {
    it("returns empty array for unknown wallet", () => {
      const result = engine.getWalletActivitySummary("0xunknown");
      expect(result).toEqual([]);
    });

    it("summarizes wallet activity", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-16T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-2",
        service: "service-2",
        summary: {},
      });

      const result = engine.getWalletActivitySummary("0xwallet");
      expect(result).toHaveLength(1);
      expect(result[0].wallet_address).toBe("0xwallet");
      expect(result[0].total_interactions).toBe(2);
      expect(result[0].unique_counterparties).toBe(2);
      expect(result[0].first_seen).toBe("2024-01-15T10:00:00Z");
      expect(result[0].last_seen).toBe("2024-01-16T10:00:00Z");
    });
  });

  describe("getInteractionTimeSeries", () => {
    beforeEach(() => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T14:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-3",
        created_at: "2024-01-16T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });
    });

    it("groups by day", () => {
      const result = engine.getInteractionTimeSeries("day");
      expect(result).toHaveLength(2);
      expect(result[0].period).toBe("2024-01-16");
      expect(result[0].count).toBe(1);
      expect(result[1].period).toBe("2024-01-15");
      expect(result[1].count).toBe(2);
    });

    it("groups by hour", () => {
      const result = engine.getInteractionTimeSeries("hour");
      expect(result.length).toBeGreaterThan(0);
    });

    it("groups by week", () => {
      const result = engine.getInteractionTimeSeries("week");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("getTransactionsByStatus", () => {
    it("returns empty array for no transactions", () => {
      const result = engine.getTransactionsByStatus();
      expect(result).toEqual([]);
    });

    it("counts transactions by status", () => {
      store.upsertBaseTransaction({
        tx_hash: "0xtx1",
        status: "confirmed",
        block_number: "12345",
        from: "0xfrom",
        to: "0xto",
        value: "1000000000000000000",
        raw: {},
        created_at: "2024-01-15T10:00:00Z",
      });

      store.upsertBaseTransaction({
        tx_hash: "0xtx2",
        status: "confirmed",
        block_number: "12346",
        from: "0xfrom",
        to: "0xto",
        value: "2000000000000000000",
        raw: {},
        created_at: "2024-01-15T10:05:00Z",
      });

      store.upsertBaseTransaction({
        tx_hash: "0xtx3",
        status: "failed",
        block_number: "12347",
        from: "0xfrom",
        to: "0xto",
        value: "0",
        raw: {},
        created_at: "2024-01-15T10:10:00Z",
      });

      const result = engine.getTransactionsByStatus();
      expect(result).toHaveLength(2);
      expect(result[0].status).toBe("confirmed");
      expect(result[0].count).toBe(2);
      expect(result[1].status).toBe("failed");
      expect(result[1].count).toBe(1);
    });
  });

  describe("getTokenTransferVolume", () => {
    it("returns empty array for no transfers", () => {
      const result = engine.getTokenTransferVolume();
      expect(result).toEqual([]);
    });

    it("counts token transfer volume", () => {
      store.upsertTokenTransfers([
        {
          id: "transfer-1",
          tx_hash: "0xtx1",
          token_address: "0xusdc",
          token_symbol: "USDC",
          from: "0xfrom",
          to: "0xto",
          value: "1000000",
          raw: {},
          created_at: "2024-01-15T10:00:00Z",
        },
        {
          id: "transfer-2",
          tx_hash: "0xtx2",
          token_address: "0xusdc",
          token_symbol: "USDC",
          from: "0xfrom",
          to: "0xto",
          value: "2000000",
          raw: {},
          created_at: "2024-01-15T10:05:00Z",
        },
        {
          id: "transfer-3",
          tx_hash: "0xtx3",
          token_address: "0xusdt",
          token_symbol: "USDT",
          from: "0xfrom",
          to: "0xto",
          value: "500000",
          raw: {},
          created_at: "2024-01-15T10:10:00Z",
        },
      ]);

      const result = engine.getTokenTransferVolume();
      expect(result).toHaveLength(2);
      expect(result[0].token_symbol).toBe("USDC");
      expect(result[0].transfer_count).toBe(2);
    });

    it("handles null token symbols", () => {
      store.upsertTokenTransfers([
        {
          id: "transfer-1",
          tx_hash: "0xtx1",
          token_address: "0xtoken",
          from: "0xfrom",
          to: "0xto",
          value: "1000000",
          raw: {},
          created_at: "2024-01-15T10:00:00Z",
        },
      ]);

      const result = engine.getTokenTransferVolume();
      expect(result).toHaveLength(1);
      expect(result[0].token_symbol).toBe("unknown");
    });
  });

  describe("getInteractionHeatmap", () => {
    it("returns empty array for no interactions", () => {
      const result = engine.getInteractionHeatmap("0xwallet");
      expect(result).toEqual([]);
    });

    it("generates interaction heatmap", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T14:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = engine.getInteractionHeatmap("0xwallet");
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("day_of_week");
      expect(result[0]).toHaveProperty("hour");
      expect(result[0]).toHaveProperty("count");
    });
  });

  describe("getCounterpartyRepeatRate", () => {
    it("returns empty array for no interactions", () => {
      const result = engine.getCounterpartyRepeatRate();
      expect(result).toEqual([]);
    });

    it("calculates repeat rate for counterparties", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-3",
        created_at: "2024-01-15T12:00:00Z",
        wallet_address: "0xwallet2",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = engine.getCounterpartyRepeatRate();
      expect(result).toHaveLength(1);
      expect(result[0].counterparty).toBe("merchant-1");
      expect(result[0].total_interactions).toBe(3);
      expect(result[0].unique_wallets).toBe(2);
      expect(result[0].repeat_rate).toBe(1.5);
    });
  });

  describe("getRecentInteractionsWithContext", () => {
    it("returns empty array for no interactions", () => {
      const result = engine.getRecentInteractionsWithContext();
      expect(result).toEqual([]);
    });

    it("fetches recent interactions with settlement context", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertSettlement({
        id: "settlement-1",
        interaction_id: "int-1",
        tx_hash: "0xtx1",
        status: "confirmed",
        metadata: {},
        created_at: "2024-01-15T10:01:00Z",
      });

      const result = engine.getRecentInteractionsWithContext(10);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("int-1");
      expect(result[0].settlement_status).toBe("confirmed");
      expect(result[0].tx_hash).toBe("0xtx1");
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 100; i++) {
        upsertInteraction({
          id: `int-${i}`,
          created_at: `2024-01-15T${String(i % 24).padStart(2, "0")}:00:00Z`,
          wallet_address: "0xwallet",
          counterparty: "merchant-1",
          service: "service-1",
          summary: {},
        });
      }

      const result = engine.getRecentInteractionsWithContext(25);
      expect(result).toHaveLength(25);
    });
  });

  describe("getDashboardOverview", () => {
    it("builds a dashboard slice from filtered sqlite analytics data", () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xWallet1",
        counterparty: "merchant-1",
        service: "service-1",
        protocol: "x402",
        summary: {},
      });
      upsertSettlement({
        id: "settlement-1",
        interaction_id: "int-1",
        status: "confirmed",
        metadata: {},
        created_at: "2024-01-15T10:01:00Z",
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xWallet1",
        counterparty: "merchant-1",
        service: "service-2",
        protocol: "x402",
        summary: {},
      });
      upsertSettlement({
        id: "settlement-2",
        interaction_id: "int-2",
        status: "failed",
        metadata: {},
        created_at: "2024-01-15T11:01:00Z",
      });

      upsertInteraction({
        id: "int-3",
        created_at: "2024-01-16T09:00:00Z",
        wallet_address: "0xWallet2",
        counterparty: "merchant-2",
        service: "service-3",
        protocol: "locus",
        summary: {},
      });
      upsertSettlement({
        id: "settlement-3",
        interaction_id: "int-3",
        status: "confirmed",
        metadata: {},
        created_at: "2024-01-16T09:01:00Z",
      });

      const result = engine.getDashboardOverview(
        { wallet: "0xwallet1", protocol: "X402", startDate: "2024-01-15T00:00:00Z", endDate: "2024-01-15T23:59:59Z" },
        { topLimit: 1, recentLimit: 2 },
      );

      expect(result.filters.wallet).toBe("0xwallet1");
      expect(result.totals.totalInteractions).toBe(2);
      expect(result.totals.uniqueWallets).toBe(1);
      expect(result.totals.uniqueCounterparties).toBe(1);
      expect(result.totals.confirmedSettlements).toBe(1);
      expect(result.totals.settlementRate).toBe(0.5);
      expect(result.dailySeries).toEqual([
        expect.objectContaining({ date: "2024-01-15", count: 2 }),
      ]);
      expect(result.topWallets).toEqual([
        expect.objectContaining({ wallet_address: "0xWallet1", count: 2 }),
      ]);
      expect(result.topCounterparties).toEqual([
        expect.objectContaining({ counterparty: "merchant-1", count: 2 }),
      ]);
      expect(result.protocolSeries).toEqual([
        expect.objectContaining({ protocol: "x402", count: 2 }),
      ]);
      expect(result.settlementSuccessRateByCounterparty).toEqual([
        expect.objectContaining({ counterparty: "merchant-1", total: 2, confirmed: 1, rate: 0.5 }),
      ]);
      expect(result.recentInteractions).toEqual([
        expect.objectContaining({ id: "int-2", settlement_status: "failed", tx_hash: null }),
        expect.objectContaining({ id: "int-1", settlement_status: "confirmed", tx_hash: null }),
      ]);

      const counterpartyFiltered = engine.getDashboardOverview({ counterparty: "merchant-2" }, { topLimit: 1, recentLimit: 1 });
      expect(counterpartyFiltered.totals.totalInteractions).toBe(1);
      expect(counterpartyFiltered.topCounterparties).toEqual([
        expect.objectContaining({ counterparty: "merchant-2", count: 1 }),
      ]);
    });

    it("uses default dashboard limits and safely closes shared connections", () => {
      const result = engine.getDashboardOverview();

      expect(result.totals.totalInteractions).toBe(0);
      expect(result.recentInteractions).toEqual([]);

      const sharedEngine = new DuckDBQueryEngine(store.getDatabase());
      expect(() => sharedEngine.close()).not.toThrow();
    });
  });

  describe("getInteractionGraph", () => {
    it("returns null when the interaction does not exist", () => {
      expect(engine.getInteractionGraph("missing")).toBeNull();
    });

    it("handles sparse focus interactions and reuses graph paths and edges across repeated neighborhoods", () => {
      upsertInteraction({
        id: "focus-sparse",
        created_at: "2024-01-15T08:00:00Z",
        wallet_address: undefined,
        counterparty: undefined,
        service: undefined,
        protocol: "x402",
        summary: {},
      });
      store.upsertEvidence([
        {
          id: "focus-sparse:evidence",
          interaction_id: "focus-sparse",
          kind: "x402",
          payload: {},
          created_at: "2024-01-15T08:00:00Z",
        },
      ]);

      const sparseResult = engine.getInteractionGraph("focus-sparse");
      expect(sparseResult).not.toBeNull();
      expect(sparseResult?.summary).toEqual({
        totalInteractions: 1,
        totalEvidence: 1,
        uniqueWallets: 1,
        uniqueCounterparties: 1,
        uniqueServices: 1,
        settlementRate: 0,
      });
      expect(sparseResult?.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "wallet:unknown", kind: "wallet", highlighted: true }),
          expect.objectContaining({ id: "counterparty:unknown", kind: "counterparty", highlighted: true }),
          expect.objectContaining({ id: "service:unknown", kind: "service", highlighted: true }),
        ]),
      );

      upsertInteraction({
        id: "repeat-focus",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xWallet1",
        counterparty: "merchant-1",
        service: "/pay",
        protocol: "x402",
        summary: {},
      });
      upsertSettlement({
        id: "repeat-focus:settlement",
        interaction_id: "repeat-focus",
        status: "confirmed",
        tx_hash: "0xtx-repeat",
        metadata: {},
      });
      store.upsertEvidence([
        {
          id: "repeat-focus:x402",
          interaction_id: "repeat-focus",
          kind: "x402",
          payload: {},
          created_at: "2024-01-15T10:00:00Z",
        },
      ]);

      upsertInteraction({
        id: "repeat-neighbor-1",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xWallet2",
        counterparty: "merchant-1",
        service: "/quote",
        protocol: "locus",
        summary: {},
      });
      store.upsertEvidence([
        {
          id: "repeat-neighbor-1:locus",
          interaction_id: "repeat-neighbor-1",
          kind: "locus",
          payload: {},
          created_at: "2024-01-15T11:00:00Z",
        },
      ]);

      upsertInteraction({
        id: "repeat-neighbor-2",
        created_at: "2024-01-15T12:00:00Z",
        wallet_address: "0xWallet2",
        counterparty: "merchant-1",
        service: "/quote",
        protocol: "locus",
        summary: {},
      });
      store.upsertEvidence([
        {
          id: "repeat-neighbor-2:locus",
          interaction_id: "repeat-neighbor-2",
          kind: "locus",
          payload: {},
          created_at: "2024-01-15T12:00:00Z",
        },
        {
          id: "repeat-neighbor-2:receipt",
          interaction_id: "repeat-neighbor-2",
          kind: "receipt",
          payload: {},
          created_at: "2024-01-15T12:00:01Z",
        },
      ]);

      const repeatedResult = engine.getInteractionGraph("repeat-focus");
      expect(repeatedResult).not.toBeNull();
      expect(repeatedResult?.summary.settlementRate).toBeCloseTo(1 / 3);
      expect(repeatedResult?.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "counterparty_service:counterparty:merchant-1->service:/quote",
            interactionCount: 2,
            evidenceCount: 3,
            highlighted: false,
            settlementStatus: "missing",
          }),
        ]),
      );
      expect(repeatedResult?.paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "0xWallet2->merchant-1->/quote->unsettled->missing",
            interactionIds: expect.arrayContaining(["repeat-neighbor-1", "repeat-neighbor-2"]),
            interactionCount: 2,
            evidenceCount: 3,
            protocols: ["locus"],
            evidenceKinds: ["locus", "receipt"],
            highlighted: false,
          }),
        ]),
      );
    });

    it("builds a relationship graph neighborhood from interaction, settlement, and evidence facts", () => {
      upsertInteraction({
        id: "focus",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xWallet1",
        counterparty: "merchant-1",
        service: "/pay",
        protocol: "x402",
        summary: {},
      });
      upsertSettlement({
        id: "settlement-focus",
        interaction_id: "focus",
        status: "confirmed",
        tx_hash: "0xtx-focus",
        metadata: {},
      });
      store.upsertEvidence([
        {
          id: "focus:x402",
          interaction_id: "focus",
          kind: "x402",
          payload: {},
          created_at: "2024-01-15T10:00:00Z",
        },
        {
          id: "focus:receipt",
          interaction_id: "focus",
          kind: "receipt",
          payload: {},
          created_at: "2024-01-15T10:00:01Z",
        },
      ]);

      upsertInteraction({
        id: "neighbor",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xWallet2",
        counterparty: "merchant-1",
        service: "/quote",
        protocol: "locus",
        summary: {},
      });
      store.upsertEvidence([
        {
          id: "neighbor:locus",
          interaction_id: "neighbor",
          kind: "locus",
          payload: {},
          created_at: "2024-01-15T11:00:00Z",
        },
      ]);

      const result = engine.getInteractionGraph("focus");
      expect(result).not.toBeNull();
      expect(result?.summary).toEqual({
        totalInteractions: 2,
        totalEvidence: 3,
        uniqueWallets: 2,
        uniqueCounterparties: 1,
        uniqueServices: 2,
        settlementRate: 0.5,
      });
      expect(result?.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "wallet:0xwallet1", kind: "wallet", highlighted: true }),
          expect.objectContaining({ id: "counterparty:merchant-1", kind: "counterparty" }),
          expect.objectContaining({ id: "service:/pay", kind: "service", highlighted: true }),
          expect.objectContaining({ id: "settlement:0xtx-focus", kind: "settlement", highlighted: true }),
        ]),
      );
      expect(result?.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "wallet_counterparty:wallet:0xwallet1->counterparty:merchant-1",
            interactionCount: 1,
            evidenceCount: 2,
            highlighted: true,
            settlementStatus: "confirmed",
          }),
          expect.objectContaining({
            id: "counterparty_service:counterparty:merchant-1->service:/quote",
            interactionCount: 1,
            evidenceCount: 1,
            highlighted: false,
            settlementStatus: "missing",
          }),
        ]),
      );
      expect(result?.paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "0xWallet1->merchant-1->/pay->0xtx-focus->confirmed",
            interactionIds: ["focus"],
            protocols: ["x402"],
            evidenceKinds: ["receipt", "x402"],
            highlighted: true,
          }),
          expect.objectContaining({
            id: "0xWallet2->merchant-1->/quote->unsettled->missing",
            interactionIds: ["neighbor"],
            protocols: ["locus"],
            evidenceKinds: ["locus"],
            highlighted: false,
          }),
        ]),
      );
    });

    it("sorts equally highlighted graph paths by interaction count and id", () => {
      upsertInteraction({
        id: "order-focus",
        created_at: "2024-01-15T09:00:00Z",
        wallet_address: "0xOrder",
        counterparty: "merchant-order",
        service: "/alpha",
        protocol: "x402",
        summary: {},
      });
      upsertInteraction({
        id: "order-a",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xOrder2",
        counterparty: "merchant-order",
        service: "/alpha",
        protocol: "x402",
        summary: {},
      });
      upsertInteraction({
        id: "order-b",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xOrder2",
        counterparty: "merchant-order",
        service: "/alpha",
        protocol: "x402",
        summary: {},
      });
      upsertInteraction({
        id: "order-c",
        created_at: "2024-01-15T12:00:00Z",
        wallet_address: "0xOrder3",
        counterparty: "merchant-order",
        service: "/beta",
        protocol: "x402",
        summary: {},
      });
      upsertInteraction({
        id: "order-d",
        created_at: "2024-01-15T13:00:00Z",
        wallet_address: "0xOrder4",
        counterparty: "merchant-order",
        service: "/aardvark",
        protocol: "x402",
        summary: {},
      });

      const result = engine.getInteractionGraph("order-focus");
      expect(result).not.toBeNull();
      expect(result?.paths.map((path) => path.id)).toEqual([
        "0xOrder->merchant-order->/alpha->unsettled->missing",
        "0xOrder2->merchant-order->/alpha->unsettled->missing",
        "0xOrder3->merchant-order->/beta->unsettled->missing",
        "0xOrder4->merchant-order->/aardvark->unsettled->missing",
      ]);
    });
  });
});

describe("FeatureExtractor", () => {
  let extractor: FeatureExtractor;

  beforeEach(() => {
    extractor = new FeatureExtractor();
  });

  describe("extractTimeFeatures", () => {
    it("extracts time features from ISO timestamp", () => {
      const features = extractor.extractTimeFeatures("2024-01-15T10:30:00Z");

      expect(features.hour).toBe(10);
      expect(features.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(features.dayOfWeek).toBeLessThan(7);
      expect(features.dayOfMonth).toBe(15);
      expect(features.month).toBe(1);
      expect(typeof features.isWeekend).toBe("boolean");
      expect(typeof features.isBusinessHours).toBe("boolean");
    });

    it("identifies weekends", () => {
      const saturday = extractor.extractTimeFeatures("2024-01-13T10:00:00Z");
      const sunday = extractor.extractTimeFeatures("2024-01-14T10:00:00Z");
      const monday = extractor.extractTimeFeatures("2024-01-15T10:00:00Z");

      expect(saturday.isWeekend).toBe(true);
      expect(sunday.isWeekend).toBe(true);
      expect(monday.isWeekend).toBe(false);
    });

    it("identifies business hours", () => {
      const earlyMorning = extractor.extractTimeFeatures("2024-01-15T06:00:00Z");
      const businessHours = extractor.extractTimeFeatures("2024-01-15T14:00:00Z");
      const evening = extractor.extractTimeFeatures("2024-01-15T19:00:00Z");
      const weekend = extractor.extractTimeFeatures("2024-01-13T14:00:00Z");

      expect(earlyMorning.isBusinessHours).toBe(false);
      expect(businessHours.isBusinessHours).toBe(true);
      expect(evening.isBusinessHours).toBe(false);
      expect(weekend.isBusinessHours).toBe(false);
    });
  });

  describe("extractWalletFeatures", () => {
    it("handles empty interactions", () => {
      const features = extractor.extractWalletFeatures([]);

      expect(features.totalInteractions).toBe(0);
      expect(features.uniqueCounterparties).toBe(0);
      expect(features.repeatRate).toBe(0);
      expect(features.avgInteractionsPerDay).toBe(0);
      expect(features.daysSinceFirst).toBe(0);
    });

    it("extracts features from wallet interactions", () => {
      const interactions = [
        { created_at: "2024-01-15T10:00:00Z", counterparty: "merchant-1" },
        { created_at: "2024-01-15T14:00:00Z", counterparty: "merchant-1" },
        { created_at: "2024-01-16T10:00:00Z", counterparty: "merchant-2" },
        { created_at: "2024-01-17T10:00:00Z", counterparty: "merchant-1" },
      ];

      const features = extractor.extractWalletFeatures(interactions);

      expect(features.totalInteractions).toBe(4);
      expect(features.uniqueCounterparties).toBe(2);
      expect(features.repeatRate).toBe(2);
      expect(features.daysSinceFirst).toBeGreaterThan(1);
      expect(features.avgInteractionsPerDay).toBeGreaterThan(0);
    });

    it("handles null counterparties", () => {
      const interactions = [
        { created_at: "2024-01-15T10:00:00Z", counterparty: null },
        { created_at: "2024-01-15T14:00:00Z", counterparty: "merchant-1" },
      ];

      const features = extractor.extractWalletFeatures(interactions);

      expect(features.totalInteractions).toBe(2);
      expect(features.uniqueCounterparties).toBe(1);
    });

    it("handles same-day interactions", () => {
      const interactions = [
        { created_at: "2024-01-15T10:00:00Z", counterparty: "merchant-1" },
        { created_at: "2024-01-15T14:00:00Z", counterparty: "merchant-1" },
      ];

      const features = extractor.extractWalletFeatures(interactions);

      expect(features.totalInteractions).toBe(2);
      expect(features.daysSinceFirst).toBeLessThan(1);
      expect(features.avgInteractionsPerDay).toBeCloseTo(12);
    });

    it("handles interactions without counterparties on the same day", () => {
      const interactions = [
        { created_at: "2024-01-15T10:00:00Z", counterparty: null },
        { created_at: "2024-01-15T10:00:00Z", counterparty: null },
      ];

      const features = extractor.extractWalletFeatures(interactions);

      expect(features.totalInteractions).toBe(2);
      expect(features.uniqueCounterparties).toBe(0);
      expect(features.repeatRate).toBe(0);
      expect(features.avgInteractionsPerDay).toBe(2);
    });
  });

  describe("extractCounterpartyFeatures", () => {
    it("handles empty interactions", () => {
      const features = extractor.extractCounterpartyFeatures([]);

      expect(features.totalInteractions).toBe(0);
      expect(features.uniqueWallets).toBe(0);
      expect(features.avgInteractionsPerWallet).toBe(0);
      expect(features.concentrationRate).toBe(0);
    });

    it("extracts features from counterparty interactions", () => {
      const interactions = [
        { wallet_address: "0xwallet1", created_at: "2024-01-15T10:00:00Z" },
        { wallet_address: "0xwallet1", created_at: "2024-01-15T14:00:00Z" },
        { wallet_address: "0xwallet2", created_at: "2024-01-16T10:00:00Z" },
        { wallet_address: "0xwallet1", created_at: "2024-01-17T10:00:00Z" },
      ];

      const features = extractor.extractCounterpartyFeatures(interactions);

      expect(features.totalInteractions).toBe(4);
      expect(features.uniqueWallets).toBe(2);
      expect(features.avgInteractionsPerWallet).toBe(2);
      expect(features.concentrationRate).toBe(0.75);
    });

    it("handles null wallet addresses", () => {
      const interactions = [
        { wallet_address: null, created_at: "2024-01-15T10:00:00Z" },
        { wallet_address: "0xwallet1", created_at: "2024-01-15T14:00:00Z" },
      ];

      const features = extractor.extractCounterpartyFeatures(interactions);

      expect(features.totalInteractions).toBe(2);
      expect(features.uniqueWallets).toBe(1);
    });

    it("handles interactions without any wallet addresses", () => {
      const interactions = [
        { wallet_address: null, created_at: "2024-01-15T10:00:00Z" },
        { wallet_address: null, created_at: "2024-01-15T14:00:00Z" },
      ];

      const features = extractor.extractCounterpartyFeatures(interactions);

      expect(features.totalInteractions).toBe(2);
      expect(features.uniqueWallets).toBe(0);
      expect(features.avgInteractionsPerWallet).toBe(0);
      expect(features.concentrationRate).toBe(0);
    });
  });

  describe("calculateStats", () => {
    it("handles empty array", () => {
      const stats = extractor.calculateStats([]);

      expect(stats.count).toBe(0);
      expect(stats.sum).toBe(0);
      expect(stats.mean).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.median).toBe(0);
      expect(stats.stdDev).toBe(0);
    });

    it("calculates stats for numeric array", () => {
      const stats = extractor.calculateStats([1, 2, 3, 4, 5]);

      expect(stats.count).toBe(5);
      expect(stats.sum).toBe(15);
      expect(stats.mean).toBe(3);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(5);
      expect(stats.median).toBe(3);
      expect(stats.stdDev).toBeGreaterThan(0);
    });

    it("calculates median for even-length array", () => {
      const stats = extractor.calculateStats([1, 2, 3, 4]);

      expect(stats.median).toBe(2.5);
    });

    it("calculates median for odd-length array", () => {
      const stats = extractor.calculateStats([1, 2, 3]);

      expect(stats.median).toBe(2);
    });

    it("handles single value", () => {
      const stats = extractor.calculateStats([42]);

      expect(stats.count).toBe(1);
      expect(stats.mean).toBe(42);
      expect(stats.median).toBe(42);
      expect(stats.min).toBe(42);
      expect(stats.max).toBe(42);
      expect(stats.stdDev).toBe(0);
    });

    it("handles decimal values", () => {
      const stats = extractor.calculateStats([1.5, 2.5, 3.5]);

      expect(stats.mean).toBeCloseTo(2.5);
      expect(stats.median).toBeCloseTo(2.5);
    });
  });
});
