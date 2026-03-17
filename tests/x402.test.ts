import { describe, expect, it } from "vitest";
import {
  buildX402Packet,
  decodePaymentPayload,
  decodePaymentRequired,
  decodeSettlementResponse,
  extractSettlementReason,
  extractSettlementSuccess,
  extractSettlementTxHash,
  extractX402Headers,
  interactionIdFromParts,
  parseJsonHeader,
} from "../server/x402";

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

  it("decodes typed payment and settlement fields", () => {
    expect(decodePaymentRequired("{\"amount\":\"1\",\"network\":\"base\",\"payTo\":\"0xmerchant\"}")).toEqual(
      expect.objectContaining({ amount: "1", network: "base", payTo: "0xmerchant" }),
    );
    expect(decodePaymentPayload("{\"payer\":\"0xpayer\",\"network\":\"base\"}")).toEqual(
      expect.objectContaining({ payer: "0xpayer", network: "base" }),
    );

    const settlement = decodeSettlementResponse(
      "{\"success\":true,\"transaction\":{\"hash\":\"0xtx\"},\"network\":\"base\",\"payer\":\"0xpayer\",\"payTo\":\"0xmerchant\"}",
    );
    expect(extractSettlementSuccess(settlement)).toBe(true);
    expect(extractSettlementTxHash(settlement)).toBe("0xtx");
    expect(settlement).toEqual(expect.objectContaining({ network: "base", payer: "0xpayer", payTo: "0xmerchant" }));
  });

  it("extracts error and reason branches from settlement responses", () => {
    expect(extractSettlementReason(decodeSettlementResponse("{\"reason\":\"insufficient_funds\"}"))).toBe(
      "insufficient_funds",
    );
    expect(extractSettlementReason(decodeSettlementResponse("{\"error\":\"declined\"}"))).toBe("declined");
    expect(extractSettlementReason(decodeSettlementResponse("{\"message\":\"retry later\"}"))).toBe("retry later");
  });

  it("builds a canonical x402 packet from raw headers", () => {
    const packet = buildX402Packet({
      paymentRequired: "{\"amount\":\"1\",\"network\":\"base\",\"payTo\":\"0xmerchant\"}",
      paymentSignature: "{\"payer\":\"0xpayer\"}",
      paymentResponse: "{\"success\":false,\"transaction\":\"0xtx\",\"reason\":\"declined\"}",
    });

    expect(packet.challenge.present).toBe(true);
    expect(packet.authorization.hasSignature).toBe(true);
    expect(packet.settlement.present).toBe(true);
    expect(packet.settlement.txHash).toBe("0xtx");
    expect(packet.settlement.success).toBe(false);
    expect(packet.settlement.network).toBe("base");
    expect(packet.settlement.payer).toBe("0xpayer");
    expect(packet.settlement.payTo).toBe("0xmerchant");
    expect(packet.settlement.reason).toBe("declined");
  });
});
