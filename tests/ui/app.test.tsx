import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  App,
  buildFlowEdges,
  filterInteractionsByFlow,
  findInteractionForFlow,
  formatAmount,
  formatControlStatus,
  formatHttpStatus,
  formatSettlementBadge,
  getFlowServiceLabel,
  selectInteractionForFlow,
} from "../../src/app";

type FetchResponse = { json: () => Promise<unknown> };

function jsonResponse(payload: unknown): FetchResponse {
  return { ok: true, json: () => Promise.resolve(payload) } as FetchResponse & { ok: boolean };
}

function makePacket(overrides: Record<string, unknown> = {}) {
  return {
    version: "afi.packet/v1",
    exportedAt: "2024-01-01T00:00:00Z",
    interaction: {
      id: "i-0",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/paid",
      protocol: "x402",
      protocolName: "EscrowX",
      amountUSD: null,
    },
    controls: {
      amount: 1,
      currency: "USDC",
      approvalRequired: false,
      withinAllowance: true,
      withinMaxTx: true,
      source: "wallet_snapshot",
    },
    protocol: {
      kind: "x402",
      x402: {
        packet: {
          challenge: { present: true, decoded: { amount: "1", network: "base", payTo: "0xmerchant" } },
          authorization: { hasSignature: true, decoded: { payer: "0xpayer" } },
          settlement: { present: true, success: true, txHash: "0xtx", network: "base", payer: "0xpayer", payTo: "0xmerchant" },
        },
        transcript: {
          requestUrl: "https://example.com/paid",
          challenge: { status: 402, headers: { paymentRequired: "{\"amount\":\"1\"}" } },
          authorization: { paymentSignature: "{\"payer\":\"0xpayer\"}" },
          settlement: { status: 200, headers: { paymentResponse: "{\"success\":true,\"transaction\":\"0xtx\"}" } },
        },
      },
    },
    evidence: {
      timeline: [{ id: "e1", kind: "x402", payload: { ok: true }, created_at: "2024-01-01T00:00:00Z" }],
      receipts: [{ id: "r1", tx_hash: "0xtx", status: "verified", raw: { ok: true }, created_at: "2024-01-01T00:00:00Z" }],
      attestations: [{ id: "a1", schemaId: "schema", txHash: "0xtx", chainId: 8453, raw: { ok: true }, created_at: "2024-01-01T00:00:00Z" }],
    },
    correlations: {
      settlement: { id: "s1", status: "confirmed", tx_hash: "0xtx" },
      baseTransaction: { tx_hash: "0xtx", status: "confirmed", from: "0xaaa", to: "0xmerchant" },
      walletSnapshot: { wallet_address: "0xwallet", allowance: "5", max_tx: "10", approvals_required: false },
      protocolLabel: {
        contract: "0xmerchant",
        name: "EscrowX",
        category: "escrow",
        source: "dune" as const,
        labeledAt: "2024-01-01T00:00:00Z",
        metadata: { matchedBy: "contract" },
      },
    },
    provenance: {
      source: "afi" as const,
      interactionId: "i-0",
      exportRoute: "/api/interactions/i-0/packet",
      schemaVersion: "afi.packet/v1",
    },
    summary: {
      handshakeStatus: "complete",
      controlStatus: "within-limits",
      settlementStatus: "confirmed",
      receiptCount: 1,
      attestationCount: 1,
      evidenceKinds: ["x402"],
    },
    references: {
      wallet: { address: "0xwallet", explorerUrl: "https://basescan.org/address/0xwallet" },
      counterparty: { id: "svc" },
      service: "/paid",
      transaction: { txHash: "0xtx", explorerUrl: "https://basescan.org/tx/0xtx" },
      protocol: { name: "EscrowX", category: "escrow", contract: "0xmerchant" },
    },
    ...overrides,
  };
}

