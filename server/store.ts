import { openDatabase } from "./db";
import type {
  AttestationRecord,
  BaseTransactionRecord,
  EvidenceRecord,
  InteractionRecord,
  LocusTransactionRecord,
  ReceiptRecord,
  SettlementRecord,
  TokenTransferRecord,
  WalletSnapshotRecord,
} from "./types";
import type { DatabaseConfig } from "./db";

export class Store {
  private db;

  constructor(config: DatabaseConfig) {
    this.db = openDatabase(config);
  }

  upsertInteraction(record: InteractionRecord) {
    const stmt = this.db.prepare(
      `insert into interactions (id, created_at, agent_id, wallet_address, counterparty, protocol, summary)
       values (@id, @created_at, @agent_id, @wallet_address, @counterparty, @protocol, @summary)
       on conflict(id) do update set summary=excluded.summary`,
    );
    stmt.run({
      ...record,
      summary: JSON.stringify(record.summary),
    });
  }

  upsertSettlement(record: SettlementRecord) {
    const stmt = this.db.prepare(
      `insert into settlements (id, interaction_id, tx_hash, chain_id, status, metadata)
       values (@id, @interaction_id, @tx_hash, @chain_id, @status, @metadata)
       on conflict(id) do update set status=excluded.status, metadata=excluded.metadata, tx_hash=excluded.tx_hash`,
    );
    stmt.run({
      ...record,
      metadata: JSON.stringify(record.metadata),
    });
  }

  upsertEvidence(records: EvidenceRecord[]) {
    const stmt = this.db.prepare(
      `insert into evidence (id, interaction_id, kind, payload, created_at)
       values (@id, @interaction_id, @kind, @payload, @created_at)
       on conflict(id) do update set payload=excluded.payload`,
    );
    const tx = this.db.transaction((rows: EvidenceRecord[]) => {
      for (const row of rows) {
        stmt.run({
          ...row,
          payload: JSON.stringify(row.payload),
        });
      }
    });
    tx(records);
  }

  upsertWalletSnapshot(record: WalletSnapshotRecord) {
    const stmt = this.db.prepare(
      `insert into wallet_snapshots (id, interaction_id, wallet_address, balance, allowance, max_tx, approvals_required, metadata, created_at)
       values (@id, @interaction_id, @wallet_address, @balance, @allowance, @max_tx, @approvals_required, @metadata, @created_at)
       on conflict(id) do update set metadata=excluded.metadata`,
    );
    stmt.run({
      ...record,
      approvals_required: record.approvals_required ? 1 : 0,
      metadata: JSON.stringify(record.metadata),
    });
  }

  upsertLocusTransactions(records: LocusTransactionRecord[]) {
    const stmt = this.db.prepare(
      `insert into locus_transactions (id, interaction_id, tx_hash, status, counterparty, amount, currency, created_at, raw)
       values (@id, @interaction_id, @tx_hash, @status, @counterparty, @amount, @currency, @created_at, @raw)
       on conflict(id) do update set status=excluded.status, raw=excluded.raw`,
    );
    const tx = this.db.transaction((rows: LocusTransactionRecord[]) => {
      for (const row of rows) {
        stmt.run({
          ...row,
          raw: JSON.stringify(row.raw),
        });
      }
    });
    tx(records);
  }

  upsertBaseTransaction(record: BaseTransactionRecord) {
    const stmt = this.db.prepare(
      `insert into base_transactions (tx_hash, status, block_number, from_address, to_address, value, raw, created_at)
       values (@tx_hash, @status, @block_number, @from_address, @to_address, @value, @raw, @created_at)
       on conflict(tx_hash) do update set status=excluded.status, raw=excluded.raw`,
    );
    stmt.run({
      tx_hash: record.tx_hash,
      status: record.status,
      block_number: record.block_number,
      from_address: record.from,
      to_address: record.to,
      value: record.value,
      raw: JSON.stringify(record.raw),
      created_at: record.created_at,
    });
  }

  upsertTokenTransfers(records: TokenTransferRecord[]) {
    const stmt = this.db.prepare(
      `insert into token_transfers (id, tx_hash, token_address, token_symbol, from_address, to_address, value, raw, created_at)
       values (@id, @tx_hash, @token_address, @token_symbol, @from_address, @to_address, @value, @raw, @created_at)
       on conflict(id) do update set raw=excluded.raw`,
    );
    const tx = this.db.transaction((rows: TokenTransferRecord[]) => {
      for (const row of rows) {
        stmt.run({
          ...row,
          raw: JSON.stringify(row.raw),
        });
      }
    });
    tx(records);
  }

