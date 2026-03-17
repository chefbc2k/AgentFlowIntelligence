import { describe, expect, it } from "vitest";
import {
  computeAgentMetrics,
  computeCounterpartyMetrics,
  enrichInteractionForReadModel,
  enrichWithPricing,
} from "../server/metrics";

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
        summary: {
          paymentRequired: {
            amount: "2",
            asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            network: 8453,
          },
        },
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
        summary: {
          locusTx: { amount: "3" },
          paymentRequired: {
            amount: "3",
            asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            network: 8453,
          },
        },
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
      getLatestPrice: (tokenAddress: string, chainId: number) =>
        tokenAddress.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" && chainId === 8453
          ? {
              id: "price-usdc",
              token_address: tokenAddress,
              chain_id: chainId,
              symbol: "USDC",
              price_usd: "1.0",
              source: "coingecko" as const,
              timestamp: "2024-01-01T00:00:00Z",
              raw: {},
            }
          : null,
      getProtocolLabel: (contractAddress: string) =>
        contractAddress === "svc"
          ? {
              id: "svc",
              contract_address: contractAddress,
              chain_id: 8453,
              protocol_name: "EscrowX",
              protocol_category: "escrow" as const,
              source: "dune" as const,
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
            }
          : contractAddress === "other"
            ? {
                id: "other",
                contract_address: contractAddress,
                chain_id: 8453,
                protocol_name: "StakeHub",
                protocol_category: "staking" as const,
                source: "dune" as const,
                metadata: {},
                created_at: "2024-01-01T00:00:00Z",
              }
            : null,
    } as const;
    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.throughput.totalInteractions).toBe(5);
    expect(metrics.counterparty.unique).toBe(3);
    expect(metrics.counterparty.top?.id).toBe("svc");
    expect(metrics.paymentBehavior.count).toBe(3);
    expect(metrics.paymentBehavior.median).toBe(2);
    expect(metrics.paymentBehaviorUSD.count).toBe(2);
    expect(metrics.paymentBehaviorUSD.totalVolumeUSD).toBe(5);
    expect(metrics.settlement.successRate).toBeCloseTo(3 / 4);
    expect(metrics.protocolActivity.uniqueProtocols).toBe(2);
    expect(metrics.protocolActivity.topProtocol?.name).toBe("EscrowX");
    expect(metrics.protocolActivity.escrowCompletionRate).toBeCloseTo(2 / 3);
    expect(metrics.protocolActivity.stakingMetrics).toEqual({ staked: 1, slashed: 0 });
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
        summary: {
          paymentRequired: {
            amount: "1",
            asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            network: 8453,
          },
        },
      },
      {
        id: "i3",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: {
          paymentRequired: {
            amount: "2",
            asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            network: 8453,
          },
        },
      },
    ];
    const store = {
      listInteractionsByCounterparty: () => interactions,
      getSettlement: () => undefined,
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listReceiptsByInteraction: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: (tokenAddress: string, chainId: number) =>
        tokenAddress.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" && chainId === 8453
          ? {
              id: "price-usdc",
              token_address: tokenAddress,
              chain_id: chainId,
              symbol: "USDC",
              price_usd: "2.0",
              source: "coingecko" as const,
              timestamp: "2024-01-01T00:00:00Z",
              raw: {},
            }
          : null,
      getProtocolLabel: () => ({
        id: "svc",
        contract_address: "svc",
        chain_id: 8453,
        protocol_name: "EscrowX",
        protocol_category: "escrow" as const,
        source: "dune" as const,
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      }),
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
    } as const;
    const metrics = computeCounterpartyMetrics(store as unknown as import("../server/store").Store, "svc");
    expect(metrics.volume.totalInteractions).toBe(2);
    expect(metrics.paymentBehavior.median).toBe(1.5);
    expect(metrics.paymentBehaviorUSD.totalVolumeUSD).toBe(6);
    expect(metrics.protocolActivity.escrowCompletionRate).toBeNull();
    expect(metrics.receiptAvailability.rate).toBe(0);
  });

  it("parses numeric chain ids from x402 summaries when computing USD metrics", () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: {
          paymentRequired: {
            amount: "3",
            asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            network: "8453",
          },
        },
      },
    ];

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
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: (tokenAddress: string, chainId: number) =>
        tokenAddress.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" && chainId === 8453
          ? {
              id: "price-usdc",
              token_address: tokenAddress,
              chain_id: chainId,
              symbol: "USDC",
              price_usd: "1.5",
              source: "coingecko" as const,
              timestamp: "2024-01-01T00:00:00Z",
              raw: {},
            }
          : null,
      getProtocolLabel: () => null,
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.paymentBehaviorUSD.totalVolumeUSD).toBe(4.5);
  });

  it("enriches interaction amounts with pricing and preserves nulls when pricing is unavailable", async () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        protocol: "x402" as const,
        summary: {
          paymentRequired: {
            amount: "2",
            asset: "0xtoken",
            network: 8453,
          },
        },
      },
      {
        id: "i2",
        created_at: "2024-01-01T00:00:00Z",
        protocol: "x402" as const,
        summary: {},
      },
      {
        id: "i3",
        created_at: "2024-01-01T00:00:00Z",
        protocol: "x402" as const,
        summary: {
          paymentRequired: {
            amount: "3",
          },
        },
      },
    ] as Array<import("../server/types").InteractionRecord>;

    const pricingService = {
      normalizeToUSD: async (amount: number, tokenAddress: string, chainId: number) =>
        tokenAddress === "0xtoken" && chainId === 8453 ? amount * 2 : null,
    } as const;

    await expect(enrichWithPricing(interactions, null)).resolves.toEqual([
      expect.objectContaining({ id: "i1", amountUSD: null }),
      expect.objectContaining({ id: "i2", amountUSD: null }),
      expect.objectContaining({ id: "i3", amountUSD: null }),
    ]);

    await expect(
      enrichWithPricing(
        interactions,
        pricingService as unknown as import("../server/pricing").PricingService,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: "i1", amountUSD: 4 }),
      expect.objectContaining({ id: "i2", amountUSD: null }),
      expect.objectContaining({ id: "i3", amountUSD: null }),
    ]);
  });

  it("treats disappearing payment metadata as unpriceable instead of inventing a token", async () => {
    let readCount = 0;
    const interaction = {
      id: "i-flaky",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402" as const,
      get summary() {
        readCount += 1;
        return readCount === 1
          ? {
              paymentRequired: {
                amount: "2",
                asset: "0xtoken",
                network: 8453,
              },
            }
          : undefined;
      },
    } as unknown as import("../server/types").InteractionRecord;

    const pricingService = {
      normalizeToUSD: async () => 99,
    } as unknown as import("../server/pricing").PricingService;

    await expect(enrichWithPricing([interaction], pricingService)).resolves.toEqual([
      expect.objectContaining({ id: "i-flaky", amountUSD: null }),
    ]);
  });

  it("counts failed staking settlements as slashed protocol activity", () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "stake-contract",
        protocol: "x402" as const,
        summary: {},
      },
    ];

    const store = {
      listInteractionsByWallet: () => interactions,
      getSettlement: () => ({ id: "s1", interaction_id: "i1", status: "failed", metadata: {} }),
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
      getProtocolLabel: () => ({
        id: "stake-contract",
        contract_address: "stake-contract",
        chain_id: 8453,
        protocol_name: "StakeHub",
        protocol_category: "staking" as const,
        source: "dune" as const,
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      }),
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.protocolActivity.stakingMetrics).toEqual({ staked: 1, slashed: 1 });
  });

  it("derives protocol contracts from settlement metadata and computes onchain USD/protocol summaries", () => {
    const interaction = {
      id: "meta-1",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "fallback-counterparty",
      protocol: "x402" as const,
      summary: {
        paymentRequired: {
          amount: "4",
          asset: "0xtoken",
          network: 8453,
        },
      },
    };

    const store = {
      listInteractionsByWallet: () => [interaction],
      listInteractionsByCounterparty: () => [],
      getSettlement: () => ({
        id: "meta-1:settlement",
        interaction_id: "meta-1",
        tx_hash: "0xtx-meta",
        status: "confirmed" as const,
        metadata: { baseTx: { to: "0xescrow-contract" } },
      }),
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => ({
        tx_hash: "0xtx-meta",
        status: "confirmed" as const,
        to: "0xescrow-contract",
        raw: {},
        created_at: "2024-01-01T00:00:10Z",
      }),
      listBaseTransactionsByWallet: () => [
        { tx_hash: "0xtx-in", status: "confirmed" as const, from: "0xother", to: "0xwallet", raw: {}, created_at: "2024-01-01T00:00:05Z" },
        { tx_hash: "0xtx-out", status: "confirmed" as const, from: "0xwallet", to: "0xescrow-contract", raw: {}, created_at: "2024-01-01T00:00:06Z" },
      ],
      listTokenTransfersByWallet: () => [
        {
          id: "transfer-in",
          tx_hash: "0xtx-in",
          token_address: "0xtoken",
          token_symbol: "TOK",
          from: "0xother",
          to: "0xwallet",
          value: "2",
          raw: {},
          created_at: "2024-01-01T00:00:05Z",
        },
        {
          id: "transfer-out",
          tx_hash: "0xtx-out",
          token_address: "0xtoken",
          token_symbol: "TOK",
          from: "0xwallet",
          to: "0xescrow-contract",
          value: "3",
          raw: {},
          created_at: "2024-01-01T00:00:06Z",
        },
      ],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      getLatestPrice: (tokenAddress: string) =>
        tokenAddress === "0xtoken"
          ? {
              id: "price-1",
              token_address: "0xtoken",
              chain_id: 8453,
              symbol: "TOK",
              price_usd: "2",
              source: "coingecko" as const,
              timestamp: "2024-01-01T00:00:00Z",
              raw: {},
            }
          : null,
      getProtocolLabel: (contractAddress: string) =>
        contractAddress === "0xescrow-contract"
          ? {
              id: "protocol-escrow",
              contract_address: contractAddress,
              chain_id: 8453,
              protocol_name: "EscrowX",
              protocol_category: "escrow" as const,
              source: "dune" as const,
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
            }
          : null,
    } as const;

    const enriched = enrichInteractionForReadModel(
      store as unknown as import("../server/store").Store,
      interaction as import("../server/types").InteractionRecord,
    );
    expect(enriched.protocolContract).toBe("0xescrow-contract");
    expect(enriched.protocolName).toBe("EscrowX");
    expect(enriched.amountUSD).toBe(8);

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xwallet");
    expect(metrics.onchain.tokenTransfers.inboundVolumeUSD).toBe(4);
    expect(metrics.onchain.tokenTransfers.outboundVolumeUSD).toBe(6);
    expect(metrics.onchain.tokenTransfers.totalVolumeUSD).toBe(10);
    expect(metrics.onchain.protocols.unique).toBe(1);
    expect(metrics.onchain.protocols.topProtocol).toEqual({ name: "EscrowX", share: 0.5 });
    expect(metrics.onchain.protocols.categoryBreakdown).toEqual({ escrow: 1 });
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
    expect(agent.paymentBehaviorUSD.count).toBe(0);

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

  it("rolls up onchain protocol categories and priced transfer volumes", () => {
    const store = {
      listInteractionsByWallet: () => [],
      getSettlement: () => undefined,
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [
        { tx_hash: "0x1", status: "confirmed", from: "0xabc", to: "0xescrow", raw: {}, created_at: "2024-01-01T00:00:00Z" },
        { tx_hash: "0x2", status: "failed", from: "0xabc", to: "0xvault", raw: {}, created_at: "2024-01-01T00:01:00Z" },
        { tx_hash: "0x3", status: "unknown", from: "0xother", to: undefined, raw: {}, created_at: "2024-01-01T00:02:00Z" },
      ],
      listTokenTransfersByWallet: () => [
        {
          id: "t-in",
          tx_hash: "0x1",
          from: "0xvault",
          to: "0xabc",
          token_address: "0xpriced-in",
          token_symbol: "PIN",
          value: "2",
          raw: {},
          created_at: "2024-01-01T00:00:01Z",
        },
        {
          id: "t-out",
          tx_hash: "0x2",
          from: "0xabc",
          to: "0xescrow",
          token_address: "0xpriced-out",
          token_symbol: "POUT",
          value: "3",
          raw: {},
          created_at: "2024-01-01T00:01:01Z",
        },
      ],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: (tokenAddress: string) =>
        tokenAddress === "0xpriced-in"
          ? ({ price_usd: "1.5" } as const)
          : tokenAddress === "0xpriced-out"
            ? ({ price_usd: "2" } as const)
            : null,
      getProtocolLabel: (contractAddress: string) =>
        contractAddress === "0xescrow"
          ? ({
              id: "escrow",
              contract_address: contractAddress,
              chain_id: 8453,
              protocol_name: "EscrowX",
              protocol_category: "escrow" as const,
              source: "dune" as const,
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
            })
          : contractAddress === "0xvault"
            ? ({
                id: "vault",
                contract_address: contractAddress,
                chain_id: 8453,
                protocol_name: "VaultY",
                protocol_category: "lending" as const,
                source: "dune" as const,
                metadata: {},
                created_at: "2024-01-01T00:00:00Z",
              })
            : null,
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");

    expect(metrics.onchain.tokenTransfers.inboundVolumeUSD).toBe(3);
    expect(metrics.onchain.tokenTransfers.outboundVolumeUSD).toBe(6);
    expect(metrics.onchain.tokenTransfers.totalVolumeUSD).toBe(9);
    expect(metrics.onchain.protocols.unique).toBe(2);
    expect(metrics.onchain.protocols.categoryBreakdown).toEqual({ escrow: 1, lending: 1 });
    expect(metrics.onchain.protocols.topProtocol?.name).toBe("EscrowX");
  });

  it("enriches pricing null branches and counts failed staking settlements", async () => {
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
        created_at: "2024-01-01T00:00:01Z",
        agent_id: "a1",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "2", asset: "0xtoken", network: 8453 } },
      },
    ] as unknown as Array<import("../server/types").InteractionRecord>;

    await expect(enrichWithPricing(interactions, null)).resolves.toEqual([
      expect.objectContaining({ amountUSD: null }),
      expect.objectContaining({ amountUSD: null }),
    ]);

    const pricingService = {
      normalizeToUSD: async () => 6,
    } as unknown as import("../server/pricing").PricingService;
    await expect(enrichWithPricing(interactions, pricingService)).resolves.toEqual([
      expect.objectContaining({ amountUSD: null }),
      expect.objectContaining({ amountUSD: 6 }),
    ]);

    const store = {
      listInteractionsByWallet: () => [interactions[1]],
      getSettlement: () => ({ id: "s1", interaction_id: "i2", status: "failed", metadata: {} }),
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
      getProtocolLabel: () => ({
        id: "stake-label",
        contract_address: "0xtoken",
        chain_id: 8453,
        protocol_name: "StakeX",
        protocol_category: "staking" as const,
        source: "dune" as const,
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      }),
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.protocolActivity.stakingMetrics).toEqual({ staked: 1, slashed: 1 });
  });

  it("drops non-numeric USD prices from agent and counterparty totals", () => {
    const interaction = {
      id: "i-bad",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xabc",
      counterparty: "svc",
      protocol: "x402" as const,
      summary: { paymentRequired: { amount: "7", asset: "0xtoken", network: 8453 } },
    };

    const store = {
      listInteractionsByWallet: () => [interaction],
      getSettlement: () => undefined,
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [interaction],
      listWalletsByCounterparty: () => ["0xabc"],
      getLatestPrice: () => ({ price_usd: "NaN" }),
      getProtocolLabel: () => null,
    } as const;

    expect(
      computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc").paymentBehaviorUSD.totalVolumeUSD,
    ).toBe(0);
    expect(
      computeCounterpartyMetrics(
        store as unknown as import("../server/store").Store,
        "svc",
      ).paymentBehaviorUSD.totalVolumeUSD,
    ).toBe(0);
  });

  it("drops USD enrichment when token metadata or price lookup is unavailable", () => {
    const interactions = [
      {
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "1", network: "not-a-number" } },
      },
      {
        id: "i2",
        created_at: "2024-01-01T00:00:01Z",
        wallet_address: "0xabc",
        counterparty: "svc",
        protocol: "x402" as const,
        summary: { paymentRequired: { amount: "2", asset: "0xtoken", network: 8453 } },
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
      listInteractionsByCounterparty: () => interactions,
      listWalletsByCounterparty: () => ["0xabc"],
      getLatestPrice: () => null,
      getProtocolLabel: () => null,
    } as const;

    expect(
      computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc").paymentBehaviorUSD.totalVolumeUSD,
    ).toBe(0);
    expect(
      computeCounterpartyMetrics(
        store as unknown as import("../server/store").Store,
        "svc",
      ).paymentBehaviorUSD.totalVolumeUSD,
    ).toBe(0);
  });

  it("computes onchain protocol and token-transfer USD summaries", () => {
    const store = {
      listInteractionsByWallet: () => [],
      getSettlement: () => undefined,
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [
        { tx_hash: "0x1", status: "confirmed", from: "0xabc", to: "0xdef", raw: {}, created_at: "2024-01-01T00:00:00Z" },
        { tx_hash: "0x2", status: "confirmed", from: "0xdef", to: "0xabc", raw: {}, created_at: "2024-01-01T00:00:00Z" },
      ],
      listTokenTransfersByWallet: () => [
        {
          id: "t1",
          tx_hash: "0x1",
          token_address: "0xusdc",
          token_symbol: "USDC",
          from: "0xdef",
          to: "0xabc",
          value: "2",
          raw: {},
          created_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "t2",
          tx_hash: "0x2",
          token_address: "0xusdc",
          token_symbol: "USDC",
          from: "0xabc",
          to: "0xdef",
          value: 3,
          raw: {},
          created_at: "2024-01-01T00:00:01Z",
        },
      ],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: (tokenAddress: string) =>
        tokenAddress === "0xusdc"
          ? {
              id: "price-usdc",
              token_address: tokenAddress,
              chain_id: 8453,
              symbol: "USDC",
              price_usd: "1.5",
              source: "coingecko" as const,
              timestamp: "2024-01-01T00:00:00Z",
              raw: {},
            }
          : null,
      getProtocolLabel: (contractAddress: string) =>
        contractAddress === "0xdef"
          ? {
              id: "def",
              contract_address: contractAddress,
              chain_id: 8453,
              protocol_name: "BridgeX",
              protocol_category: "bridge" as const,
              source: "dune" as const,
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
            }
          : null,
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xabc");
    expect(metrics.onchain.tokenTransfers.inboundVolumeUSD).toBe(3);
    expect(metrics.onchain.tokenTransfers.outboundVolumeUSD).toBe(4.5);
    expect(metrics.onchain.tokenTransfers.totalVolumeUSD).toBe(7.5);
    expect(metrics.onchain.protocols.unique).toBe(1);
    expect(metrics.onchain.protocols.topProtocol).toEqual({ name: "BridgeX", share: 0.5 });
    expect(metrics.onchain.protocols.categoryBreakdown).toEqual({ bridge: 1 });
  });

  it("accepts numeric store values when normalizing stored USD amounts", () => {
    const interaction = {
      id: "numeric-1",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc",
      protocol: "x402" as const,
      summary: {
        paymentRequired: {
          amount: "2",
          asset: "0xtoken",
          network: 8453,
        },
      },
    };

    const store = {
      listInteractionsByWallet: () => [interaction],
      getSettlement: () => undefined,
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [],
      listTokenTransfersByWallet: () => [
        {
          id: "transfer-1",
          token_address: "0xtoken",
          token_symbol: "TOK",
          from: "0xwallet",
          to: "0xother",
          value: 3,
          raw: {},
          created_at: "2024-01-01T00:00:01Z",
        },
      ],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () =>
        ({
          id: "price-numeric",
          token_address: "0xtoken",
          chain_id: 8453,
          symbol: "TOK",
          price_usd: 1.5,
          source: "coingecko",
          timestamp: "2024-01-01T00:00:00Z",
          raw: {},
        }) as unknown as {
          id: string;
          token_address: string;
          chain_id: number;
          symbol: string;
          price_usd: string;
          source: "coingecko";
          timestamp: string;
          raw: Record<string, unknown>;
        },
      getProtocolLabel: () => null,
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xwallet");
    expect(metrics.paymentBehaviorUSD.totalVolumeUSD).toBe(3);
    expect(metrics.onchain.tokenTransfers.outboundVolumeUSD).toBe(4.5);
  });

  it("skips onchain protocol labeling when the tx target is absent", () => {
    const store = {
      listInteractionsByWallet: () => [],
      getSettlement: () => undefined,
      getEvidence: () => [],
      getWalletSnapshot: () => undefined,
      getBaseTransaction: () => undefined,
      listBaseTransactionsByWallet: () => [{ tx_hash: "0xmissing-to", status: "unknown" as const, raw: {}, created_at: "2024-01-01T00:00:00Z" }],
      listTokenTransfersByWallet: () => [],
      listReceiptsByInteraction: () => [],
      listAttestationsByWallet: () => [],
      listInteractionsByCounterparty: () => [],
      listWalletsByCounterparty: () => [],
      getLatestPrice: () => null,
      getProtocolLabel: () => {
        throw new Error("should not be called without tx.to");
      },
    } as const;

    const metrics = computeAgentMetrics(store as unknown as import("../server/store").Store, "0xwallet");
    expect(metrics.onchain.protocols.unique).toBe(0);
    expect(metrics.onchain.protocols.topProtocol).toBeNull();
  });
});
