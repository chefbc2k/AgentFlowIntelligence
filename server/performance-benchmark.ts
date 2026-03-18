/**
 * Performance benchmarking utility for query operations
 * Measures execution time and throughput for different query strategies
 */

import type { Store } from "./store";
import { computeAgentMetrics, computeCounterpartyMetrics } from "./metrics";
import { QueryCache } from "./query-cache";

export interface BenchmarkResult {
  operation: string;
  strategy: "direct" | "cached" | "cached_warm";
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  throughputPerSecond: number;
}

export interface BenchmarkSuite {
  suite: string;
  timestamp: string;
  results: BenchmarkResult[];
  summary: {
    directAvgMs: number;
    cachedColdAvgMs: number;
    cachedWarmAvgMs: number;
    speedupCachedWarm: number;
  };
}

/**
 * Run performance benchmarks comparing direct queries vs cached queries
 */
export class PerformanceBenchmark {
  private store: Store;
  private queryCache: QueryCache;

  constructor(store: Store) {
    this.store = store;
    this.queryCache = new QueryCache({
      enablePerformanceMonitoring: true,
    });
  }

  /**
   * Benchmark agent metrics queries
   */
  async benchmarkAgentMetrics(wallet: string, iterations = 100): Promise<BenchmarkSuite> {
    const results: BenchmarkResult[] = [];

    // Benchmark 1: Direct queries (no cache)
    const directTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      computeAgentMetrics(this.store, wallet);
      const end = performance.now();
      directTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("agent_metrics", "direct", directTimes));

    // Benchmark 2: Cached queries (cold cache)
    this.queryCache.invalidateAll();
    this.queryCache.resetStats();

