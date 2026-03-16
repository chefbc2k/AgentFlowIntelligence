import { interactionIdFromParts, parseJsonHeader } from "./x402";
import { parsePeacReceipt } from "./peac";
import type { EvidenceRecord, InteractionRecord, SettlementRecord, WalletSnapshotRecord } from "./types";

export interface NormalizeInput {
  agentId?: string;
  counterparty?: string;
  walletAddress?: string;
  paymentHeaders: {
    paymentRequired?: string;
    paymentSignature?: string;
    paymentResponse?: string;
    peacReceipt?: string;
  };
  txHash?: string;
  locusMetadata?: Record<string, unknown>;
  walletSnapshot?: WalletSnapshotRecord;
}

export interface NormalizedBundle {
  interaction: InteractionRecord;
  settlement: SettlementRecord;
  evidence: EvidenceRecord[];
}

export function normalizeInteraction(input: NormalizeInput): NormalizedBundle {
  const createdAt = new Date().toISOString();
  const paymentRequired = parseJsonHeader(input.paymentHeaders.paymentRequired);
  const paymentSignature = parseJsonHeader(input.paymentHeaders.paymentSignature);
  const paymentResponse = parseJsonHeader(input.paymentHeaders.paymentResponse);
  const peacReceipt = parsePeacReceipt(input.paymentHeaders.peacReceipt);
  const interactionId = interactionIdFromParts([
    input.paymentHeaders.paymentRequired ?? "",
    input.paymentHeaders.paymentSignature ?? "",
    input.paymentHeaders.paymentResponse ?? "",
    input.txHash ?? "",
  ]);

  const interaction: InteractionRecord = {
    id: interactionId,
    created_at: createdAt,
    agent_id: input.agentId,
    wallet_address: input.walletAddress,
    counterparty: input.counterparty,
    protocol: "x402",
    summary: {
      paymentRequired,
      paymentSignature,
      paymentResponse,
      txHash: input.txHash,
    },
  };

  const settlement: SettlementRecord = {
    id: `${interactionId}:settlement`,
    interaction_id: interactionId,
    tx_hash: input.txHash,
    chain_id: 8453,
    status: input.txHash ? "pending" : "unknown",
    metadata: {
      locus: input.locusMetadata ?? null,
    },
  };

  const evidence: EvidenceRecord[] = [
    {
      id: `${interactionId}:x402`,
      interaction_id: interactionId,
      kind: "x402",
      created_at: createdAt,
      payload: {
        paymentRequired,
        paymentSignature,
        paymentResponse,
      },
    },
  ];

  if (input.locusMetadata) {
    evidence.push({
      id: `${interactionId}:locus`,
      interaction_id: interactionId,
      kind: "locus",
      created_at: createdAt,
      payload: input.locusMetadata,
    });
  }

  if (input.txHash) {
    evidence.push({
      id: `${interactionId}:tx`,
      interaction_id: interactionId,
      kind: "base",
      created_at: createdAt,
      payload: { txHash: input.txHash },
    });
  }

  if (peacReceipt) {
    evidence.push({
      id: `${interactionId}:peac`,
      interaction_id: interactionId,
      kind: "peac",
      created_at: createdAt,
      payload: {
        status: peacReceipt.status,
        decoded: peacReceipt.decoded ?? null,
        raw: peacReceipt.raw,
      },
    });
  }

  if (input.walletSnapshot) {
    evidence.push({
      id: `${interactionId}:wallet_snapshot`,
      interaction_id: interactionId,
      kind: "wallet_snapshot",
      created_at: createdAt,
      payload: {
        walletAddress: input.walletSnapshot.wallet_address,
        balance: input.walletSnapshot.balance,
        allowance: input.walletSnapshot.allowance,
        maxTx: input.walletSnapshot.max_tx,
        approvalsRequired: input.walletSnapshot.approvals_required,
        metadata: input.walletSnapshot.metadata,
      },
    });
  }

  return { interaction, settlement, evidence };
}

export interface NormalizeLocusInput {
  agentId?: string;
  walletAddress?: string;
  counterparty?: string;
  locusTx: Record<string, unknown>;
  txHash?: string;
  walletSnapshot?: WalletSnapshotRecord;
}

export function normalizeLocusInteraction(input: NormalizeLocusInput): NormalizedBundle {
  const createdAt = new Date().toISOString();
  const interactionId = interactionIdFromParts([
    String(input.locusTx.id ?? ""),
    input.txHash ?? "",
    String(input.locusTx.createdAt ?? ""),
  ]);

  const interaction: InteractionRecord = {
    id: interactionId,
    created_at: createdAt,
    agent_id: input.agentId,
    wallet_address: input.walletAddress,
    counterparty: input.counterparty,
    protocol: "locus",
    summary: {
      locusTx: input.locusTx,
      txHash: input.txHash,
    },
  };

  const settlement: SettlementRecord = {
    id: `${interactionId}:settlement`,
    interaction_id: interactionId,
    tx_hash: input.txHash,
    chain_id: 8453,
    status: input.txHash ? "pending" : "unknown",
    metadata: {
      locus: input.locusTx,
    },
  };

  const evidence: EvidenceRecord[] = [
    {
      id: `${interactionId}:locus`,
      interaction_id: interactionId,
      kind: "locus",
      created_at: createdAt,
      payload: input.locusTx,
    },
  ];

  if (input.txHash) {
    evidence.push({
      id: `${interactionId}:tx`,
      interaction_id: interactionId,
      kind: "base",
      created_at: createdAt,
      payload: { txHash: input.txHash },
    });
  }

  if (input.walletSnapshot) {
    evidence.push({
      id: `${interactionId}:wallet_snapshot`,
      interaction_id: interactionId,
      kind: "wallet_snapshot",
      created_at: createdAt,
      payload: {
        walletAddress: input.walletSnapshot.wallet_address,
        balance: input.walletSnapshot.balance,
        allowance: input.walletSnapshot.allowance,
        maxTx: input.walletSnapshot.max_tx,
        approvalsRequired: input.walletSnapshot.approvals_required,
        metadata: input.walletSnapshot.metadata,
      },
    });
  }

  return { interaction, settlement, evidence };
}