describe("AFI UI", () => {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

  const emptyControls = {
    approvals: { total: 0, required: 0, rate: 0 },
    allowance: { total: 0, compliant: 0, overLimit: 0, rate: 0 },
    maxTx: { total: 0, compliant: 0, overLimit: 0, rate: 0 },
    overall: { total: 0, compliant: 0, rate: 0 },
  };

  const emptyLatency = { total: 0, avgSeconds: 0, minSeconds: 0, maxSeconds: 0, medianSeconds: 0 };

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the header", () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    render(<App />);
    expect(screen.getByText(/Agent Flow Intelligence/i)).toBeInTheDocument();
  });

  it("covers packet and flow helper branches directly", () => {
    const basePacket = makePacket();
    expect(formatAmount(basePacket)).toBe("1 USDC");
    expect(formatAmount(makePacket({ interaction: { id: "usd", created_at: "2024-01-01T00:00:00Z", protocol: "x402", amountUSD: 2.5 } }))).toBe(
      "2.50 USD",
    );
    expect(
      formatAmount(
        makePacket({
          interaction: { id: "dash", created_at: "2024-01-01T00:00:00Z", protocol: "x402", amountUSD: null },
          controls: {
            amount: null,
            currency: null,
            approvalRequired: null,
            withinAllowance: null,
            withinMaxTx: null,
            source: "none",
          },
        }),
      ),
    ).toBe("—");
    expect(
      formatControlStatus(
        makePacket({
          summary: {
            handshakeStatus: "authorized",
            controlStatus: "",
            settlementStatus: "unknown",
            receiptCount: 0,
            attestationCount: 0,
            evidenceKinds: [],
          },
          controls: {
            amount: 1,
            currency: null,
            approvalRequired: null,
            withinAllowance: false,
            withinMaxTx: true,
            source: "none",
          },
        }),
      ),
    ).toBe("over-limit");
    expect(
      formatControlStatus(
        makePacket({
          summary: {
            handshakeStatus: "authorized",
            controlStatus: "",
            settlementStatus: "unknown",
            receiptCount: 0,
            attestationCount: 0,
            evidenceKinds: [],
          },
          controls: {
            amount: null,
            currency: null,
            approvalRequired: null,
            withinAllowance: null,
            withinMaxTx: null,
            source: "none",
          },
        }),
      ),
    ).toBe("—");
    expect(formatControlStatus(basePacket)).toBe("within-limits");
    expect(formatSettlementBadge()).toBe("missing");
    expect(formatSettlementBadge({ challenge: { present: false }, authorization: { hasSignature: false }, settlement: { present: true, success: null } })).toBe(
      "recorded",
    );
    expect(formatSettlementBadge({ challenge: { present: false }, authorization: { hasSignature: false }, settlement: { present: true, success: false } })).toBe(
      "failed",
    );
    expect(formatSettlementBadge(basePacket.protocol.x402?.packet)).toBe("success");
    expect(formatHttpStatus()).toBe("—");
    expect(formatHttpStatus(202)).toBe("202");

    const interactions = [
      { id: "a", created_at: "2024-01-01T00:00:00Z", wallet_address: "w1", counterparty: "c1", service: "/pay", protocol: "x402", protocolName: "EscrowX" },
      { id: "b", created_at: "2024-01-01T00:00:00Z", wallet_address: "w2", counterparty: "c2", protocol: "locus" },
      { id: "c", created_at: "2024-01-01T00:00:00Z", protocol: "locus" },
    ];
    expect(getFlowServiceLabel(interactions[0]!)).toBe("EscrowX /pay");
    expect(getFlowServiceLabel({ ...interactions[0]!, protocolName: "EscrowX", service: undefined })).toBe("EscrowX");
    expect(getFlowServiceLabel({ ...interactions[1]!, service: "/wrapped", protocolName: undefined })).toBe("/wrapped");
    expect(getFlowServiceLabel(interactions[1]!)).toBe("unknown");
    expect(filterInteractionsByFlow(interactions, null)).toHaveLength(3);
    expect(filterInteractionsByFlow(interactions, { wallet: "w1" })).toEqual([interactions[0]]);
    expect(filterInteractionsByFlow(interactions, { wallet: "missing" })).toEqual([]);
    expect(filterInteractionsByFlow(interactions, { wallet: "unknown" })).toEqual([interactions[2]]);
    expect(filterInteractionsByFlow(interactions, { counterparty: "c2" })).toEqual([interactions[1]]);
    expect(filterInteractionsByFlow(interactions, { counterparty: "missing" })).toEqual([]);
    expect(filterInteractionsByFlow(interactions, { counterparty: "unknown" })).toEqual([interactions[2]]);
    expect(filterInteractionsByFlow(interactions, { service: "EscrowX /pay" })).toEqual([interactions[0]]);
    expect(filterInteractionsByFlow(interactions, { service: "missing" })).toEqual([]);
    expect(findInteractionForFlow(interactions, { wallet: "w2", counterparty: "c2" })).toEqual(interactions[1]);
    expect(findInteractionForFlow(interactions, { wallet: "missing" })).toBeUndefined();
    expect(findInteractionForFlow(interactions, { wallet: "unknown" })).toEqual(interactions[2]);
    expect(findInteractionForFlow(interactions, { counterparty: "missing" })).toBeUndefined();
    expect(findInteractionForFlow(interactions, { counterparty: "unknown" })).toEqual(interactions[2]);
    expect(
      findInteractionForFlow(
        [
          { id: "x", created_at: "2024-01-01T00:00:00Z", wallet_address: "w1", counterparty: "wrong", protocol: "x402" },
          { id: "y", created_at: "2024-01-01T00:00:00Z", wallet_address: "w1", counterparty: "c1", protocol: "x402" },
        ],
        { wallet: "w1", counterparty: "c1" },
      )?.id,
    ).toBe("y");
    expect(findInteractionForFlow(interactions, { service: "missing" })).toBeUndefined();
    const onMatch = vi.fn();
    expect(selectInteractionForFlow(interactions, { service: "EscrowX /pay" }, onMatch)).toEqual(interactions[0]);
    expect(onMatch).toHaveBeenCalledWith("a");
    expect(selectInteractionForFlow(interactions, { service: "missing" }, onMatch)).toBeNull();
    expect(buildFlowEdges([...interactions, interactions[0]!])).toEqual([
      { wallet: "w1", counterparty: "c1", service: "EscrowX /pay", count: 2 },
      { wallet: "w2", counterparty: "c2", service: "unknown", count: 1 },
      { wallet: "unknown", counterparty: "unknown", service: "unknown", count: 1 },
    ]);
  });

  it("loads interactions, renders flow edges, and shows canonical packet details", async () => {
    const repeatedEdge = Array.from({ length: 11 }, (_, idx) => ({
      id: `i-${idx}`,
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/paid",
      protocol: "x402",
      protocolName: "EscrowX",
    }));
    const interactions = [
      ...repeatedEdge,
      {
        id: "i-protocol-name",
        created_at: "2024-01-01T00:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "svc",
        protocolName: "Uniswap",
        protocol: "x402",
      },
      {
        id: "i-protocol-and-service",
        created_at: "2024-01-01T00:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "svc",
        protocolName: "Uniswap",
        service: "/swap",
        protocol: "x402",
      },
      {
        id: "i-unknown",
        created_at: "2024-01-02T00:00:00Z",
        protocol: "locus",
      },
    ];

    fetchMock.mockResolvedValueOnce(jsonResponse(interactions));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { ...interactions[0], amountUSD: null } })));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makePacket({
          interaction: { ...interactions[0], amountUSD: 3.5 },
          controls: {
            amount: 7,
            currency: "USDC",
            approvalRequired: false,
            withinAllowance: false,
            withinMaxTx: null,
            source: "wallet_snapshot",
          },
          summary: {
            handshakeStatus: "authorized",
            controlStatus: "over-limit",
            settlementStatus: "confirmed",
            receiptCount: 1,
            attestationCount: 1,
            evidenceKinds: ["x402"],
          },
          protocol: {
            kind: "x402",
            x402: {
              packet: {
                challenge: { present: true, decoded: { amount: "1" } },
                authorization: { hasSignature: true, decoded: { payer: "0xpayer" } },
                settlement: { present: false, success: null },
              },
            },
          },
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText("11")).toBeInTheDocument();
    expect(screen.getAllByText("→ svc")).toHaveLength(3);
    expect(screen.getByText("→ EscrowX /paid")).toBeInTheDocument();
    expect(screen.getByText("→ Uniswap")).toBeInTheDocument();
    expect(screen.getByText("→ Uniswap /swap")).toBeInTheDocument();

    const bars = Array.from(document.querySelectorAll(".afi-edge-bar > div"));
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "10%" });

    const interactionsList = screen.getByRole("list");
    within(interactionsList).getAllByRole("button", { name: "View" })[0]?.click();

    expect(await screen.findByText("i-0")).toBeInTheDocument();
    expect(screen.getAllByText("afi.packet/v1").length).toBeGreaterThan(0);
    expect(screen.getByText("Packet Summary")).toBeInTheDocument();
    expect(screen.getByText("x402 Transcript Timeline")).toBeInTheDocument();
    expect(screen.getByText("Settlement Correlation")).toBeInTheDocument();
    expect(screen.getAllByText("Receipts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Attestations").length).toBeGreaterThan(0);
    expect(screen.getByText("Evidence Timeline")).toBeInTheDocument();
    expect(screen.getByText("Download packet JSON")).toHaveAttribute("download", "afi-packet-i-0.json");
    expect(screen.getByText("Download packet JSON")).toHaveAttribute("href", "/api/interactions/i-0/packet");
    expect(screen.getByText("within-limits")).toBeInTheDocument();
    expect(screen.getByText("1 USDC")).toBeInTheDocument();
    expect(screen.getByText("captured")).toBeInTheDocument();
    expect(screen.getByText("signature-recorded")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getAllByText("0xtx").length).toBeGreaterThan(0);
    expect(screen.getByText("r1")).toBeInTheDocument();
    expect(screen.getByText("a1")).toBeInTheDocument();
    expect(screen.getByText("Protocol source").parentElement?.querySelector("strong")).toHaveTextContent("dune");
    expect(screen.getByText("Protocol contract").parentElement?.querySelector("strong")).toHaveTextContent("0xmerchant");
    expect(screen.getByText("Matched by").parentElement?.querySelector("strong")).toHaveTextContent("contract");

    within(interactionsList).getAllByRole("button", { name: "View" })[0]?.click();
    expect(await screen.findByText("over-limit")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("authorized");
    expect(screen.getByText("Amount").parentElement?.querySelector("strong")).toHaveTextContent("3.50 USD");
  });

  it("drives profile loading from flow explorer clicks", async () => {
    const interactions = [
      {
        id: "i-1",
        created_at: "2024-01-01T00:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "svc",
        service: "/paid",
        protocol: "x402",
        protocolName: "EscrowX",
      },
    ];

    const agentMetrics = {
      wallet: "0xwallet",
      lifecycle: { firstSeen: undefined, lastSeen: "2024-01-03T00:00:00Z", ageDays: 1.25 },
      throughput: { totalInteractions: 12, dailyCounts: [12], burstiness: 0.1234 },
      counterparty: { unique: 2, top: { id: "svc", share: 0.9 }, repeatRate: 0.5 },
      paymentBehavior: { count: 1, avg: 2, min: 2, max: 2, median: 2 },
      paymentBehaviorUSD: { count: 1, avg: 2, min: 2, max: 2, median: 2, totalVolumeUSD: 12 },
      protocolActivity: {
        uniqueProtocols: 1,
        topProtocol: { name: "EscrowX", share: 1 },
        categoryBreakdown: {},
        escrowCompletionRate: 1,
        stakingMetrics: null,
      },
      settlement: { total: 2, successRate: 0.75 },
      settlementLatency: { total: 1, avgSeconds: 1.2, minSeconds: 1.2, maxSeconds: 1.2, medianSeconds: 1.2 },
      controls: {
        approvals: { total: 2, required: 1, rate: 0.5 },
        allowance: { total: 2, compliant: 2, overLimit: 0, rate: 1 },
        maxTx: { total: 2, compliant: 1, overLimit: 1, rate: 0.5 },
        overall: { total: 2, compliant: 1, rate: 0.5 },
      },
      receiptAvailability: { total: 12, withReceipt: 6, rate: 0.5 },
      evidenceDensity: 3.25,
      onchain: {
        transactions: {
          total: 9,
          confirmed: 8,
          failed: 1,
          unknown: 0,
          uniqueCounterparties: 3,
          topCounterparty: { address: "0xsvc", share: 0.5 },
        },
        tokenTransfers: {
          total: 4,
          inbound: 1,
          outbound: 3,
          inboundVolumeUSD: 0,
          outboundVolumeUSD: 0,
          totalVolumeUSD: 0,
          uniqueTokens: 2,
          topToken: { symbol: "USDC", share: 0.75 },
        },
        protocols: { unique: 1, topProtocol: { name: "EscrowX", share: 1 }, categoryBreakdown: {} },
      },
    };

    const counterpartyMetrics = {
      counterparty: "svc",
      volume: { totalInteractions: 4, uniqueWallets: 2 },
      paymentBehavior: { count: 2, avg: 1.234, min: 1, max: 2, median: 1.5 },
      paymentBehaviorUSD: { count: 2, avg: 1.234, min: 1, max: 2, median: 1.5, totalVolumeUSD: 4.5 },
      protocolActivity: {
        uniqueProtocols: 1,
        topProtocol: null,
        categoryBreakdown: {},
        escrowCompletionRate: 1,
        stakingMetrics: null,
      },
      fulfillment: { total: 4, successRate: 0.5 },
      settlementLatency: emptyLatency,
      controls: emptyControls,
      receiptAvailability: { total: 4, withReceipt: 0, rate: 0 },
    };

    fetchMock.mockResolvedValueOnce(jsonResponse(interactions));
    fetchMock.mockResolvedValueOnce(jsonResponse(agentMetrics));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { ...interactions[0], amountUSD: 1 } })));
    fetchMock.mockResolvedValueOnce(jsonResponse(counterpartyMetrics));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { ...interactions[0], amountUSD: 1 } })));

    render(<App />);

    expect(await screen.findByText("→ svc")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "0xwallet" }));
    expect(await screen.findByDisplayValue("0xwallet")).toBeInTheDocument();
    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect((await screen.findAllByText("i-1")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "→ svc" }));
    expect(await screen.findByDisplayValue("svc")).toBeInTheDocument();
    expect((await screen.findAllByText("50%")).length).toBeGreaterThan(0);
  });

  it("loads manual profile metrics and supports early-return when inputs are empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    render(<App />);

    const agentSection = screen.getByRole("heading", { name: "Agent Profile" }).closest("section")!;
    const counterpartySection = screen.getByRole("heading", { name: "Counterparty Profile" }).closest("section")!;

    fetchMock.mockClear();
    within(agentSection).getByRole("button", { name: "Load" }).click();
    within(counterpartySection).getByRole("button", { name: "Load" }).click();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("covers optional metric fallbacks when USD and protocol aggregates are absent", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    render(<App />);

    const agentSection = screen.getByRole("heading", { name: "Agent Profile" }).closest("section")!;
    const counterpartySection = screen.getByRole("heading", { name: "Counterparty Profile" }).closest("section")!;

    const agentMetrics = {
      wallet: "0xwallet",
      lifecycle: { firstSeen: undefined, lastSeen: "2024-01-03T00:00:00Z", ageDays: 1.25 },
      throughput: { totalInteractions: 12, dailyCounts: [12], burstiness: 0.1234 },
      counterparty: { unique: 2, top: { id: "svc", share: 0.9 }, repeatRate: 0.5 },
      paymentBehavior: { count: 1, avg: 2, min: 2, max: 2, median: 2 },
      settlement: { total: 2, successRate: 0.75 },
      settlementLatency: { total: 1, avgSeconds: 1.2, minSeconds: 1.2, maxSeconds: 1.2, medianSeconds: 1.2 },
      controls: {
        approvals: { total: 2, required: 1, rate: 0.5 },
        allowance: { total: 2, compliant: 2, overLimit: 0, rate: 1 },
        maxTx: { total: 2, compliant: 1, overLimit: 1, rate: 0.5 },
        overall: { total: 2, compliant: 1, rate: 0.5 },
      },
      receiptAvailability: { total: 12, withReceipt: 6, rate: 0.5 },
      evidenceDensity: 3.25,
      onchain: {
        transactions: {
          total: 9,
          confirmed: 8,
          failed: 1,
          unknown: 0,
          uniqueCounterparties: 3,
          topCounterparty: { address: "0xsvc", share: 0.5 },
        },
        tokenTransfers: {
          total: 4,
          inbound: 1,
          outbound: 3,
          inboundVolumeUSD: 0,
          outboundVolumeUSD: 0,
          uniqueTokens: 2,
          topToken: { symbol: "USDC", share: 0.75 },
        },
      },
    };

    const counterpartyMetrics = {
      counterparty: "svc",
      volume: { totalInteractions: 4, uniqueWallets: 2 },
      paymentBehavior: { count: 2, avg: 1.234, min: 1, max: 2, median: 1.5 },
      protocolActivity: {
        uniqueProtocols: 1,
        topProtocol: null,
        categoryBreakdown: {},
        escrowCompletionRate: 1,
        stakingMetrics: null,
      },
      fulfillment: { total: 4, successRate: 0.5 },
      settlementLatency: emptyLatency,
      controls: emptyControls,
      receiptAvailability: { total: 4, withReceipt: 0, rate: 0 },
    };

    fetchMock.mockResolvedValueOnce(jsonResponse(agentMetrics));
    fetchMock.mockResolvedValueOnce(jsonResponse(counterpartyMetrics));

    fireEvent.change(within(agentSection).getByPlaceholderText("Wallet address (Base)"), {
      target: { value: "0xwallet" },
    });
    within(agentSection).getByRole("button", { name: "Load" }).click();

    fireEvent.change(within(counterpartySection).getByPlaceholderText("Counterparty ID"), {
      target: { value: "svc" },
    });
    within(counterpartySection).getByRole("button", { name: "Load" }).click();

    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(within(agentSection).getByText("Total USD volume").parentElement?.querySelector("strong")).toHaveTextContent("0.00");
    expect(within(agentSection).getByText("Onchain USD volume").parentElement?.querySelector("strong")).toHaveTextContent("0.00");
    expect(within(agentSection).getByText("Onchain protocols").parentElement?.querySelector("strong")).toHaveTextContent("0");
    expect(within(counterpartySection).getByText("Total USD volume").parentElement?.querySelector("strong")).toHaveTextContent("0.00");
  });

  it("filters flows by service and supports manual counterparty loading", async () => {
    const interactions = [
      {
        id: "i-service",
        created_at: "2024-01-01T00:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "svc",
        service: "/paid",
        protocol: "x402",
        protocolName: "EscrowX",
      },
      {
        id: "i-other",
        created_at: "2024-01-01T00:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "other",
        service: "/quote",
        protocol: "x402",
        protocolName: "EscrowX",
      },
    ];

    const counterpartyMetrics = {
      counterparty: "svc-manual",
      volume: { totalInteractions: 4, uniqueWallets: 2 },
      paymentBehavior: { count: 2, avg: 1.234, min: 1, max: 2, median: 1.5 },
      paymentBehaviorUSD: undefined,
      protocolActivity: {
        uniqueProtocols: 1,
        topProtocol: null,
        categoryBreakdown: {},
        escrowCompletionRate: 1,
        stakingMetrics: null,
      },
      fulfillment: { total: 4, successRate: 0.5 },
      settlementLatency: emptyLatency,
      controls: emptyControls,
      receiptAvailability: { total: 4, withReceipt: 0, rate: 0 },
    };

    fetchMock.mockResolvedValueOnce(jsonResponse(interactions));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { ...interactions[0], amountUSD: 1 } })));
    fetchMock.mockResolvedValueOnce(jsonResponse(counterpartyMetrics));

    render(<App />);

    expect(await screen.findByText("→ EscrowX /paid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "→ EscrowX /paid" }));
    expect(await screen.findByText(/Filtered by/i)).toBeInTheDocument();
    expect(await screen.findByText("Packet Summary")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(2);

    const counterpartySection = screen.getByRole("heading", { name: "Counterparty Profile" }).closest("section")!;
    fireEvent.change(within(counterpartySection).getByPlaceholderText("Counterparty ID"), {
      target: { value: "svc-manual" },
    });
    within(counterpartySection).getByRole("button", { name: "Load" }).click();

    expect(await screen.findByDisplayValue("svc-manual")).toBeInTheDocument();
    expect(await screen.findByText("50%")).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new Error("counterparty"));
    within(counterpartySection).getByRole("button", { name: "Load" }).click();
    expect(await screen.findByText(/Track inbound flows/i)).toBeInTheDocument();
  });

  it("derives fallback control labels and amount display when packet summaries omit them", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "i-fallback", created_at: "2024-01-01T00:00:00Z", protocol: "x402" }]));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      exportedAt: "",
      interaction: { id: "i-fallback", created_at: "2024-01-01T00:00:00Z", protocol: "x402", amountUSD: null },
      controls: {
        amount: null,
        currency: null,
        approvalRequired: null,
        withinAllowance: null,
        withinMaxTx: null,
        source: "none",
      },
      summary: {
        handshakeStatus: "not-captured",
        controlStatus: "",
        settlementStatus: "unknown",
        receiptCount: 0,
        attestationCount: 0,
        evidenceKinds: [],
      },
      evidence: {
        timeline: [],
        receipts: [{ id: "r-fallback", raw: { ok: true }, created_at: "2024-01-01T00:00:00Z" }],
        attestations: [{ id: "a-fallback", raw: { ok: true }, created_at: "2024-01-01T00:00:00Z" }],
      },
      correlations: {
        settlement: undefined,
        baseTransaction: undefined,
        walletSnapshot: undefined,
        protocolLabel: undefined,
      },
    })));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      interaction: { id: "i-fallback", created_at: "2024-01-01T00:00:00Z", protocol: "x402", amountUSD: null },
      controls: {
        amount: 2,
        currency: null,
        approvalRequired: null,
        withinAllowance: false,
        withinMaxTx: true,
        source: "none",
      },
      summary: {
        handshakeStatus: "authorized",
        controlStatus: "",
        settlementStatus: "unknown",
        receiptCount: 0,
        attestationCount: 0,
        evidenceKinds: [],
      },
    })));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      interaction: { id: "i-fallback", created_at: "2024-01-01T00:00:00Z", protocol: "x402", amountUSD: null },
      controls: {
        amount: 2,
        currency: null,
        approvalRequired: null,
        withinAllowance: true,
        withinMaxTx: true,
        source: "none",
      },
      summary: {
        handshakeStatus: "authorized",
        controlStatus: "",
        settlementStatus: "unknown",
        receiptCount: 0,
        attestationCount: 0,
        evidenceKinds: [],
      },
    })));

    render(<App />);

    const viewButton = (await screen.findByRole("button", { name: "View" }));
    fireEvent.click(viewButton);
    expect(await screen.findByText("Download packet JSON")).toBeInTheDocument();
    expect(screen.getByText("Controls").parentElement?.querySelector("strong")).toHaveTextContent("—");
    expect(screen.getByText("Amount").parentElement?.querySelector("strong")).toHaveTextContent("—");
    expect(screen.getByText("Exported").parentElement?.querySelector("strong")).toHaveTextContent("—");
    expect(screen.getByText("Status: raw")).toBeInTheDocument();
    expect(screen.getByText("Schema: —")).toBeInTheDocument();
    expect(screen.getAllByText("Tx: —").length).toBeGreaterThan(0);
    expect(screen.getByText("Protocol source").parentElement?.querySelector("strong")).toHaveTextContent("—");

    fireEvent.click(viewButton);
    expect(await screen.findByText("over-limit")).toBeInTheDocument();
    expect(screen.getByText("Amount").parentElement?.querySelector("strong")).toHaveTextContent("2");

    fireEvent.click(viewButton);
    expect(await screen.findByText("within-limits")).toBeInTheDocument();
  });

  it("refreshes protocol provenance from the packet panel", async () => {
    const interactions = [{ id: "i-refresh", created_at: "2024-01-01T00:00:00Z", protocol: "x402" }];

    fetchMock.mockResolvedValueOnce(jsonResponse(interactions));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { id: "i-refresh", created_at: "2024-01-01T00:00:00Z", protocol: "x402" } })));
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, refreshed: true, message: "Protocol label refreshed" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        makePacket({
          interaction: { id: "i-refresh", created_at: "2024-01-01T00:00:00Z", protocol: "x402" },
          correlations: {
            settlement: { id: "s1", status: "confirmed", tx_hash: "0xtx" },
            baseTransaction: { tx_hash: "0xtx", status: "confirmed", from: "0xaaa", to: "0xmerchant" },
            walletSnapshot: { wallet_address: "0xwallet", allowance: "5", max_tx: "10", approvals_required: false },
            protocolLabel: {
              contract: "0xmerchant",
              name: "EscrowX",
              category: "escrow",
              source: "dune",
              labeledAt: "2024-01-02T00:00:00Z",
              metadata: { matchedBy: "contract" },
            },
          },
        }),
      ),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    expect(await screen.findByText("Refresh protocol label")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh protocol label" }));

    expect(await screen.findByText("Protocol label refreshed")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/interactions/i-refresh/enrich/protocol", { method: "POST" });
  });

  it("uses the default success message when protocol refresh omits one", async () => {
    const interactions = [{ id: "i-refresh-default", created_at: "2024-01-01T00:00:00Z", protocol: "x402" }];

    fetchMock.mockResolvedValueOnce(jsonResponse(interactions));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { id: "i-refresh-default", created_at: "2024-01-01T00:00:00Z", protocol: "x402" } })));
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, refreshed: true }));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { id: "i-refresh-default", created_at: "2024-01-01T00:00:00Z", protocol: "x402" } })));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(await screen.findByRole("button", { name: "Refresh protocol label" }));

    expect(await screen.findByText("Protocol label refreshed")).toBeInTheDocument();
  });

  it("renders a protocol refresh failure message", async () => {
    const interactions = [{ id: "i-refresh-fail", created_at: "2024-01-01T00:00:00Z", protocol: "x402" }];

    fetchMock.mockResolvedValueOnce(jsonResponse(interactions));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { id: "i-refresh-fail", created_at: "2024-01-01T00:00:00Z", protocol: "x402" } })));
    fetchMock.mockRejectedValueOnce(new Error("refresh failed"));

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(await screen.findByRole("button", { name: "Refresh protocol label" }));

    expect(await screen.findByText("Protocol refresh failed")).toBeInTheDocument();
  });

  it("treats non-ok protocol refresh responses as failures", async () => {
    const interactions = [{ id: "i-refresh-http", created_at: "2024-01-01T00:00:00Z", protocol: "x402" }];

    fetchMock.mockResolvedValueOnce(jsonResponse(interactions));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({ interaction: { id: "i-refresh-http", created_at: "2024-01-01T00:00:00Z", protocol: "x402" } })));
    fetchMock.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) } as FetchResponse & { ok: boolean });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    fireEvent.click(await screen.findByRole("button", { name: "Refresh protocol label" }));

    expect(await screen.findByText("Protocol refresh failed")).toBeInTheDocument();
  });

  it("covers metrics render branches + failure fallbacks", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    const { unmount } = render(<App />);

    const agentSection = screen.getByRole("heading", { name: "Agent Profile" }).closest("section")!;

    const agentMetrics = {
      wallet: "0xwallet",
      lifecycle: { firstSeen: "2024-01-01T00:00:00Z", lastSeen: undefined, ageDays: 0 },
      throughput: { totalInteractions: 0, dailyCounts: [], burstiness: 0 },
      counterparty: { unique: 0, top: null, repeatRate: 0 },
      paymentBehavior: { count: 0, avg: 0, min: 0, max: 0, median: 0 },
      paymentBehaviorUSD: undefined,
      protocolActivity: { uniqueProtocols: 0, topProtocol: null, categoryBreakdown: {}, escrowCompletionRate: null, stakingMetrics: null },
      settlement: { total: 0, successRate: 0 },
      settlementLatency: emptyLatency,
      controls: emptyControls,
      receiptAvailability: { total: 0, withReceipt: 0, rate: 0 },
      evidenceDensity: 0,
      onchain: {
        transactions: { total: 0, confirmed: 0, failed: 0, unknown: 0, uniqueCounterparties: 0, topCounterparty: null },
        tokenTransfers: {
          total: 0,
          inbound: 0,
          outbound: 0,
          inboundVolumeUSD: 0,
          outboundVolumeUSD: 0,
          totalVolumeUSD: undefined,
          uniqueTokens: 0,
          topToken: null,
        },
        protocols: undefined,
      },
    };

    fetchMock.mockResolvedValueOnce(jsonResponse(agentMetrics));
    fireEvent.change(within(agentSection).getByPlaceholderText("Wallet address (Base)"), {
      target: { value: "0xwallet" },
    });
    within(agentSection).getByRole("button", { name: "Load" }).click();

    expect(await screen.findByText("2024-01-01T00:00:00Z")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    fetchMock.mockRejectedValueOnce(new Error("agent"));
    within(agentSection).getByRole("button", { name: "Load" }).click();
    expect(await screen.findByText(/Enter a wallet/i)).toBeInTheDocument();

    unmount();
  });

  it("covers interaction/detail fetch failures and packet status fallbacks", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const first = render(<App />);
    expect(await screen.findByText("No interactions yet.")).toBeInTheDocument();
    first.unmount();

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "i1", created_at: "2024-01-01T00:00:00Z", protocol: "x402" }]));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      interaction: { id: "i1", created_at: "2024-01-01T00:00:00Z", protocol: "x402" },
      summary: { handshakeStatus: "not-captured", controlStatus: "unknown", settlementStatus: "unknown", receiptCount: 0, attestationCount: 0, evidenceKinds: [] },
      protocol: { kind: "x402" },
      evidence: { timeline: [], receipts: [], attestations: [] },
      correlations: {},
      references: {},
    })));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      interaction: { id: "i1", created_at: "2024-01-01T00:00:00Z", protocol: "x402" },
      summary: { handshakeStatus: "challenge-only", controlStatus: "unknown", settlementStatus: "unknown", receiptCount: 0, attestationCount: 0, evidenceKinds: [] },
      protocol: { kind: "x402", x402: { packet: { challenge: { present: true }, authorization: { hasSignature: false }, settlement: { present: false, success: null } } } },
      evidence: { timeline: [], receipts: [], attestations: [] },
      correlations: {},
      references: {},
    })));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      interaction: { id: "i1", created_at: "2024-01-01T00:00:00Z", protocol: "x402" },
      summary: { handshakeStatus: "authorized", controlStatus: "unknown", settlementStatus: "unknown", receiptCount: 0, attestationCount: 0, evidenceKinds: [] },
      protocol: { kind: "x402", x402: { packet: { challenge: { present: false }, authorization: { hasSignature: true }, settlement: { present: false, success: null } } } },
      evidence: { timeline: [], receipts: [], attestations: [] },
      correlations: {},
      references: {},
    })));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      interaction: { id: "i1", created_at: "2024-01-01T00:00:00Z", protocol: "x402" },
      summary: { handshakeStatus: "settled", controlStatus: "unknown", settlementStatus: "failed", receiptCount: 0, attestationCount: 0, evidenceKinds: [] },
      protocol: { kind: "x402", x402: { packet: { challenge: { present: false }, authorization: { hasSignature: false }, settlement: { present: true, success: false } } } },
      evidence: { timeline: [], receipts: [], attestations: [] },
      correlations: { settlement: { id: "s1", status: "failed" } },
      references: {},
    })));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      interaction: { id: "i1", created_at: "2024-01-01T00:00:00Z", protocol: "x402" },
      summary: { handshakeStatus: "settled", controlStatus: "unknown", settlementStatus: "recorded", receiptCount: 0, attestationCount: 0, evidenceKinds: [] },
      protocol: { kind: "x402", x402: { packet: { challenge: { present: false }, authorization: { hasSignature: false }, settlement: { present: true, success: null } } } },
      evidence: { timeline: [], receipts: [], attestations: [] },
      correlations: { settlement: { id: "s1", status: "recorded" } },
      references: {},
    })));
    fetchMock.mockResolvedValueOnce(jsonResponse(makePacket({
      interaction: { id: "i1", created_at: "2024-01-01T00:00:00Z", protocol: "x402" },
      summary: { handshakeStatus: "not-captured", controlStatus: "unknown", settlementStatus: "unknown", receiptCount: 0, attestationCount: 0, evidenceKinds: [] },
      protocol: { kind: "x402", x402: { packet: { challenge: { present: false }, authorization: { hasSignature: false }, settlement: { present: false, success: null } } } },
      evidence: { timeline: [], receipts: [], attestations: [] },
      correlations: {},
      references: {},
    })));
    fetchMock.mockRejectedValueOnce(new Error("detail"));

    render(<App />);
    const interactionsList = await screen.findByRole("list");
    const viewButton = within(interactionsList).getByRole("button", { name: "View" });

    viewButton.click();
    expect(await screen.findByText("Download packet JSON")).toBeInTheDocument();
    expect(screen.getByText("Status").parentElement?.querySelector("strong")).toHaveTextContent("unknown");
    expect(screen.getByText("Controls").parentElement?.querySelector("strong")).toHaveTextContent("unknown");
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("not-captured");

    viewButton.click();
    expect(await screen.findByText("Download packet JSON")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("challenge-only");

    viewButton.click();
    expect(await screen.findByText("Download packet JSON")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("authorized");

    viewButton.click();
    expect(await screen.findByText("Download packet JSON")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("settled");
    expect(screen.getByText("Settlement").parentElement?.querySelector("strong")).toHaveTextContent("failed");

    viewButton.click();
    expect(await screen.findByText("Download packet JSON")).toBeInTheDocument();
    expect(screen.getByText("Settlement").parentElement?.querySelector("strong")).toHaveTextContent("recorded");

    viewButton.click();
    expect(await screen.findByText("Download packet JSON")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("not-captured");

    viewButton.click();
    expect(await screen.findByText(/Select an interaction/i)).toBeInTheDocument();
  });
});
