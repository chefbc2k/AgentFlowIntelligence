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
});
