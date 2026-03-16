import { describe, expect, it } from "vitest";
import { extractX402Headers, interactionIdFromParts, parseJsonHeader } from "../server/x402";

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

  it("joins multi-valued headers", () => {
    const parsed = extractX402Headers({ "payment-required": ["a", "b"] });
    expect(parsed.paymentRequired).toBe("a,b");
  });

  it("parses JSON header bodies", () => {
    expect(parseJsonHeader()).toBeUndefined();
    expect(parseJsonHeader("{\"ok\":true}")?.ok).toBe(true);
    expect(parseJsonHeader("{not-json}")).toBeUndefined();
  });

  it("produces stable interaction ids", () => {
    const a = interactionIdFromParts(["a", "b", "c"]);
    const b = interactionIdFromParts(["a", "b", "c"]);
    const c = interactionIdFromParts(["a", "b", "x"]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
