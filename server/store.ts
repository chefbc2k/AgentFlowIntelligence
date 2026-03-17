import { openDatabase } from "./db";
import type {
  AttestationRecord,
  BaseTransactionRecord,
  EvidenceRecord,
  InteractionRecord,
  LocusTransactionRecord,
  PriceRecord,
  ProtocolLabelRecord,
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
      `insert into interactions (id, created_at, agent_id, wallet_address, counterparty, service, protocol, summary)
       values (@id, @created_at, @agent_id, @wallet_address, @counterparty, @service, @protocol, @summary)
       on conflict(id) do update set agent_id=excluded.agent_id, wallet_address=excluded.wallet_address, counterparty=excluded.counterparty, service=excluded.service, protocol=excluded.protocol, summary=excluded.summary`,
    );
    stmt.run({
      id: record.id,
      created_at: record.created_at,
      agent_id: record.agent_id ?? null,
      wallet_address: record.wallet_address ?? null,
      counterparty: record.counterparty ?? null,
      service: record.service ?? null,
      protocol: record.protocol,
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
      id: record.id,
      interaction_id: record.interaction_id,
      tx_hash: record.tx_hash ?? null,
      chain_id: record.chain_id ?? null,
      status: record.status,
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
      id: record.id,
      interaction_id: record.interaction_id,
      wallet_address: record.wallet_address ?? null,
      balance: record.balance ?? null,
      allowance: record.allowance ?? null,
      max_tx: record.max_tx ?? null,
      approvals_required: record.approvals_required ? 1 : 0,
      metadata: JSON.stringify(record.metadata),
      created_at: record.created_at,
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
          id: row.id,
          interaction_id: row.interaction_id ?? null,
          tx_hash: row.tx_hash ?? null,
          status: row.status ?? null,
          counterparty: row.counterparty ?? null,
          amount: row.amount ?? null,
          currency: row.currency ?? null,
          created_at: row.created_at ?? null,
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
      block_number: record.block_number ?? null,
      from_address: record.from ?? null,
      to_address: record.to ?? null,
      value: record.value ?? null,
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
          id: row.id,
          tx_hash: row.tx_hash ?? null,
          token_address: row.token_address ?? null,
          token_symbol: row.token_symbol ?? null,
          from_address: row.from ?? null,
          to_address: row.to ?? null,
          value: row.value ?? null,
          created_at: row.created_at,
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
          id: row.id,
          attester: row.attester ?? null,
          recipient: row.recipient ?? null,
          schema_id: row.schema_id ?? null,
          tx_hash: row.tx_hash ?? null,
          chain_id: row.chain_id ?? null,
          created_at: row.created_at,
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
          id: row.id,
          interaction_id: row.interaction_id ?? null,
          tx_hash: row.tx_hash ?? null,
          created_at: row.created_at,
          raw: JSON.stringify(row.raw),
        });
      }
    });
    tx(records);
  }

  listInteractions() {
    const rows = this.db.prepare("select * from interactions order by created_at desc").all() as unknown as Array<
      InteractionRecord & { summary: string }
    >;
    return rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      agent_id: row.agent_id ?? undefined,
      wallet_address: row.wallet_address ?? undefined,
      counterparty: row.counterparty ?? undefined,
      service: row.service ?? undefined,
      protocol: row.protocol,
      summary: JSON.parse(row.summary) as InteractionRecord["summary"],
    }));
  }

  listInteractionsByWallet(wallet: string) {
    const rows = this.db
      .prepare("select * from interactions where wallet_address = ? order by created_at desc")
      .all(wallet) as unknown as Array<InteractionRecord & { summary: string }>;
    return rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      agent_id: row.agent_id ?? undefined,
      wallet_address: wallet,
      counterparty: row.counterparty ?? undefined,
      service: row.service ?? undefined,
      protocol: row.protocol,
      summary: JSON.parse(row.summary) as InteractionRecord["summary"],
    }));
  }

  listInteractionsByCounterparty(counterparty: string) {
    const rows = this.db
      .prepare("select * from interactions where counterparty = ? order by created_at desc")
      .all(counterparty) as unknown as Array<InteractionRecord & { summary: string }>;
    return rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      agent_id: row.agent_id ?? undefined,
      wallet_address: row.wallet_address ?? undefined,
      counterparty,
      service: row.service ?? undefined,
      protocol: row.protocol,
      summary: JSON.parse(row.summary) as InteractionRecord["summary"],
    }));
  }

  getInteraction(id: string) {
    const row = this.db.prepare("select * from interactions where id = ?").get(id) as unknown as
      | (InteractionRecord & { summary: string })
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      created_at: row.created_at,
      agent_id: row.agent_id ?? undefined,
      wallet_address: row.wallet_address ?? undefined,
      counterparty: row.counterparty ?? undefined,
      service: row.service ?? undefined,
      protocol: row.protocol,
      summary: JSON.parse(row.summary) as InteractionRecord["summary"],
    };
  }

  getEvidence(interactionId: string) {
    const rows = this.db.prepare("select * from evidence where interaction_id = ? order by created_at asc").all(
      interactionId,
    ) as unknown as Array<EvidenceRecord & { payload: string }>;
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }

  getWalletSnapshot(interactionId: string) {
    const row = this.db
      .prepare("select * from wallet_snapshots where interaction_id = ? order by created_at desc limit 1")
      .get(interactionId) as unknown as (WalletSnapshotRecord & { metadata: string }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      wallet_address: row.wallet_address ?? undefined,
      balance: row.balance ?? undefined,
      allowance: row.allowance ?? undefined,
      max_tx: row.max_tx ?? undefined,
      approvals_required: Boolean(row.approvals_required),
      metadata: JSON.parse(row.metadata) as WalletSnapshotRecord["metadata"],
    };
  }

  getSettlement(interactionId: string) {
    const row = this.db.prepare("select * from settlements where interaction_id = ?").get(interactionId) as unknown as
      | (SettlementRecord & { metadata: string })
      | undefined;
    if (!row) return undefined;
    return {
      ...row,
      tx_hash: row.tx_hash ?? undefined,
      chain_id: row.chain_id ?? undefined,
      metadata: JSON.parse(row.metadata) as SettlementRecord["metadata"],
    };
  }

  getBaseTransaction(txHash: string) {
    const row = this.db.prepare("select * from base_transactions where tx_hash = ?").get(txHash) as unknown as
      | (BaseTransactionRecord & { raw: string; from_address?: string; to_address?: string })
      | undefined;
    if (!row) return undefined;
    return {
      tx_hash: row.tx_hash,
      status: row.status,
      block_number: row.block_number ?? undefined,
      from: row.from_address ?? undefined,
      to: row.to_address ?? undefined,
      value: row.value ?? undefined,
      raw: JSON.parse(row.raw),
      created_at: row.created_at,
    };
  }

  listBaseTransactionsByWallet(wallet: string) {
    const rows = this.db
      .prepare(
        "select * from base_transactions where lower(from_address) = lower(?) or lower(to_address) = lower(?) order by created_at desc",
      )
      .all(wallet, wallet) as unknown as Array<
      BaseTransactionRecord & { raw: string; from_address?: string; to_address?: string }
    >;
    return rows.map((row) => ({
      tx_hash: row.tx_hash,
      status: row.status,
      block_number: row.block_number ?? undefined,
      from: row.from_address ?? undefined,
      to: row.to_address ?? undefined,
      value: row.value ?? undefined,
      raw: JSON.parse(row.raw),
      created_at: row.created_at,
    }));
  }

  listTokenTransfersByWallet(wallet: string) {
    const rows = this.db
      .prepare(
        "select * from token_transfers where lower(from_address) = lower(?) or lower(to_address) = lower(?) order by created_at desc",
      )
      .all(wallet, wallet) as unknown as Array<
      TokenTransferRecord & { raw: string; from_address?: string; to_address?: string }
    >;
    return rows.map((row) => ({
      id: row.id,
      tx_hash: row.tx_hash ?? undefined,
      token_address: row.token_address ?? undefined,
      token_symbol: row.token_symbol ?? undefined,
      from: row.from_address ?? undefined,
      to: row.to_address ?? undefined,
      value: row.value ?? undefined,
      raw: JSON.parse(row.raw),
      created_at: row.created_at,
    }));
  }

  listAttestationsByWallet(wallet: string) {
    const rows = this.db
      .prepare(
        "select * from attestations where lower(attester) = lower(?) or lower(recipient) = lower(?) order by created_at desc",
      )
      .all(wallet, wallet) as unknown as Array<AttestationRecord & { raw: string }>;
    return rows.map((row) => ({
      id: row.id,
      attester: row.attester ?? undefined,
      recipient: row.recipient ?? undefined,
      schema_id: row.schema_id ?? undefined,
      tx_hash: row.tx_hash ?? undefined,
      chain_id: row.chain_id ?? undefined,
      raw: JSON.parse(row.raw),
      created_at: row.created_at,
    }));
  }

  listAttestationsByTxHash(txHash: string) {
    const rows = this.db
      .prepare("select * from attestations where lower(tx_hash) = lower(?) order by created_at desc")
      .all(txHash) as unknown as Array<AttestationRecord & { raw: string }>;
    return rows.map((row) => ({
      id: row.id,
      attester: row.attester ?? undefined,
      recipient: row.recipient ?? undefined,
      schema_id: row.schema_id ?? undefined,
      tx_hash: row.tx_hash,
      chain_id: row.chain_id ?? undefined,
      raw: JSON.parse(row.raw),
      created_at: row.created_at,
    }));
  }

  listReceiptsByInteraction(interactionId: string) {
    const rows = this.db
      .prepare("select * from receipts where interaction_id = ? order by created_at desc")
      .all(interactionId) as unknown as Array<ReceiptRecord & { raw: string }>;
    return rows.map((row) => ({
      id: row.id,
      interaction_id: interactionId,
      tx_hash: row.tx_hash ?? undefined,
      raw: JSON.parse(row.raw),
      created_at: row.created_at,
    }));
  }

  upsertPrice(record: PriceRecord) {
    const stmt = this.db.prepare(
      `insert into prices (id, token_address, chain_id, symbol, price_usd, source, timestamp, raw)
       values (@id, @token_address, @chain_id, @symbol, @price_usd, @source, @timestamp, @raw)
       on conflict(id) do update set price_usd=excluded.price_usd, timestamp=excluded.timestamp, raw=excluded.raw`,
    );
    stmt.run({
      id: record.id,
      token_address: record.token_address,
      chain_id: record.chain_id,
      symbol: record.symbol ?? null,
      price_usd: record.price_usd,
      source: record.source,
      timestamp: record.timestamp,
      raw: JSON.stringify(record.raw),
    });
  }

  getLatestPrice(tokenAddress: string, chainId: number) {
    const row = this.db
      .prepare(
        "select * from prices where lower(token_address) = lower(?) and chain_id = ? order by timestamp desc limit 1",
      )
      .get(tokenAddress, chainId) as unknown as (PriceRecord & { raw: string }) | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      token_address: row.token_address,
      chain_id: row.chain_id,
      symbol: row.symbol ?? undefined,
      price_usd: row.price_usd,
      source: row.source,
      timestamp: row.timestamp,
      raw: JSON.parse(row.raw),
    };
  }

  upsertProtocolLabel(record: ProtocolLabelRecord) {
    const stmt = this.db.prepare(
      `insert into protocol_labels (id, contract_address, chain_id, protocol_name, protocol_category, source, metadata, created_at)
       values (@id, @contract_address, @chain_id, @protocol_name, @protocol_category, @source, @metadata, @created_at)
       on conflict(id) do update set protocol_name=excluded.protocol_name, protocol_category=excluded.protocol_category, metadata=excluded.metadata`,
    );
    stmt.run({
      id: record.id,
      contract_address: record.contract_address,
      chain_id: record.chain_id,
      protocol_name: record.protocol_name ?? null,
      protocol_category: record.protocol_category ?? null,
      source: record.source,
      metadata: JSON.stringify(record.metadata),
      created_at: record.created_at,
    });
  }

  getProtocolLabel(contractAddress: string, chainId: number) {
    const row = this.db
      .prepare(
        "select * from protocol_labels where lower(contract_address) = lower(?) and chain_id = ? order by created_at desc limit 1",
      )
      .get(contractAddress, chainId) as unknown as (ProtocolLabelRecord & { metadata: string }) | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      contract_address: row.contract_address,
      chain_id: row.chain_id,
      protocol_name: row.protocol_name ?? undefined,
      protocol_category: row.protocol_category ?? undefined,
      source: row.source,
      metadata: JSON.parse(row.metadata),
      created_at: row.created_at,
    };
  }

  getActiveWallets(daysBack: number) {
    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db
      .prepare(
        "select distinct wallet_address from interactions where wallet_address is not null and created_at >= ? order by created_at desc",
      )
      .all(cutoffDate) as unknown as Array<{ wallet_address: string }>;
    return rows.map((row) => row.wallet_address);
  }

  listObservedTokens() {
    const rows = this.db
      .prepare(
        `select distinct token_address, token_symbol
         from token_transfers
         where token_address is not null
         order by created_at desc`,
      )
      .all() as unknown as Array<{ token_address?: string; token_symbol?: string }>;

    return rows.map((row) => ({
      address: row.token_address as string,
      chainId: 8453,
      symbol: row.token_symbol ?? undefined,
    }));
  }
}
