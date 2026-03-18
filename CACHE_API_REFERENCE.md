# Cache API Reference

Quick reference for using the AFI caching layer.

## Import

```typescript
import { QueryCache } from "./server/query-cache";
import { PerformanceBenchmark } from "./server/performance-benchmark";
```

## QueryCache API

### Constructor

```typescript
const cache = new QueryCache(config?: QueryCacheConfig);
```

**Config options**:
```typescript
interface QueryCacheConfig {
  agentMetricsTTL?: number;              // Default: 300 (5 minutes)
  counterpartyMetricsTTL?: number;       // Default: 300 (5 minutes)
  flowAggregateTTL?: number;             // Default: 180 (3 minutes)
  interactionListTTL?: number;           // Default: 60 (1 minute)
  enablePerformanceMonitoring?: boolean; // Default: false
}
```

### Methods

#### getAgentMetrics()
```typescript
getAgentMetrics(store: Store, wallet: string): AgentMetrics
```
Get cached agent metrics for a wallet.

**Example**:
```typescript
const metrics = cache.getAgentMetrics(store, "0x123");
console.log(metrics.throughput.totalInteractions);
```

#### getCounterpartyMetrics()
```typescript
getCounterpartyMetrics(store: Store, counterparty: string): CounterpartyMetrics
```
Get cached counterparty metrics.

**Example**:
```typescript
const metrics = cache.getCounterpartyMetrics(store, "service1");
console.log(metrics.volume.totalInteractions);
```

#### getFlowAggregates()
```typescript
getFlowAggregates(store: Store, filters?: {
  wallet?: string;
  counterparty?: string;
  protocol?: string;
  startDate?: string; // ISO format
  endDate?: string;   // ISO format
}): FlowAggregateResult
```
Get cached flow aggregates with optional filters.

**Examples**:
```typescript
// All flows
const all = cache.getFlowAggregates(store);

// Wallet-specific
const walletFlows = cache.getFlowAggregates(store, { wallet: "0x123" });

// Protocol-specific
const locusFlows = cache.getFlowAggregates(store, { protocol: "locus" });

// Date range
const recent = cache.getFlowAggregates(store, {
  startDate: "2024-01-01",
  endDate: "2024-12-31"
});

// Combined filters
const filtered = cache.getFlowAggregates(store, {
  wallet: "0x123",
  protocol: "locus",
  startDate: "2024-03-01"
});
```

**Returns**:
```typescript
interface FlowAggregateResult {
  totalInteractions: number;
  dateRange: { start: string | null; end: string | null };
  dailySeries: Array<{
    date: string;
    count: number;
    uniqueProtocols: number;
    uniqueCounterparties: number;
  }>;
  protocolSeries: Array<{ protocol: string; count: number }>;
  counterpartySeries: Array<{ counterparty: string; count: number }>;
  uniqueProtocols: number;
  uniqueCounterparties: number;
}
```

#### getInteractionsList()
```typescript
getInteractionsList(store: Store, filters?: {
  wallet?: string;
  counterparty?: string;
}): InteractionRecord[]
```
Get cached list of interactions with optional filters.

**Examples**:
```typescript
// All interactions
const all = cache.getInteractionsList(store);

// By wallet
const walletInteractions = cache.getInteractionsList(store, {
  wallet: "0x123"
});

// By counterparty
const serviceInteractions = cache.getInteractionsList(store, {
  counterparty: "service1"
});
```

#### invalidateOnIngestion()
```typescript
invalidateOnIngestion(
  affectedWallets: string[],
  affectedCounterparties: string[]
): void
```
Invalidate cache for specific entities after data ingestion.

**Example**:
```typescript
// After ingesting a transaction
store.upsertInteraction(interaction);
cache.invalidateOnIngestion(
  [interaction.wallet_address],
  [interaction.counterparty]
);
```

#### invalidateAll()
```typescript
invalidateAll(): void
```
Clear entire cache.

**Example**:
```typescript
cache.invalidateAll();
```

#### getStats()
```typescript
getStats(): CacheStats
```
Get cache statistics.

**Returns**:
```typescript
interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number; // 0-1
}
```

**Example**:
```typescript
const stats = cache.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
console.log(`Cache size: ${stats.size} entries`);
```

#### getPerformanceMetrics()
```typescript
getPerformanceMetrics(): QueryPerformanceMetrics[]
```
Get performance metrics (only when `enablePerformanceMonitoring: true`).

**Returns**:
```typescript
interface QueryPerformanceMetrics {
  queryType: string;
  cacheHit: boolean;
  executionTimeMs: number;
  timestamp: string;
}
```

