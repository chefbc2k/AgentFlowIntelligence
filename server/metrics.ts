import type { InteractionRecord, SettlementRecord } from "./types";
import type { Store } from "./store";
import type { PricingService } from "./pricing";
import { deriveControls } from "./controls";

function toDateBucket(iso: string) {
  return iso.slice(0, 10);
}

function toLower(value?: string) {
  return typeof value === "string" ? value.toLowerCase() : undefined;
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

function computeOnchainMetrics(store: Store, wallet: string) {
  const walletLower = wallet.toLowerCase();
  const baseTxs = store.listBaseTransactionsByWallet(wallet);
  const transfers = store.listTokenTransfersByWallet(wallet);

  const txStatus = { confirmed: 0, failed: 0, unknown: 0 };
  const txCounterparties = new Map<string, number>();
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
  }

  const txEntries = Array.from(txCounterparties.entries()).sort((a, b) => b[1] - a[1]);
  const topTxCounterparty = txEntries[0];

  const transferTokens = new Map<string, number>();
  let inboundTransfers = 0;
  let outboundTransfers = 0;
  for (const transfer of transfers) {
    const from = toLower(transfer.from);
    const to = toLower(transfer.to);
    if (to === walletLower && from !== walletLower) inboundTransfers += 1;
    else if (from === walletLower && to !== walletLower) outboundTransfers += 1;

    const token = transfer.token_symbol ?? transfer.token_address ?? "unknown";
    transferTokens.set(token, (transferTokens.get(token) ?? 0) + 1);
  }

  const tokenEntries = Array.from(transferTokens.entries()).sort((a, b) => b[1] - a[1]);
  const topToken = tokenEntries[0];
  const tokenTotal = transfers.length || 1;

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
      uniqueTokens: transferTokens.size,
      topToken: topToken ? { symbol: topToken[0], share: topToken[1] / tokenTotal } : null,
    },
  };
}

