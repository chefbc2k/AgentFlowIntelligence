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
