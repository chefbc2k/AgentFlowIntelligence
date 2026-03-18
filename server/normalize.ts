import {
  buildX402Packet,
  decodePaymentPayload,
  decodePaymentRequired,
  decodeSettlementResponse,
  extractSettlementSuccess,
  extractSettlementTxHash,
  interactionIdFromParts,
} from "./x402";
import { parsePeacReceipt } from "./peac";
import { deriveControls } from "./controls";
import type { EvidenceRecord, InteractionRecord, SettlementRecord, WalletSnapshotRecord, X402Transcript } from "./types";

export interface NormalizeInput {
  agentId?: string;
  counterparty?: string;
  service?: string;
  walletAddress?: string;
  url?: string;
  paymentHeaders: {
    paymentRequired?: string;
    paymentSignature?: string;
    paymentResponse?: string;
    peacReceipt?: string;
  };
  transcript?: X402Transcript;
  txHash?: string;
  locusMetadata?: Record<string, unknown>;
  walletSnapshot?: WalletSnapshotRecord;
}

export interface NormalizedBundle {
  interaction: InteractionRecord;
  settlement: SettlementRecord;
  evidence: EvidenceRecord[];
}

function inferServiceFromUrl(raw?: string): { counterparty?: string; service?: string } {
  if (!raw) return {};
  try {
    const url = new URL(raw);
    return {
      counterparty: url.hostname === "" ? undefined : url.hostname,
      service: url.pathname,
    };
  } catch {
    return {};
  }
}

function inferServiceFromLocusMetadata(metadata?: Record<string, unknown>): { counterparty?: string; service?: string } {
  if (!metadata) return {};
  const provider = metadata.provider;
  const endpoint = metadata.endpoint;
  if (typeof provider === "string" && typeof endpoint === "string") {
    return { counterparty: provider, service: endpoint };
  }
  const slug = metadata.slug;
  if (typeof slug === "string") {
    return { service: slug };
  }
  return {};
}

function mergeTranscriptHeaders(input: NormalizeInput["paymentHeaders"], transcript?: X402Transcript) {
  return {
    paymentRequired: input.paymentRequired ?? transcript?.challenge?.headers.paymentRequired ?? transcript?.settlement?.headers.paymentRequired,
    paymentSignature: input.paymentSignature ?? transcript?.authorization?.paymentSignature ?? transcript?.settlement?.headers.paymentSignature,
    paymentResponse: input.paymentResponse ?? transcript?.settlement?.headers.paymentResponse,
    peacReceipt: input.peacReceipt ?? transcript?.settlement?.headers.peacReceipt ?? transcript?.challenge?.headers.peacReceipt,
  };
}

export function normalizeInteraction(input: NormalizeInput): NormalizedBundle {
  const createdAt = new Date().toISOString();
  const paymentHeaders = mergeTranscriptHeaders(input.paymentHeaders, input.transcript);
  const paymentRequired = decodePaymentRequired(paymentHeaders.paymentRequired);
  const paymentSignature = decodePaymentPayload(paymentHeaders.paymentSignature);
  const paymentResponse = decodeSettlementResponse(paymentHeaders.paymentResponse);
  const peacReceipt = parsePeacReceipt(paymentHeaders.peacReceipt);
  const inferredTxHash = extractSettlementTxHash(paymentResponse);
  const txHash = input.txHash ?? inferredTxHash;
  const settlementSuccess = extractSettlementSuccess(paymentResponse);
  const x402 = buildX402Packet(paymentHeaders, { txHash });
  const urlHints = inferServiceFromUrl(input.url ?? input.transcript?.requestUrl);
  const locusHints = inferServiceFromLocusMetadata(input.locusMetadata);
  const counterparty = input.counterparty ?? urlHints.counterparty ?? locusHints.counterparty;
  const service = input.service ?? urlHints.service ?? locusHints.service;
  const interactionId = interactionIdFromParts([
    paymentHeaders.paymentRequired ?? "",
    paymentHeaders.paymentSignature ?? "",
    paymentHeaders.paymentResponse ?? "",
    txHash ?? "",
  ]);

  const interaction: InteractionRecord = {
    id: interactionId,
    created_at: createdAt,
    agent_id: input.agentId,
    wallet_address: input.walletAddress,
    counterparty,
    service,
    protocol: "x402",
    summary: {
      paymentRequired,
      paymentSignature,
      paymentResponse,
      txHash,
      x402,
      x402Transcript: input.transcript,
    },
  };

  interaction.summary.controls = deriveControls(interaction, input.walletSnapshot);

  const settlementStatus: SettlementRecord["status"] =
    settlementSuccess === false ? "failed" : txHash ? "pending" : "unknown";

  const settlement: SettlementRecord = {
    id: `${interactionId}:settlement`,
    interaction_id: interactionId,
    tx_hash: txHash,
    chain_id: 8453,
    status: settlementStatus,
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
        transcript: input.transcript,
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

  if (txHash) {
    evidence.push({
      id: `${interactionId}:tx`,
      interaction_id: interactionId,
      kind: "base",
      created_at: createdAt,
      payload: { txHash },
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
  service?: string;
  locusTx: Record<string, unknown>;
  txHash?: string;
  walletSnapshot?: WalletSnapshotRecord;
  actionKey?: string;
  createdAt?: string;
}

function inferServiceFromLocusTx(locusTx: Record<string, unknown>): { counterparty?: string; service?: string } {
  const provider = locusTx.provider;
  const endpoint = locusTx.endpoint;
  if (typeof provider === "string" && typeof endpoint === "string") {
    return { counterparty: provider, service: endpoint };
  }
  const slug = locusTx.slug;
  if (typeof slug === "string") {
    return { service: slug };
  }
  return {};
}

export function normalizeLocusInteraction(input: NormalizeLocusInput): NormalizedBundle {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const hints = inferServiceFromLocusTx(input.locusTx);
  const counterparty = input.counterparty ?? hints.counterparty;
  const service = input.service ?? hints.service;
  const interactionId = interactionIdFromParts([
    String(input.locusTx.id ?? ""),
    input.txHash ?? "",
    String(input.locusTx.createdAt ?? createdAt),
    input.actionKey ?? "",
  ]);

  const interaction: InteractionRecord = {
    id: interactionId,
    created_at: createdAt,
    agent_id: input.agentId,
    wallet_address: input.walletAddress,
    counterparty,
    service,
    protocol: "locus",
    summary: {
      locusTx: input.locusTx,
      txHash: input.txHash,
    },
  };

  interaction.summary.controls = deriveControls(interaction, input.walletSnapshot);

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
