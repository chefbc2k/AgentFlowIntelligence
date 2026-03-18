import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach } from "vitest";
import { QueryCache } from "../server/query-cache";
import type { Store } from "../server/store";
import type { InteractionRecord } from "../server/types";

describe("QueryCache", () => {
  let cache: QueryCache;
  let mockStore: Store;

  beforeEach(() => {
    cache = new QueryCache({
      agentMetricsTTL: 1, // 1 second for faster testing
      counterpartyMetricsTTL: 1,
      flowAggregateTTL: 1,
      interactionListTTL: 1,
      enablePerformanceMonitoring: true,
    });

    // Create minimal mock store
    mockStore = {
      listInteractionsByWallet: (wallet: string) => {
        return [
          {
            id: "int1",
            created_at: "2024-01-01T00:00:00Z",
            protocol: "locus",
            wallet_address: wallet,
            counterparty: "service1",
            summary: {},
          },
        ] as InteractionRecord[];
      },
      listInteractionsByCounterparty: (counterparty: string) => {
        return [
          {
            id: "int2",
            created_at: "2024-01-02T00:00:00Z",
            protocol: "locus",
            counterparty,
            summary: {},
          },
        ] as InteractionRecord[];
      },
      listInteractions: () => {
        return [
          {
            id: "int1",
            created_at: "2024-01-01T00:00:00Z",
            protocol: "locus",
            summary: {},
          },
          {
            id: "int2",
            created_at: "2024-01-02T00:00:00Z",
            protocol: "x402",
            summary: {},
          },
        ] as InteractionRecord[];
      },
      getSettlement: () => undefined,
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
    } as unknown as Store;
  });

  describe("getAgentMetrics", () => {
    it("caches agent metrics queries", () => {
      const wallet = "0x123";

      // First call - cache miss
      const result1 = cache.getAgentMetrics(mockStore, wallet);
      expect(result1.wallet).toBe(wallet);

      const stats1 = cache.getStats();
      expect(stats1.hits).toBe(0);
      expect(stats1.misses).toBe(1);

      // Second call - cache hit
      const result2 = cache.getAgentMetrics(mockStore, wallet);
      expect(result2).toEqual(result1);

      const stats2 = cache.getStats();
      expect(stats2.hits).toBe(1);
      expect(stats2.misses).toBe(1);
      expect(stats2.hitRate).toBeCloseTo(0.5);
    });

    it("respects TTL for agent metrics", async () => {
      const wallet = "0x123";

      // First call
      cache.getAgentMetrics(mockStore, wallet);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Call after TTL - should be cache miss
      cache.getAgentMetrics(mockStore, wallet);

      const stats = cache.getStats();
      expect(stats.misses).toBe(2); // Both calls should be misses
    });

    it("handles case-insensitive wallet addresses", () => {
      cache.getAgentMetrics(mockStore, "0xABC");
      cache.getAgentMetrics(mockStore, "0xabc");

      const stats = cache.getStats();
      expect(stats.hits).toBe(1); // Second call should be a hit
    });
  });

  describe("getCounterpartyMetrics", () => {
    it("caches counterparty metrics queries", () => {
      const counterparty = "service1";

      // First call - cache miss
      const result1 = cache.getCounterpartyMetrics(mockStore, counterparty);
      expect(result1.counterparty).toBe(counterparty);

      // Second call - cache hit
      const result2 = cache.getCounterpartyMetrics(mockStore, counterparty);
      expect(result2).toEqual(result1);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it("handles case-insensitive counterparty names", () => {
      cache.getCounterpartyMetrics(mockStore, "Service1");
      cache.getCounterpartyMetrics(mockStore, "service1");

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
    });
  });

  describe("getFlowAggregates", () => {
    it("caches flow aggregate queries", () => {
      const filters = { wallet: "0x123" };

      // First call - cache miss
      const result1 = cache.getFlowAggregates(mockStore, filters);
      expect(result1.totalInteractions).toBeGreaterThan(0);

      // Second call - cache hit
      const result2 = cache.getFlowAggregates(mockStore, filters);
      expect(result2).toEqual(result1);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it("computes daily aggregates correctly", () => {
      const result = cache.getFlowAggregates(mockStore, {});

      expect(result.dailySeries).toHaveLength(2); // Two different dates
      expect(result.dailySeries[0].date).toBe("2024-01-01");
      expect(result.dailySeries[0].count).toBe(1);
      expect(result.dailySeries[1].date).toBe("2024-01-02");
    });

    it("computes protocol breakdown correctly", () => {
      const result = cache.getFlowAggregates(mockStore, {});

      expect(result.protocolSeries).toHaveLength(2);
      expect(result.protocolSeries.some((p) => p.protocol === "locus")).toBe(true);
      expect(result.protocolSeries.some((p) => p.protocol === "x402")).toBe(true);
      expect(result.uniqueProtocols).toBe(2);
    });

    it("filters by protocol", () => {
      const result = cache.getFlowAggregates(mockStore, { protocol: "locus" });

      expect(result.totalInteractions).toBe(1);
      expect(result.protocolSeries.every((p) => p.protocol === "locus")).toBe(true);
    });

    it("filters flow aggregates by start and end date", () => {
      const result = cache.getFlowAggregates(mockStore, {
        startDate: "2024-01-02T00:00:00Z",
        endDate: "2024-01-02T23:59:59Z",
      });

      expect(result.totalInteractions).toBe(1);
      expect(result.dailySeries).toEqual([
        expect.objectContaining({
          date: "2024-01-02",
          count: 1,
        }),
      ]);
    });

    it("caches different filter combinations separately", () => {
      const result1 = cache.getFlowAggregates(mockStore, { wallet: "0x123" });
      const result2 = cache.getFlowAggregates(mockStore, { counterparty: "service1" });

      expect(result1).not.toEqual(result2);

      const stats = cache.getStats();
      expect(stats.misses).toBe(2); // Both should be cache misses (different filters)
    });

    it("aggregates multiple interactions on the same day into one daily bucket", () => {
      mockStore.listInteractions = () =>
        [
          {
            id: "int-same-day-1",
            created_at: "2024-01-01T00:00:00Z",
            protocol: "locus",
            counterparty: "service1",
            summary: {},
          },
          {
            id: "int-same-day-2",
            created_at: "2024-01-01T12:00:00Z",
            protocol: "x402",
            counterparty: "service2",
            summary: {},
          },
        ] as unknown as ReturnType<Store["listInteractions"]>;

      const result = cache.getFlowAggregates(mockStore, {});

      expect(result.dailySeries).toEqual([
        expect.objectContaining({
          date: "2024-01-01",
          count: 2,
        }),
      ]);
    });
  });

  describe("getDashboardAnalytics", () => {
    it("caches dashboard analytics queries against the shared store database", () => {
      const db = new DatabaseSync(":memory:");
      db.exec(`
        CREATE TABLE interactions (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          agent_id TEXT,
          wallet_address TEXT,
          counterparty TEXT,
          service TEXT,
          protocol TEXT,
          summary TEXT NOT NULL
        );
        CREATE TABLE settlements (
          id TEXT PRIMARY KEY,
          interaction_id TEXT NOT NULL,
          tx_hash TEXT,
          chain_id INTEGER,
          status TEXT NOT NULL,
          metadata TEXT NOT NULL
        );
      `);
      db.prepare(
        `INSERT INTO interactions (id, created_at, wallet_address, counterparty, service, protocol, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run("dash-1", "2024-01-01T00:00:00Z", "0xabc", "merchant-1", "service-1", "x402", "{}");
      db.prepare(
        `INSERT INTO settlements (id, interaction_id, status, metadata)
         VALUES (?, ?, ?, ?)`,
      ).run("settlement-1", "dash-1", "confirmed", "{}");

      const dashboardStore = {
        getDatabase: () => db,
      } as unknown as Store;

      const result1 = cache.getDashboardAnalytics(dashboardStore, { wallet: "0xABC" }, { topLimit: 1, recentLimit: 1 });
      const result2 = cache.getDashboardAnalytics(dashboardStore, { wallet: "0xABC" }, { topLimit: 1, recentLimit: 1 });

      expect(result1.totals.totalInteractions).toBe(1);
      expect(result1.totals.settlementRate).toBe(1);
      expect(result1.topCounterparties).toEqual([{ counterparty: "merchant-1", count: 1 }]);
      expect(result2).toEqual(result1);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      db.close();
    });
  });

  describe("getInteractionsList", () => {
    it("caches interaction list queries", () => {
      // First call - cache miss
      const result1 = cache.getInteractionsList(mockStore, { wallet: "0x123" });
      expect(result1).toHaveLength(1);

      // Second call - cache hit
      const result2 = cache.getInteractionsList(mockStore, { wallet: "0x123" });
      expect(result2).toEqual(result1);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it("supports filtering by wallet", () => {
      const result = cache.getInteractionsList(mockStore, { wallet: "0x123" });
      expect(result).toHaveLength(1);
      expect(result[0].wallet_address).toBe("0x123");
    });

    it("supports filtering by counterparty", () => {
      const result = cache.getInteractionsList(mockStore, { counterparty: "service1" });
      expect(result).toHaveLength(1);
      expect(result[0].counterparty).toBe("service1");
    });

    it("lists all interactions when no filter is provided", () => {
      const result = cache.getInteractionsList(mockStore, {});
      expect(result).toHaveLength(2);
    });
  });

  describe("invalidateOnIngestion", () => {
    it("invalidates specific wallet caches", () => {
      const wallet = "0x123";

      // Prime the cache
      cache.getAgentMetrics(mockStore, wallet);
      expect(cache.getStats().size).toBeGreaterThan(0);

      // Invalidate
      cache.invalidateOnIngestion([wallet], []);

      // Next call should be a cache miss
      cache.resetStats();
      cache.getAgentMetrics(mockStore, wallet);
      expect(cache.getStats().misses).toBe(1);
      expect(cache.getStats().hits).toBe(0);
    });

    it("invalidates specific counterparty caches", () => {
      const counterparty = "service1";

      // Prime the cache
      cache.getCounterpartyMetrics(mockStore, counterparty);

      // Invalidate
      cache.invalidateOnIngestion([], [counterparty]);

      // Next call should be a cache miss
      cache.resetStats();
      cache.getCounterpartyMetrics(mockStore, counterparty);
      expect(cache.getStats().misses).toBe(1);
    });

    it("invalidates all flow aggregates and interaction lists", () => {
      // Prime the cache
      cache.getFlowAggregates(mockStore, {});
      cache.getInteractionsList(mockStore, {});

      const sizeBefore = cache.getStats().size;

      // Invalidate
      cache.invalidateOnIngestion(["0x123"], ["service1"]);

      // Flow aggregates and interaction lists should be cleared
      const sizeAfter = cache.getStats().size;
      expect(sizeAfter).toBeLessThan(sizeBefore);
    });

    it("handles multiple wallets and counterparties", () => {
      // Prime the cache
      cache.getAgentMetrics(mockStore, "0x123");
      cache.getAgentMetrics(mockStore, "0x456");
      cache.getCounterpartyMetrics(mockStore, "service1");
      cache.getCounterpartyMetrics(mockStore, "service2");

      // Invalidate multiple
      cache.invalidateOnIngestion(["0x123", "0x456"], ["service1", "service2"]);

      // All should be cache misses
      cache.resetStats();
      cache.getAgentMetrics(mockStore, "0x123");
      cache.getAgentMetrics(mockStore, "0x456");
      cache.getCounterpartyMetrics(mockStore, "service1");
      cache.getCounterpartyMetrics(mockStore, "service2");

      const stats = cache.getStats();
      expect(stats.misses).toBe(4);
      expect(stats.hits).toBe(0);
    });
  });

  describe("invalidateAll", () => {
    it("clears entire cache", () => {
      // Prime the cache
      cache.getAgentMetrics(mockStore, "0x123");
      cache.getCounterpartyMetrics(mockStore, "service1");
      cache.getFlowAggregates(mockStore, {});

      expect(cache.getStats().size).toBeGreaterThan(0);

      // Invalidate all
      cache.invalidateAll();

      expect(cache.getStats().size).toBe(0);
    });
  });

  describe("getStats", () => {
    it("returns accurate cache statistics", () => {
      // Perform some operations
      cache.getAgentMetrics(mockStore, "0x123"); // miss
      cache.getAgentMetrics(mockStore, "0x123"); // hit
      cache.getCounterpartyMetrics(mockStore, "service1"); // miss
      cache.getCounterpartyMetrics(mockStore, "service1"); // hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(0.5);
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe("getPerformanceMetrics", () => {
    it("tracks performance metrics when enabled", () => {
      cache.getAgentMetrics(mockStore, "0x123");
      cache.getCounterpartyMetrics(mockStore, "service1");

      const metrics = cache.getPerformanceMetrics();
      expect(metrics).toHaveLength(2);
      expect(metrics[0].queryType).toBe("agent_metrics");
      expect(metrics[0].cacheHit).toBe(false);
      expect(metrics[0].executionTimeMs).toBeGreaterThan(0);
      expect(metrics[1].queryType).toBe("counterparty_metrics");
    });

    it("does not track metrics when disabled", () => {
      const cacheWithoutMonitoring = new QueryCache({ enablePerformanceMonitoring: false });

      cacheWithoutMonitoring.getAgentMetrics(mockStore, "0x123");

      const metrics = cacheWithoutMonitoring.getPerformanceMetrics();
      expect(metrics).toHaveLength(0);
    });

    it("limits performance log to 1000 entries", () => {
      // Generate more than 1000 entries
      for (let i = 0; i < 1100; i++) {
        cache.getAgentMetrics(mockStore, `0x${i}`);
      }

      const metrics = cache.getPerformanceMetrics();
      expect(metrics).toHaveLength(1000);
    });
  });

  describe("clearPerformanceMetrics", () => {
    it("clears performance metrics log", () => {
      cache.getAgentMetrics(mockStore, "0x123");
      expect(cache.getPerformanceMetrics()).toHaveLength(1);

      cache.clearPerformanceMetrics();
      expect(cache.getPerformanceMetrics()).toHaveLength(0);
    });
  });

  describe("cleanup", () => {
    it("removes expired cache entries", async () => {
      // Add some entries
      cache.getAgentMetrics(mockStore, "0x123");
      cache.getCounterpartyMetrics(mockStore, "service1");

      const sizeBefore = cache.getStats().size;
      expect(sizeBefore).toBeGreaterThan(0);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Cleanup
      cache.cleanup();

      const sizeAfter = cache.getStats().size;
      expect(sizeAfter).toBe(0);
    });
  });

  describe("resetStats", () => {
    it("resets hit and miss counters", () => {
      cache.getAgentMetrics(mockStore, "0x123");
      cache.getAgentMetrics(mockStore, "0x123");

      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().misses).toBe(1);

      cache.resetStats();

      expect(cache.getStats().hits).toBe(0);
      expect(cache.getStats().misses).toBe(0);
    });
  });

  describe("cache key generation", () => {
    it("generates unique keys for different queries", () => {
      cache.getAgentMetrics(mockStore, "0x123");
      cache.getAgentMetrics(mockStore, "0x456");

      // Both should be cache misses (different wallets)
      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
      expect(stats.hits).toBe(0);
    });

    it("generates same key for equivalent filter objects", () => {
      cache.getFlowAggregates(mockStore, { wallet: "0x123", protocol: "locus" });
      cache.getFlowAggregates(mockStore, { wallet: "0x123", protocol: "locus" });

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("handles empty filter objects", () => {
      const result = cache.getFlowAggregates(mockStore, {});
      expect(result.totalInteractions).toBeGreaterThan(0);
    });

    it("handles missing optional fields", () => {
      const result = cache.getFlowAggregates(mockStore, {
        startDate: undefined,
        endDate: undefined,
      });
      expect(result).toBeDefined();
    });

    it("handles concurrent cache access", () => {
      const wallet = "0x123";

      // Simulate concurrent requests
      const promises = Array.from({ length: 10 }, () => Promise.resolve(cache.getAgentMetrics(mockStore, wallet)));

      return Promise.all(promises).then((results) => {
        // All results should be identical
        const first = results[0];
        results.forEach((result) => {
          expect(result).toEqual(first);
        });

        const stats = cache.getStats();
        expect(stats.hits).toBeGreaterThan(0); // At least some should be cache hits
      });
    });
  });
});