**Example**:
```typescript
const cache = new QueryCache({ enablePerformanceMonitoring: true });
// ... run some queries ...
const metrics = cache.getPerformanceMetrics();
metrics.forEach(m => {
  console.log(`${m.queryType}: ${m.executionTimeMs.toFixed(2)}ms ${m.cacheHit ? '(HIT)' : '(MISS)'}`);
});
```

#### clearPerformanceMetrics()
```typescript
clearPerformanceMetrics(): void
```
Clear performance metrics log.

#### cleanup()
```typescript
cleanup(): void
```
Remove expired cache entries. Call periodically (e.g., every 5 minutes).

**Example**:
```typescript
setInterval(() => cache.cleanup(), 5 * 60 * 1000);
```

#### resetStats()
```typescript
resetStats(): void
```
Reset hit/miss counters.

## PerformanceBenchmark API

### Constructor

```typescript
const benchmark = new PerformanceBenchmark(store: Store);
```

### Methods

#### benchmarkAgentMetrics()
```typescript
benchmarkAgentMetrics(
  wallet: string,
  iterations?: number
): Promise<BenchmarkSuite>
```
Benchmark agent metrics queries.

**Example**:
```typescript
const result = await benchmark.benchmarkAgentMetrics("0x123", 100);
console.log(`Speedup: ${result.summary.speedupCachedWarm.toFixed(1)}x`);
```

#### benchmarkCounterpartyMetrics()
```typescript
benchmarkCounterpartyMetrics(
  counterparty: string,
  iterations?: number
): Promise<BenchmarkSuite>
```
Benchmark counterparty metrics queries.

#### benchmarkFlowAggregates()
```typescript
benchmarkFlowAggregates(
  filters?: { wallet?: string; counterparty?: string },
  iterations?: number
): Promise<BenchmarkSuite>
```
Benchmark flow aggregate queries.

#### runFullBenchmark()
```typescript
runFullBenchmark(options?: {
  wallet?: string;
  counterparty?: string;
  iterations?: number;
}): Promise<{
  agentMetrics?: BenchmarkSuite;
  counterpartyMetrics?: BenchmarkSuite;
  flowAggregates: BenchmarkSuite;
  overallSummary: {
    avgSpeedup: number;
    cacheEffectiveness: "excellent" | "good" | "moderate" | "poor";
  };
}>
```
Run comprehensive benchmark suite.

**Example**:
```typescript
const results = await benchmark.runFullBenchmark({
  wallet: "0x123",
  counterparty: "service1",
  iterations: 100
});

console.log(`Average Speedup: ${results.overallSummary.avgSpeedup.toFixed(1)}x`);
console.log(`Effectiveness: ${results.overallSummary.cacheEffectiveness}`);
```

#### generateReport()
```typescript
generateReport(suites: BenchmarkSuite[]): string
```
Generate human-readable benchmark report.

**Example**:
```typescript
const agentBench = await benchmark.benchmarkAgentMetrics("0x123", 100);
const counterpartyBench = await benchmark.benchmarkCounterpartyMetrics("service1", 100);

const report = benchmark.generateReport([agentBench, counterpartyBench]);
console.log(report);
```

## HTTP API Endpoints

### GET /api/cache/stats
Get cache statistics.

**Response**:
```json
{
  "hits": 1234,
  "misses": 456,
  "size": 42,
  "hitRate": 0.73
}
```

### POST /api/cache/invalidate
Manually invalidate entire cache.

**Response**:
```json
{
  "ok": true,
  "message": "Cache invalidated"
}
```

### GET /api/metrics/flow-aggregates
Get flow aggregates with caching.

**Query Parameters**:
- `wallet` (optional): Filter by wallet address
- `counterparty` (optional): Filter by counterparty
- `protocol` (optional): Filter by protocol
- `startDate` (optional): Filter start date (ISO format)
- `endDate` (optional): Filter end date (ISO format)

**Examples**:
```bash
# All flows
curl http://localhost:8787/api/metrics/flow-aggregates

# Wallet-specific
curl "http://localhost:8787/api/metrics/flow-aggregates?wallet=0x123"

# Protocol-specific with date range
curl "http://localhost:8787/api/metrics/flow-aggregates?protocol=locus&startDate=2024-01-01"

# Multiple filters
curl "http://localhost:8787/api/metrics/flow-aggregates?wallet=0x123&protocol=locus&startDate=2024-03-01"
```

**Response**:
```json
{
  "totalInteractions": 150,
  "dateRange": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-03-18T00:00:00Z"
  },
  "dailySeries": [
    {
      "date": "2024-01-01",
      "count": 5,
      "uniqueProtocols": 2,
      "uniqueCounterparties": 3
    }
  ],
  "protocolSeries": [
    { "protocol": "locus", "count": 80 },
    { "protocol": "x402", "count": 70 }
  ],
  "counterpartySeries": [
    { "counterparty": "service1", "count": 60 },
    { "counterparty": "service2", "count": 40 }
  ],
  "uniqueProtocols": 3,
  "uniqueCounterparties": 5
}
```

