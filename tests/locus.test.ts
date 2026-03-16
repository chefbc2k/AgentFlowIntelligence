import { afterEach, describe, expect, it, vi } from "vitest";
import { LocusClient } from "../server/locus";

describe("locus client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls status endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ address: "0xabc", balance: "1", status: "ok" }),
      }),
    );
    const client = new LocusClient({ baseUrl: "https://beta-api.paywithlocus.com", apiKey: "key" });
    const result = await client.getStatus();
    expect(result.address).toBe("0xabc");
  });

  it("calls wrapped catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
    const client = new LocusClient({ baseUrl: "https://beta-api.paywithlocus.com", apiKey: "key" });
    const result = await client.getWrappedCatalog();
    expect(result).toEqual({ ok: true });
  });
});
