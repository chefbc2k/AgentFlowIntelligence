import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface DatabaseConfig {
  dbPath: string;
  dataDir: string;
}

export function openDatabase(config: DatabaseConfig) {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  const db = new DatabaseSync(config.dbPath);
  db.exec("pragma foreign_keys = on;");

  const transaction = <Args extends unknown[], Result>(fn: (...args: Args) => Result) => {
    return (...args: Args) => {
      db.exec("begin");
      try {
        const result = fn(...args);
        db.exec("commit");
        return result;
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    };
  };

  db.exec(`
    create table if not exists interactions (
      id text primary key,
      created_at text not null,
      agent_id text,
      wallet_address text,
      counterparty text,
      service text,
      protocol text not null,
      summary text not null
    );
    create table if not exists settlements (
      id text primary key,
      interaction_id text not null,
      tx_hash text,
      chain_id integer,
      status text not null,
      metadata text not null,
      foreign key (interaction_id) references interactions(id)
    );
    create table if not exists evidence (
      id text primary key,
      interaction_id text not null,
      kind text not null,
      payload text not null,
      created_at text not null,
      foreign key (interaction_id) references interactions(id)
    );
    create table if not exists wallet_snapshots (
      id text primary key,
      interaction_id text not null,
      wallet_address text,
      balance text,
      allowance text,
      max_tx text,
      approvals_required integer,
      metadata text not null,
      created_at text not null,
      foreign key (interaction_id) references interactions(id)
    );
    create table if not exists locus_transactions (
      id text primary key,
      interaction_id text,
      tx_hash text,
      status text,
      counterparty text,
      amount text,
      currency text,
      created_at text,
      raw text not null
    );
    create table if not exists base_transactions (
      tx_hash text primary key,
      status text not null,
      block_number text,
      from_address text,
      to_address text,
      value text,
      raw text not null,
      created_at text not null
    );
    create table if not exists token_transfers (
      id text primary key,
      tx_hash text,
      token_address text,
      token_symbol text,
      from_address text,
      to_address text,
      value text,
      raw text not null,
      created_at text not null
    );
    create table if not exists attestations (
      id text primary key,
      attester text,
      recipient text,
      schema_id text,
      tx_hash text,
      chain_id integer,
      raw text not null,
      created_at text not null
    );
    create table if not exists receipts (
      id text primary key,
      interaction_id text,
      tx_hash text,
      raw text not null,
      created_at text not null
    );
    create table if not exists prices (
      id text primary key,
      token_address text,
      chain_id integer,
      symbol text,
      price_usd text not null,
      source text not null,
      timestamp text not null,
      raw text not null
    );
    create table if not exists protocol_labels (
      id text primary key,
      contract_address text not null,
      chain_id integer,
      protocol_name text,
      protocol_category text,
      source text not null,
      metadata text not null,
      created_at text not null
    );
  `);

  const columns = db.prepare("pragma table_info(interactions)").all() as Array<{ name?: string }>;
  if (!columns.some((col) => col.name === "service")) {
    db.exec("alter table interactions add column service text;");
  }

  return {
    exec: db.exec.bind(db),
    prepare: db.prepare.bind(db),
    transaction,
  };
}
