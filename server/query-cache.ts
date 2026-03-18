/**
 * Query caching layer for AFI metrics and aggregates
 * Provides in-memory cache with TTL and invalidation on ingestion
 */

import { Cache } from "./cache";
import type { Store } from "./store";
import { computeAgentMetrics, computeCounterpartyMetrics } from "./metrics";
import type { InteractionRecord } from "./types";

export interface QueryCacheConfig {
  /** TTL in seconds for agent metrics queries (default: 300 = 5 minutes) */
  agentMetricsTTL?: number;
  /** TTL in seconds for counterparty metrics queries (default: 300 = 5 minutes) */
  counterpartyMetricsTTL?: number;
  /** TTL in seconds for flow aggregate queries (default: 180 = 3 minutes) */
  flowAggregateTTL?: number;
  /** TTL in seconds for interaction list queries (default: 60 = 1 minute) */
  interactionListTTL?: number;
  /** Enable performance monitoring and logging */
  enablePerformanceMonitoring?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

export interface QueryPerformanceMetrics {
  queryType: string;
  cacheHit: boolean;
  executionTimeMs: number;
  timestamp: string;
}

/**
 * Cached query service for AFI analytics
 * Wraps Store methods with intelligent caching and invalidation
 */
export class QueryCache {
  private cache: Cache;
  private config: Required<QueryCacheConfig>;
  private hits = 0;
  private misses = 0;
  private performanceLog: QueryPerformanceMetrics[] = [];

  constructor(config: QueryCacheConfig = {}) {
    this.cache = new Cache();
    this.config = {
      agentMetricsTTL: config.agentMetricsTTL ?? 300,
      counterpartyMetricsTTL: config.counterpartyMetricsTTL ?? 300,
      flowAggregateTTL: config.flowAggregateTTL ?? 180,
      interactionListTTL: config.interactionListTTL ?? 60,
      enablePerformanceMonitoring: config.enablePerformanceMonitoring ?? false,
    };
  }

  /**
   * Get agent metrics with caching
   */
  getAgentMetrics(store: Store, wallet: string): ReturnType<typeof computeAgentMetrics> {
    const key = `agent_metrics:${wallet.toLowerCase()}`;
    const startTime = performance.now();

    const cached = this.cache.get<ReturnType<typeof computeAgentMetrics>>(key);
    if (cached) {
      this.hits++;
      this.logPerformance("agent_metrics", true, performance.now() - startTime);
      return cached;
    }

    this.misses++;
    const result = computeAgentMetrics(store, wallet);
    this.cache.set(key, result, this.config.agentMetricsTTL);
    this.logPerformance("agent_metrics", false, performance.now() - startTime);

    return result;
  }

  /**
   * Get counterparty metrics with caching
   */
  getCounterpartyMetrics(store: Store, counterparty: string): ReturnType<typeof computeCounterpartyMetrics> {
    const key = `counterparty_metrics:${counterparty.toLowerCase()}`;
    const startTime = performance.now();

    const cached = this.cache.get<ReturnType<typeof computeCounterpartyMetrics>>(key);
    if (cached) {
      this.hits++;
      this.logPerformance("counterparty_metrics", true, performance.now() - startTime);
      return cached;
    }

    this.misses++;
    const result = computeCounterpartyMetrics(store, counterparty);
    this.cache.set(key, result, this.config.counterpartyMetricsTTL);
    this.logPerformance("counterparty_metrics", false, performance.now() - startTime);

    return result;
  }

  /**
   * Get flow aggregates with caching
   * Aggregates interactions by time period, protocol, and counterparty
   */
  getFlowAggregates(
    store: Store,
    filters: {
      wallet?: string;
      counterparty?: string;
      protocol?: string;
      startDate?: string;
      endDate?: string;
    } = {},
  ): FlowAggregateResult {
    const key = `flow_aggregates:${JSON.stringify(filters)}`;
    const startTime = performance.now();

    const cached = this.cache.get<FlowAggregateResult>(key);
    if (cached) {
      this.hits++;
      this.logPerformance("flow_aggregates", true, performance.now() - startTime);
      return cached;
    }

    this.misses++;
    const result = this.computeFlowAggregates(store, filters);
    this.cache.set(key, result, this.config.flowAggregateTTL);
    this.logPerformance("flow_aggregates", false, performance.now() - startTime);

    return result;
  }

  /**
   * Get interactions list with caching
   */
  getInteractionsList(
    store: Store,
    filters: { wallet?: string; counterparty?: string } = {},
  ): InteractionRecord[] {
    const key = `interactions_list:${JSON.stringify(filters)}`;
    const startTime = performance.now();

    const cached = this.cache.get<InteractionRecord[]>(key);
    if (cached) {
      this.hits++;
      this.logPerformance("interactions_list", true, performance.now() - startTime);
      return cached;
    }

    this.misses++;
    let result: InteractionRecord[];
    if (filters.wallet) {
      result = store.listInteractionsByWallet(filters.wallet);
    } else if (filters.counterparty) {
      result = store.listInteractionsByCounterparty(filters.counterparty);
    } else {
      result = store.listInteractions();
    }

    this.cache.set(key, result, this.config.interactionListTTL);
    this.logPerformance("interactions_list", false, performance.now() - startTime);

    return result;
  }

