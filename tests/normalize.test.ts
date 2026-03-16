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
      walletSnapshot: {
        id: "ws1",
        interaction_id: "i1",
        wallet_address: "0xabc",
        balance: "1",
        allowance: "1",
        max_tx: "1",
        approvals_required: true,
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    });
    expect(bundle.interaction.id).toHaveLength(64);
    expect(bundle.evidence.length).toBeGreaterThanOrEqual(3);
    expect(bundle.settlement.tx_hash).toBe("0xdef");
    expect(bundle.evidence.some((row) => row.kind === "wallet_snapshot")).toBe(true);
  });

  it("handles raw PEAC receipts and missing tx hashes", () => {
    const bundle = normalizeInteraction({
      agentId: "agent-1",
      counterparty: "service-x",
      walletAddress: "0xabc",
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        peacReceipt: "{not-json}",
      },
    });
    expect(bundle.settlement.status).toBe("unknown");
    const peac = bundle.evidence.find((row) => row.kind === "peac");
    expect(peac?.payload.decoded).toBeNull();
  });

  it("handles missing optional inputs and raw PEAC receipts", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        peacReceipt: "{not-json}",
      },
    });

    expect(bundle.settlement.status).toBe("unknown");
    expect(bundle.evidence.some((row) => row.kind === "locus")).toBe(false);
    expect(bundle.evidence.some((row) => row.kind === "base")).toBe(false);

    const peac = bundle.evidence.find((row) => row.kind === "peac");
    expect(peac?.payload).toEqual(expect.objectContaining({ status: "raw", decoded: null }));
  });

  it("builds locus interaction bundle", () => {
    const bundle = normalizeLocusInteraction({
      agentId: "agent-1",
      walletAddress: "0xabc",
      counterparty: "service-y",
      locusTx: { id: "tx-1", amount: "2", createdAt: "2024-01-01T00:00:00Z" },
      txHash: "0xabc",
      walletSnapshot: {
        id: "ws2",
        interaction_id: "i2",
        wallet_address: "0xabc",
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    });
    expect(bundle.interaction.protocol).toBe("locus");
    expect(bundle.evidence.length).toBeGreaterThan(0);
    expect(bundle.evidence.some((row) => row.kind === "wallet_snapshot")).toBe(true);
  });

  it("builds locus bundles even when optional locus fields are missing", () => {
    const bundle = normalizeLocusInteraction({
      agentId: "agent-1",
      walletAddress: "0xabc",
      counterparty: "service-y",
      locusTx: {},
    });
    expect(bundle.settlement.status).toBe("unknown");
    expect(bundle.evidence).toHaveLength(1);
  });

  it("builds locus bundle without tx hash or wallet snapshot", () => {
    const bundle = normalizeLocusInteraction({
      locusTx: { amount: "2" },
    });
    expect(bundle.interaction.protocol).toBe("locus");
    expect(bundle.settlement.status).toBe("unknown");
    expect(bundle.evidence.some((row) => row.kind === "base")).toBe(false);
    expect(bundle.evidence.some((row) => row.kind === "wallet_snapshot")).toBe(false);
  });
});
