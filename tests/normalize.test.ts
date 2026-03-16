import { describe, expect, it } from "vitest";
import { normalizeInteraction, normalizeLocusInteraction } from "../server/normalize";

describe("normalizeInteraction", () => {
  it("builds deterministic interaction bundle", () => {
    const bundle = normalizeInteraction({
      agentId: "agent-1",
      counterparty: "service-x",
      walletAddress: "0xabc",
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        paymentSignature: "{\"sig\":\"0xabc\"}",
        paymentResponse: "{\"tx\":\"0xdef\"}",
        peacReceipt: "{\"receipt\":\"ok\"}",
      },
      txHash: "0xdef",
      locusMetadata: { status: "ok" },
    });
    expect(bundle.interaction.id).toHaveLength(64);
    expect(bundle.evidence.length).toBeGreaterThanOrEqual(3);
    expect(bundle.settlement.tx_hash).toBe("0xdef");
  });

  it("builds locus interaction bundle", () => {
    const bundle = normalizeLocusInteraction({
      agentId: "agent-1",
      walletAddress: "0xabc",
      counterparty: "service-y",
      locusTx: { id: "tx-1", amount: "2", createdAt: "2024-01-01T00:00:00Z" },
      txHash: "0xabc",
    });
    expect(bundle.interaction.protocol).toBe("locus");
    expect(bundle.evidence.length).toBeGreaterThan(0);
  });
});
