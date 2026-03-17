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
    expect(result.capture.requestUrl).toBe("https://example.com/paid");
    expect(result.capture.settlement?.status).toBe(200);
    expect(result.capture.settlement?.headers.paymentRequired).toContain("amount");
    expect(result.capture.settlement?.headers.paymentResponse).toContain("transaction");
    expect(result.capture.settlement?.headers.peacReceipt).toContain("receipt");
  });

  it("captures a two-step x402 handshake and records outbound payment-signature", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("payment required", {
          status: 402,
          headers: {
            "payment-required": "{\"amount\":\"1\",\"network\":\"base\"}",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response("paid", {
          status: 200,
          headers: {
            "payment-response": "{\"success\":true,\"transaction\":\"0xtx\"}",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWithX402Capture("https://example.com/paid", {
      onPaymentRequired: async ({ headers }) => {
        expect(headers.paymentRequired).toContain("amount");
        return { paymentSignature: "{\"payer\":\"0xpayer\"}" };
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.capture.challenge?.status).toBe(402);
    expect(result.capture.challenge?.headers.paymentRequired).toContain("amount");
    expect(result.capture.authorization?.paymentSignature).toContain("payer");
    expect(result.capture.settlement?.status).toBe(200);
    expect(result.capture.settlement?.headers.paymentResponse).toContain("0xtx");
  });
});
