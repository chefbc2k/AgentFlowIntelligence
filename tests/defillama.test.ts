import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DefiLlamaClient } from "../server/defillama";

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

describe("DefiLlamaClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches current prices for multiple tokens", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/prices/current/")) {
        return okJson({
          coins: {
            "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
              price: 1.0,
              symbol: "USDC",
              timestamp: Date.now(),
              confidence: 0.99,
            },
            "base:0x4200000000000000000000000000000000000006": {
              price: 3200.0,
              symbol: "WETH",
              timestamp: Date.now(),
              confidence: 0.95,
            },
          },
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const prices = await client.getCurrentPrices([
      "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      "base:0x4200000000000000000000000000000000000006",
    ]);

    expect(Object.keys(prices)).toHaveLength(2);
    expect(prices["base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"]).toEqual({
      price: 1.0,
      symbol: "USDC",
      timestamp: expect.any(Number),
      confidence: 0.99,
    });
    expect(prices["base:0x4200000000000000000000000000000000000006"].price).toBe(3200.0);
  });

  it("returns empty object on price fetch failure", async () => {
    const fetchMock = vi.fn(async () => notOk(500));
    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const pricesPromise = client.getCurrentPrices(["base:0x123"]);
    await vi.runAllTimersAsync();
    const prices = await pricesPromise;

    expect(prices).toEqual({});
  });

  it("filters out invalid price entries", async () => {
    const fetchMock = vi.fn(async () =>
      okJson({
        coins: {
          "base:0xvalid": { price: 1.5, symbol: "VALID" },
          "base:0xinvalid": { symbol: "INVALID" }, // Missing price
        },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const prices = await client.getCurrentPrices(["base:0xvalid", "base:0xinvalid"]);

    expect(Object.keys(prices)).toHaveLength(1);
    expect(prices["base:0xvalid"].price).toBe(1.5);
  });

  it("fetches protocol metadata", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/protocol/")) {
        return okJson({
          id: "uniswap",
          name: "Uniswap",
          category: "Dexes",
          tvl: 5000000000,
          chain: "Base",
          description: "A decentralized exchange",
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const protocol = await client.getProtocolMetadata("uniswap");

    expect(protocol).toBeDefined();
    expect(protocol?.name).toBe("Uniswap");
    expect(protocol?.category).toBe("Dexes");
    expect(protocol?.tvl).toBe(5000000000);
  });

  it("returns null for missing protocol", async () => {
    const fetchMock = vi.fn(async () => notOk(404));
    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const protocolPromise = client.getProtocolMetadata("unknown-protocol");
    await vi.runAllTimersAsync();
    const protocol = await protocolPromise;

    expect(protocol).toBeNull();
  });

  it("fetches chain TVL", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/charts/")) {
        return okJson({
          tokenSymbol: "ETH",
          tvl: 10000000000,
          chainId: 8453,
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const chainMetrics = await client.getChainTVL("base");

    expect(chainMetrics).toBeDefined();
    expect(chainMetrics?.tvl).toBe(10000000000);
    expect(chainMetrics?.tokenSymbol).toBe("ETH");
  });

  it("lists all protocols", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/protocols")) {
        return okJson([
          { name: "Uniswap", category: "Dexes", tvl: 5000000000 },
          { name: "Aave", category: "Lending", tvl: 3000000000 },
        ]);
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const protocols = await client.listProtocols();

    expect(protocols).toHaveLength(2);
    expect(protocols[0].name).toBe("Uniswap");
    expect(protocols[1].name).toBe("Aave");
  });

  it("builds protocol category mapping", async () => {
    const fetchMock = vi.fn(async () =>
      okJson([
        { name: "Uniswap", category: "Dexes" },
        { name: "Aave", category: "Lending" },
        { name: "Unknown", category: null }, // Should be skipped
      ]),
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const categories = await client.getProtocolCategories();

    expect(categories).toEqual({
      uniswap: "dexes",
      aave: "lending",
    });
  });

  it("returns empty array when protocol list fails", async () => {
    const fetchMock = vi.fn(async () => notOk(500));
    vi.stubGlobal("fetch", fetchMock);

    const client = new DefiLlamaClient();
    const protocolsPromise = client.listProtocols();
    await vi.runAllTimersAsync();
    const protocols = await protocolsPromise;

    expect(protocols).toEqual([]);
  });
});
