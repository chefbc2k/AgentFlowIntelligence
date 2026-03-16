import type { InteractionRecord, WalletSnapshotRecord } from "./types";

export type ControlFacts = {
  amount: number | null;
  currency: string | null;
  approvalRequired: boolean | null;
  allowance: number | null;
  maxTx: number | null;
  withinAllowance: boolean | null;
  withinMaxTx: boolean | null;
  source: "wallet_snapshot" | "none";
};

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCurrency(summary: Record<string, unknown>): string | null {
  const locusTx = summary.locusTx as Record<string, unknown> | undefined;
  if (locusTx && typeof locusTx.currency === "string") return locusTx.currency;

  const paymentRequired = summary.paymentRequired as Record<string, unknown> | undefined;
  if (paymentRequired && typeof paymentRequired.asset === "string") return paymentRequired.asset;

  return null;
}

function extractAmount(summary: Record<string, unknown>): number | null {
  const locusTx = summary.locusTx as Record<string, unknown> | undefined;
  if (locusTx) {
    const parsed = parseFiniteNumber(locusTx.amount);
    if (parsed !== null) return parsed;
  }

  const paymentRequired = summary.paymentRequired as Record<string, unknown> | undefined;
  if (paymentRequired) {
    const parsed = parseFiniteNumber(paymentRequired.amount);
    if (parsed !== null) return parsed;
  }

  return null;
}

export function deriveControls(interaction: InteractionRecord, walletSnapshot?: WalletSnapshotRecord): ControlFacts {
  const summary = (interaction.summary ?? {}) as Record<string, unknown>;
  const amount = extractAmount(summary);
  const currency = extractCurrency(summary);

  const allowance = parseFiniteNumber(walletSnapshot?.allowance);
  const maxTx = parseFiniteNumber(walletSnapshot?.max_tx);

  const withinAllowance = amount !== null && allowance !== null ? amount <= allowance : null;
  const withinMaxTx = amount !== null && maxTx !== null ? amount <= maxTx : null;

  return {
    amount,
    currency,
    approvalRequired: walletSnapshot ? Boolean(walletSnapshot.approvals_required) : null,
    allowance,
    maxTx,
    withinAllowance,
    withinMaxTx,
    source: walletSnapshot ? "wallet_snapshot" : "none",
  };
}
