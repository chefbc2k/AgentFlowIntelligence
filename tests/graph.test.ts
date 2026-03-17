import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphClient } from "../server/graph";

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

describe("GraphClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes GraphQL query", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return okJson({
          data: {
            positions: [
              { id: "1", owner: "0xowner", liquidity: "1000" },
              { id: "2", owner: "0xowner", liquidity: "2000" },
            ],
          },
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "test-subgraph-id");
    const result = await client.query<{ positions: Array<{ id: string; liquidity: string }> }>(
      `query { positions { id liquidity } }`,
    );

    expect(result.positions).toHaveLength(2);
    expect(result.positions[0].id).toBe("1");
  });

  it("handles GraphQL errors", async () => {
    const fetchMock = vi.fn(async () =>
      okJson({
        errors: [{ message: "Field 'invalid' doesn't exist" }],
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "test-subgraph-id");

    await expect(client.query("query { invalid }")).rejects.toThrow("GraphQL error");
  });

  it("fetches Uniswap positions", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return okJson({
          data: {
            positions: [
              {
                id: "pos1",
                owner: "0xowner",
                liquidity: "5000",
                token0: { symbol: "USDC", id: "0xusdc" },
                token1: { symbol: "ETH", id: "0xeth" },
                depositedToken0: "100",
                depositedToken1: "0.05",
              },
            ],
          },
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "uniswap-v3-subgraph");
    const positions = await client.getUniswapPositions("0xowner");

    expect(positions).toHaveLength(1);
    expect(positions[0].id).toBe("pos1");
    expect(positions[0].token0?.symbol).toBe("USDC");
    expect(positions[0].token1?.symbol).toBe("ETH");
  });

  it("fetches Aave deposits", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return okJson({
          data: {
            deposits: [
              {
                id: "dep1",
                user: "0xuser",
                amount: "1000",
                reserve: { symbol: "USDC", underlyingAsset: "0xusdc" },
                timestamp: "1234567890",
              },
            ],
          },
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "aave-v3-subgraph");
    const deposits = await client.getAaveDeposits("0xuser");

    expect(deposits).toHaveLength(1);
    expect(deposits[0].id).toBe("dep1");
    expect(deposits[0].reserve?.symbol).toBe("USDC");
  });

  it("returns empty Aave deposits on query failure", async () => {
    const fetchMock = vi.fn(async () => notOk(500));
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new GraphClient("test-api-key", "aave-v3-subgraph");
    const depositsPromise = client.getAaveDeposits("0xuser");
    await vi.runAllTimersAsync();
    expect(await depositsPromise).toEqual([]);

    errorSpy.mockRestore();
  });

  it("returns empty array on query failure", async () => {
    const fetchMock = vi.fn(async () => notOk(500));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "test-subgraph");
    const positionsPromise = client.getUniswapPositions("0xowner");
    await vi.runAllTimersAsync();
    const positions = await positionsPromise;

    expect(positions).toEqual([]);
  });

  it("creates client for different subgraph", () => {
    const client = new GraphClient("api-key-1", "subgraph-1");
    const newClient = client.forSubgraph("subgraph-2", "api-key-2");
    const rootClient = new GraphClient("api-key-3");

    expect(newClient).toBeInstanceOf(GraphClient);
    expect(newClient).not.toBe(client);
    expect(rootClient).toBeInstanceOf(GraphClient);
  });

  it("handles missing data in response", async () => {
    const fetchMock = vi.fn(async () => okJson({ data: null }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "test-subgraph");

    await expect(client.query("query { test }")).rejects.toThrow("No data returned");
  });

  it("covers protocol interaction queries and adapter fallbacks", async () => {
    const interactionFetch = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method !== "POST") {
        return notOk(404);
      }

      const payload = JSON.parse(String(init.body)) as { query: string };
      if (payload.query.includes("transactionCount")) {
        return okJson({
          data: {
            account: {
              transactionCount: 7,
              positions: [{ id: "p1" }],
            },
          },
        });
      }

      return okJson({
        data: {
          deposits: [{ id: "dep1", reserve: { symbol: "USDC" } }],
        },
      });
    });
    vi.stubGlobal("fetch", interactionFetch);

    const client = new GraphClient("test-api-key", "subgraph");
    await expect(client.getProtocolInteractions("0xabc")).resolves.toEqual([
      { protocol: "detected", txCount: 7 },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string, init?: RequestInit) =>
        okJson({
          data: JSON.parse(String(init?.body)).query.includes("transactionCount")
            ? { account: null }
            : null,
        }),
      ),
    );
    await expect(client.getProtocolInteractions("0xabc")).resolves.toEqual([]);
    await expect(client.getAaveDeposits("0xuser")).resolves.toEqual([]);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => notOk(500)));
    const interactionsPromise = client.getProtocolInteractions("0xabc");
    await vi.runAllTimersAsync();
    await expect(interactionsPromise).resolves.toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("fetches generic protocol interaction counts", async () => {
    const fetchMock = vi.fn(async () =>
      okJson({
        data: {
          account: {
            transactionCount: 7,
            positions: [{ id: "pos1" }],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "test-subgraph");
    await expect(client.getProtocolInteractions("0xowner")).resolves.toEqual([
      { protocol: "detected", txCount: 7 },
    ]);
  });

  it("defaults empty graph entity arrays and zero transaction counts", async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { query: string };
      if (payload.query.includes("positions(where")) {
        return okJson({ data: {} });
      }
      if (payload.query.includes("deposits(where")) {
        return okJson({ data: {} });
      }
      return okJson({ data: { account: {} } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "test-subgraph");
    await expect(client.getUniswapPositions("0xowner")).resolves.toEqual([]);
    await expect(client.getAaveDeposits("0xowner")).resolves.toEqual([]);
    await expect(client.getProtocolInteractions("0xowner")).resolves.toEqual([
      { protocol: "detected", txCount: 0 },
    ]);
  });

  it("returns empty generic protocol interactions when no account is found", async () => {
    const fetchMock = vi.fn(async () => okJson({ data: { account: null } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GraphClient("test-api-key", "test-subgraph");
    await expect(client.getProtocolInteractions("0xowner")).resolves.toEqual([]);
  });

  it("returns empty generic protocol interactions on query failure", async () => {
    const fetchMock = vi.fn(async () => notOk(500));
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new GraphClient("test-api-key", "test-subgraph");
    const interactionsPromise = client.getProtocolInteractions("0xowner");
    await vi.runAllTimersAsync();
    expect(await interactionsPromise).toEqual([]);

    errorSpy.mockRestore();
  });
});