    const cachedColdTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      this.queryCache.invalidateAll(); // Clear cache each time to simulate cold cache
      const start = performance.now();
      this.queryCache.getAgentMetrics(this.store, wallet);
      const end = performance.now();
      cachedColdTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("agent_metrics", "cached", cachedColdTimes));

    // Benchmark 3: Cached queries (warm cache)
    this.queryCache.invalidateAll();
    this.queryCache.resetStats();

    // Warm up cache
    this.queryCache.getAgentMetrics(this.store, wallet);

    const cachedWarmTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      this.queryCache.getAgentMetrics(this.store, wallet);
      const end = performance.now();
      cachedWarmTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("agent_metrics", "cached_warm", cachedWarmTimes));

    // Calculate summary
    const directAvg = results[0].avgTimeMs;
    const cachedColdAvg = results[1].avgTimeMs;
    const cachedWarmAvg = results[2].avgTimeMs;

    return {
      suite: "agent_metrics",
      timestamp: new Date().toISOString(),
      results,
      summary: {
        directAvgMs: directAvg,
        cachedColdAvgMs: cachedColdAvg,
        cachedWarmAvgMs: cachedWarmAvg,
        speedupCachedWarm: directAvg / cachedWarmAvg,
      },
    };
  }

  /**
   * Benchmark counterparty metrics queries
   */
  async benchmarkCounterpartyMetrics(counterparty: string, iterations = 100): Promise<BenchmarkSuite> {
    const results: BenchmarkResult[] = [];

    // Benchmark 1: Direct queries (no cache)
    const directTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      computeCounterpartyMetrics(this.store, counterparty);
      const end = performance.now();
      directTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("counterparty_metrics", "direct", directTimes));

    // Benchmark 2: Cached queries (cold cache)
    this.queryCache.invalidateAll();
    this.queryCache.resetStats();

    const cachedColdTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      this.queryCache.invalidateAll();
      const start = performance.now();
      this.queryCache.getCounterpartyMetrics(this.store, counterparty);
      const end = performance.now();
      cachedColdTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("counterparty_metrics", "cached", cachedColdTimes));

    // Benchmark 3: Cached queries (warm cache)
    this.queryCache.invalidateAll();
    this.queryCache.resetStats();

    // Warm up cache
    this.queryCache.getCounterpartyMetrics(this.store, counterparty);

    const cachedWarmTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      this.queryCache.getCounterpartyMetrics(this.store, counterparty);
      const end = performance.now();
      cachedWarmTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("counterparty_metrics", "cached_warm", cachedWarmTimes));

    // Calculate summary
    const directAvg = results[0].avgTimeMs;
    const cachedColdAvg = results[1].avgTimeMs;
    const cachedWarmAvg = results[2].avgTimeMs;

    return {
      suite: "counterparty_metrics",
      timestamp: new Date().toISOString(),
      results,
      summary: {
        directAvgMs: directAvg,
        cachedColdAvgMs: cachedColdAvg,
        cachedWarmAvgMs: cachedWarmAvg,
        speedupCachedWarm: directAvg / cachedWarmAvg,
      },
    };
  }

  /**
   * Benchmark flow aggregates queries
   */
  async benchmarkFlowAggregates(
    filters: { wallet?: string; counterparty?: string } = {},
    iterations = 100,
  ): Promise<BenchmarkSuite> {
    const results: BenchmarkResult[] = [];

    // Benchmark 1: Direct queries (no cache)
    const directTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      // Simulate what the flow aggregates computation does
      if (filters.wallet) {
        this.store.listInteractionsByWallet(filters.wallet);
      } else if (filters.counterparty) {
        this.store.listInteractionsByCounterparty(filters.counterparty);
      } else {
        this.store.listInteractions();
      }
      const end = performance.now();
      directTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("flow_aggregates", "direct", directTimes));

    // Benchmark 2: Cached queries (cold cache)
    this.queryCache.invalidateAll();
    this.queryCache.resetStats();

    const cachedColdTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      this.queryCache.invalidateAll();
      const start = performance.now();
      this.queryCache.getFlowAggregates(this.store, filters);
      const end = performance.now();
      cachedColdTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("flow_aggregates", "cached", cachedColdTimes));

    // Benchmark 3: Cached queries (warm cache)
    this.queryCache.invalidateAll();
    this.queryCache.resetStats();

    // Warm up cache
    this.queryCache.getFlowAggregates(this.store, filters);

    const cachedWarmTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      this.queryCache.getFlowAggregates(this.store, filters);
      const end = performance.now();
      cachedWarmTimes.push(end - start);
    }

    results.push(this.calculateBenchmarkResult("flow_aggregates", "cached_warm", cachedWarmTimes));

    // Calculate summary
    const directAvg = results[0].avgTimeMs;
    const cachedColdAvg = results[1].avgTimeMs;
    const cachedWarmAvg = results[2].avgTimeMs;

    return {
      suite: "flow_aggregates",
      timestamp: new Date().toISOString(),
      results,
      summary: {
        directAvgMs: directAvg,
        cachedColdAvgMs: cachedColdAvg,
        cachedWarmAvgMs: cachedWarmAvg,
        speedupCachedWarm: directAvg / cachedWarmAvg,
      },
    };
  }

  /**
   * Run comprehensive benchmark suite
   */
  async runFullBenchmark(options: {
    wallet?: string;
    counterparty?: string;
    iterations?: number;
  } = {}): Promise<{
    agentMetrics?: BenchmarkSuite;
    counterpartyMetrics?: BenchmarkSuite;
    flowAggregates: BenchmarkSuite;
    overallSummary: {
      avgSpeedup: number;
      cacheEffectiveness: "excellent" | "good" | "moderate" | "poor";
    };
  }> {
    const iterations = options.iterations ?? 100;
    const results: {
      agentMetrics?: BenchmarkSuite;
      counterpartyMetrics?: BenchmarkSuite;
      flowAggregates: BenchmarkSuite;
      overallSummary: {
        avgSpeedup: number;
        cacheEffectiveness: "excellent" | "good" | "moderate" | "poor";
      };
    } = {
      flowAggregates: await this.benchmarkFlowAggregates(
        { wallet: options.wallet, counterparty: options.counterparty },
        iterations,
      ),
      overallSummary: { avgSpeedup: 0, cacheEffectiveness: "poor" },
    };

    if (options.wallet) {
      results.agentMetrics = await this.benchmarkAgentMetrics(options.wallet, iterations);
    }

    if (options.counterparty) {
      results.counterpartyMetrics = await this.benchmarkCounterpartyMetrics(options.counterparty, iterations);
    }

    // Calculate overall summary
    const speedups = [
      results.agentMetrics?.summary.speedupCachedWarm,
      results.counterpartyMetrics?.summary.speedupCachedWarm,
      results.flowAggregates.summary.speedupCachedWarm,
    ].filter((s): s is number => s !== undefined);

    const avgSpeedup = speedups.reduce((sum, s) => sum + s, 0) / speedups.length;

    let cacheEffectiveness: "excellent" | "good" | "moderate" | "poor";
    if (avgSpeedup >= 100) {
      cacheEffectiveness = "excellent";
    } else if (avgSpeedup >= 20) {
      cacheEffectiveness = "good";
    } else if (avgSpeedup >= 5) {
      cacheEffectiveness = "moderate";
    } else {
      cacheEffectiveness = "poor";
    }

    results.overallSummary = { avgSpeedup, cacheEffectiveness };

    return results;
  }

  /**
   * Generate benchmark report in human-readable format
   */
  generateReport(suites: BenchmarkSuite[]): string {
    let report = "Performance Benchmark Report\n";
    report += "============================\n\n";

    for (const suite of suites) {
      report += `Suite: ${suite.suite}\n`;
      report += `Timestamp: ${suite.timestamp}\n\n`;

      for (const result of suite.results) {
        report += `  ${result.strategy}:\n`;
        report += `    Iterations: ${result.iterations}\n`;
        report += `    Total Time: ${result.totalTimeMs.toFixed(2)}ms\n`;
        report += `    Avg Time: ${result.avgTimeMs.toFixed(4)}ms\n`;
        report += `    Min Time: ${result.minTimeMs.toFixed(4)}ms\n`;
        report += `    Max Time: ${result.maxTimeMs.toFixed(4)}ms\n`;
        report += `    Throughput: ${result.throughputPerSecond.toFixed(2)} ops/sec\n\n`;
      }

      report += `  Summary:\n`;
      report += `    Direct Avg: ${suite.summary.directAvgMs.toFixed(4)}ms\n`;
      report += `    Cached (Cold) Avg: ${suite.summary.cachedColdAvgMs.toFixed(4)}ms\n`;
      report += `    Cached (Warm) Avg: ${suite.summary.cachedWarmAvgMs.toFixed(4)}ms\n`;
      report += `    Speedup (Warm Cache): ${suite.summary.speedupCachedWarm.toFixed(2)}x\n\n`;
      report += "---\n\n";
    }

    return report;
  }

  private calculateBenchmarkResult(
    operation: string,
    strategy: "direct" | "cached" | "cached_warm",
    times: number[],
  ): BenchmarkResult {
    const totalTimeMs = times.reduce((sum, t) => sum + t, 0);
    const avgTimeMs = totalTimeMs / times.length;
    const minTimeMs = Math.min(...times);
    const maxTimeMs = Math.max(...times);
    const throughputPerSecond = 1000 / avgTimeMs;

    return {
      operation,
      strategy,
      iterations: times.length,
      totalTimeMs,
      avgTimeMs,
      minTimeMs,
      maxTimeMs,
      throughputPerSecond,
    };
  }
}