function computeControlsSummary(controls: Array<ReturnType<typeof deriveControls>>) {
  const approvalKnown = controls.filter((c) => c.approvalRequired !== null);
  const approvalRequired = approvalKnown.filter((c) => c.approvalRequired).length;

  const allowanceKnown = controls.filter((c) => c.withinAllowance !== null);
  const allowanceCompliant = allowanceKnown.filter((c) => c.withinAllowance).length;
  const allowanceOver = allowanceKnown.filter((c) => c.withinAllowance === false).length;

  const maxTxKnown = controls.filter((c) => c.withinMaxTx !== null);
  const maxTxCompliant = maxTxKnown.filter((c) => c.withinMaxTx).length;
  const maxTxOver = maxTxKnown.filter((c) => c.withinMaxTx === false).length;

  const eligible = controls.filter((c) => c.withinAllowance !== null || c.withinMaxTx !== null);
  const compliant = eligible.filter((c) => c.withinAllowance !== false && c.withinMaxTx !== false).length;

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

/**
 * Extract token address and chain ID from interaction
 */
function extractTokenInfo(interaction: InteractionRecord): { address: string; chainId: number } | null {
  const summary = interaction.summary ?? {};
  const paymentRequired = (summary as Record<string, unknown>).paymentRequired as Record<string, unknown> | undefined;

  if (paymentRequired) {
    const asset = paymentRequired.asset;
    const chainId = toChainId(paymentRequired.network);

    if (typeof asset === "string" && chainId !== null) {
      return { address: asset, chainId };
    }
  }

  // Default to USDC on Base if no payment info
  return { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453 };
}

/**
 * SOLVES PROBLEM 1: USD Normalization
 * Enriches interactions with USD-normalized payment amounts
 */
export async function enrichWithPricing(
  interactions: InteractionRecord[],
  pricingService: PricingService | null,
): Promise<Array<InteractionRecord & { amountUSD: number | null }>> {
  if (!pricingService) {
    return interactions.map((i) => ({ ...i, amountUSD: null }));
  }

  const enriched: Array<InteractionRecord & { amountUSD: number | null }> = [];

  for (const interaction of interactions) {
    const rawAmount = extractAmount(interaction);

    if (rawAmount === null) {
      enriched.push({ ...interaction, amountUSD: null });
      continue;
    }

    const tokenInfo = extractTokenInfo(interaction);
    if (!tokenInfo) {
      enriched.push({ ...interaction, amountUSD: null });
      continue;
    }

    const amountUSD = await pricingService.normalizeToUSD(
      rawAmount,
      tokenInfo.address,
      tokenInfo.chainId,
    );

    enriched.push({ ...interaction, amountUSD });
  }

  return enriched;
}

/**
 * SOLVES PROBLEM 2: Protocol Semantics
 * Enriches interactions with protocol labels (DEX, bridge, escrow, etc.)
 */
export function enrichWithProtocolLabels(
  interactions: InteractionRecord[],
  store: Store,
): Array<InteractionRecord & { protocolName?: string; protocolCategory?: string }> {
  const enriched: Array<InteractionRecord & { protocolName?: string; protocolCategory?: string }> = [];

  for (const interaction of interactions) {
    const settlement = store.getSettlement(interaction.id);

    // Try to get contract address from settlement or counterparty
    let contractAddress: string | undefined;

    if (settlement?.metadata) {
      const baseTx = (settlement.metadata as Record<string, unknown>).baseTx as Record<string, unknown> | undefined;
      contractAddress = baseTx?.to as string | undefined;
    }

    if (!contractAddress && interaction.counterparty) {
      contractAddress = interaction.counterparty;
    }

    if (!contractAddress) {
      enriched.push({ ...interaction });
      continue;
    }

    // Lookup protocol label
    const label = store.getProtocolLabel(contractAddress, 8453);

    enriched.push({
      ...interaction,
      protocolName: label?.protocol_name,
      protocolCategory: label?.protocol_category,
    });
  }

  return enriched;
}

/**
 * SOLVES PROBLEM 2: Compute protocol diversity metrics
 */
function computeProtocolMetrics(
  enrichedInteractions: Array<InteractionRecord & { protocolName?: string; protocolCategory?: string }>,
  store: Store,
) {
  const protocols = enrichedInteractions
    .map((i) => i.protocolName)
    .filter((name): name is string => name !== undefined && name !== null);

  const categories = enrichedInteractions
    .map((i) => i.protocolCategory)
    .filter((cat): cat is string => cat !== undefined && cat !== null);

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
  for (const [category, count] of categoryCounts) {
    categoryBreakdown[category] = count;
  }

  // Compute escrow completion rate (if we have escrow interactions)
  const escrowInteractions = enrichedInteractions.filter((i) => i.protocolCategory === "escrow");
  const escrowSettlements = escrowInteractions
    .map((interaction) => store.getSettlement(interaction.id))
    .filter((settlement): settlement is SettlementRecord => settlement !== undefined);
  const escrowCompleted = escrowSettlements.filter((settlement) => settlement.status === "confirmed").length;
  const escrowCompletionRate =
    escrowSettlements.length > 0 ? escrowCompleted / escrowSettlements.length : null;

  // Compute staking metrics (if we have staking interactions)
  const stakingInteractions = enrichedInteractions.filter((i) => i.protocolCategory === "staking");
  const stakingSettlements = stakingInteractions
    .map((interaction) => store.getSettlement(interaction.id))
    .filter((settlement): settlement is SettlementRecord => settlement !== undefined);
  const stakingMetrics =
    stakingInteractions.length > 0
      ? {
          staked: stakingInteractions.length,
          slashed: stakingSettlements.filter((settlement) => settlement.status === "failed").length,
        }
      : null;

  return {
    uniqueProtocols: protocolCounts.size,
    topProtocol: topProtocol ? { name: topProtocol[0], share: topProtocol[1] / enrichedInteractions.length } : null,
    categoryBreakdown,
    escrowCompletionRate,
    stakingMetrics,
  };
}

export function computeAgentMetrics(store: Store, wallet: string) {
  const interactions = store.listInteractionsByWallet(wallet);
  const settlements = interactions.map((i) => store.getSettlement(i.id));
  const evidenceCounts = interactions.map((i) => store.getEvidence(i.id).length);
  const receiptCounts = interactions.map((i) => store.listReceiptsByInteraction(i.id).length);
  const attestationCount = new Set(store.listAttestationsByWallet(wallet).map((row) => row.id)).size;
  const onchain = computeOnchainMetrics(store, wallet);

  const controlFacts = interactions.map((i) => deriveControls(i, store.getWalletSnapshot(i.id)));
  const controls = computeControlsSummary(controlFacts);

  const receiptAvailability = {
    total: interactions.length,
    withReceipt: receiptCounts.filter((count) => count > 0).length,
    rate: interactions.length > 0 ? receiptCounts.filter((count) => count > 0).length / interactions.length : 0,
  };

  const settlementLatenciesSeconds = interactions
    .map((interaction) => {
      const settlement = store.getSettlement(interaction.id);
      if (!settlement?.tx_hash || settlement.status !== "confirmed") return null;
      const baseTx = store.getBaseTransaction(settlement.tx_hash);
      if (!baseTx) return null;
      const created = Date.parse(interaction.created_at);
      const confirmed = Date.parse(baseTx.created_at);
      if (!Number.isFinite(created) || !Number.isFinite(confirmed)) return null;
      return Math.max(0, (confirmed - created) / 1000);
    })
    .filter((value): value is number => value !== null);

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

  // SOLVES PROBLEM 1: USD Normalization
  const amountsUSD = interactions
    .map((interaction) => {
      const rawAmount = extractAmount(interaction);
      if (rawAmount === null) return null;

      const tokenInfo = extractTokenInfo(interaction);
      if (!tokenInfo) return null;

      const price = store.getLatestPrice(tokenInfo.address, tokenInfo.chainId);
      if (!price) return null;

      const priceUSD = Number(price.price_usd);
      if (!Number.isFinite(priceUSD)) return null;

      return rawAmount * priceUSD;
    })
    .filter((value): value is number => value !== null);

  const totalVolumeUSD = amountsUSD.reduce((sum, v) => sum + v, 0);

  // SOLVES PROBLEM 2: Protocol Semantics
  const enrichedWithProtocols = enrichWithProtocolLabels(interactions, store);
  const protocolActivity = computeProtocolMetrics(enrichedWithProtocols, store);

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
    paymentBehaviorUSD: { ...summarizeAmounts(amountsUSD), totalVolumeUSD },
    protocolActivity,
    settlement: settlementStats,
    settlementLatency: summarizeSeconds(settlementLatenciesSeconds),
    controls,
    receiptAvailability,
    evidenceDensity,
    onchain,
  };
}

