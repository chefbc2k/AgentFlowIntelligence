export interface InteractionRecord {
  id: string;
  created_at: string;
  agent_id?: string;
  wallet_address?: string;
  counterparty?: string;
  service?: string;
  protocol: "x402" | "locus";
  summary: Record<string, unknown>;
}

export interface SettlementRecord {
  id: string;
  interaction_id: string;
  tx_hash?: string;
  chain_id?: number;
  status: "pending" | "confirmed" | "failed" | "unknown";
  metadata: Record<string, unknown>;
}

export interface EvidenceRecord {
  id: string;
  interaction_id: string;
  kind: "x402" | "locus" | "base" | "receipt" | "eas" | "peac" | "locus_tx" | "base_tx" | "wallet_snapshot";
  payload: Record<string, unknown>;
  created_at: string;
}

export interface X402PaymentRequired {
  amount?: string;
  asset?: string;
  network?: string;
  payTo?: string;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface X402PaymentPayload {
  signature?: string;
  payer?: string;
  network?: string;
  [key: string]: unknown;
}

export interface X402SettlementResponse {
  success?: boolean;
  transaction?: string | { hash?: string; [key: string]: unknown };
  txHash?: string;
  tx?: string;
  hash?: string;
  network?: string;
  payer?: string;
  payTo?: string;
  error?: string;
  reason?: string;
  message?: string;
  [key: string]: unknown;
}

export interface DecodedX402Section<TDecoded> {
  present: boolean;
  raw?: string;
  decoded?: TDecoded;
}

export interface X402Correlation {
  txHash?: string;
  network?: string;
  payer?: string;
  payTo?: string;
  success: boolean | null;
  reason?: string;
}

export interface X402Packet {
  challenge: DecodedX402Section<X402PaymentRequired>;
  authorization: DecodedX402Section<X402PaymentPayload> & { hasSignature: boolean };
  settlement: DecodedX402Section<X402SettlementResponse> & X402Correlation;
}

export interface X402TranscriptStep {
  status: number;
  headers: {
    paymentRequired?: string;
    paymentSignature?: string;
    paymentResponse?: string;
    peacReceipt?: string;
  };
}

export interface X402Transcript {
  requestUrl: string;
  challenge?: X402TranscriptStep;
  authorization?: {
    paymentSignature?: string;
  };
  settlement?: X402TranscriptStep;
}

export interface AfiPacketReferences {
  wallet?: { address: string; explorerUrl: string };
  counterparty?: { id: string; explorerUrl?: string };
  service?: string;
  transaction?: { txHash: string; explorerUrl: string };
  protocol?: { name?: string; category?: string; contract?: string };
}

export type BehaviorFlagSeverity = "low" | "medium" | "high";

export type BehaviorFlagKey =
  | "high_counterparty_concentration"
  | "high_payment_volatility"
  | "high_settlement_latency"
  | "high_failure_rate"
  | "burst_activity"
  | "new_counterparty_surge"
  | "thin_evidence"
  | "control_friction";

export interface BehaviorFlag {
  key: BehaviorFlagKey;
  label: string;
  severity: BehaviorFlagSeverity;
  value: number;
  threshold: number;
  direction: "above" | "below";
  explanation: string;
}

export interface BehaviorContribution {
  key:
    | "burstiness"
    | "counterparty_concentration"
    | "settlement_failure_rate"
    | "control_friction"
    | "evidence_density"
    | "settlement_latency"
    | "payment_volatility"
    | "new_counterparty_rate";
  label: string;
  value: number;
  impact: number;
  explanation: string;
}

export interface BehaviorFeatureHighlights {
  txCount7d: number;
  txCount30d: number;
  uniqueCounterparties30d: number;
  topCounterpartyShare30d: number;
  totalVolumeUsd30d: number;
  avgPaymentUsd30d: number;
  paymentSizeCv30d: number;
  avgLatencySeconds30d: number;
  settlementFailureRate30d: number;
  hourlyBurstRatio24h: number;
  newCounterpartyRate7d: number;
  evidenceDensity: number;
  controlFailureRate: number;
}

export interface BehaviorModelProvenance {
  source: "afi_heuristic";
  computedAt: string;
  observationWindowDays: number;
  featureSource: "sqlite_runtime";
  modelVersion: string;
}

export type BehaviorClusterLabel =
  | "steady_operator"
  | "bursty_explorer"
  | "concentrated_power_user"
  | "high_value_settler"
  | "emerging_wallet";

export interface WalletBehaviorModel {
  wallet: string;
  anomaly: {
    score: number;
    normalizedScore: number;
    label: "normal" | "elevated" | "anomalous";
    explanation: string;
  };
  cluster: {
    id: BehaviorClusterLabel;
    label: BehaviorClusterLabel;
    explanation: string;
  };
  flags: BehaviorFlag[];
  topSignals: BehaviorContribution[];
  features: BehaviorFeatureHighlights;
  provenance: BehaviorModelProvenance;
}

export type ProtocolCategory = "dex" | "bridge" | "escrow" | "lending" | "staking" | "other";
export type ProtocolLabelSource = "dune" | "graph" | "defillama";

export interface ProtocolAttribution {
  contract?: string;
  name?: string;
  category?: ProtocolCategory;
  source: ProtocolLabelSource;
  labeledAt: string;
  metadata: Record<string, unknown>;
}

export interface AfiPacketSummary {
  handshakeStatus: "complete" | "challenge-only" | "authorized" | "settled" | "not-captured";
  controlStatus: "within-limits" | "over-limit" | "unknown";
  settlementStatus: string;
  receiptCount: number;
  attestationCount: number;
  evidenceKinds: string[];
}

export interface AfiPacketReceipt {
  id: string;
  created_at: string;
  tx_hash?: string;
  status: string;
  decoded?: unknown;
  raw: unknown;
}

export interface AfiPacketAttestation {
  id: string;
  attester?: string;
  recipient?: string;
  schemaId?: string;
  txHash?: string;
  chainId?: number;
  created_at: string;
  raw: Record<string, unknown>;
}

export interface AfiPacketProtocol {
  kind: InteractionRecord["protocol"];
  x402?: {
    packet: X402Packet;
    transcript?: X402Transcript;
  };
  locus?: {
    transaction?: Record<string, unknown>;
  };
}

export interface AfiPacketCorrelations {
  settlement?: SettlementRecord;
  baseTransaction?: BaseTransactionRecord;
  walletSnapshot?: WalletSnapshotRecord;
  protocolLabel?: ProtocolAttribution;
}

export interface AfiPacketProvenance {
  source: "afi";
  interactionId: string;
  exportRoute: string;
  schemaVersion: "afi.packet/v1";
}

export interface AfiPacketV1 {
  version: "afi.packet/v1";
  exportedAt: string;
  interaction: InteractionRecord & {
    amountUSD?: number | null;
    protocolName?: string;
    protocolCategory?: string;
    protocolContract?: string;
    protocolLabel?: ProtocolAttribution;
  };
  controls: {
    amount: number | null;
    currency: string | null;
    approvalRequired: boolean | null;
    withinAllowance: boolean | null;
    withinMaxTx: boolean | null;
    source: string;
  };
  protocol: AfiPacketProtocol;
  evidence: {
    timeline: EvidenceRecord[];
    receipts: AfiPacketReceipt[];
    attestations: AfiPacketAttestation[];
  };
  correlations: AfiPacketCorrelations;
  provenance: AfiPacketProvenance;
  summary: AfiPacketSummary;
  references: AfiPacketReferences;
}

export interface WalletSnapshotRecord {
  id: string;
  interaction_id: string;
  wallet_address?: string;
  balance?: string;
  allowance?: string;
  max_tx?: string;
  approvals_required?: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface LocusTransactionRecord {
  id: string;
  interaction_id?: string;
  tx_hash?: string;
  status?: string;
  counterparty?: string;
  amount?: string;
  currency?: string;
  created_at?: string;
  raw: Record<string, unknown>;
}

export interface BaseTransactionRecord {
  tx_hash: string;
  status: "confirmed" | "failed" | "unknown";
  block_number?: string;
  from?: string;
  to?: string;
  value?: string;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface TokenTransferRecord {
  id: string;
  tx_hash?: string;
  token_address?: string;
  token_symbol?: string;
  from?: string;
  to?: string;
  value?: string;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface AttestationRecord {
  id: string;
  attester?: string;
  recipient?: string;
  schema_id?: string;
  tx_hash?: string;
  chain_id?: number;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface ReceiptRecord {
  id: string;
  interaction_id?: string;
  tx_hash?: string;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface PriceRecord {
  id: string;
  token_address: string;
  chain_id: number;
  symbol?: string;
  price_usd: string;
  source: "coingecko" | "defillama";
  timestamp: string;
  raw: Record<string, unknown>;
}

export interface ProtocolLabelRecord {
  id: string;
  contract_address: string;
  chain_id: number;
  protocol_name?: string;
  protocol_category?: ProtocolCategory;
  source: ProtocolLabelSource;
  metadata: Record<string, unknown>;
  created_at: string;
}
