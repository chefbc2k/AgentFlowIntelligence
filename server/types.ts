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
