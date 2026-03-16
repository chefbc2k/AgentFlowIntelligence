import { describe, expect, it } from "vitest";
import { computeAgentMetrics, computeCounterpartyMetrics } from "../server/metrics";

describe("metrics", () => {
  it("handles empty stores", () => {
    const store = {
      listInteractionsByWallet: () => [],
      getSettlement: () => undefined,
      getEvidence: () => [],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
    } as const;
    const agent = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(agent.throughput.totalInteractions).toBe(0);
    expect(agent.throughput.burstiness).toBe(0);
    expect(agent.settlement.total).toBe(0);
    expect(agent.evidenceDensity).toBe(0);

    const counterparty = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(counterparty.volume.totalInteractions).toBe(0);
    expect(counterparty.paymentBehavior.count).toBe(0);
  });

  it("computes agent metrics across counterparties and amounts", () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { locusTx: { amount: "1.5" } },
      },
      {
        id: "i2",
        created_at: "2024-01-02T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "2" } },
      },
      {
        id: "i3",
        created_at: "2024-01-02T01:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "other",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "not-a-number" } },
      },
      {
        id: "i4",
        created_at: "2024-01-02T02:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { locusTx: { amount: "3" } },
      },
      {
        id: "i5",
        created_at: "2024-01-03T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "none",
        protocol: "x402" as const,
        summary: {},
      },
    ];
    const store = {
      listInteractionsByWallet: () => interactions,
      getSettlement: (id: string) =>
        id === "i3"
          ? undefined
          :
        id === "i2"
          ? { id: "i2:settlement", interaction_id: "i2", status: "failed", metadata: {} }
          : { id: `${id}:settlement`, interaction_id: id, status: "confirmed", metadata: {} },
      getEvidence: () => [
        { id: "e1", interaction_id: "i1", kind: "x402", payload: {}, created_at: "2024-01-01T00:00:00Z" },
      ],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
    } as const;
    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.throughput.totalInteractions).toBe(5);
    expect(metrics.counterparty.unique).toBe(3);
    expect(metrics.counterparty.top?.id).toBe("svc");
    expect(metrics.paymentBehavior.count).toBe(3);
    expect(metrics.paymentBehavior.median).toBe(2);
    expect(metrics.settlement.successRate).toBeCloseTo(3 / 4);
  });

  it("includes receipts and attestations in evidence density", () => {
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
      {
        id: "i2",
        created_at: "2024-01-02T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: {},
      },
    ];
    const store = {
      listInteractionsByWallet: () => interactions,
      getSettlement: () => ({ id: "s", interaction_id: "i1", status: "confirmed", metadata: {} }),
      getEvidence: (id: string) =>
        id === "i1"
          ? [
              { id: "e1", interaction_id: "i1", kind: "x402", payload: {}, created_at: "2024-01-01T00:00:00Z" },
              { id: "e2", interaction_id: "i1", kind: "base", payload: {}, created_at: "2024-01-01T00:00:00Z" },
            ]
          : [{ id: "e3", interaction_id: "i2", kind: "x402", payload: {}, created_at: "2024-01-01T00:00:00Z" }],
      listReceiptsByInteraction: (id: string) =>
        id === "i1" ? [{ id: "r1", raw: {}, created_at: "2024-01-01T00:00:00Z" }] : [],
      listAttestationsByWallet: () => [
        { id: "att1", raw: {}, created_at: "2024-01-01T00:00:00Z" },
        { id: "att2", raw: {}, created_at: "2024-01-01T00:00:00Z" },
      ],
      listInteractionsByCounterparty: () => [],
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    // evidence: 2 + 1, receipts: 1, attestations: 2 => total 6 / 2 interactions = 3
    expect(metrics.evidenceDensity).toBe(3);
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
        summary: { paymentRequired: { amount: "1" } },
      },
      {
        id: "i3",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "2" } },
      },
    ];
    const store = {
      listInteractionsByCounterparty: () => interactions,
      getSettlement: () => undefined,
    } as const;
    const metrics = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(metrics.volume.totalInteractions).toBe(2);
    expect(metrics.paymentBehavior.median).toBe(1.5);
  });

  it("covers nullish and non-numeric branches", () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: undefined,
        protocol: "x402" as const,
        summary: undefined,
      },
      {
        id: "i2",
        created_at: "2024-01-02T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { locusTx: { amount: "not-a-number" } },
      },
    ] as unknown as Array<import("../server/types").InteractionRecord>;

    const store = {
      listInteractionsByWallet: () => interactions,
      getSettlement: () => undefined,
      getEvidence: () => [],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [
        {
          id: "c1",
          created_at: "2024-01-01T00:00:00Z",
          agent_id: "a1",
          wallet_address: undefined,
          counterparty: "svc",
          protocol: "x402" as const,
          summary: {},
        } as unknown as import("../server/types").InteractionRecord,
      ],
    } as const;

    const agent = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(agent.counterparty.unique).toBeGreaterThan(0);
    expect(agent.paymentBehavior.count).toBe(0);

    const counterparty = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(counterparty.volume.uniqueWallets).toBe(1);
  });
});
