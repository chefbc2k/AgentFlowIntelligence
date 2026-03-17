import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app";

type FetchResponse = { json: () => Promise<unknown> };

function jsonResponse(payload: unknown): FetchResponse {
  return { json: () => Promise.resolve(payload) };
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

  it("loads interactions, renders flow edges, and shows packet details", async () => {
    const repeatedEdge = Array.from({ length: 11 }, (_, idx) => ({
      id: `i-${idx}`,
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/paid",
      protocol: "x402",
    }));
    const interactions = [
      ...repeatedEdge,
      {
        id: "i-unknown",
        created_at: "2024-01-02T00:00:00Z",
        wallet_address: undefined,
        counterparty: undefined,
        service: undefined,
        protocol: "locus",
      },
    ];

    const detailWithin = {
      interaction: interactions[0],
      x402: {
        challenge: { present: true, decoded: { amount: "1", network: "base", payTo: "0xmerchant" } },
        authorization: { hasSignature: true, decoded: { payer: "0xpayer" } },
        settlement: { present: true, success: true, txHash: "0xtx", network: "base", payer: "0xpayer", payTo: "0xmerchant" },
      },
      controls: {
        amount: 1,
        currency: "USDC",
        approvalRequired: false,
        withinAllowance: true,
        withinMaxTx: true,
        source: "wallet_snapshot",
      },
      evidence: [{ id: "e1", kind: "x402", payload: { ok: true }, created_at: "2024-01-01T00:00:00Z" }],
      settlement: { id: "s1", status: "confirmed", tx_hash: "0xtx" },
      baseTransaction: { tx_hash: "0xtx", status: "confirmed", from: "0xaaa", to: "0xmerchant" },
      walletSnapshot: { wallet_address: "0xwallet", approvals_required: true },
      receipts: [{ id: "r1", raw: { ok: true }, created_at: "2024-01-01T00:00:00Z" }],
    };

    fetchMock.mockResolvedValueOnce(jsonResponse(interactions));
    fetchMock.mockResolvedValueOnce(jsonResponse(detailWithin));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...detailWithin,
        x402: {
          challenge: { present: false, decoded: { amount: "2" } },
          authorization: { hasSignature: true, decoded: { payer: "0xpayer" } },
          settlement: { present: false, success: null },
        },
        controls: { ...detailWithin.controls, amount: 2, currency: null, withinAllowance: false, withinMaxTx: null },
      }),
    );

    render(<App />);

    expect(await screen.findByText("11")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("→ svc")).toBeInTheDocument();
    expect(screen.getByText("→ /paid")).toBeInTheDocument();

    const bars = Array.from(document.querySelectorAll(".afi-edge-bar > div"));
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "10%" });

    const interactionsList = screen.getByRole("list");
    within(interactionsList).getAllByRole("button", { name: "View" })[0]?.click();

    expect(await screen.findByText(detailWithin.interaction.id)).toBeInTheDocument();
    expect(screen.getByText("Status").parentElement?.querySelector("strong")).toHaveTextContent("confirmed");
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(screen.getByText("Download JSON")).toHaveAttribute("download", `afi-${detailWithin.interaction.id}.json`);
    expect(screen.getByText("within-limits")).toBeInTheDocument();
    expect(screen.getByText("1 USDC")).toBeInTheDocument();
    expect(screen.getByText("captured")).toBeInTheDocument();
    expect(screen.getByText("signature-recorded")).toBeInTheDocument();
    expect(screen.getAllByText("success").length).toBeGreaterThan(0);
    expect(screen.getByText("0xtx")).toBeInTheDocument();

    within(interactionsList).getAllByRole("button", { name: "View" })[0]?.click();
    expect(await screen.findByText("over-limit")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("authorized");

    const amountLabel = screen.getByText("Amount");
    expect(amountLabel.parentElement?.querySelector("strong")).toHaveTextContent("2");
  });

  it("loads agent + counterparty metrics and supports early-return when inputs are empty", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    render(<App />);

    const agentSection = screen.getByRole("heading", { name: "Agent Profile" }).closest("section")!;
    const counterpartySection = screen.getByRole("heading", { name: "Counterparty Profile" }).closest("section")!;

    fetchMock.mockClear();
    within(agentSection).getByRole("button", { name: "Load" }).click();
    within(counterpartySection).getByRole("button", { name: "Load" }).click();
    expect(fetchMock).not.toHaveBeenCalled();

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
          uniqueTokens: 2,
          topToken: { symbol: "USDC", share: 0.75 },
        },
      },
    };

    const counterpartyMetrics = {
      counterparty: "svc",
      volume: { totalInteractions: 4, uniqueWallets: 2 },
      paymentBehavior: { count: 2, avg: 1.234, min: 1, max: 2, median: 1.5 },
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
    expect(await within(counterpartySection).findByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Onchain txs").parentElement?.querySelector("strong")).toHaveTextContent("9");
    expect(screen.getByText("Top token").parentElement?.querySelector("strong")).toHaveTextContent("USDC");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    fetchMock.mockRejectedValueOnce(new Error("counterparty"));
    within(counterpartySection).getByRole("button", { name: "Load" }).click();
    expect(await screen.findByText(/Track inbound flows/i)).toBeInTheDocument();
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
      settlement: { total: 0, successRate: 0 },
      settlementLatency: emptyLatency,
      controls: emptyControls,
      receiptAvailability: { total: 0, withReceipt: 0, rate: 0 },
      evidenceDensity: 0,
      onchain: {
        transactions: { total: 0, confirmed: 0, failed: 0, unknown: 0, uniqueCounterparties: 0, topCounterparty: null },
        tokenTransfers: { total: 0, inbound: 0, outbound: 0, uniqueTokens: 0, topToken: null },
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

  it("covers interaction/detail fetch failures and the packet status fallback", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const first = render(<App />);
    expect(await screen.findByText("No interactions yet.")).toBeInTheDocument();
    first.unmount();

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: "i1", created_at: "2024-01-01T00:00:00Z", protocol: "x402" }]),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ interaction: { id: "i1" } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        interaction: { id: "i1" },
        x402: {
          challenge: { present: true },
          authorization: { hasSignature: false },
          settlement: { present: false, success: null },
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
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        interaction: { id: "i1" },
        x402: {
          challenge: { present: true },
          authorization: { hasSignature: true },
          settlement: { present: false, success: null },
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
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        interaction: { id: "i1" },
        x402: {
          challenge: { present: false },
          authorization: { hasSignature: false },
          settlement: { present: true, success: false },
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
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        interaction: { id: "i1" },
        x402: {
          challenge: { present: false },
          authorization: { hasSignature: false },
          settlement: { present: true, success: null },
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
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        interaction: { id: "i1" },
        x402: {
          challenge: { present: false },
          authorization: { hasSignature: false },
          settlement: { present: false, success: null },
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
    );
    fetchMock.mockRejectedValueOnce(new Error("detail"));

    render(<App />);
    const interactionsList = await screen.findByRole("list");
    const viewButton = within(interactionsList).getByRole("button", { name: "View" });

    viewButton.click();
    expect(await screen.findByText("Download JSON")).toBeInTheDocument();
    const statusLabel = screen.getByText("Status");
    expect(statusLabel.parentElement?.querySelector("strong")).toHaveTextContent("unknown");
    expect(screen.getByText("Controls").parentElement?.querySelector("strong")).toHaveTextContent("—");
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("not-captured");

    viewButton.click();
    expect(await screen.findByText("Download JSON")).toBeInTheDocument();
    expect(screen.getByText("Controls").parentElement?.querySelector("strong")).toHaveTextContent("—");
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("challenge-only");

    viewButton.click();
    expect(await screen.findByText("Download JSON")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("authorized");

    viewButton.click();
    expect(await screen.findByText("Download JSON")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("settled");
    expect(screen.getByText("Settlement").parentElement?.querySelector("strong")).toHaveTextContent("failed");

    viewButton.click();
    expect(await screen.findByText("Download JSON")).toBeInTheDocument();
    expect(screen.getByText("Settlement").parentElement?.querySelector("strong")).toHaveTextContent("recorded");

    viewButton.click();
    expect(await screen.findByText("Download JSON")).toBeInTheDocument();
    expect(screen.getByText("x402 Handshake").parentElement?.querySelector("strong")).toHaveTextContent("not-captured");

    viewButton.click();
    expect(await screen.findByText(/Select an interaction/i)).toBeInTheDocument();
  });
});