export function computeCounterpartyMetrics(store: Store, counterparty: string) {
  const interactions = store.listInteractionsByCounterparty(counterparty);
  const settlements = interactions.map((i) => store.getSettlement(i.id));
  const controlFacts = interactions.map((i) => deriveControls(i, store.getWalletSnapshot(i.id)));
  const controls = computeControlsSummary(controlFacts);
  const receiptCounts = interactions.map((i) => store.listReceiptsByInteraction(i.id).length);
  const receiptAvailability = {
    total: interactions.length,
    withReceipt: receiptCounts.filter((count) => count > 0).length,
    rate: interactions.length > 0 ? receiptCounts.filter((count) => count > 0).length / interactions.length : 0,
  };

  const settlementLatenciesSeconds = interactions
    .map((interaction) => {
      const settlement = store.getSettlement(interaction.id);
      if (!settlement?.tx_hash || settlement.status !== "confirmed") return null;
      const baseTx = store.getBaseTransaction(settlement.tx_hash);
      if (!baseTx) return null;
      const created = Date.parse(interaction.created_at);
      const confirmed = Date.parse(baseTx.created_at);
      if (!Number.isFinite(created) || !Number.isFinite(confirmed)) return null;
      return Math.max(0, (confirmed - created) / 1000);
    })
    .filter((value): value is number => value !== null);

  const amounts = interactions
    .map((interaction) => extractAmount(interaction))
    .filter((value): value is number => value !== null);

  // SOLVES PROBLEM 1: USD Normalization
  const amountsUSD = interactions
    .map((interaction) => {
      const rawAmount = extractAmount(interaction);
      if (rawAmount === null) return null;

      const tokenInfo = extractTokenInfo(interaction);
      if (!tokenInfo) return null;

      const price = store.getLatestPrice(tokenInfo.address, tokenInfo.chainId);
      if (!price) return null;

      const priceUSD = Number(price.price_usd);
      if (!Number.isFinite(priceUSD)) return null;

      return rawAmount * priceUSD;
    })
    .filter((value): value is number => value !== null);

  const totalVolumeUSD = amountsUSD.reduce((sum, v) => sum + v, 0);

  // SOLVES PROBLEM 2: Protocol Semantics
  const enrichedWithProtocols = enrichWithProtocolLabels(interactions, store);
  const protocolActivity = computeProtocolMetrics(enrichedWithProtocols, store);

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
    paymentBehaviorUSD: { ...summarizeAmounts(amountsUSD), totalVolumeUSD },
    protocolActivity,
    fulfillment: settlementStats,
    settlementLatency: summarizeSeconds(settlementLatenciesSeconds),
    controls,
    receiptAvailability,
  };
}
