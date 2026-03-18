/**
 * INTEGRATION GUIDE FOR QUERY CACHE
 *
 * This file shows all the changes needed to integrate QueryCache into server/index.ts
 * Apply these changes to the existing index.ts file
 */

/*
=== STEP 1: Add Import ===
Add this import at the top of server/index.ts:
*/
import { QueryCache } from "./query-cache";

/*
=== STEP 2: Update CreateAppOptions Interface ===
Change the interface to include queryCache:
*/
export interface CreateAppOptions {
  config?: AppConfig;
  store?: Store;
  queryCache?: QueryCache;  // ADD THIS LINE
}

/*
=== STEP 3: Update createApi Function Signature ===
Change the function signature and initialize cache:
*/
export function createApi({ config, store, queryCache }: { config: AppConfig; store: Store; queryCache?: QueryCache }) {
  const duneClient = config.duneApiKey ? new DuneClient(config.duneApiKey) : undefined;

  // ADD THESE LINES:
  const cache = queryCache ?? new QueryCache({
    agentMetricsTTL: 300,
    counterpartyMetricsTTL: 300,
    flowAggregateTTL: 180,
    interactionListTTL: 60,
    enablePerformanceMonitoring: false,
  });

  // ... rest of function
}

/*
=== STEP 4: Add Cache Invalidation in captureLocusAction ===
After store.upsertLocusTransactions([...]), add:
*/
// Invalidate cache for affected entities
const affectedWallets = bundle.interaction.wallet_address ? [bundle.interaction.wallet_address] : [];
const affectedCounterparties = bundle.interaction.counterparty ? [bundle.interaction.counterparty] : [];
cache.invalidateOnIngestion(affectedWallets, affectedCounterparties);

/*
=== STEP 5: Add Cache Invalidation in ingestX402 ===
After store.upsertWalletSnapshot(snapshot), add:
*/
// Invalidate cache for affected entities
const affectedWallets = bundle.interaction.wallet_address ? [bundle.interaction.wallet_address] : [];
const affectedCounterparties = bundle.interaction.counterparty ? [bundle.interaction.counterparty] : [];
cache.invalidateOnIngestion(affectedWallets, affectedCounterparties);

/*
=== STEP 6: Add Cache Invalidation in locusIngestTransactions ===
After store.upsertLocusTransactions(locusRows), add:
*/
// Invalidate cache for all affected wallets and counterparties
if (status.address) {
  cache.invalidateOnIngestion([status.address], []);
}
const counterparties = Array.from(new Set(locusRows.map((r) => r.counterparty).filter((c): c is string => !!c)));
if (counterparties.length > 0) {
  cache.invalidateOnIngestion([], counterparties);
}

/*
=== STEP 7: Replace agentMetrics and counterpartyMetrics with Cached Versions ===
Change these two lines in the return statement of createApi:
FROM:
    agentMetrics: (wallet: string) => ok(computeAgentMetrics(store, wallet)),
    counterpartyMetrics: (id: string) => ok(computeCounterpartyMetrics(store, id)),
TO:
*/
agentMetrics: (wallet: string) => ok(cache.getAgentMetrics(store, wallet)),
counterpartyMetrics: (id: string) => ok(cache.getCounterpartyMetrics(store, id)),

/*
=== STEP 8: Add New API Endpoints ===
Add these new endpoints in the return statement of createApi:
*/
flowAggregates: (filters: {
  wallet?: string;
  counterparty?: string;
  protocol?: string;
  startDate?: string;
  endDate?: string;
} = {}) => ok(cache.getFlowAggregates(store, filters)),
cacheStats: () => ok(cache.getStats()),
cacheInvalidate: () => {
  cache.invalidateAll();
  return ok({ ok: true, message: "Cache invalidated" });
},

/*
=== STEP 9: Add Route Handlers ===
Add these handlers in createRouteHandlers return statement:
*/
flowAggregates: (req: { query: Record<string, string | string[] | undefined> }, res: JsonResponder) =>
  send(
    res,
    api.flowAggregates({
      wallet: req.query.wallet ? String(req.query.wallet) : undefined,
      counterparty: req.query.counterparty ? String(req.query.counterparty) : undefined,
      protocol: req.query.protocol ? String(req.query.protocol) : undefined,
      startDate: req.query.startDate ? String(req.query.startDate) : undefined,
      endDate: req.query.endDate ? String(req.query.endDate) : undefined,
    }),
  ),
cacheStats: (_req: unknown, res: JsonResponder) => send(res, api.cacheStats()),
cacheInvalidate: (_req: unknown, res: JsonResponder) => send(res, api.cacheInvalidate()),

/*
=== STEP 10: Update createApp Function ===
After initializing store, add queryCache and update API initialization:
*/
const queryCache = options.queryCache ?? new QueryCache({
  agentMetricsTTL: 300,
  counterpartyMetricsTTL: 300,
  flowAggregateTTL: 180,
  interactionListTTL: 60,
  enablePerformanceMonitoring: false,
});
const api = createApi({ config, store, queryCache });  // Pass queryCache here

/*
=== STEP 11: Add Cache Cleanup Interval ===
After jobScheduler.start(), add:
*/
// Periodic cache cleanup (every 5 minutes)
const cacheCleanupInterval = setInterval(() => {
  queryCache.cleanup();
}, 5 * 60 * 1000);

/*
=== STEP 12: Update Graceful Shutdown ===
Update SIGTERM and SIGINT handlers to clear interval:
*/
process.on("SIGTERM", () => {
  console.log("SIGTERM received, stopping background jobs");
  clearInterval(cacheCleanupInterval);  // ADD THIS LINE
  jobScheduler.stop();
});

process.on("SIGINT", () => {
  console.log("SIGINT received, stopping background jobs");
  clearInterval(cacheCleanupInterval);  // ADD THIS LINE
  jobScheduler.stop();
  process.exit(0);
});

/*
=== STEP 13: Add Express Routes ===
Add these routes before return app:
*/
app.get("/api/metrics/flow-aggregates", handlers.flowAggregates as never);
app.get("/api/cache/stats", handlers.cacheStats as never);
app.post("/api/cache/invalidate", handlers.cacheInvalidate as never);
