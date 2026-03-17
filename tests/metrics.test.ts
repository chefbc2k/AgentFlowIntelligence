import { describe, expect, it } from "vitest";
import { computeAgentMetrics, computeCounterpartyMetrics } from "../server/metrics";

describe("metrics", () => {
  it("handles empty stores", () => {
    const store = {
      listInteractionsByWallet: () => [],
      getSettlement: () => undefined,
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
    } as const;
    const agent = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(agent.throughput.totalInteractions).toBe(0);
    expect(agent.throughput.burstiness).toBe(0);
    expect(agent.settlement.total).toBe(0);
    expect(agent.evidenceDensity).toBe(0);
    expect(agent.controls.overall.total).toBe(0);
    expect(agent.receiptAvailability.total).toBe(0);
    expect(agent.onchain.transactions.total).toBe(0);
    expect(agent.onchain.tokenTransfers.total).toBe(0);

    const counterparty = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(counterparty.volume.totalInteractions).toBe(0);
    expect(counterparty.paymentBehavior.count).toBe(0);
    expect(counterparty.controls.overall.total).toBe(0);
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
          : id === "i2"
            ? { id: "i2:settlement", interaction_id: "i2", status: "failed", metadata: {} }
            : {
                id: `${id}:settlement`,
                interaction_id: id,
                status: "confirmed",
                tx_hash: id === "i1" ? "0xtx" : id === "i4" ? "0xtx2" : undefined,
                metadata: {},
              },
      getEvidence: () => [
        { id: "e1", interaction_id: "i1", kind: "x402", payload: {}, created_at: "2024-01-01T00:00:00Z" },
      ],
      getWalletSnapshot: (id: string) => {
        switch (id) {
          case "i1":
            return {
              id: "ws1",
              interaction_id: "i1",
              allowance: "2",
              max_tx: "2",
              approvals_required: false,
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
            };
          case "i2":
            return {
              id: "ws2",
              interaction_id: "i2",
              allowance: "1",
              max_tx: "10",
              approvals_required: true,
              metadata: {},
              created_at: "2024-01-02T00:00:00Z",
            };
          case "i4":
            return {
              id: "ws4",
              interaction_id: "i4",
              allowance: "10",
              max_tx: "2",
              approvals_required: false,
              metadata: {},
              created_at: "2024-01-02T00:00:00Z",
            };
          default:
            return undefined;
        }
      },
      getBaseTransaction: (txHash: string) =>
        txHash === "0xtx"
          ? { tx_hash: "0xtx", status: "confirmed", raw: {}, created_at: "2024-01-01T00:00:10Z" }
          : txHash === "0xtx2"
            ? { tx_hash: "0xtx2", status: "confirmed", raw: {}, created_at: "2024-01-02T02:00:10Z" }
            : undefined,
      listBaseTransactionsByWallet: () => [
        { tx_hash: "0xtx", status: "confirmed", from: "0xabc", to: "0xdef", raw: {}, created_at: "2024-01-01T00:00:10Z" },
        { tx_hash: "0xtx2", status: "failed", from: "0xdef", to: "0xabc", raw: {}, created_at: "2024-01-02T00:00:10Z" },
        { tx_hash: "0xtx3", status: "unknown", from: "0xabc", to: "0xghi", raw: {}, created_at: "2024-01-03T00:00:10Z" },
      ],
      listTokenTransfersByWallet: () => [
        {
          id: "t1",
          tx_hash: "0xtx",
          token_address: "0xusdc",
          token_symbol: "USDC",
          from: "0xdef",
          to: "0xabc",
          value: "1",
          raw: {},
          created_at: "2024-01-01T00:00:11Z",
        },
        {
          id: "t2",
          tx_hash: "0xtx2",
          token_address: "0xusdc",
          token_symbol: "USDC",
          from: "0xabc",
          to: "0xghi",
          value: "2",
          raw: {},
          created_at: "2024-01-02T00:00:11Z",
        },
        {
          id: "t3",
          tx_hash: "0xtx3",
          token_address: "0xother",
          token_symbol: "OTHER",
          from: "0xabc",
          to: "0xdef",
          value: "3",
          raw: {},
          created_at: "2024-01-03T00:00:11Z",
        },
      ],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
    } as const;
    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.throughput.totalInteractions).toBe(5);
    expect(metrics.counterparty.unique).toBe(3);
    expect(metrics.counterparty.top?.id).toBe("svc");
    expect(metrics.paymentBehavior.count).toBe(3);
    expect(metrics.paymentBehavior.median).toBe(2);
    expect(metrics.settlement.successRate).toBeCloseTo(3 / 4);
    expect(metrics.controls.approvals.required).toBe(1);
    expect(metrics.controls.allowance.overLimit).toBe(1);
    expect(metrics.controls.maxTx.overLimit).toBe(1);
    expect(metrics.settlementLatency.total).toBe(2);
    expect(metrics.settlementLatency.medianSeconds).toBeCloseTo((10 + 10) / 2);
    expect(metrics.onchain.transactions.total).toBe(3);
    expect(metrics.onchain.transactions.confirmed).toBe(1);
    expect(metrics.onchain.transactions.failed).toBe(1);
    expect(metrics.onchain.transactions.unknown).toBe(1);
    expect(metrics.onchain.transactions.uniqueCounterparties).toBe(2);
    expect(metrics.onchain.transactions.topCounterparty?.address).toBe("0xdef");
    expect(metrics.onchain.transactions.topCounterparty?.share).toBeCloseTo(2 / 3);
    expect(metrics.onchain.tokenTransfers.total).toBe(3);
    expect(metrics.onchain.tokenTransfers.inbound).toBe(1);
    expect(metrics.onchain.tokenTransfers.outbound).toBe(2);
    expect(metrics.onchain.tokenTransfers.uniqueTokens).toBe(2);
    expect(metrics.onchain.tokenTransfers.topToken?.symbol).toBe("USDC");
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
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
      listReceiptsByInteraction: (id: string) =>
        id === "i1" ? [{ id: "r1", raw: {}, created_at: "2024-01-01T00:00:00Z" }] : [],
      listAttestationsByWallet: () => [
        { id: "att1", raw: {}, created_at: "2024-01-01T00:00:00Z" },
        { id: "att2", raw: {}, created_at: "2024-01-01T00:00:00Z" },
      ],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.evidenceDensity).toBe(3);
    expect(metrics.receiptAvailability.rate).toBe(0.5);
  });

  it("ignores settlement latency when enrichment data is missing or invalid", () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "1" } },
      },
      {
        id: "i2",
        created_at: "not-a-date",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "1" } },
      },
    ];

    const store = {
      listInteractionsByWallet: () => interactions,
      getSettlement: (id: string) => ({ id: `${id}:s`, interaction_id: id, status: "confirmed", tx_hash: id, metadata: {} }),
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: (txHash: string) =>
        txHash === "i2" ? { tx_hash: "i2", status: "confirmed", raw: {}, created_at: "2024-01-01T00:00:05Z" } : undefined,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.settlementLatency.total).toBe(0);
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
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listReceiptsByInteraction: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
    } as const;
    const metrics = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(metrics.volume.totalInteractions).toBe(2);
    expect(metrics.paymentBehavior.median).toBe(1.5);
    expect(metrics.receiptAvailability.rate).toBe(0);
  });

  it("computes counterparty settlement latency when Base tx timestamps are known", () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "1" } },
      },
    ];
    const store = {
      listInteractionsByCounterparty: () => interactions,
      getSettlement: () => ({ id: "s1", interaction_id: "i1", status: "confirmed", tx_hash: "0xtx", metadata: {} }),
      getBaseTransaction: (txHash: string) =>
        txHash === "0xtx" ? { tx_hash: "0xtx", status: "confirmed", raw: {}, created_at: "2024-01-01T00:00:05Z" } : undefined,
      getWalletSnapshot: () => ({
        id: "ws",
        interaction_id: "i1",
        allowance: "2",
        max_tx: "2",
        approvals_required: false,
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      }),
      listReceiptsByInteraction: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
    } as const;

    const metrics = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(metrics.settlementLatency.total).toBe(1);
    expect(metrics.settlementLatency.avgSeconds).toBe(5);
    expect(metrics.controls.overall.rate).toBe(1);
  });

  it("ignores counterparty settlement latency when base tx metadata is missing or invalid", () => {
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
        created_at: "not-a-date",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: {},
      },
    ];
    const store = {
      listInteractionsByCounterparty: () => interactions,
      getSettlement: (interactionId: string) => ({
        id: `${interactionId}:s`,
        interaction_id: interactionId,
        status: "confirmed",
        tx_hash: interactionId,
        metadata: {},
      }),
      getBaseTransaction: (txHash: string) =>
        txHash === "i2" ? { tx_hash: "i2", status: "confirmed", raw: {}, created_at: "2024-01-01T00:00:05Z" } : undefined,
      getWalletSnapshot: () => undefined,
      listReceiptsByInteraction: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
    } as const;

    const metrics = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(metrics.settlementLatency.total).toBe(0);
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
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
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
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
    } as const;

    const agent = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(agent.counterparty.unique).toBeGreaterThan(0);
    expect(agent.paymentBehavior.count).toBe(0);

    const counterparty = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(counterparty.volume.uniqueWallets).toBe(1);
  });

  it("ignores unrelated onchain rows and self-transfers while still tracking fallback token ids", () => {
    const store = {
      listInteractionsByWallet: () => [],
      getSettlement: () => undefined,
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [
        { tx_hash: "0x1", status: "confirmed", from: undefined, to: "0xdef", raw: {}, created_at: "2024-01-01T00:00:00Z" },
        { tx_hash: "0x2", status: "unknown", from: "0xother", to: "0xelse", raw: {}, created_at: "2024-01-01T00:00:00Z" },
      ],
      listTokenTransfersByWallet: () => [
        {
          id: "t1",
          tx_hash: "0x1",
          from: undefined,
          to: "0xabc",
          token_symbol: undefined,
          token_address: undefined,
          raw: {},
          created_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "t2",
          tx_hash: "0x2",
          from: "0xabc",
          to: "0xabc",
          token_symbol: undefined,
          token_address: "0xtoken",
          raw: {},
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.onchain.transactions.uniqueCounterparties).toBe(0);
    expect(metrics.onchain.transactions.topCounterparty).toBeNull();
    expect(metrics.onchain.tokenTransfers.inbound).toBe(1);
    expect(metrics.onchain.tokenTransfers.outbound).toBe(0);
    expect(metrics.onchain.tokenTransfers.uniqueTokens).toBe(2);
    expect(metrics.onchain.tokenTransfers.topToken?.symbol).toBe("unknown");
  });
});
