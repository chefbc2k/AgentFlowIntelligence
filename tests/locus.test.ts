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

  it("calls balance endpoint and parses known fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ balance: "10", allowance: "1", maxTx: "0.5", approvalsRequired: true, extra: "ok" }),
      }),
    );
    const client = new LocusClient({ baseUrl: "https://beta-api.paywithlocus.com", apiKey: "key" });
    const result = await client.getBalance();
    expect(result.balance).toBe("10");
    expect(result.approvalsRequired).toBe(true);
    expect((result as Record<string, unknown>).extra).toBe("ok");
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

  it("posts JSON payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sent: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new LocusClient({ baseUrl: "https://beta-api.paywithlocus.com", apiKey: "key" });
    const result = await client.sendPayment({ amount: "1" });
    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledWith("https://beta-api.paywithlocus.com/api/pay/send", expect.objectContaining({ method: "POST" }));
  });

  it("omits request bodies when payload is undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ registered: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new LocusClient({ baseUrl: "https://beta-api.paywithlocus.com", apiKey: "key" });
    await client.register();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://beta-api.paywithlocus.com/api/register",
      expect.objectContaining({ method: "POST", body: undefined }),
    );
  });

  it("throws when a request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      }),
    );
    const client = new LocusClient({ baseUrl: "https://beta-api.paywithlocus.com", apiKey: "key" });
    await expect(client.getStatus()).rejects.toThrow("Locus request failed: 401");
  });

  it("throws when a POST request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }),
    );
    const client = new LocusClient({ baseUrl: "https://beta-api.paywithlocus.com", apiKey: "key" });
    await expect(client.sendPayment({ amount: "1" })).rejects.toThrow("Locus request failed: 500");
  });
});
