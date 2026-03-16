import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBaseTokenTransfers, fetchBaseTx, fetchBaseTxHistory } from "../server/base";

const mockFetch = (payload: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });

describe("base adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches tx by hash via etherscan", async () => {
    const payload = { result: { hash: "0x1", blockNumber: "0x10", from: "0xaaa", to: "0xbbb", value: "1" } };
    vi.stubGlobal("fetch", mockFetch(payload));
    const result = await fetchBaseTx("0x1", { etherscanApiKey: "key" });
    expect(result.status).toBe("confirmed");
    expect(result.txHash).toBe("0x1");
  });

  it("fetches tx history", async () => {
    const payload = { result: [{ hash: "0x1", timeStamp: "1" }] };
    vi.stubGlobal("fetch", mockFetch(payload));
    const result = await fetchBaseTxHistory("0xabc", { etherscanApiKey: "key" });
    expect(result.length).toBe(1);
  });

  it("fetches token transfers", async () => {
    const payload = { result: [{ hash: "0x1", contractAddress: "0xusdc" }] };
    vi.stubGlobal("fetch", mockFetch(payload));
    const result = await fetchBaseTokenTransfers("0xabc", { etherscanApiKey: "key" });
    expect(result.length).toBe(1);
  });
});
