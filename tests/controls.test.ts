import { describe, expect, it } from "vitest";
import { deriveControls } from "../server/controls";
import type { InteractionRecord, WalletSnapshotRecord } from "../server/types";

describe("controls", () => {
  it("derives numeric amount + currency from locus summary", () => {
    const interaction: InteractionRecord = {
      id: "i1",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "locus",
      summary: { locusTx: { amount: 2, currency: "USDC" } },
    };
    const snapshot: WalletSnapshotRecord = {
      id: "ws1",
      interaction_id: "i1",
      allowance: "1",
      max_tx: "3",
      approvals_required: false,
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    };

    expect(deriveControls(interaction, snapshot)).toEqual(
      expect.objectContaining({
        amount: 2,
        currency: "USDC",
        withinAllowance: false,
        withinMaxTx: true,
        source: "wallet_snapshot",
      }),
    );
  });

  it("derives amount + asset from x402 paymentRequired and tolerates non-numeric limits", () => {
    const interaction: InteractionRecord = {
      id: "i2",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: { paymentRequired: { amount: "1.5", asset: "USDC" } },
    };
    const snapshot: WalletSnapshotRecord = {
      id: "ws2",
      interaction_id: "i2",
      allowance: "not-a-number",
      max_tx: "Infinity",
      approvals_required: true,
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    };

    expect(deriveControls(interaction, snapshot)).toEqual(
      expect.objectContaining({
        amount: 1.5,
        currency: "USDC",
        approvalRequired: true,
        withinAllowance: null,
        withinMaxTx: null,
      }),
    );
  });

  it("handles missing summaries and snapshots", () => {
    const interaction: InteractionRecord = {
      id: "i3",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: {},
    };
    expect(deriveControls(interaction)).toEqual(
      expect.objectContaining({
        amount: null,
        currency: null,
        approvalRequired: null,
        withinAllowance: null,
        withinMaxTx: null,
        source: "none",
      }),
    );
  });

  it("falls back when locus amount is non-finite", () => {
    const interaction: InteractionRecord = {
      id: "i4",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: { locusTx: { amount: Number.POSITIVE_INFINITY }, paymentRequired: { amount: "1" } },
    };

    expect(deriveControls(interaction).amount).toBe(1);
  });
});
