import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBQueryEngine, FeatureExtractor } from "../server/duckdb-queries";
import { Store } from "../server/store";

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

    it("executes raw SQL query", () => {
      store.upsertInteraction({
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
      store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T14:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
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
        store.upsertInteraction({
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
      store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
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
        store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertSettlement({
        id: "settlement-1",
        interaction_id: "int-1",
        status: "confirmed",
        metadata: {},
        created_at: "2024-01-15T10:01:00Z",
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertSettlement({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        protocol: "x402",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        protocol: "x402",
        summary: {},
      });

      store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T14:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
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
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertSettlement({
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
        store.upsertInteraction({
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
