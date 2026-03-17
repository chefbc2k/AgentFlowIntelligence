import { AppConfig } from "./config";
import { Store } from "./store";
import { PricingService } from "./pricing";
import { DuneClient } from "./dune";

export interface JobSchedulerConfig {
  config: AppConfig;
  store: Store;
  pricingService: PricingService;
  duneClient?: DuneClient;
}

/**
 * Background job scheduler for keeping price and protocol data fresh
 * Runs two periodic jobs:
 * 1. Price refresh (every 5 minutes) - SOLVES PROBLEM 1
 * 2. Protocol label refresh (every 1 hour) - SOLVES PROBLEM 2
 */
export class JobScheduler {
  private jobs: Map<string, NodeJS.Timeout> = new Map();
  private config: AppConfig;
  private store: Store;
  private pricingService: PricingService;
  private duneClient?: DuneClient;

  constructor({ config, store, pricingService, duneClient }: JobSchedulerConfig) {
    this.config = config;
    this.store = store;
    this.pricingService = pricingService;
    this.duneClient = duneClient;
  }

  /**
   * Start all background jobs
   */
  start(): void {
    if (!this.config.enableBackgroundJobs) {
      console.log("[JobScheduler] Background jobs disabled by config");
      return;
    }

    console.log("[JobScheduler] Starting background jobs");

    // JOB 1: Price polling (every 5 minutes) - SOLVES PROBLEM 1: USD Normalization
    this.schedule("price-refresh", 5 * 60 * 1000, async () => {
      await this.refreshPrices();
    });

    // JOB 2: Protocol labels (every 1 hour) - SOLVES PROBLEM 2: Protocol Semantics
    if (this.duneClient) {
      this.schedule("protocol-labels", 60 * 60 * 1000, async () => {
        await this.refreshProtocolLabels();
      });
    } else {
      console.log("[JobScheduler] Dune client not configured, skipping protocol label job");
    }

    // Run jobs immediately on startup. Individual refreshers already log and continue on per-item failures.
    void this.refreshPrices();

    if (this.duneClient) {
      void this.refreshProtocolLabels();
    }
  }

  /**
   * Stop all background jobs
   */
  stop(): void {
    console.log("[JobScheduler] Stopping background jobs");
    for (const [name, timer] of this.jobs) {
      clearInterval(timer);
      console.log(`[JobScheduler] Stopped job: ${name}`);
    }
    this.jobs.clear();
  }

  /**
   * Schedule a recurring job
   */
  private schedule(name: string, intervalMs: number, task: () => Promise<void>): void {
    const timer = setInterval(async () => {
      try {
        console.log(`[JobScheduler] Running job: ${name}`);
        await task();
        console.log(`[JobScheduler] Completed job: ${name}`);
      } catch (error) {
        console.error(`[JobScheduler] Job ${name} failed:`, error);
      }
    }, intervalMs);

    this.jobs.set(name, timer);
    console.log(`[JobScheduler] Scheduled job: ${name} (interval: ${intervalMs}ms)`);
  }

  /**
   * JOB 1: Refresh prices for common tokens
   * SOLVES PROBLEM 1: USD Normalization
   */
  private async refreshPrices(): Promise<void> {
    const tokens = PricingService.getCommonTokens();
    console.log(`[JobScheduler] Refreshing prices for ${tokens.length} tokens`);

    let successCount = 0;
    let failCount = 0;

    for (const token of tokens) {
      try {
        const price = await this.pricingService.getPriceUSD(token.address, token.chainId);

        if (price !== null) {
          this.store.upsertPrice({
            id: `${token.chainId}:${token.address.toLowerCase()}`,
            token_address: token.address.toLowerCase(),
            chain_id: token.chainId,
            symbol: token.symbol,
            price_usd: price.toString(),
            source: "coingecko", // Source is tracked by PricingService internally
            timestamp: new Date().toISOString(),
            raw: { price },
          });
          successCount++;
        } else {
          failCount++;
          console.warn(
            `[JobScheduler] Failed to fetch price for ${token.symbol} (${token.address})`,
          );
        }
      } catch (error) {
        failCount++;
        console.error(
          `[JobScheduler] Error fetching price for ${token.symbol}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log(
      `[JobScheduler] Price refresh complete: ${successCount} success, ${failCount} failed`,
    );
  }

  /**
   * JOB 2: Refresh protocol labels for active wallets
   * SOLVES PROBLEM 2: Protocol Semantics
   */
  private async refreshProtocolLabels(): Promise<void> {
    if (!this.duneClient) {
      return;
    }

    const daysBack = 7;
    const activeWallets = this.store.getActiveWallets(daysBack);
    console.log(
      `[JobScheduler] Refreshing protocol labels for ${activeWallets.length} active wallets (last ${daysBack} days)`,
    );

    if (activeWallets.length === 0) {
      console.log("[JobScheduler] No active wallets found, skipping protocol label refresh");
      return;
    }

    let totalLabels = 0;

    for (const wallet of activeWallets) {
      try {
        const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
        const activity = await this.duneClient.getProtocolActivity(wallet, startDate);

        for (const event of activity) {
          if (event.contractAddress && event.protocolName) {
            const labelId = `${event.chainId || 8453}:${event.contractAddress.toLowerCase()}`;

            this.store.upsertProtocolLabel({
              id: labelId,
              contract_address: event.contractAddress.toLowerCase(),
              chain_id: event.chainId || 8453,
              protocol_name: event.protocolName,
              protocol_category: this.categorizeProtocol(event.category),
              source: "dune",
              metadata: {
                txHash: event.txHash,
                blockTime: event.blockTime,
                category: event.category,
                amountUSD: event.amountUSD,
              },
              created_at: new Date().toISOString(),
            });

            totalLabels++;
          }
        }
      } catch (error) {
        console.error(
          `[JobScheduler] Error fetching protocol activity for ${wallet}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    console.log(`[JobScheduler] Protocol label refresh complete: ${totalLabels} labels updated`);
  }

  /**
   * Map Dune category strings to protocol category types
   */
  private categorizeProtocol(
    category?: string,
  ): "dex" | "bridge" | "escrow" | "lending" | "staking" | "other" {
    if (!category) return "other";

    const lower = category.toLowerCase();
    if (lower.includes("dex") || lower.includes("swap")) return "dex";
    if (lower.includes("bridge")) return "bridge";
    if (lower.includes("escrow")) return "escrow";
    if (lower.includes("lend") || lower.includes("borrow")) return "lending";
    if (lower.includes("stak")) return "staking";

    return "other";
  }
}
