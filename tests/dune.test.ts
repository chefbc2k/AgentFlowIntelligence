import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DuneClient } from "../server/dune";

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

describe("DuneClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes SQL query and polls for results", async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);

      // Step 1: Submit query
      if (url.pathname.includes("/sql/execute")) {
        return okJson({ execution_id: "exec123" });
      }

      // Step 2: Poll for results (simulate pending then completed)
      if (url.pathname.includes("/execution/")) {
        pollCount++;
        if (pollCount === 1) {
          return okJson({ state: "QUERY_STATE_PENDING" });
        }
        return okJson({
          state: "QUERY_STATE_COMPLETED",
          result: {
            rows: [
              { blockTime: "2024-01-01T00:00:00Z", txHash: "0xtx1", protocolName: "Uniswap" },
              { blockTime: "2024-01-02T00:00:00Z", txHash: "0xtx2", protocolName: "Aave" },
            ],
          },
        });
      }

      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DuneClient("test-api-key");
    const resultsPromise = client.executeQuery("SELECT * FROM dex.trades LIMIT 10");

    // Advance time to allow polling (2 seconds between polls)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    const results = await resultsPromise;

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty("protocolName", "Uniswap");
    expect(results[1]).toHaveProperty("protocolName", "Aave");
    expect(pollCount).toBeGreaterThan(0);
  });

  it("times out after max polling attempts", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);

      if (url.pathname.includes("/sql/execute")) {
        return okJson({ execution_id: "exec123" });
      }

      if (url.pathname.includes("/execution/")) {
        // Always return pending
        return okJson({ state: "QUERY_STATE_PENDING" });
      }

      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DuneClient("test-api-key");

    // Should throw after timeout
    const queryPromise = expect(client.executeQuery("SELECT 1")).rejects.toThrow();
    await vi.runAllTimersAsync();
    await queryPromise;
  });

  it("fetches protocol activity for address", async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);

      if (url.pathname.includes("/sql/execute")) {
        return okJson({ execution_id: "exec456" });
      }

      if (url.pathname.includes("/execution/")) {
        pollCount++;
        if (pollCount === 1) {
          return okJson({ state: "QUERY_STATE_PENDING" });
        }
        return okJson({
          state: "QUERY_STATE_COMPLETED",
          result: {
            rows: [
              {
                blockTime: "2024-01-01T00:00:00Z",
                txHash: "0xabc",
                protocolName: "Uniswap",
                category: "DEX",
                contractAddress: "0xcontract1",
                chainId: 8453,
                amountUSD: 100.5,
              },
            ],
          },
        });
      }

      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DuneClient("test-api-key");
    const activityPromise = client.getProtocolActivity("0xwallet", "2024-01-01");

    // Advance time to allow polling (2 seconds between polls)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    const activity = await activityPromise;

    expect(activity).toHaveLength(1);
    expect(activity[0].protocolName).toBe("Uniswap");
    expect(activity[0].category).toBe("DEX");
    expect(activity[0].contractAddress).toBe("0xcontract1");
  });

  it("defaults missing protocol activity numeric fields", async () => {
    const client = new DuneClient("test-api-key");
    vi.spyOn(client, "executeQuery").mockResolvedValue([
      {
        blockTime: "2024-01-01T00:00:00Z",
        txHash: "0xabc",
        protocolName: "Uniswap",
        category: "DEX",
        contractAddress: "0xcontract1",
      },
    ]);

    await expect(client.getProtocolActivity("0xwallet", "2024-01-01")).resolves.toEqual([
      expect.objectContaining({ amountUSD: undefined, chainId: 8453 }),
    ]);
  });

  it("handles query execution failures", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/sql/execute")) {
        return notOk(500);
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DuneClient("test-api-key");

    const queryPromise = expect(client.executeQuery("SELECT 1")).rejects.toThrow();
    await vi.runAllTimersAsync();
    await queryPromise;
  });

  it("handles query completion with errors", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);

      if (url.pathname.includes("/sql/execute")) {
        return okJson({ execution_id: "exec789" });
      }

      if (url.pathname.includes("/execution/")) {
        return okJson({
          state: "QUERY_STATE_FAILED",
          error: "SQL syntax error",
        });
      }

      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DuneClient("test-api-key");

    const queryPromise = expect(client.executeQuery("SELECT invalid")).rejects.toThrow();
    await vi.runAllTimersAsync();
    await queryPromise;
  });

  it("returns an empty result set when a completed query has no rows", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/sql/execute")) {
        return okJson({ execution_id: "exec-empty" });
      }

      if (url.pathname.includes("/execution/")) {
        return okJson({
          state: "QUERY_STATE_COMPLETED",
          result: {},
        });
      }

      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DuneClient("test-api-key");
    const rowsPromise = client.executeQuery("SELECT 1");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(rowsPromise).resolves.toEqual([]);
  });

  it("returns escrow completions and falls back cleanly on protocol query failures", async () => {
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);

      if (url.pathname.includes("/sql/execute")) {
        return okJson({ execution_id: "exec-escrow" });
      }

      if (url.pathname.includes("/execution/")) {
        pollCount += 1;
        if (pollCount === 1) {
          return okJson({ state: "QUERY_STATE_PENDING" });
        }

        return okJson({
          state: "QUERY_STATE_COMPLETED",
          result: {
            rows: [
              {
                blockTime: "2024-01-03T00:00:00Z",
                txHash: "0xescrow",
                protocolName: "EscrowX",
                fromAddress: "0xfrom",
                toAddress: "0xto",
                amountUSD: 12,
                contractAddress: "0xcontract",
              },
            ],
          },
        });
      }

      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new DuneClient("test-api-key");
    const completionsPromise = client.getEscrowCompletions("0xwallet");
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(completionsPromise).resolves.toEqual([
      expect.objectContaining({
        protocolName: "EscrowX",
        category: "escrow",
        chainId: 8453,
      }),
    ]);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => notOk(500)));

    const activityPromise = client.getProtocolActivity("0xwallet", "2024-01-01");
    const failedEscrowPromise = client.getEscrowCompletions("0xwallet");
    await vi.runAllTimersAsync();

    await expect(activityPromise).resolves.toEqual([]);
    await expect(failedEscrowPromise).resolves.toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("returns empty protocol activity when the query wrapper fails", async () => {
    const client = new DuneClient("test-api-key");
    vi.spyOn(client, "executeQuery").mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(client.getProtocolActivity("0xwallet", "2024-01-01")).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith("Dune protocol activity query failed:", expect.any(Error));

    errorSpy.mockRestore();
  });

  it("fetches escrow completions", async () => {
    const client = new DuneClient("test-api-key");
    vi.spyOn(client, "executeQuery").mockResolvedValue([
      {
        blockTime: "2024-01-01T00:00:00Z",
        txHash: "0xescrow",
        protocolName: "EscrowX",
        fromAddress: "0xfrom",
        toAddress: "0xto",
        amountUSD: 42,
        contractAddress: "0xcontract",
        chainId: 10,
      },
    ]);

    const rows = await client.getEscrowCompletions("0xwallet");
    expect(rows).toEqual([
      expect.objectContaining({
        txHash: "0xescrow",
        category: "escrow",
        chainId: 10,
      }),
    ]);
  });

  it("returns empty escrow completions when the query fails", async () => {
    const client = new DuneClient("test-api-key");
    vi.spyOn(client, "executeQuery").mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(client.getEscrowCompletions("0xwallet")).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith("Dune escrow query failed:", expect.any(Error));

    errorSpy.mockRestore();
  });

  it("defaults missing escrow fields during normalization", async () => {
    const client = new DuneClient("test-api-key");
    vi.spyOn(client, "executeQuery").mockResolvedValue([
      {
        txHash: "0xescrow2",
        protocolName: "EscrowY",
        amountUSD: "unknown",
        contractAddress: "0xcontract2",
      },
    ]);

    await expect(client.getEscrowCompletions("0xwallet")).resolves.toEqual([
      expect.objectContaining({
        category: "escrow",
        amountUSD: undefined,
        chainId: 8453,
      }),
    ]);
  });
});