## Common Patterns

### Pattern 1: Initialize Cache in Application

```typescript
import { QueryCache } from "./server/query-cache";
import { Store } from "./server/store";

export function createApp() {
  const store = new Store(config);
  const queryCache = new QueryCache({
    agentMetricsTTL: 300,
    counterpartyMetricsTTL: 300,
    flowAggregateTTL: 180,
    interactionListTTL: 60,
  });

  // Pass to API
  const api = createApi({ store, queryCache });

  // Setup periodic cleanup
  const cleanupInterval = setInterval(() => {
    queryCache.cleanup();
  }, 5 * 60 * 1000);

  // Cleanup on shutdown
  process.on("SIGTERM", () => {
    clearInterval(cleanupInterval);
  });

  return app;
}
```

### Pattern 2: Invalidate on Ingestion

```typescript
// After ingesting data
async function ingestX402(data: X402Data) {
  const bundle = normalizeInteraction(data);

  store.upsertInteraction(bundle.interaction);
  store.upsertSettlement(bundle.settlement);
  store.upsertEvidence(bundle.evidence);

  // Invalidate affected caches
  const wallets = bundle.interaction.wallet_address
    ? [bundle.interaction.wallet_address]
    : [];
  const counterparties = bundle.interaction.counterparty
    ? [bundle.interaction.counterparty]
    : [];

  queryCache.invalidateOnIngestion(wallets, counterparties);

  return bundle.interaction.id;
}
```

### Pattern 3: Batch Invalidation

```typescript
// After batch ingestion
async function ingestBatch(transactions: Transaction[]) {
  const wallets = new Set<string>();
  const counterparties = new Set<string>();

  for (const tx of transactions) {
    store.upsertInteraction(tx);
    if (tx.wallet_address) wallets.add(tx.wallet_address);
    if (tx.counterparty) counterparties.add(tx.counterparty);
  }

  // Batch invalidate
  queryCache.invalidateOnIngestion(
    Array.from(wallets),
    Array.from(counterparties)
  );
}
```

### Pattern 4: Monitor Cache Performance

```typescript
const cache = new QueryCache({ enablePerformanceMonitoring: true });

// Run queries
cache.getAgentMetrics(store, "0x123");
cache.getCounterpartyMetrics(store, "service1");

// Analyze performance
const metrics = cache.getPerformanceMetrics();
const avgTime = metrics.reduce((sum, m) => sum + m.executionTimeMs, 0) / metrics.length;
console.log(`Average query time: ${avgTime.toFixed(2)}ms`);

const hitRate = cache.getStats().hitRate;
console.log(`Cache hit rate: ${(hitRate * 100).toFixed(1)}%`);
```

### Pattern 5: Run Performance Benchmarks

```typescript
async function analyzeCachePerformance() {
  const benchmark = new PerformanceBenchmark(store);

  const results = await benchmark.runFullBenchmark({
    wallet: "0x123",
    counterparty: "service1",
    iterations: 100
  });

  console.log(`\nPerformance Analysis:`);
  console.log(`- Average Speedup: ${results.overallSummary.avgSpeedup.toFixed(1)}x`);
  console.log(`- Cache Effectiveness: ${results.overallSummary.cacheEffectiveness}`);

  if (results.agentMetrics) {
    console.log(`\nAgent Metrics:`);
    console.log(`- Direct: ${results.agentMetrics.summary.directAvgMs.toFixed(2)}ms`);
    console.log(`- Cached (warm): ${results.agentMetrics.summary.cachedWarmAvgMs.toFixed(2)}ms`);
  }

  // Generate full report
  const report = benchmark.generateReport([
    results.agentMetrics!,
    results.counterpartyMetrics!,
    results.flowAggregates
  ]);
  console.log(report);
}
```

## Best Practices

1. **Always invalidate on ingestion**: Ensures data consistency
2. **Set appropriate TTLs**: Balance freshness vs performance
3. **Monitor hit rates**: Aim for > 50% in production
4. **Use cleanup interval**: Prevent memory leaks
5. **Enable monitoring in dev**: Helps identify bottlenecks
6. **Benchmark regularly**: Verify cache effectiveness
7. **Handle edge cases**: Empty results, null values, etc.

## Troubleshooting

**Low hit rate (<30%)**:
- Increase TTLs
- Check query parameter normalization
- Review invalidation frequency

**Stale data**:
- Decrease TTLs
- Verify invalidation on all ingestion paths
- Add manual invalidation endpoint

**High memory usage**:
- Decrease TTLs
- Verify cleanup is running
- Consider cache size limits

**Performance not improving**:
- Enable performance monitoring
- Run benchmarks
- Check if queries are actually using cache
