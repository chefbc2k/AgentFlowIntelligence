import { describe, expect, it } from "vitest";
import { extractX402Headers, interactionIdFromParts } from "../server/x402";

describe("x402 headers", () => {
  it("extracts payment headers case-insensitively", () => {
    const headers = {
      "Payment-Required": "{\"amount\":\"1\"}",
      "PAYMENT-SIGNATURE": "{\"sig\":\"0xabc\"}",
      "payment-response": "{\"tx\":\"0xdef\"}",
      "PEAC-Receipt": "{\"receipt\":\"ok\"}",
    };
    const parsed = extractX402Headers(headers);
    expect(parsed.paymentRequired).toContain("amount");
    expect(parsed.paymentSignature).toContain("sig");
    expect(parsed.paymentResponse).toContain("tx");
    expect(parsed.peacReceipt).toContain("receipt");
  });

  it("produces stable interaction ids", () => {
    const a = interactionIdFromParts(["a", "b", "c"]);
    const b = interactionIdFromParts(["a", "b", "c"]);
    const c = interactionIdFromParts(["a", "b", "x"]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
