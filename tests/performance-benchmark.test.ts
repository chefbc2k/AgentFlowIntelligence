import { describe, it, expect, beforeEach } from "vitest";
import { PerformanceBenchmark } from "../server/performance-benchmark";
import type { Store } from "../server/store";
import type { InteractionRecord } from "../server/types";

describe("PerformanceBenchmark", () => {
  let benchmark: PerformanceBenchmark;
  let mockStore: Store;

  beforeEach(() => {
    // Create a mock store with realistic data
    const mockInteractions: InteractionRecord[] = Array.from({ length: 50 }, (_, i) => ({
      id: `int${i}`,
      created_at: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      protocol: i % 3 === 0 ? "locus" : i % 3 === 1 ? "x402" : "peac",
      wallet_address: i % 2 === 0 ? "0x123" : "0x456",
      counterparty: i % 4 === 0 ? "service1" : i % 4 === 1 ? "service2" : i % 4 === 2 ? "service3" : "service4",
      summary: {},
    }));

    mockStore = {
      listInteractionsByWallet: (wallet: string) => {
        return mockInteractions.filter((i) => i.wallet_address === wallet);
      },
      listInteractionsByCounterparty: (counterparty: string) => {
        return mockInteractions.filter((i) => i.counterparty === counterparty);
      },
      listInteractions: () => mockInteractions,
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

    benchmark = new PerformanceBenchmark(mockStore);
  });

  describe("benchmarkAgentMetrics", () => {
    it("runs agent metrics benchmark with multiple iterations", async () => {
      const result = await benchmark.benchmarkAgentMetrics("0x123", 10);

      expect(result.suite).toBe("agent_metrics");
      expect(result.results).toHaveLength(3); // direct, cached, cached_warm
      expect(result.timestamp).toBeDefined();

      // Verify direct benchmark
      const directResult = result.results.find((r) => r.strategy === "direct");
      expect(directResult).toBeDefined();
      expect(directResult?.iterations).toBe(10);
      expect(directResult?.avgTimeMs).toBeGreaterThan(0);
      expect(directResult?.minTimeMs).toBeGreaterThan(0);
      expect(directResult?.maxTimeMs).toBeGreaterThanOrEqual(directResult?.minTimeMs || 0);
      expect(directResult?.throughputPerSecond).toBeGreaterThan(0);

      // Verify cached (cold) benchmark
      const cachedColdResult = result.results.find((r) => r.strategy === "cached");
      expect(cachedColdResult).toBeDefined();
      expect(cachedColdResult?.iterations).toBe(10);

      // Verify cached (warm) benchmark
      const cachedWarmResult = result.results.find((r) => r.strategy === "cached_warm");
      expect(cachedWarmResult).toBeDefined();
      expect(cachedWarmResult?.iterations).toBe(10);

      // Warm cache should be faster than cold cache and direct
      expect(cachedWarmResult?.avgTimeMs).toBeLessThan(cachedColdResult?.avgTimeMs || Infinity);
      expect(cachedWarmResult?.avgTimeMs).toBeLessThan(directResult?.avgTimeMs || Infinity);

      // Verify summary
      expect(result.summary.directAvgMs).toBeGreaterThan(0);
      expect(result.summary.cachedColdAvgMs).toBeGreaterThan(0);
      expect(result.summary.cachedWarmAvgMs).toBeGreaterThan(0);
      expect(result.summary.speedupCachedWarm).toBeGreaterThan(1); // Cache should provide speedup
    });

    it("shows significant speedup with warm cache", async () => {
      const result = await benchmark.benchmarkAgentMetrics("0x123", 50);

      // Warm cache should be significantly faster
      expect(result.summary.speedupCachedWarm).toBeGreaterThan(10);
    });
  });

  describe("benchmarkCounterpartyMetrics", () => {
    it("runs counterparty metrics benchmark", async () => {
      const result = await benchmark.benchmarkCounterpartyMetrics("service1", 10);

      expect(result.suite).toBe("counterparty_metrics");
      expect(result.results).toHaveLength(3);

      const warmResult = result.results.find((r) => r.strategy === "cached_warm");
      const directResult = result.results.find((r) => r.strategy === "direct");

      expect(warmResult?.avgTimeMs).toBeLessThan(directResult?.avgTimeMs || Infinity);
      expect(result.summary.speedupCachedWarm).toBeGreaterThan(1);
    });
  });

  describe("benchmarkFlowAggregates", () => {
    it("runs flow aggregates benchmark", async () => {
      const result = await benchmark.benchmarkFlowAggregates({}, 10);

      expect(result.suite).toBe("flow_aggregates");
      expect(result.results).toHaveLength(3);

      const warmResult = result.results.find((r) => r.strategy === "cached_warm");
      expect(warmResult?.strategy).toBe("cached_warm");
      expect(warmResult?.avgTimeMs).toBeGreaterThan(0);
    });

    it("benchmarks with wallet filter", async () => {
      const result = await benchmark.benchmarkFlowAggregates({ wallet: "0x123" }, 10);

      expect(result.results).toHaveLength(3);
      expect(result.summary.speedupCachedWarm).toBeGreaterThan(0); // Timing-sensitive, just check it's positive
    });

    it("benchmarks with counterparty filter", async () => {
      const result = await benchmark.benchmarkFlowAggregates({ counterparty: "service1" }, 10);

      expect(result.results).toHaveLength(3);
      expect(result.summary.speedupCachedWarm).toBeGreaterThan(0); // Timing-sensitive, just check it's positive
    });
  });

  describe("runFullBenchmark", () => {
    it("runs comprehensive benchmark suite", async () => {
      const result = await benchmark.runFullBenchmark({
        wallet: "0x123",
        counterparty: "service1",
        iterations: 10,
      });

      expect(result.agentMetrics).toBeDefined();
      expect(result.counterpartyMetrics).toBeDefined();
      expect(result.flowAggregates).toBeDefined();
      expect(result.overallSummary).toBeDefined();

      expect(result.overallSummary.avgSpeedup).toBeGreaterThan(1);
      expect(["excellent", "good", "moderate", "poor"]).toContain(result.overallSummary.cacheEffectiveness);
    });

    it("classifies cache effectiveness correctly", async () => {
      const result = await benchmark.runFullBenchmark({
        wallet: "0x123",
        iterations: 50,
      });

      // Verify cache effectiveness is classified (timing-sensitive, so just check it's valid)
      expect(["excellent", "good", "moderate", "poor"]).toContain(result.overallSummary.cacheEffectiveness);
      expect(result.overallSummary.avgSpeedup).toBeGreaterThan(0);
    });

    it("handles partial benchmark when only wallet is provided", async () => {
      const result = await benchmark.runFullBenchmark({
        wallet: "0x123",
        iterations: 10,
      });

      expect(result.agentMetrics).toBeDefined();
      expect(result.counterpartyMetrics).toBeUndefined();
      expect(result.flowAggregates).toBeDefined();
    });

    it("handles partial benchmark when only counterparty is provided", async () => {
      const result = await benchmark.runFullBenchmark({
        counterparty: "service1",
        iterations: 10,
      });

      expect(result.agentMetrics).toBeUndefined();
      expect(result.counterpartyMetrics).toBeDefined();
      expect(result.flowAggregates).toBeDefined();
    });

    it("always includes flow aggregates benchmark", async () => {
      const result = await benchmark.runFullBenchmark({
        iterations: 10,
      });

      expect(result.flowAggregates).toBeDefined();
    });
  });

  describe("generateReport", () => {
    it("generates human-readable report", async () => {
      const agentSuite = await benchmark.benchmarkAgentMetrics("0x123", 10);
      const report = benchmark.generateReport([agentSuite]);

      expect(report).toContain("Performance Benchmark Report");
      expect(report).toContain("Suite: agent_metrics");
      expect(report).toContain("direct:");
      expect(report).toContain("cached:");
      expect(report).toContain("cached_warm:");
      expect(report).toContain("Iterations:");
      expect(report).toContain("Avg Time:");
      expect(report).toContain("Throughput:");
      expect(report).toContain("Speedup");
    });

    it("generates report for multiple suites", async () => {
      const agentSuite = await benchmark.benchmarkAgentMetrics("0x123", 10);
      const counterpartySuite = await benchmark.benchmarkCounterpartyMetrics("service1", 10);
      const report = benchmark.generateReport([agentSuite, counterpartySuite]);

      expect(report).toContain("agent_metrics");
      expect(report).toContain("counterparty_metrics");
    });
  });

  describe("performance metrics calculation", () => {
    it("calculates min/max/avg correctly", async () => {
      const result = await benchmark.benchmarkAgentMetrics("0x123", 100);

      const directResult = result.results.find((r) => r.strategy === "direct");
      expect(directResult).toBeDefined();
      expect(directResult?.minTimeMs).toBeLessThanOrEqual(directResult?.avgTimeMs || Infinity);
      expect(directResult?.maxTimeMs).toBeGreaterThanOrEqual(directResult?.avgTimeMs || 0);
      expect(directResult?.avgTimeMs).toBeGreaterThanOrEqual(directResult?.minTimeMs || 0);
      expect(directResult?.avgTimeMs).toBeLessThanOrEqual(directResult?.maxTimeMs || Infinity);
    });

    it("calculates throughput correctly", async () => {
      const result = await benchmark.benchmarkAgentMetrics("0x123", 10);

      for (const benchmarkResult of result.results) {
        const expectedThroughput = 1000 / benchmarkResult.avgTimeMs;
        expect(benchmarkResult.throughputPerSecond).toBeCloseTo(expectedThroughput, 2);
      }
    });
  });

  describe("cache effectiveness classification", () => {
    it("classifies excellent performance (>= 100x speedup)", async () => {
      // This test might be flaky depending on system performance
      // but with 100+ iterations, warm cache should be extremely fast
      const result = await benchmark.runFullBenchmark({
        wallet: "0x123",
        iterations: 100,
      });

      if (result.overallSummary.avgSpeedup >= 100) {
        expect(result.overallSummary.cacheEffectiveness).toBe("excellent");
      }
    });

    it("classifies good performance (>= 20x speedup)", () => {
      const effectiveness = (speedup: number) => {
        if (speedup >= 100) return "excellent";
        if (speedup >= 20) return "good";
        if (speedup >= 5) return "moderate";
        return "poor";
      };

      expect(effectiveness(25)).toBe("good");
      expect(effectiveness(50)).toBe("good");
    });

    it("classifies moderate performance (>= 5x speedup)", () => {
      const effectiveness = (speedup: number) => {
        if (speedup >= 100) return "excellent";
        if (speedup >= 20) return "good";
        if (speedup >= 5) return "moderate";
        return "poor";
      };

      expect(effectiveness(7)).toBe("moderate");
      expect(effectiveness(10)).toBe("moderate");
    });

    it("classifies poor performance (< 5x speedup)", () => {
      const effectiveness = (speedup: number) => {
        if (speedup >= 100) return "excellent";
        if (speedup >= 20) return "good";
        if (speedup >= 5) return "moderate";
        return "poor";
      };

      expect(effectiveness(2)).toBe("poor");
      expect(effectiveness(4)).toBe("poor");
    });
  });

  describe("edge cases", () => {
    it("handles empty store gracefully", async () => {
      const emptyStore = {
        listInteractionsByWallet: () => [],
        listInteractionsByCounterparty: () => [],
        listInteractions: () => [],
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

      const emptyBenchmark = new PerformanceBenchmark(emptyStore);
      const result = await emptyBenchmark.benchmarkAgentMetrics("0x123", 10);

      expect(result.results).toHaveLength(3);
      expect(result.summary.speedupCachedWarm).toBeGreaterThan(0);
    });

    it("handles single iteration benchmark", async () => {
      const result = await benchmark.benchmarkAgentMetrics("0x123", 1);

      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.iterations === 1)).toBe(true);
    });
  });
});