  /**
   * Invalidate cache on new ingestion
   * Call this after inserting new interactions/settlements/evidence
   */
  invalidateOnIngestion(affectedWallets: string[] = [], affectedCounterparties: string[] = []): void {
    // Invalidate specific wallets
    for (const wallet of affectedWallets) {
      this.cache.clear(`agent_metrics:${wallet.toLowerCase()}`);
    }

    // Invalidate specific counterparties
    for (const counterparty of affectedCounterparties) {
      this.cache.clear(`counterparty_metrics:${counterparty.toLowerCase()}`);
    }

    // Clear all flow aggregates and interaction lists as they may be affected
    this.cache.clear("flow_aggregates:");
    this.cache.clear("interactions_list:");
  }

  /**
   * Full cache invalidation (use sparingly)
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size(),
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Get performance metrics for monitoring
   */
  getPerformanceMetrics(): QueryPerformanceMetrics[] {
    return [...this.performanceLog];
  }

  /**
   * Clear performance metrics log
   */
  clearPerformanceMetrics(): void {
    this.performanceLog = [];
  }

  /**
   * Cleanup expired entries (call periodically)
   */
  cleanup(): void {
    this.cache.cleanup();
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  private logPerformance(queryType: string, cacheHit: boolean, executionTimeMs: number): void {
    if (!this.config.enablePerformanceMonitoring) {
      return;
    }

    this.performanceLog.push({
      queryType,
      cacheHit,
      executionTimeMs,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 1000 entries to prevent memory leaks
    if (this.performanceLog.length > 1000) {
      this.performanceLog = this.performanceLog.slice(-1000);
    }
  }

  private computeFlowAggregates(
    store: Store,
    filters: {
      wallet?: string;
      counterparty?: string;
      protocol?: string;
      startDate?: string;
      endDate?: string;
    },
  ): FlowAggregateResult {
    let interactions: InteractionRecord[];

    if (filters.wallet) {
      interactions = store.listInteractionsByWallet(filters.wallet);
    } else if (filters.counterparty) {
      interactions = store.listInteractionsByCounterparty(filters.counterparty);
    } else {
      interactions = store.listInteractions();
    }

    // Apply additional filters
    if (filters.protocol) {
      interactions = interactions.filter((i) => i.protocol === filters.protocol);
    }

    if (filters.startDate) {
      interactions = interactions.filter((i) => i.created_at >= filters.startDate);
    }

    if (filters.endDate) {
      interactions = interactions.filter((i) => i.created_at <= filters.endDate);
    }

    // Aggregate by time period (daily)
    const dailyAggregates = new Map<string, DailyAggregate>();
    const protocolBreakdown = new Map<string, number>();
    const counterpartyBreakdown = new Map<string, number>();

    for (const interaction of interactions) {
      const date = interaction.created_at.slice(0, 10); // YYYY-MM-DD

      if (!dailyAggregates.has(date)) {
        dailyAggregates.set(date, {
          date,
          count: 0,
          protocols: new Set(),
          counterparties: new Set(),
        });
      }

      const daily = dailyAggregates.get(date)!;
      daily.count++;
      daily.protocols.add(interaction.protocol);
      if (interaction.counterparty) {
        daily.counterparties.add(interaction.counterparty);
      }

      // Protocol breakdown
      protocolBreakdown.set(interaction.protocol, (protocolBreakdown.get(interaction.protocol) ?? 0) + 1);

      // Counterparty breakdown
      if (interaction.counterparty) {
        counterpartyBreakdown.set(
          interaction.counterparty,
          (counterpartyBreakdown.get(interaction.counterparty) ?? 0) + 1,
        );
      }
    }

    // Convert to arrays and sort
    const dailySeries = Array.from(dailyAggregates.values())
      .map((d) => ({
        date: d.date,
        count: d.count,
        uniqueProtocols: d.protocols.size,
        uniqueCounterparties: d.counterparties.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const protocolSeries = Array.from(protocolBreakdown.entries())
      .map(([protocol, count]) => ({ protocol, count }))
      .sort((a, b) => b.count - a.count);

    const counterpartySeries = Array.from(counterpartyBreakdown.entries())
      .map(([counterparty, count]) => ({ counterparty, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalInteractions: interactions.length,
      dateRange: {
        start: interactions.length > 0 ? interactions[interactions.length - 1].created_at : null,
        end: interactions.length > 0 ? interactions[0].created_at : null,
      },
      dailySeries,
      protocolSeries,
      counterpartySeries,
      uniqueProtocols: protocolBreakdown.size,
      uniqueCounterparties: counterpartyBreakdown.size,
    };
  }
}

interface DailyAggregate {
  date: string;
  count: number;
  protocols: Set<string>;
  counterparties: Set<string>;
}

export interface FlowAggregateResult {
  totalInteractions: number;
  dateRange: {
    start: string | null;
    end: string | null;
  };
  dailySeries: Array<{
    date: string;
    count: number;
    uniqueProtocols: number;
    uniqueCounterparties: number;
  }>;
  protocolSeries: Array<{
    protocol: string;
    count: number;
  }>;
  counterpartySeries: Array<{
    counterparty: string;
    count: number;
  }>;
  uniqueProtocols: number;
  uniqueCounterparties: number;
}
