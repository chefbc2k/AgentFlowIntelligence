import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BlockscoutClient } from "../server/blockscout";

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

describe("BlockscoutClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches transaction details", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/transactions/")) {
        return okJson({
          hash: "0xabc123",
          from: { hash: "0xfrom" },
          to: { hash: "0xto" },
          value: "1000000000000000000",
          status: "ok",
          block: 123456,
          timestamp: "2024-01-01T00:00:00Z",
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new BlockscoutClient("test-api-key");
    const tx = await client.getTransaction("0xabc123");

    expect(tx).toBeDefined();
    expect(tx?.txHash).toBe("0xabc123");
    expect(tx?.from).toBe("0xfrom");
    expect(tx?.to).toBe("0xto");
    expect(tx?.value).toBe("1000000000000000000");
    expect(tx?.status).toBe("confirmed");
  });

  it("returns null for missing transaction", async () => {
    const fetchMock = vi.fn(async () => notOk(404));
    vi.stubGlobal("fetch", fetchMock);

    const client = new BlockscoutClient("test-api-key");
    const txPromise = client.getTransaction("0xmissing");
    await vi.runAllTimersAsync();
    const tx = await txPromise;

    expect(tx).toBeNull();
  });

  it("fetches address transactions", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/addresses/") && url.pathname.includes("/transactions")) {
        return okJson({
          items: [
            {
              hash: "0xtx1",
              from: { hash: "0xaddr" },
              to: { hash: "0xto1" },
              value: "100",
              status: "ok",
              block: 100,
            },
            {
              hash: "0xtx2",
              from: { hash: "0xfrom2" },
              to: { hash: "0xaddr" },
              value: "200",
              status: "ok",
              block: 101,
            },
          ],
          next_page_params: null,
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new BlockscoutClient("test-api-key");
    const txs = await client.getAddressTransactions("0xaddr");

    expect(txs).toHaveLength(2);
    expect(txs[0].txHash).toBe("0xtx1");
    expect(txs[1].txHash).toBe("0xtx2");
  });

  it("fetches token transfers", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/addresses/") && url.pathname.includes("/token-transfers")) {
        return okJson({
          items: [
            {
              tx_hash: "0xtransfer1",
              from: { hash: "0xfrom" },
              to: { hash: "0xto" },
              total: { value: "1000" },
              token: { address: "0xtoken", symbol: "TKN" },
              timestamp: "2024-01-01T00:00:00Z",
            },
          ],
          next_page_params: null,
        });
      }
      return notOk(404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new BlockscoutClient("test-api-key");
    const transfers = await client.getTokenTransfers("0xaddr");

    expect(transfers).toHaveLength(1);
    expect(transfers[0].txHash).toBe("0xtransfer1");
    expect(transfers[0].tokenSymbol).toBe("TKN");
    expect(transfers[0].value).toBe("1000");
  });

  it("handles API errors gracefully", async () => {
    const fetchMock = vi.fn(async () => notOk(500));
    vi.stubGlobal("fetch", fetchMock);

    const client = new BlockscoutClient("test-api-key");
    const txPromise = client.getTransaction("0xabc");
    await vi.runAllTimersAsync();
    const tx = await txPromise;

    expect(tx).toBeNull();
  });
});
