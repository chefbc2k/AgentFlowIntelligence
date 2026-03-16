import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithX402Capture } from "../server/x402-client";

describe("x402 capture client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures x402 headers from a fetch response", async () => {
    const response = new Response("ok", {
      status: 200,
      headers: {
        "payment-required": "{\"amount\":\"1\"}",
        "payment-response": "{\"transaction\":\"0x1\"}",
        "peac-receipt": "{\"receipt\":\"ok\"}",
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const result = await fetchWithX402Capture("https://example.com/paid");
    expect(result.capture.status).toBe(200);
    expect(result.capture.headers.paymentRequired).toContain("amount");
    expect(result.capture.headers.paymentResponse).toContain("transaction");
    expect(result.capture.headers.peacReceipt).toContain("receipt");
  });
});

