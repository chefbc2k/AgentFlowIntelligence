import { describe, expect, it } from "vitest";
import { computeAgentMetrics, computeCounterpartyMetrics } from "../server/metrics";

describe("metrics", () => {
  it("computes agent metrics", () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: {},
      },
    ];
    const store = {
      listInteractionsByWallet: () => interactions,
      getSettlement: () => ({ id: "i1:settlement", interaction_id: "i1", status: "confirmed", metadata: {} }),
      getEvidence: () => [{ id: "e1", interaction_id: "i1", kind: "x402", payload: {}, created_at: "2024-01-01T00:00:00Z" }],
    } as const;
    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.throughput.totalInteractions).toBe(1);
    expect(metrics.settlement.successRate).toBe(1);
  });

  it("computes counterparty metrics", () => {
    const interactions = [
      {
        id: "i2",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: {},
      },
    ];
    const store = {
      listInteractionsByCounterparty: () => interactions,
      getSettlement: () => undefined,
    } as const;
    const metrics = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(metrics.volume.totalInteractions).toBe(1);
  });
});
