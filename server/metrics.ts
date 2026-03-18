import type { InteractionRecord, SettlementRecord } from "./types";
import type { Store } from "./store";
import type { PricingService } from "./pricing";
import { deriveControls } from "./controls";
import { getProtocolAttribution } from "./protocol-labels";

export type EnrichedInteractionRecord = InteractionRecord & {
  amountUSD: number | null;
  protocolName?: string;
  protocolCategory?: string;
  protocolContract?: string;
  protocolLabel?: import("./types").ProtocolAttribution;
};

function toDateBucket(iso: string) {
  return iso.slice(0, 10);
}

function toLower(value?: string) {
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function toChainId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseNumericString(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
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

function summarizeUsdAmounts(amounts: number[]) {
  return {
    ...summarizeAmounts(amounts),
    totalVolumeUSD: amounts.reduce((sum, value) => sum + value, 0),
  };
}

function summarizeSeconds(values: number[]) {
  if (values.length === 0) {
    return { total: 0, avgSeconds: 0, minSeconds: 0, maxSeconds: 0, medianSeconds: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianSeconds = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const totalSeconds = values.reduce((sum, v) => sum + v, 0);

  return {
    total: values.length,
    avgSeconds: totalSeconds / values.length,
    minSeconds: sorted[0],
    maxSeconds: sorted[sorted.length - 1],
    medianSeconds,
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

function extractTokenInfo(interaction: InteractionRecord): { address: string; chainId: number } | null {
  const summary = interaction.summary ?? {};
  const paymentRequired = (summary as Record<string, unknown>).paymentRequired as Record<string, unknown> | undefined;

  if (!paymentRequired) {
    return null;
  }

  const asset = paymentRequired.asset;
  const chainId = toChainId(paymentRequired.network);

  if (typeof asset === "string" && chainId !== null) {
    return { address: asset, chainId };
  }

  return null;
}

function settlementSuccessRate(settlements: Array<SettlementRecord | undefined>) {
  const filtered = settlements.filter(isDefined);
  if (filtered.length === 0) return { total: 0, successRate: 0 };
  const success = filtered.filter((settlement) => settlement.status === "confirmed").length;
  return { total: filtered.length, successRate: success / filtered.length };
}

function getStoredAmountUSD(store: Store, interaction: InteractionRecord): number | null {
  const rawAmount = extractAmount(interaction);
  const tokenInfo = extractTokenInfo(interaction);
  if (rawAmount === null || tokenInfo === null) {
    return null;
  }

  const price = store.getLatestPrice(tokenInfo.address, tokenInfo.chainId);
  const priceUSD = price ? parseNumericString(price.price_usd) : null;
  if (priceUSD === null) {
    return null;
  }

  return rawAmount * priceUSD;
}

export function enrichInteractionForReadModel(store: Store, interaction: InteractionRecord): EnrichedInteractionRecord {
  const { contractAddress, label, attribution } = getProtocolAttribution(store, interaction);

  return {
    ...interaction,
    amountUSD: getStoredAmountUSD(store, interaction),
    protocolName: label?.protocol_name,
    protocolCategory: label?.protocol_category,
    protocolContract: contractAddress,
    protocolLabel: attribution,
  };
}

function computeControlsSummary(controls: Array<ReturnType<typeof deriveControls>>) {
  const approvalKnown = controls.filter((control) => control.approvalRequired !== null);
  const approvalRequired = approvalKnown.filter((control) => control.approvalRequired).length;

  const allowanceKnown = controls.filter((control) => control.withinAllowance !== null);
  const allowanceCompliant = allowanceKnown.filter((control) => control.withinAllowance).length;
  const allowanceOver = allowanceKnown.filter((control) => control.withinAllowance === false).length;

  const maxTxKnown = controls.filter((control) => control.withinMaxTx !== null);
  const maxTxCompliant = maxTxKnown.filter((control) => control.withinMaxTx).length;
  const maxTxOver = maxTxKnown.filter((control) => control.withinMaxTx === false).length;

  const eligible = controls.filter((control) => control.withinAllowance !== null || control.withinMaxTx !== null);
  const compliant = eligible.filter((control) => control.withinAllowance !== false && control.withinMaxTx !== false).length;

  return {
    approvals: {
      total: approvalKnown.length,
      required: approvalRequired,
      rate: approvalKnown.length > 0 ? approvalRequired / approvalKnown.length : 0,
    },
    allowance: {
      total: allowanceKnown.length,
      compliant: allowanceCompliant,
      overLimit: allowanceOver,
      rate: allowanceKnown.length > 0 ? allowanceCompliant / allowanceKnown.length : 0,
    },
    maxTx: {
      total: maxTxKnown.length,
      compliant: maxTxCompliant,
      overLimit: maxTxOver,
      rate: maxTxKnown.length > 0 ? maxTxCompliant / maxTxKnown.length : 0,
    },
    overall: {
      total: eligible.length,
      compliant,
      rate: eligible.length > 0 ? compliant / eligible.length : 0,
    },
  };
}

function computeOnchainMetrics(store: Store, wallet: string) {
  const walletLower = wallet.toLowerCase();
  const baseTxs = store.listBaseTransactionsByWallet(wallet);
  const transfers = store.listTokenTransfersByWallet(wallet);

  const txStatus = { confirmed: 0, failed: 0, unknown: 0 };
  const txCounterparties = new Map<string, number>();
  const protocolCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  for (const tx of baseTxs) {
    if (tx.status === "confirmed") txStatus.confirmed += 1;
    else if (tx.status === "failed") txStatus.failed += 1;
    else txStatus.unknown += 1;

    const from = toLower(tx.from);
    const to = toLower(tx.to);
    const counterparty = from === walletLower ? to : to === walletLower ? from : undefined;
    if (counterparty) {
      txCounterparties.set(counterparty, (txCounterparties.get(counterparty) ?? 0) + 1);
    }

    if (typeof tx.to === "string") {
      const label = store.getProtocolLabel(tx.to, 8453);
      if (label?.protocol_name) {
        protocolCounts.set(label.protocol_name, (protocolCounts.get(label.protocol_name) ?? 0) + 1);
      }
      if (label?.protocol_category) {
        categoryCounts.set(label.protocol_category, (categoryCounts.get(label.protocol_category) ?? 0) + 1);
      }
    }
  }

  const transferTokens = new Map<string, number>();
  let inboundTransfers = 0;
  let outboundTransfers = 0;
  let inboundVolumeUSD = 0;
  let outboundVolumeUSD = 0;

  for (const transfer of transfers) {
    const from = toLower(transfer.from);
    const to = toLower(transfer.to);
    const isInbound = to === walletLower && from !== walletLower;
    const isOutbound = from === walletLower && to !== walletLower;

    if (isInbound) inboundTransfers += 1;
    else if (isOutbound) outboundTransfers += 1;

    const token = transfer.token_symbol ?? transfer.token_address ?? "unknown";
    transferTokens.set(token, (transferTokens.get(token) ?? 0) + 1);

    const price = transfer.token_address ? store.getLatestPrice(transfer.token_address, 8453) : undefined;
    const priceUSD = price ? parseNumericString(price.price_usd) : null;
    const amount = parseNumericString(transfer.value);
    const volumeUSD = amount !== null && priceUSD !== null ? amount * priceUSD : null;

    if (volumeUSD !== null) {
      if (isInbound) inboundVolumeUSD += volumeUSD;
      if (isOutbound) outboundVolumeUSD += volumeUSD;
    }
  }

  const txEntries = Array.from(txCounterparties.entries()).sort((a, b) => b[1] - a[1]);
  const topTxCounterparty = txEntries[0];
  const tokenEntries = Array.from(transferTokens.entries()).sort((a, b) => b[1] - a[1]);
  const topToken = tokenEntries[0];
  const tokenTotal = transfers.length || 1;
  const protocolEntries = Array.from(protocolCounts.entries()).sort((a, b) => b[1] - a[1]);
  const topProtocol = protocolEntries[0];

  const categoryBreakdown: Record<string, number> = {};
  for (const [category, count] of categoryCounts.entries()) {
    categoryBreakdown[category] = count;
  }

  return {
    transactions: {
      total: baseTxs.length,
      ...txStatus,
      uniqueCounterparties: txCounterparties.size,
      topCounterparty: topTxCounterparty ? { address: topTxCounterparty[0], share: topTxCounterparty[1] / baseTxs.length } : null,
    },
    tokenTransfers: {
      total: transfers.length,
      inbound: inboundTransfers,
      outbound: outboundTransfers,
      inboundVolumeUSD,
      outboundVolumeUSD,
      totalVolumeUSD: inboundVolumeUSD + outboundVolumeUSD,
      uniqueTokens: transferTokens.size,
      topToken: topToken ? { symbol: topToken[0], share: topToken[1] / tokenTotal } : null,
    },
    protocols: {
      unique: protocolCounts.size,
      topProtocol: topProtocol ? { name: topProtocol[0], share: topProtocol[1] / baseTxs.length } : null,
      categoryBreakdown,
    },
  };
}

export async function enrichWithPricing(
  interactions: InteractionRecord[],
  pricingService: PricingService | null,
): Promise<Array<InteractionRecord & { amountUSD: number | null }>> {
  if (!pricingService) {
    return interactions.map((interaction) => ({ ...interaction, amountUSD: null }));
  }

  const enriched: Array<InteractionRecord & { amountUSD: number | null }> = [];

  for (const interaction of interactions) {
    const rawAmount = extractAmount(interaction);
    const tokenInfo = extractTokenInfo(interaction);
    if (rawAmount === null || tokenInfo === null) {
      enriched.push({ ...interaction, amountUSD: null });
      continue;
    }

    const amountUSD = await pricingService.normalizeToUSD(rawAmount, tokenInfo.address, tokenInfo.chainId);
    enriched.push({ ...interaction, amountUSD });
  }

  return enriched;
}

export function enrichWithProtocolLabels(interactions: InteractionRecord[], store: Store): EnrichedInteractionRecord[] {
  return interactions.map((interaction) => enrichInteractionForReadModel(store, interaction));
}

function computeProtocolMetrics(enrichedInteractions: EnrichedInteractionRecord[], store: Store) {
  const protocols = enrichedInteractions.map((interaction) => interaction.protocolName).filter(isDefined);
  const categories = enrichedInteractions.map((interaction) => interaction.protocolCategory).filter(isDefined);

  const protocolCounts = new Map<string, number>();
  for (const protocol of protocols) {
    protocolCounts.set(protocol, (protocolCounts.get(protocol) ?? 0) + 1);
  }

  const categoryCounts = new Map<string, number>();
  for (const category of categories) {
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  const protocolEntries = Array.from(protocolCounts.entries()).sort((a, b) => b[1] - a[1]);
  const topProtocol = protocolEntries[0];

  const categoryBreakdown: Record<string, number> = {};
  for (const [category, count] of categoryCounts.entries()) {
    categoryBreakdown[category] = count;
  }

  const escrowSettlements = enrichedInteractions
    .filter((interaction) => interaction.protocolCategory === "escrow")
    .map((interaction) => store.getSettlement(interaction.id))
    .filter(isDefined);
  const escrowCompleted = escrowSettlements.filter((settlement) => settlement.status === "confirmed").length;

  const stakingInteractions = enrichedInteractions.filter((interaction) => interaction.protocolCategory === "staking");
  const stakingSettlements = stakingInteractions
    .map((interaction) => store.getSettlement(interaction.id))
    .filter(isDefined);

  return {
    uniqueProtocols: protocolCounts.size,
    topProtocol: topProtocol ? { name: topProtocol[0], share: topProtocol[1] / enrichedInteractions.length } : null,
    categoryBreakdown,
    escrowCompletionRate: escrowSettlements.length > 0 ? escrowCompleted / escrowSettlements.length : null,
    stakingMetrics:
      stakingInteractions.length > 0
        ? {
            staked: stakingInteractions.length,
            slashed: stakingSettlements.filter((settlement) => settlement.status === "failed").length,
          }
        : null,
  };
}

function computeSettlementLatencies(store: Store, interactions: InteractionRecord[]) {
  return interactions
    .map((interaction) => {
      const settlement = store.getSettlement(interaction.id);
      if (!settlement?.tx_hash || settlement.status !== "confirmed") {
        return null;
      }

      const baseTx = store.getBaseTransaction(settlement.tx_hash);
      if (!baseTx) {
        return null;
      }

      const created = Date.parse(interaction.created_at);
      const confirmed = Date.parse(baseTx.created_at);
      if (!Number.isFinite(created) || !Number.isFinite(confirmed)) {
        return null;
      }

      return Math.max(0, (confirmed - created) / 1000);
    })
    .filter(isDefined);
}

function computeAmountSeries(store: Store, interactions: InteractionRecord[]) {
  return {
    raw: interactions.map((interaction) => extractAmount(interaction)).filter(isDefined),
    usd: interactions.map((interaction) => getStoredAmountUSD(store, interaction)).filter(isDefined),
  };
}

function computeCounterpartyStats(interactions: InteractionRecord[]) {
  const counterparties = new Map<string, number>();
  for (const interaction of interactions) {
    const key = interaction.counterparty ?? "unknown";
    counterparties.set(key, (counterparties.get(key) ?? 0) + 1);
  }

  const entries = Array.from(counterparties.entries()).sort((a, b) => b[1] - a[1]);
  const top = entries[0];

  return {
    unique: counterparties.size,
    top: top ? { id: top[0], share: top[1] / interactions.length } : null,
    repeatRate: interactions.length > 0 ? (interactions.length - counterparties.size) / interactions.length : 0,
  };
}

export function computeAgentMetrics(store: Store, wallet: string) {
  const interactions = store.listInteractionsByWallet(wallet);
  const settlements = interactions.map((interaction) => store.getSettlement(interaction.id));
  const evidenceCounts = interactions.map((interaction) => store.getEvidence(interaction.id).length);
  const receiptCounts = interactions.map((interaction) => store.listReceiptsByInteraction(interaction.id).length);
  const attestationCount = new Set(store.listAttestationsByWallet(wallet).map((row) => row.id)).size;
  const onchain = computeOnchainMetrics(store, wallet);
  const controls = computeControlsSummary(interactions.map((interaction) => deriveControls(interaction, store.getWalletSnapshot(interaction.id))));
  const settlementLatency = summarizeSeconds(computeSettlementLatencies(store, interactions));
  const paymentAmounts = computeAmountSeries(store, interactions);
  const enrichedInteractions = enrichWithProtocolLabels(interactions, store);
  const protocolActivity = computeProtocolMetrics(enrichedInteractions, store);

  const createdAtSorted = interactions.map((interaction) => interaction.created_at).sort();
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
  const evidenceTotal =
    evidenceCounts.reduce((sum, value) => sum + value, 0) +
    receiptCounts.reduce((sum, value) => sum + value, 0) +
    attestationCount;

  return {
    wallet,
    lifecycle: { firstSeen, lastSeen, ageDays },
    throughput: {
      totalInteractions: interactions.length,
      dailyCounts,
      burstiness: coefficientOfVariation(dailyCounts),
    },
    counterparty: computeCounterpartyStats(interactions),
    paymentBehavior: summarizeAmounts(paymentAmounts.raw),
    paymentBehaviorUSD: summarizeUsdAmounts(paymentAmounts.usd),
    protocolActivity,
    settlement: settlementSuccessRate(settlements),
    settlementLatency,
    controls,
    receiptAvailability: {
      total: interactions.length,
      withReceipt: receiptCounts.filter((count) => count > 0).length,
      rate: interactions.length > 0 ? receiptCounts.filter((count) => count > 0).length / interactions.length : 0,
    },
    evidenceDensity: interactions.length > 0 ? evidenceTotal / interactions.length : 0,
    onchain,
  };
}

export function computeCounterpartyMetrics(store: Store, counterparty: string) {
  const interactions = store.listInteractionsByCounterparty(counterparty);
  const settlements = interactions.map((interaction) => store.getSettlement(interaction.id));
  const receiptCounts = interactions.map((interaction) => store.listReceiptsByInteraction(interaction.id).length);
  const paymentAmounts = computeAmountSeries(store, interactions);
  const enrichedInteractions = enrichWithProtocolLabels(interactions, store);
  const protocolActivity = computeProtocolMetrics(enrichedInteractions, store);

  const wallets = new Map<string, number>();
  for (const interaction of interactions) {
    const key = interaction.wallet_address ?? "unknown";
    wallets.set(key, (wallets.get(key) ?? 0) + 1);
  }

  return {
    counterparty,
    volume: {
      totalInteractions: interactions.length,
      uniqueWallets: wallets.size,
    },
    paymentBehavior: summarizeAmounts(paymentAmounts.raw),
    paymentBehaviorUSD: summarizeUsdAmounts(paymentAmounts.usd),
    protocolActivity,
    fulfillment: settlementSuccessRate(settlements),
    settlementLatency: summarizeSeconds(computeSettlementLatencies(store, interactions)),
    controls: computeControlsSummary(
      interactions.map((interaction) => deriveControls(interaction, store.getWalletSnapshot(interaction.id))),
    ),
    receiptAvailability: {
      total: interactions.length,
      withReceipt: receiptCounts.filter((count) => count > 0).length,
      rate: interactions.length > 0 ? receiptCounts.filter((count) => count > 0).length / interactions.length : 0,
    },
  };
}
