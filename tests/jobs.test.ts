import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JobScheduler } from "../server/jobs";
import { Store } from "../server/store";
import { PricingService } from "../server/pricing";
import { DuneClient } from "../server/dune";
import type { AppConfig } from "../server/config";

function okJson<T>(data: T) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("JobScheduler", () => {
  let scheduler: JobScheduler | null = null;

  const createConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
    port: "8787",
    dbPath: ":memory:",
    dataDir: "./data",
    locusBaseUrl: "https://beta-api.paywithlocus.com",
    easBaseUrl: "https://base.easscan.org/graphql",
    easSepoliaUrl: "https://base-sepolia.easscan.org/graphql",
    enableBackgroundJobs: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
      scheduler = null;
    }
    vi.useRealTimers();
  });

  it("starts background jobs when enabled", () => {
    const config = createConfig();

    const store = new Store({ dbPath: ":memory:", dataDir: "./data" });
    const pricingService = new PricingService();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({ config, store, pricingService });
    scheduler.start();

    expect(consoleSpy).toHaveBeenCalledWith("[JobScheduler] Starting background jobs");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[JobScheduler] Scheduled job: price-refresh"),
    );

    consoleSpy.mockRestore();
  });

  it("skips jobs when disabled in config", () => {
    const config = createConfig({ enableBackgroundJobs: false });

    const store = new Store({ dbPath: ":memory:", dataDir: "./data" });
    const pricingService = new PricingService();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({ config, store, pricingService });
    scheduler.start();

    expect(consoleSpy).toHaveBeenCalledWith("[JobScheduler] Background jobs disabled by config");

    consoleSpy.mockRestore();
  });

  it("refreshes prices on schedule", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname.includes("coingecko")) {
        return okJson({
          "usd-coin": { usd: 1.0 },
          weth: { usd: 3200.0 },
        });
      }
      return okJson({});
    });

    vi.stubGlobal("fetch", fetchMock);

    const config = createConfig();

    const store = new Store({ dbPath: ":memory:", dataDir: "./data" });
    const pricingService = new PricingService();

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    scheduler = new JobScheduler({ config, store, pricingService });
    scheduler.start();

    // Wait for initial job run (run only pending timers, not intervals)
    await vi.runOnlyPendingTimersAsync();

    // Verify prices were fetched (at least one call to CoinGecko)
    const coingeckoCalls = fetchMock.mock.calls.filter((call) =>
      call[0].includes("coingecko"),
    );
    expect(coingeckoCalls.length).toBeGreaterThan(0);
  });

  it("stops all jobs when stop is called", () => {
    const config = createConfig();

    const store = new Store({ dbPath: ":memory:", dataDir: "./data" });
    const pricingService = new PricingService();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({ config, store, pricingService });
    scheduler.start();
    scheduler.stop();

    expect(consoleSpy).toHaveBeenCalledWith("[JobScheduler] Stopping background jobs");
    expect(consoleSpy).toHaveBeenCalledWith("[JobScheduler] Stopped job: price-refresh");

    consoleSpy.mockRestore();
  });

  it("handles price refresh failures gracefully", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("Network error");
    });

    vi.stubGlobal("fetch", fetchMock);

    const config = createConfig();

    const store = new Store({ dbPath: ":memory:", dataDir: "./data" });
    const pricingService = new PricingService();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    scheduler = new JobScheduler({ config, store, pricingService });
    scheduler.start();

    // Wait for initial job run (run only pending timers, not intervals)
    await vi.runOnlyPendingTimersAsync();

    // Should log warnings for failed price fetches but not crash
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("schedules protocol label refresh when Dune client available", () => {
    const config = createConfig({ duneApiKey: "test-key" });

    const store = new Store({ dbPath: ":memory:", dataDir: "./data" });
    const pricingService = new PricingService();
    const duneClient = new DuneClient("test-key");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({ config, store, pricingService, duneClient });
    scheduler.start();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[JobScheduler] Scheduled job: protocol-labels"),
    );

    consoleSpy.mockRestore();
  });

  it("skips protocol label job when Dune client not available", () => {
    const config = createConfig();

    const store = new Store({ dbPath: ":memory:", dataDir: "./data" });
    const pricingService = new PricingService();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({ config, store, pricingService });
    scheduler.start();

    expect(consoleSpy).toHaveBeenCalledWith(
      "[JobScheduler] Dune client not configured, skipping protocol label job",
    );

    consoleSpy.mockRestore();
  });

  it("refreshes protocol labels for active wallets and categorizes protocol families", async () => {
    const upsertProtocolLabel = vi.fn();
    const store = {
      getActiveWallets: () => ["0xwallet"],
      listObservedTokens: () => [],
      upsertProtocolLabel,
    } as unknown as Store;
    const duneClient = {
      getProtocolActivity: vi.fn(async () => [
        { contractAddress: "0xdex", protocolName: "Dex", category: "swap", chainId: 8453 },
        { contractAddress: "0xbridge", protocolName: "Bridge", category: "bridge", chainId: 8453 },
        { contractAddress: "0xescrow", protocolName: "Escrow", category: "escrow", chainId: 8453 },
        { contractAddress: "0xlend", protocolName: "Lend", category: "borrow", chainId: 8453 },
        { contractAddress: "0xstake", protocolName: "Stake", category: "staking", chainId: 8453 },
        { contractAddress: "0xother", protocolName: "Other", category: undefined, chainId: 8453 },
        { contractAddress: undefined, protocolName: "Skip", category: "swap", chainId: 8453 },
      ]),
    } as unknown as DuneClient;

    scheduler = new JobScheduler({
      config: createConfig(),
      store,
      pricingService: {} as PricingService,
      duneClient,
    });

    await (scheduler as unknown as { refreshProtocolLabels: () => Promise<void> }).refreshProtocolLabels();

    expect(upsertProtocolLabel).toHaveBeenCalledTimes(6);
    expect(upsertProtocolLabel.mock.calls.map(([row]) => row.protocol_category)).toEqual([
      "dex",
      "bridge",
      "escrow",
      "lending",
      "staking",
      "other",
    ]);
  });

  it("skips direct protocol refresh when no wallets are active or no dune client exists", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({
      config: createConfig(),
      store: { getActiveWallets: () => [], listObservedTokens: () => [] } as unknown as Store,
      pricingService: {} as PricingService,
      duneClient: {
        getProtocolActivity: vi.fn(async () => []),
      } as unknown as DuneClient,
    });
    await (scheduler as unknown as { refreshProtocolLabels: () => Promise<void> }).refreshProtocolLabels();

    const noDuneScheduler = new JobScheduler({
      config: createConfig(),
      store: { getActiveWallets: () => ["0xwallet"], listObservedTokens: () => [] } as unknown as Store,
      pricingService: {} as PricingService,
    });
    await (noDuneScheduler as unknown as { refreshProtocolLabels: () => Promise<void> }).refreshProtocolLabels();

    expect(consoleSpy).toHaveBeenCalledWith(
      "[JobScheduler] No active wallets found, skipping protocol label refresh",
    );

    consoleSpy.mockRestore();
  });

  it("continues price and protocol refresh loops when individual calls fail", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const store = {
      upsertPrice: vi.fn(),
      getActiveWallets: () => ["0xwallet"],
      listObservedTokens: () => [],
      upsertProtocolLabel: vi.fn(),
    } as unknown as Store;
    const pricingService = {
      getPriceUSD: vi
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(2),
    } as unknown as PricingService;
    const duneClient = {
      getProtocolActivity: vi.fn(async () => {
        throw new Error("dune boom");
      }),
    } as unknown as DuneClient;

    scheduler = new JobScheduler({
      config: createConfig(),
      store,
      pricingService,
      duneClient,
    });

    await (scheduler as unknown as { refreshPrices: () => Promise<void> }).refreshPrices();
    await (scheduler as unknown as { refreshProtocolLabels: () => Promise<void> }).refreshProtocolLabels();

    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs non-Error failures from price and protocol refreshers", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({
      config: createConfig(),
      store: {
        upsertPrice: vi.fn(),
        getActiveWallets: () => ["0xwallet"],
        listObservedTokens: () => [],
        upsertProtocolLabel: vi.fn(),
      } as unknown as Store,
      pricingService: {
        getPriceUSD: vi.fn().mockRejectedValue("price boom"),
      } as unknown as PricingService,
      duneClient: {
        getProtocolActivity: vi.fn(async () => {
          throw "dune boom";
        }),
      } as unknown as DuneClient,
    });

    await (scheduler as unknown as { refreshPrices: () => Promise<void> }).refreshPrices();
    await (scheduler as unknown as { refreshProtocolLabels: () => Promise<void> }).refreshProtocolLabels();

    expect(errorSpy).toHaveBeenCalledWith("[JobScheduler] Error fetching price for USDC:", "price boom");
    expect(errorSpy).toHaveBeenCalledWith(
      "[JobScheduler] Error fetching protocol activity for 0xwallet:",
      "dune boom",
    );

    errorSpy.mockRestore();
  });

  it("categorizes protocol labels across all supported buckets and ignores incomplete events", async () => {
    const store = new Store({ dbPath: ":memory:", dataDir: "./data" });
    store.upsertInteraction({
      id: "active-wallet",
      created_at: new Date().toISOString(),
      wallet_address: "0xwallet",
      protocol: "x402",
      summary: {},
    });

    scheduler = new JobScheduler({
      config: createConfig({ duneApiKey: "test-key" }),
      store,
      pricingService: { getPriceUSD: vi.fn() } as unknown as PricingService,
      duneClient: {
        getProtocolActivity: vi.fn(async () => [
          { contractAddress: "0xdex", protocolName: "Uni", category: "DEX" },
          { contractAddress: "0xbridge", protocolName: "BridgeX", category: "Bridge" },
          { contractAddress: "0xescrow", protocolName: "EscrowX", category: "Escrow" },
          { contractAddress: "0xlend", protocolName: "LendX", category: "Borrow" },
          { contractAddress: "0xstake", protocolName: "StakeX", category: "Staking" },
          { contractAddress: "0xother", protocolName: "OtherX", category: "Unknown" },
          { contractAddress: "0xskip", protocolName: undefined, category: "DEX" },
          { contractAddress: undefined, protocolName: "SkipX", category: "DEX" },
        ]),
      } as unknown as DuneClient,
    });

    await (scheduler as unknown as { refreshProtocolLabels: () => Promise<void> }).refreshProtocolLabels();

    expect(store.getProtocolLabel("0xdex", 8453)?.protocol_category).toBe("dex");
    expect(store.getProtocolLabel("0xbridge", 8453)?.protocol_category).toBe("bridge");
    expect(store.getProtocolLabel("0xescrow", 8453)?.protocol_category).toBe("escrow");
    expect(store.getProtocolLabel("0xlend", 8453)?.protocol_category).toBe("lending");
    expect(store.getProtocolLabel("0xstake", 8453)?.protocol_category).toBe("staking");
    expect(store.getProtocolLabel("0xother", 8453)?.protocol_category).toBe("other");
    expect(store.getProtocolLabel("0xskip", 8453)).toBeUndefined();
  });

  it("logs scheduled protocol job failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({
      config: createConfig({ duneApiKey: "test-key" }),
      store: new Store({ dbPath: ":memory:", dataDir: "./data" }),
      pricingService: { getPriceUSD: vi.fn(async () => 1) } as unknown as PricingService,
      duneClient: { getProtocolActivity: vi.fn(async () => []) } as unknown as DuneClient,
    });

    vi.spyOn(scheduler as unknown as { refreshProtocolLabels: () => Promise<void> }, "refreshProtocolLabels")
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("scheduled protocol failure"));

    scheduler.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(errorSpy).toHaveBeenCalledWith(
      "[JobScheduler] Job protocol-labels failed:",
      expect.any(Error),
    );
  });

  it("logs non-Error values from price and protocol refresh failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    scheduler = new JobScheduler({
      config: createConfig({ duneApiKey: "test-key" }),
      store: {
        upsertPrice: vi.fn(),
        getActiveWallets: () => ["0xwallet"],
        listObservedTokens: () => [],
        upsertProtocolLabel: vi.fn(),
      } as unknown as Store,
      pricingService: {
        getPriceUSD: vi.fn(async () => {
          throw "price-string";
        }),
      } as unknown as PricingService,
      duneClient: {
        getProtocolActivity: vi.fn(async () => {
          throw "protocol-string";
        }),
      } as unknown as DuneClient,
    });

    await (scheduler as unknown as { refreshPrices: () => Promise<void> }).refreshPrices();
    await (scheduler as unknown as { refreshProtocolLabels: () => Promise<void> }).refreshProtocolLabels();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[JobScheduler] Error fetching price"),
      "price-string",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[JobScheduler] Error fetching protocol activity for 0xwallet:",
      "protocol-string",
    );
  });

});
