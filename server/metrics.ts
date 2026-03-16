import type { InteractionRecord, SettlementRecord } from "./types";
import type { Store } from "./store";

function toDateBucket(iso: string) {
  return iso.slice(0, 10);
}

function coefficientOfVariation(values: number[]) {
  const mean = values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function summarizeAmounts(amounts: number[]) {
  if (amounts.length === 0) {
    return { count: 0, avg: 0, min: 0, max: 0, median: 0 };
  }
  const sorted = [...amounts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const total = amounts.reduce((sum, v) => sum + v, 0);
  return {
    count: amounts.length,
    avg: total / amounts.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
  };
}

function extractAmount(interaction: InteractionRecord): number | null {
  const summary = interaction.summary ?? {};
  const locusTx = (summary as Record<string, unknown>).locusTx as Record<string, unknown> | undefined;
  if (locusTx && typeof locusTx.amount === "string") {
    const parsed = Number(locusTx.amount);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const paymentRequired = (summary as Record<string, unknown>).paymentRequired as Record<string, unknown> | undefined;
  if (paymentRequired && typeof paymentRequired.amount === "string") {
    const parsed = Number(paymentRequired.amount);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function settlementSuccessRate(settlements: Array<SettlementRecord | undefined>) {
  const filtered = settlements.filter(Boolean) as SettlementRecord[];
  if (filtered.length === 0) return { total: 0, successRate: 0 };
  const success = filtered.filter((s) => s.status === "confirmed").length;
  return { total: filtered.length, successRate: success / filtered.length };
}

export function computeAgentMetrics(store: Store, wallet: string) {
  const interactions = store.listInteractionsByWallet(wallet);
  const settlements = interactions.map((i) => store.getSettlement(i.id));
  const evidenceCounts = interactions.map((i) => store.getEvidence(i.id).length);
  const receiptCounts = interactions.map((i) => store.listReceiptsByInteraction(i.id).length);
  const attestationCount = new Set(store.listAttestationsByWallet(wallet).map((row) => row.id)).size;

  const createdAtSorted = interactions.map((i) => i.created_at).sort();
  const firstSeen = createdAtSorted[0];
  const lastSeen = createdAtSorted[createdAtSorted.length - 1];
  const ageDays =
    firstSeen && lastSeen ? (Date.parse(lastSeen) - Date.parse(firstSeen)) / (1000 * 60 * 60 * 24) : 0;

  const buckets = new Map<string, number>();
  for (const interaction of interactions) {
    const bucket = toDateBucket(interaction.created_at);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }

  const dailyCounts = Array.from(buckets.values());
  const burstiness = coefficientOfVariation(dailyCounts);

  const counterparties = new Map<string, number>();
  for (const interaction of interactions) {
    const key = interaction.counterparty ?? "unknown";
    counterparties.set(key, (counterparties.get(key) ?? 0) + 1);
  }

  const counterpartyEntries = Array.from(counterparties.entries()).sort((a, b) => b[1] - a[1]);
  const topCounterparty = counterpartyEntries[0];
  const totalCounterparty = interactions.length || 1;

  const amounts = interactions
    .map((interaction) => extractAmount(interaction))
    .filter((value): value is number => value !== null);

  const settlementStats = settlementSuccessRate(settlements);

  const evidenceTotal =
    evidenceCounts.reduce((sum, v) => sum + v, 0) + receiptCounts.reduce((sum, v) => sum + v, 0) + attestationCount;
  const evidenceDensity = interactions.length > 0 ? evidenceTotal / interactions.length : 0;

  return {
    wallet,
    lifecycle: { firstSeen, lastSeen, ageDays },
    throughput: { totalInteractions: interactions.length, dailyCounts, burstiness },
    counterparty: {
      unique: counterparties.size,
      top: topCounterparty ? { id: topCounterparty[0], share: topCounterparty[1] / totalCounterparty } : null,
      repeatRate: interactions.length > 0 ? (interactions.length - counterparties.size) / interactions.length : 0,
    },
    paymentBehavior: summarizeAmounts(amounts),
    settlement: settlementStats,
    evidenceDensity,
  };
}

export function computeCounterpartyMetrics(store: Store, counterparty: string) {
  const interactions = store.listInteractionsByCounterparty(counterparty);
  const settlements = interactions.map((i) => store.getSettlement(i.id));

  const amounts = interactions
    .map((interaction) => extractAmount(interaction))
    .filter((value): value is number => value !== null);

  const settlementStats = settlementSuccessRate(settlements);

  const wallets = new Map<string, number>();
  for (const interaction of interactions) {
    const key = interaction.wallet_address ?? "unknown";
    wallets.set(key, (wallets.get(key) ?? 0) + 1);
  }

  return {
    counterparty,
    volume: { totalInteractions: interactions.length, uniqueWallets: wallets.size },
    paymentBehavior: summarizeAmounts(amounts),
    fulfillment: settlementStats,
  };
}
