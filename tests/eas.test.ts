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
});