  upsertAttestations(records: AttestationRecord[]) {
    const stmt = this.db.prepare(
      `insert into attestations (id, attester, recipient, schema_id, tx_hash, chain_id, raw, created_at)
       values (@id, @attester, @recipient, @schema_id, @tx_hash, @chain_id, @raw, @created_at)
       on conflict(id) do update set raw=excluded.raw`,
    );
    const tx = this.db.transaction((rows: AttestationRecord[]) => {
      for (const row of rows) {
        stmt.run({
          ...row,
          raw: JSON.stringify(row.raw),
        });
      }
    });
    tx(records);
  }

  upsertReceipts(records: ReceiptRecord[]) {
    const stmt = this.db.prepare(
      `insert into receipts (id, interaction_id, tx_hash, raw, created_at)
       values (@id, @interaction_id, @tx_hash, @raw, @created_at)
       on conflict(id) do update set raw=excluded.raw`,
    );
    const tx = this.db.transaction((rows: ReceiptRecord[]) => {
      for (const row of rows) {
        stmt.run({
          ...row,
          raw: JSON.stringify(row.raw),
        });
      }
    });
    tx(records);
  }

  listInteractions() {
    const rows = this.db.prepare("select * from interactions order by created_at desc").all() as Array<
      InteractionRecord & { summary: string }
    >;
    return rows.map((row) => ({ ...row, summary: JSON.parse(row.summary) }));
  }

  listInteractionsByWallet(wallet: string) {
    const rows = this.db
      .prepare("select * from interactions where wallet_address = ? order by created_at desc")
      .all(wallet) as Array<InteractionRecord & { summary: string }>;
    return rows.map((row) => ({ ...row, summary: JSON.parse(row.summary) }));
  }

  listInteractionsByCounterparty(counterparty: string) {
    const rows = this.db
      .prepare("select * from interactions where counterparty = ? order by created_at desc")
      .all(counterparty) as Array<InteractionRecord & { summary: string }>;
    return rows.map((row) => ({ ...row, summary: JSON.parse(row.summary) }));
  }

  getInteraction(id: string) {
    const row = this.db.prepare("select * from interactions where id = ?").get(id) as
      | (InteractionRecord & { summary: string })
      | undefined;
    if (!row) return undefined;
    return { ...row, summary: JSON.parse(row.summary) };
  }

  getEvidence(interactionId: string) {
    const rows = this.db.prepare("select * from evidence where interaction_id = ? order by created_at asc").all(
      interactionId,
    ) as Array<EvidenceRecord & { payload: string }>;
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }

  getWalletSnapshot(interactionId: string) {
    const row = this.db
      .prepare("select * from wallet_snapshots where interaction_id = ? order by created_at desc limit 1")
      .get(interactionId) as (WalletSnapshotRecord & { metadata: string }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      approvals_required: Boolean(row.approvals_required),
      metadata: JSON.parse(row.metadata),
    };
  }

  getSettlement(interactionId: string) {
    const row = this.db.prepare("select * from settlements where interaction_id = ?").get(interactionId) as
      | (SettlementRecord & { metadata: string })
      | undefined;
    if (!row) return undefined;
    return { ...row, metadata: JSON.parse(row.metadata) };
  }

  listBaseTransactionsByWallet(wallet: string) {
    const rows = this.db
      .prepare("select * from base_transactions where from_address = ? or to_address = ? order by created_at desc")
      .all(wallet, wallet) as Array<BaseTransactionRecord & { raw: string; from_address?: string; to_address?: string }>;
    return rows.map((row) => ({
      tx_hash: row.tx_hash,
      status: row.status,
      block_number: row.block_number,
      from: row.from_address,
      to: row.to_address,
      value: row.value,
      raw: JSON.parse(row.raw),
      created_at: row.created_at,
    }));
  }

  listTokenTransfersByWallet(wallet: string) {
    const rows = this.db
      .prepare("select * from token_transfers where from_address = ? or to_address = ? order by created_at desc")
      .all(wallet, wallet) as Array<TokenTransferRecord & { raw: string; from_address?: string; to_address?: string }>;
    return rows.map((row) => ({
      ...row,
      from: row.from_address,
      to: row.to_address,
      raw: JSON.parse(row.raw),
    }));
  }

  listAttestationsByWallet(wallet: string) {
    const rows = this.db
      .prepare("select * from attestations where attester = ? or recipient = ? order by created_at desc")
      .all(wallet, wallet) as Array<AttestationRecord & { raw: string }>;
    return rows.map((row) => ({ ...row, raw: JSON.parse(row.raw) }));
  }

  listReceiptsByInteraction(interactionId: string) {
    const rows = this.db
      .prepare("select * from receipts where interaction_id = ? order by created_at desc")
      .all(interactionId) as Array<ReceiptRecord & { raw: string }>;
    return rows.map((row) => ({ ...row, raw: JSON.parse(row.raw) }));
  }
}
