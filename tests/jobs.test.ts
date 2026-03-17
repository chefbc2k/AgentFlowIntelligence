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
});
