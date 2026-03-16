import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEasAttestations } from "../server/eas";

describe("eas adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses attestations from GraphQL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attestations: [
              { id: "1", attester: "0xaaa", recipient: "0xbbb", schemaId: "0x1", txid: "0x2", time: 1 },
            ],
          },
        }),
      }),
    );
    const results = await fetchEasAttestations({ baseUrl: "https://base.easscan.org/graphql" }, "0xbbb");
    expect(results[0].id).toBe("1");
    expect(results[0].txHash).toBe("0x2");
  });

  it("lowercases the address and throws on transport failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchEasAttestations({ baseUrl: "https://base.easscan.org/graphql" }, "0xABC")).rejects.toThrow(
      "EAS GraphQL failed: 500",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://base.easscan.org/graphql",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"address\":\"0xabc\""),
      }),
    );
  });

  it("tolerates missing or malformed fields in rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attestations: [
              { id: 1, attester: 123, recipient: null, schemaId: "0x1", txid: false, time: "2" },
            ],
          },
        }),
      }),
    );
    const results = await fetchEasAttestations({ baseUrl: "https://base.easscan.org/graphql" }, "0xbbb");
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: "1",
        attester: undefined,
        recipient: undefined,
        schemaId: "0x1",
        txHash: undefined,
        time: 2,
      }),
    );
  });

  it("coerces mixed GraphQL payload types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            attestations: [{ id: 1, attester: 123, recipient: null, schemaId: undefined, txid: 456, time: "2" }],
          },
        }),
      }),
    );
    const results = await fetchEasAttestations({ baseUrl: "https://base.easscan.org/graphql" }, "0xbbb");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: "1",
      attester: undefined,
      recipient: undefined,
      schemaId: undefined,
      txHash: undefined,
      time: 2,
      raw: { id: 1, attester: 123, recipient: null, schemaId: undefined, txid: 456, time: "2" },
    });
  });

  it("returns an empty list when the GraphQL payload has no rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );
    const results = await fetchEasAttestations({ baseUrl: "https://base.easscan.org/graphql" }, "0xbbb");
    expect(results).toEqual([]);
  });
});
