import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchBaseTokenTransfers,
  fetchBaseTokenTransfersFromBlockscout,
  fetchBaseTx,
  fetchBaseTxFromBlockscout,
  fetchBaseTxFromEtherscan,
  fetchBaseTxHistory,
  fetchBaseTxHistoryFromBlockscout,
} from "../server/base";

const okJson = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

const notOk = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
});

describe("base adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches tx by hash via etherscan", async () => {
    const payload = { result: { hash: "0x1", blockNumber: "0x10", from: "0xaaa", to: "0xbbb", value: "1" } };
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const action = url.searchParams.get("action");
      if (action === "eth_getTransactionByHash") return okJson(payload);
      if (action === "eth_getBlockByNumber") return okJson({ result: { timestamp: "0x10" } });
      return notOk(500);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTx("0x1", { etherscanApiKey: "key" });
    expect(result.status).toBe("confirmed");
    expect(result.txHash).toBe("0x1");
    expect(result.confirmedAt).toBe("1970-01-01T00:00:16.000Z");
  });

  it("keeps tx lookup working when block timestamp enrichment fails", async () => {
    const payload = { result: { hash: "0x1", blockNumber: "0x10", from: "0xaaa", to: "0xbbb", value: "1" } };
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const action = url.searchParams.get("action");
      if (action === "eth_getTransactionByHash") return okJson(payload);
      if (action === "eth_getBlockByNumber") return notOk(503);
      return notOk(500);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTxFromEtherscan("key", "0x1");
    expect(result.status).toBe("confirmed");
    expect(result.confirmedAt).toBeUndefined();
  });

  it("marks tx as unknown when etherscan has no block number", async () => {
    const payload = { result: { hash: "0x1", blockNumber: null, from: "0xaaa", to: "0xbbb", value: "1" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(payload)));
    const result = await fetchBaseTxFromEtherscan("key", "0x1");
    expect(result.status).toBe("unknown");
  });

  it("returns unknown when etherscan tx lookup has no block number yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ result: { hash: "0x1", blockNumber: null } })));
    const result = await fetchBaseTxFromEtherscan("key", "0x1");
    expect(result.status).toBe("unknown");
  });

  it("falls back to blockscout if etherscan tx lookup fails", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.etherscan.io") return notOk(500);
      return okJson({ result: { hash: "0x1", blockNumber: null, from: "0xaaa" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTx("0x1", { etherscanApiKey: "key" });
    expect(result.status).toBe("unknown");
  });

  it("returns unknown when tx lookup payload has no hash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ result: null })));
    const result = await fetchBaseTxFromEtherscan("key", "0xdead");
    expect(result).toEqual({ txHash: "0xdead", status: "unknown", raw: { result: null } });
  });

  it("fetches tx from blockscout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson({ result: { hash: "0x1", blockNumber: "0x10", from: "0xaaa" } })),
    );
    const result = await fetchBaseTxFromBlockscout("0x1");
    expect(result.status).toBe("confirmed");
  });

  it("returns unknown when blockscout payload has no hash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ result: null })));
    const result = await fetchBaseTxFromBlockscout("0xdead");
    expect(result).toEqual({ txHash: "0xdead", status: "unknown", raw: { result: null } });
  });

  it("returns unknown when blockscout tx lookup payload has no hash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ result: null })));
    const result = await fetchBaseTxFromBlockscout("0xdead");
    expect(result).toEqual({ txHash: "0xdead", status: "unknown", raw: { result: null } });
  });

  it("fetches tx history via etherscan list API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ status: "1", message: "OK", result: [{ hash: "0x1" }] })));
    const result = await fetchBaseTxHistory("0xabc", { etherscanApiKey: "key" });
    expect(result).toHaveLength(1);
  });

  it("does not treat status=0 without NOTOK as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ status: "0", message: "OK", result: [] })));
    const result = await fetchBaseTxHistory("0xabc", { etherscanApiKey: "key" });
    expect(result).toEqual([]);
  });

  it("falls back to blockscout tx history when etherscan transport fails", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.etherscan.io") return notOk(502);
      return okJson({ result: [{ hash: "0x2" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTxHistory("0xabc", { etherscanApiKey: "key" });
    expect(result[0]?.hash).toBe("0x2");
  });

  it("falls back to blockscout tx history when etherscan returns NOTOK", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.etherscan.io") {
        return okJson({ status: "0", message: "NOTOK", result: "rate limit" });
      }
      return okJson({ result: [{ hash: "0x2" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTxHistory("0xabc", { etherscanApiKey: "key" });
    expect(result[0]?.hash).toBe("0x2");
  });

  it("falls back when etherscan returns NOTOK without a reason string", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.etherscan.io") {
        return okJson({ status: "0", message: "NOTOK" });
      }
      return okJson({ result: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTxHistory("0xabc", { etherscanApiKey: "key" });
    expect(result).toEqual([]);
  });

  it("falls back to blockscout tx history when etherscan transport fails", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.etherscan.io") return notOk(503);
      return okJson({ result: [{ hash: "0xtransport" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTxHistory("0xabc", { etherscanApiKey: "key" });
    expect(result[0]?.hash).toBe("0xtransport");
  });

  it("fetches token transfers via etherscan list API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okJson({ status: "1", message: "OK", result: [{ hash: "0x1", contractAddress: "0xusdc" }] })),
    );
    const result = await fetchBaseTokenTransfers("0xabc", { etherscanApiKey: "key" });
    expect(result).toHaveLength(1);
  });

  it("falls back to blockscout token transfers when etherscan list transport fails", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.etherscan.io") return notOk(500);
      return okJson({ result: [{ hash: "0xblockscout" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTokenTransfers("0xabc", { etherscanApiKey: "key" });
    expect(result[0]?.hash).toBe("0xblockscout");
  });

  it("falls back to blockscout token transfers when etherscan fails", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === "api.etherscan.io") {
        return okJson({ status: "0", message: "NOTOK", result: "rate limit" });
      }
      return okJson({ result: [{ hash: "0x2" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchBaseTokenTransfers("0xabc", { etherscanApiKey: "key" });
    expect(result[0]?.hash).toBe("0x2");
  });

  it("fetches tx history directly from blockscout when no etherscan key is provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ result: [{ hash: "0x3" }] })));
    const result = await fetchBaseTxHistoryFromBlockscout("0xabc");
    expect(result[0]?.hash).toBe("0x3");
  });

  it("fetches token transfers directly from blockscout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ result: [{ hash: "0x4" }] })));
    const result = await fetchBaseTokenTransfersFromBlockscout("0xabc");
    expect(result[0]?.hash).toBe("0x4");
  });

  it("throws when blockscout list response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(notOk(503)));
    await expect(fetchBaseTxHistoryFromBlockscout("0xabc")).rejects.toThrow("Blockscout failed: 503");
  });
});
