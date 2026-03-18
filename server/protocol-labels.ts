import type { ProtocolActivity } from "./dune";
import type { DuneClient } from "./dune";
import type {
  InteractionRecord,
  ProtocolAttribution,
  ProtocolCategory,
  ProtocolLabelRecord,
  SettlementRecord,
} from "./types";
import type { Store } from "./store";

type RefreshMode = "background" | "interaction";

type ProtocolAttempt = { source: "dune"; outcome: "matched"; detail?: Record<string, unknown> };

export type ProtocolRefreshResult =
  | { kind: "resolved"; refreshed: boolean; contractAddress: string; protocolLabel: ProtocolLabelRecord }
  | { kind: "missing_contract" }
  | { kind: "missing_enrichment_config"; contractAddress: string }
  | { kind: "unresolved"; contractAddress: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBaseTxRecord(settlement?: SettlementRecord) {
  const metadata = settlement?.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }

  const baseTx = metadata.baseTx;
  return isRecord(baseTx) ? baseTx : undefined;
}

function toIsoTime(value?: string) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeProtocolCategory(category?: string): ProtocolCategory {
  if (!category) return "other";

  const lower = category.toLowerCase();
  if (lower.includes("dex") || lower.includes("swap")) return "dex";
  if (lower.includes("bridge")) return "bridge";
  if (lower.includes("escrow")) return "escrow";
  if (lower.includes("lend") || lower.includes("borrow")) return "lending";
  if (lower.includes("stak")) return "staking";

  return "other";
}

export function resolveProtocolContract(store: Store, interaction: InteractionRecord): string | undefined {
  const settlement = store.getSettlement(interaction.id);
  const baseTx = getBaseTxRecord(settlement);
  const contractAddress = typeof baseTx?.to === "string" ? baseTx.to : interaction.counterparty;
  return typeof contractAddress === "string" ? contractAddress : undefined;
}

function resolveProtocolQueryAddress(store: Store, interaction: InteractionRecord) {
  const settlement = store.getSettlement(interaction.id);
  const baseTx = getBaseTxRecord(settlement);

  const candidates = [
    interaction.wallet_address,
    typeof baseTx?.from === "string" ? baseTx.from : undefined,
  ];

  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0);
}

function buildProtocolAttempts(activity: ProtocolActivity): ProtocolAttempt[] {
  return [
    {
      source: "dune",
      outcome: "matched",
      detail: {
        txHash: activity.txHash,
        blockTime: activity.blockTime,
        category: activity.category,
        amountUSD: activity.amountUSD,
      },
    },
  ];
}

export function buildProtocolLabelRecord(
  activity: ProtocolActivity,
  mode: RefreshMode,
  createdAt: string,
  attempts = buildProtocolAttempts(activity),
): ProtocolLabelRecord | null {
  if (!activity.contractAddress || !activity.protocolName) {
    return null;
  }

  const chainId = activity.chainId ?? 8453;
  const contractAddress = activity.contractAddress.toLowerCase();

  return {
    id: `${chainId}:${contractAddress}`,
    contract_address: contractAddress,
    chain_id: chainId,
    protocol_name: activity.protocolName,
    protocol_category: normalizeProtocolCategory(activity.category),
    source: "dune",
    metadata: {
      resolverVersion: "protocol-label/v1",
      refreshMode: mode,
      matchedBy: "contract",
      attempts,
      evidence: {
        txHash: activity.txHash,
        blockTime: activity.blockTime,
        amountUSD: activity.amountUSD,
        category: activity.category,
      },
    },
    created_at: createdAt,
  };
}

function findMatchingActivity(activities: ProtocolActivity[], contractAddress: string) {
  const contractLower = contractAddress.toLowerCase();
  return activities
    .filter((activity) => activity.contractAddress?.toLowerCase() === contractLower && (activity.chainId ?? 8453) === 8453)
    .map((activity) => ({
      activity,
      blockTime: toIsoTime(activity.blockTime),
      txHash: activity.txHash ?? "",
    }))
    .sort((left, right) => {
      const timeDiff = right.blockTime - left.blockTime;
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return right.txHash.localeCompare(left.txHash);
    })[0]?.activity;
}

export async function refreshProtocolLabelForInteraction(
  store: Store,
  interaction: InteractionRecord,
  duneClient?: DuneClient,
  createdAt = new Date().toISOString(),
): Promise<ProtocolRefreshResult> {
  const contractAddress = resolveProtocolContract(store, interaction);
  if (!contractAddress) {
    return { kind: "missing_contract" };
  }

  if (!duneClient) {
    return { kind: "missing_enrichment_config", contractAddress };
  }

  const queryAddress = resolveProtocolQueryAddress(store, interaction) ?? contractAddress;
  const startDate = new Date(Date.parse(interaction.created_at) - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const activities = await duneClient.getProtocolActivity(queryAddress, startDate);
    const match = findMatchingActivity(activities, contractAddress);
    if (!match) {
      return { kind: "unresolved", contractAddress };
    }

    const record = buildProtocolLabelRecord(match, "interaction", createdAt);
    if (!record) {
      return { kind: "unresolved", contractAddress };
    }

    store.upsertProtocolLabel(record);
    return {
      kind: "resolved",
      refreshed: true,
      contractAddress,
      protocolLabel: record,
    };
  } catch {
    return { kind: "unresolved", contractAddress };
  }
}

export function getProtocolAttribution(store: Store, interaction: InteractionRecord): {
  contractAddress?: string;
  label?: ProtocolLabelRecord;
  attribution?: ProtocolAttribution;
} {
  const contractAddress = resolveProtocolContract(store, interaction);
  if (!contractAddress) {
    return { contractAddress: undefined, label: undefined, attribution: undefined };
  }

  const label = store.getProtocolLabel(contractAddress, 8453);
  if (!label) {
    return { contractAddress, label: undefined, attribution: undefined };
  }

  return {
    contractAddress,
    label,
    attribution: {
      contract: contractAddress,
      name: label.protocol_name,
      category: label.protocol_category,
      source: label.source,
      labeledAt: label.created_at,
      metadata: label.metadata,
    },
  };
}
