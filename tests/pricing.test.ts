import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PricingService } from "../server/pricing";

function okJson<T>(data: T) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function notOk(status: number) {
  return new Response(JSON.stringify({ error: "failed" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PricingService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches token price from CoinGecko", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname.includes("coingecko")) {
        expect(url.pathname).toBe("/api/v3/simple/price");
        expect(url.searchParams.get("ids")).toBe("usd-coin");
        expect(url.searchParams.get("vs_currencies")).toBe("usd");
        return okJson({
          "usd-coin": { usd: 1.0 },
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const price = await service.getPriceUSD("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 8453); // USDC on Base

    expect(price).toBe(1.0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to DefiLlama when CoinGecko fails", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname.includes("coingecko")) {
        return notOk(500);
      }
      if (url.hostname.includes("llama.fi")) {
        return okJson({
          coins: {
            "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
              price: 1.0,
              timestamp: Date.now(),
            },
          },
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const pricePromise = service.getPriceUSD("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 8453);
    await vi.runAllTimersAsync();
    const price = await pricePromise;

    expect(price).toBe(1.0);
  });

  it("returns null when both APIs fail", async () => {
    const fetchMock = vi.fn(async () => notOk(500));
    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const pricePromise = service.getPriceUSD("0xunknown", 8453);
    await vi.runAllTimersAsync();
    const price = await pricePromise;

    expect(price).toBeNull();
  });

  it("normalizes amount to USD", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname.includes("coingecko")) {
        return okJson({
          "usd-coin": { usd: 1.0 },
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const amountUSD = await service.normalizeToUSD(100, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 8453);

    expect(amountUSD).toBe(100);
  });

  it("returns null when normalization fails", async () => {
    const fetchMock = vi.fn(async () => notOk(500));
    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const amountPromise = service.normalizeToUSD(100, "0xunknown", 8453);
    await vi.runAllTimersAsync();
    const amountUSD = await amountPromise;

    expect(amountUSD).toBeNull();
  });

  it("provides common tokens list", () => {
    const tokens = PricingService.getCommonTokens();

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0]).toHaveProperty("address");
    expect(tokens[0]).toHaveProperty("chainId");
    expect(tokens[0]).toHaveProperty("symbol");
  });

  it("batches multiple price requests", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname.includes("coingecko")) {
        return okJson({
          "usd-coin": { usd: 1.0 },
          weth: { usd: 3200.0 },
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const prices = await service.batchGetPrices([
      { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453, symbol: "USDC" },
      { address: "0x4200000000000000000000000000000000000006", chainId: 8453, symbol: "WETH" },
    ]);

    expect(prices.size).toBe(2);
    expect(prices.get("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe(1.0);
    expect(prices.get("8453:0x4200000000000000000000000000000000000006")).toBe(3200.0);
  });

  it("skips batch entries whose prices cannot be resolved", async () => {
    const fetchMock = vi.fn(async () => okJson({ coins: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const pricesPromise = service.batchGetPrices([{ address: "0xunknown", chainId: 8453 }]);
    await vi.runAllTimersAsync();
    expect(await pricesPromise).toEqual(new Map());
  });

  it("handles contract lookups without price data and unsupported chains", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname.includes("coingecko") && url.pathname.includes("/contract/")) {
        return okJson({
          market_data: {
            current_price: {},
          },
        });
      }
      if (url.hostname.includes("llama.fi")) {
        return okJson({ coins: {} });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    await expect(service.getPriceUSD("0xnot-mapped", 8453)).resolves.toBeNull();
    await expect(service.getPriceUSD("0xnot-mapped", 999999)).resolves.toBeNull();
  });

  it("looks up unknown tokens via CoinGecko contract endpoints", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/coins/base/contract/0xunknown")) {
        return okJson({
          market_data: {
            current_price: {
              usd: 12.34,
            },
          },
        });
      }

      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const price = await service.getPriceUSD("0xunknown", 8453);
    expect(price).toBe(12.34);
  });

  it("sends the CoinGecko demo key header when configured", async () => {
    process.env.AFI_COINGECKO_API_KEY = "demo-key";
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.headers).toEqual(
        expect.objectContaining({
          "x-cg-demo-api-key": "demo-key",
        }),
      );
      return okJson({ "usd-coin": { usd: 1 } });
    });

    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    await expect(
      service.getPriceUSD("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 8453),
    ).resolves.toBe(1);
    delete process.env.AFI_COINGECKO_API_KEY;
  });

  it("skips null batch results and sends the CoinGecko demo key for contract lookups", async () => {
    process.env.AFI_COINGECKO_API_KEY = "demo-key";
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.includes("/contract/")) {
        expect(init?.headers).toEqual(
          expect.objectContaining({
            "x-cg-demo-api-key": "demo-key",
          }),
        );
        return okJson({
          market_data: {
            current_price: {
              usd: 2,
            },
          },
        });
      }

      if (url.pathname.includes("/simple/price")) {
        return okJson({ "usd-coin": { usd: 1 } });
      }

      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const service = new PricingService();
    const prices = await service.batchGetPrices([
      { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453 },
      { address: "0xcontract", chainId: 8453 },
      { address: "0xmissing", chainId: 999999 },
    ]);

    expect(prices.get("8453:0xcontract")).toBe(2);
    expect(prices.has("999999:0xmissing")).toBe(false);
    delete process.env.AFI_COINGECKO_API_KEY;
  });
});
