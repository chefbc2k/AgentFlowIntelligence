import { deriveControls } from "./controls";
import { enrichInteractionForReadModel } from "./metrics";
import type {
  AfiPacketV1,
  AttestationRecord,
  BaseTransactionRecord,
  EvidenceRecord,
  InteractionRecord,
  ReceiptRecord,
  SettlementRecord,
  WalletSnapshotRecord,
  X402Packet,
  X402Transcript,
} from "./types";
import type { Store } from "./store";

export const AFI_PACKET_SCHEMA_VERSION = "afi.packet/v1" as const;

type InteractionContext = {
  evidence: EvidenceRecord[];
  settlement?: SettlementRecord;
  baseTransaction?: BaseTransactionRecord;
  walletSnapshot?: WalletSnapshotRecord;
  controls: ReturnType<typeof deriveControls>;
  x402?: X402Packet;
  transcript?: X402Transcript;
  receipts: ReceiptRecord[];
  attestations: AttestationRecord[];
};

function dedupeById<T extends { id: string }>(rows: T[]) {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExplorableReference(value?: string) {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

function toAddressReference(value?: string) {
  if (!value) return undefined;
  return {
    id: value,
    explorerUrl: isExplorableReference(value) ? `https://basescan.org/address/${value}` : undefined,
  };
}

function inferTxHash(interaction: InteractionRecord, settlement?: SettlementRecord) {
  if (settlement?.tx_hash) return settlement.tx_hash;
  const summary = interaction.summary as Record<string, unknown>;
  const x402 = isRecord(summary.x402) ? summary.x402 : undefined;
  const x402Settlement = x402 && isRecord(x402.settlement) ? x402.settlement : undefined;
  return typeof x402Settlement?.txHash === "string"
    ? x402Settlement.txHash
    : typeof summary.txHash === "string"
      ? summary.txHash
      : undefined;
}

function getHandshakeStatus(packet?: X402Packet) {
  if (!packet) return "not-captured" as const;
  if (packet.challenge.present && packet.authorization.hasSignature && packet.settlement.present) return "complete" as const;
  if (packet.challenge.present && !packet.authorization.hasSignature) return "challenge-only" as const;
  if (packet.authorization.hasSignature && !packet.settlement.present) return "authorized" as const;
  if (packet.settlement.present) return "settled" as const;
  return "not-captured" as const;
}

function getControlStatus(controls: ReturnType<typeof deriveControls>) {
  if (controls.withinAllowance === null && controls.withinMaxTx === null) return "unknown" as const;
  if (controls.withinAllowance === false || controls.withinMaxTx === false) return "over-limit" as const;
  return "within-limits" as const;
}

function getCorrelatedReceipts(store: Store, interactionId: string, txHash?: string) {
  return dedupeById([...store.listReceiptsByInteraction(interactionId), ...(txHash ? store.listReceiptsByTxHash(txHash) : [])]);
}

function getCorrelatedAttestations(store: Store, interaction: InteractionRecord, txHash?: string) {
  return dedupeById([
    ...(interaction.wallet_address ? store.listAttestationsByWallet(interaction.wallet_address) : []),
    ...(txHash ? store.listAttestationsByTxHash(txHash) : []),
  ]);
}

function flattenReceipt(receipt: ReceiptRecord) {
  const payload = isRecord(receipt.raw) ? receipt.raw : {};
  return {
    id: receipt.id,
    created_at: receipt.created_at,
    tx_hash: receipt.tx_hash,
    status: typeof payload.status === "string" ? payload.status : "raw",
    decoded: Object.prototype.hasOwnProperty.call(payload, "decoded") ? payload.decoded : undefined,
    raw: Object.prototype.hasOwnProperty.call(payload, "raw") ? payload.raw : receipt.raw,
  };
}

function flattenAttestation(attestation: AttestationRecord) {
  return {
    id: attestation.id,
    attester: attestation.attester,
    recipient: attestation.recipient,
    schemaId: attestation.schema_id,
    txHash: attestation.tx_hash,
    chainId: attestation.chain_id,
    created_at: attestation.created_at,
    raw: attestation.raw,
  };
}

export function buildInteractionContext(store: Store, interaction: InteractionRecord): InteractionContext {
  const settlement = store.getSettlement(interaction.id);
  const txHash = inferTxHash(interaction, settlement);
  const baseTransaction = txHash ? store.getBaseTransaction(txHash) : undefined;
  const walletSnapshot = store.getWalletSnapshot(interaction.id);
  const controls = deriveControls(interaction, walletSnapshot);
  const summary = interaction.summary as Record<string, unknown>;
  const x402 = interaction.protocol === "x402" && isRecord(summary.x402) ? (summary.x402 as unknown as X402Packet) : undefined;
  const transcript =
    interaction.protocol === "x402" && isRecord(summary.x402Transcript ?? summary.transcript)
      ? ((summary.x402Transcript ?? summary.transcript) as unknown as X402Transcript)
      : undefined;

  return {
    evidence: store.getEvidence(interaction.id),
    settlement,
    baseTransaction,
    walletSnapshot,
    controls,
    x402,
    transcript,
    receipts: getCorrelatedReceipts(store, interaction.id, txHash),
    attestations: getCorrelatedAttestations(store, interaction, txHash),
  };
}

export function buildPortableInteractionPacket(
  store: Store,
  interaction: InteractionRecord,
  exportedAt = new Date().toISOString(),
): AfiPacketV1 {
  const enrichedInteraction = enrichInteractionForReadModel(store, interaction);
  const context = buildInteractionContext(store, interaction);
  const summary = interaction.summary as Record<string, unknown>;
  const settlementTxHash = context.settlement?.tx_hash ?? context.baseTransaction?.tx_hash ?? inferTxHash(interaction, context.settlement);
  const receipts = context.receipts.map(flattenReceipt);
  const attestations = context.attestations.map(flattenAttestation);

  return {
    version: AFI_PACKET_SCHEMA_VERSION,
    exportedAt,
    interaction: enrichedInteraction,
    controls: context.controls,
    protocol: {
      kind: interaction.protocol,
      x402: context.x402
        ? {
            packet: context.x402,
            transcript: context.transcript,
          }
        : undefined,
      locus:
        interaction.protocol === "locus"
          ? {
              transaction: isRecord(summary.locusTx) ? summary.locusTx : undefined,
            }
          : undefined,
    },
    evidence: Object.assign([...context.evidence], {
      timeline: context.evidence,
      receipts,
      attestations,
    }),
    correlations: {
      settlement: context.settlement,
      baseTransaction: context.baseTransaction,
      walletSnapshot: context.walletSnapshot,
    },
    provenance: {
      source: "afi",
      interactionId: interaction.id,
      exportRoute: `/api/interactions/${interaction.id}/packet`,
      schemaVersion: AFI_PACKET_SCHEMA_VERSION,
    },
    summary: {
      handshakeStatus: getHandshakeStatus(context.x402),
      controlStatus: getControlStatus(context.controls),
      settlementStatus: context.settlement?.status ?? "unknown",
      receiptCount: context.receipts.length,
      attestationCount: context.attestations.length,
      evidenceKinds: Array.from(new Set(context.evidence.map((row) => row.kind))).sort(),
    },
    references: {
      wallet: enrichedInteraction.wallet_address
        ? { address: enrichedInteraction.wallet_address, explorerUrl: `https://basescan.org/address/${enrichedInteraction.wallet_address}` }
        : undefined,
      counterparty: toAddressReference(enrichedInteraction.counterparty),
      service: enrichedInteraction.service,
      transaction: settlementTxHash ? { txHash: settlementTxHash, explorerUrl: `https://basescan.org/tx/${settlementTxHash}` } : undefined,
      protocol:
        enrichedInteraction.protocolName || enrichedInteraction.protocolCategory || enrichedInteraction.protocolContract
          ? {
              name: enrichedInteraction.protocolName,
              category: enrichedInteraction.protocolCategory,
              contract: enrichedInteraction.protocolContract,
            }
          : undefined,
    },
  } as AfiPacketV1;
}
