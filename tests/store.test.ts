import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { openDatabase } from "../server/db";

describe("store", () => {
  it("round-trips all record types", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "afi-store-"));
    const store = new Store({ dbPath: ":memory:", dataDir });

    store.upsertInteraction({
      id: "i1",
      created_at: "2024-01-01T00:00:00Z",
      agent_id: "agent",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/paid",
      protocol: "x402",
      summary: { paymentRequired: { amount: "1" } },
    });

    store.upsertSettlement({
      id: "i1:settlement",
      interaction_id: "i1",
      tx_hash: "0xtx",
      chain_id: 8453,
      status: "confirmed",
      metadata: { ok: true },
    });

    store.upsertEvidence([
      {
        id: "i1:x402",
        interaction_id: "i1",
        kind: "x402",
        payload: { header: "value" },
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "i1:locus",
        interaction_id: "i1",
        kind: "locus",
        payload: { ok: true },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    store.upsertWalletSnapshot({
      id: "ws1",
      interaction_id: "i1",
      wallet_address: "0xwallet",
      balance: "10",
      allowance: "1",
      max_tx: "0.1",
      approvals_required: true,
      metadata: { status: "ok" },
      created_at: "2024-01-01T00:00:00Z",
    });

    store.upsertLocusTransactions([
      {
        id: "lt1",
        interaction_id: "i1",
        tx_hash: "0xtx",
        status: "confirmed",
        counterparty: "svc",
        amount: "1",
        currency: "USDC",
        created_at: "2024-01-01T00:00:00Z",
        raw: { ok: true },
      },
    ]);

    store.upsertBaseTransaction({
      tx_hash: "0xtx",
      status: "confirmed",
      block_number: "1",
      from: "0xwallet",
      to: "0xsvc",
      value: "1",
      raw: { ok: true },
      created_at: "2024-01-01T00:00:00Z",
    });

    store.upsertBaseTransaction({
      tx_hash: "0xrx",
      status: "confirmed",
      block_number: "2",
      to: "0xwallet",
      value: "1",
      raw: { ok: true },
      created_at: "2024-01-02T00:00:00Z",
    });

    store.upsertTokenTransfers([
      {
        id: "transfer1",
        tx_hash: "0xtx",
        token_address: "0xtoken",
        token_symbol: "USDC",
        from: "0xwallet",
        to: "0xsvc",
        value: "1",
        raw: { ok: true },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    store.upsertAttestations([
      {
        id: "att1",
        attester: "0xwallet",
        recipient: "0xsvc",
        schema_id: "schema",
        tx_hash: "0xtx",
        chain_id: 8453,
        raw: { ok: true },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    store.upsertReceipts([
      {
        id: "receipt1",
        interaction_id: "i1",
        tx_hash: "0xtx",
        raw: { ok: true },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    expect(store.listInteractions()).toHaveLength(1);
    expect(store.listInteractionsByWallet("0xwallet")).toHaveLength(1);
    expect(store.listInteractionsByCounterparty("svc")).toHaveLength(1);
    expect(store.getInteraction("i1")?.service).toBe("/paid");
    expect(store.getInteraction("i1")?.summary).toEqual({ paymentRequired: { amount: "1" } });
    expect(store.getInteraction("missing")).toBeUndefined();

    expect(store.getEvidence("i1")).toHaveLength(2);
    expect(store.getSettlement("i1")?.metadata).toEqual({ ok: true });
    expect(store.getSettlement("missing")).toBeUndefined();

    expect(store.getWalletSnapshot("i1")?.approvals_required).toBe(true);
    expect(store.getWalletSnapshot("missing")).toBeUndefined();

    expect(store.listBaseTransactionsByWallet("0xwallet")).toHaveLength(2);
    expect(store.listBaseTransactionsByWallet("0xWALLET")).toHaveLength(2);
    expect(store.listTokenTransfersByWallet("0xwallet")).toHaveLength(1);
    expect(store.listTokenTransfersByWallet("0xWALLET")).toHaveLength(1);
    expect(store.listAttestationsByWallet("0xwallet")).toHaveLength(1);
    expect(store.listAttestationsByWallet("0xWALLET")).toHaveLength(1);
    expect(store.listAttestationsByTxHash("0xTX")).toHaveLength(1);
    expect(store.listReceiptsByInteraction("i1")).toHaveLength(1);
    expect(store.listReceiptsByTxHash("0xTX")).toHaveLength(1);

    // Cover the "approvals_required: false" write path as well.
    store.upsertWalletSnapshot({
      id: "ws2",
      interaction_id: "i1",
      wallet_address: "0xwallet",
      approvals_required: false,
      metadata: {},
      created_at: "2024-01-02T00:00:00Z",
    });
    expect(store.getWalletSnapshot("i1")?.approvals_required).toBe(false);
  });

  it("normalizes nullable SQLite columns to undefined", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "afi-store-null-"));
    const store = new Store({ dbPath: ":memory:", dataDir });

    store.upsertInteraction({
      id: "i-null",
      created_at: "2024-01-01T00:00:00Z",
      agent_id: undefined,
      wallet_address: "0xwallet2",
      counterparty: undefined,
      service: undefined,
      protocol: "x402",
      summary: {},
    });

    store.upsertInteraction({
      id: "i-ctry",
      created_at: "2024-01-01T00:00:00Z",
      agent_id: undefined,
      wallet_address: undefined,
      counterparty: "svc2",
      service: undefined,
      protocol: "x402",
      summary: {},
    });

    store.upsertSettlement({
      id: "i-null:settlement",
      interaction_id: "i-null",
      tx_hash: undefined,
      chain_id: undefined,
      status: "unknown",
      metadata: {},
    });

    store.upsertWalletSnapshot({
      id: "ws-null",
      interaction_id: "i-null",
      wallet_address: undefined,
      balance: undefined,
      allowance: undefined,
      max_tx: undefined,
      approvals_required: undefined,
      metadata: {},
      created_at: "2024-01-02T00:00:00Z",
    });

    store.upsertLocusTransactions([
      {
        id: "lt-null",
        interaction_id: undefined,
        tx_hash: undefined,
        status: undefined,
        counterparty: undefined,
        amount: undefined,
        currency: undefined,
        created_at: undefined,
        raw: {},
      },
    ]);

    store.upsertBaseTransaction({
      tx_hash: "0xbase-null",
      status: "unknown",
      block_number: undefined,
      from: "0xwallet2",
      to: undefined,
      value: undefined,
      raw: {},
      created_at: "2024-01-01T00:00:00Z",
    });

    store.upsertBaseTransaction({
      tx_hash: "0xbase-null2",
      status: "unknown",
      block_number: undefined,
      from: undefined,
      to: "0xwallet2",
      value: undefined,
      raw: {},
      created_at: "2024-01-02T00:00:00Z",
    });

    store.upsertTokenTransfers([
      {
        id: "transfer-null",
        tx_hash: "0xbase-null",
        token_address: undefined,
        token_symbol: undefined,
        from: "0xwallet2",
        to: undefined,
        value: undefined,
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "transfer-null2",
        tx_hash: undefined,
        token_address: undefined,
        token_symbol: undefined,
        from: "0xwallet2",
        to: undefined,
        value: undefined,
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "transfer-null3",
        tx_hash: "0xbase-null",
        token_address: undefined,
        token_symbol: undefined,
        from: undefined,
        to: "0xwallet2",
        value: undefined,
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    store.upsertAttestations([
      {
        id: "att-null",
        attester: "0xwallet2",
        recipient: undefined,
        schema_id: undefined,
        tx_hash: undefined,
        chain_id: undefined,
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "att-null2",
        attester: undefined,
        recipient: "0xwallet2",
        schema_id: undefined,
        tx_hash: undefined,
        chain_id: undefined,
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "att-null3",
        attester: undefined,
        recipient: undefined,
        schema_id: undefined,
        tx_hash: "0xTX-NULL",
        chain_id: undefined,
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    store.upsertReceipts([
      {
        id: "receipt-null",
        interaction_id: "i-null",
        tx_hash: undefined,
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const interaction = store.getInteraction("i-null");
    expect(interaction?.agent_id).toBeUndefined();
    expect(interaction?.counterparty).toBeUndefined();
    expect(interaction?.service).toBeUndefined();

    const interactions = store.listInteractions();
    expect(interactions.find((row) => row.id === "i-null")?.agent_id).toBeUndefined();

    const interactionsByWallet = store.listInteractionsByWallet("0xwallet2");
    expect(interactionsByWallet[0]?.agent_id).toBeUndefined();

    const interactionsByCounterparty = store.listInteractionsByCounterparty("svc2");
    expect(interactionsByCounterparty[0]?.wallet_address).toBeUndefined();

    const settlement = store.getSettlement("i-null");
    expect(settlement?.tx_hash).toBeUndefined();
    expect(settlement?.chain_id).toBeUndefined();

    const walletSnapshot = store.getWalletSnapshot("i-null");
    expect(walletSnapshot?.wallet_address).toBeUndefined();
    expect(walletSnapshot?.balance).toBeUndefined();
    expect(walletSnapshot?.approvals_required).toBe(false);

    const baseTxs = store.listBaseTransactionsByWallet("0xwallet2");
    const baseNull = baseTxs.find((row) => row.tx_hash === "0xbase-null");
    const baseNull2 = baseTxs.find((row) => row.tx_hash === "0xbase-null2");
    expect(baseNull?.block_number).toBeUndefined();
    expect(baseNull?.to).toBeUndefined();
    expect(baseNull?.value).toBeUndefined();
    expect(baseNull2?.from).toBeUndefined();
    expect(baseNull2?.to).toBe("0xwallet2");

    const transfers = store.listTokenTransfersByWallet("0xwallet2");
    const transferNull = transfers.find((row) => row.id === "transfer-null");
    const transferNull2 = transfers.find((row) => row.id === "transfer-null2");
    const transferNull3 = transfers.find((row) => row.id === "transfer-null3");
    expect(transferNull?.token_symbol).toBeUndefined();
    expect(transferNull?.to).toBeUndefined();
    expect(transferNull2?.tx_hash).toBeUndefined();
    expect(transferNull3?.from).toBeUndefined();

    const attestations = store.listAttestationsByWallet("0xwallet2");
    const attNull = attestations.find((row) => row.id === "att-null");
    const attNull2 = attestations.find((row) => row.id === "att-null2");
    expect(attNull?.schema_id).toBeUndefined();
    expect(attNull?.tx_hash).toBeUndefined();
    expect(attNull?.chain_id).toBeUndefined();
    expect(attNull2?.attester).toBeUndefined();

    const attestationsByTx = store.listAttestationsByTxHash("0xtx-null");
    const attNull3 = attestationsByTx.find((row) => row.id === "att-null3");
    expect(attNull3?.attester).toBeUndefined();
    expect(attNull3?.recipient).toBeUndefined();
    expect(attNull3?.schema_id).toBeUndefined();
    expect(attNull3?.chain_id).toBeUndefined();

    const receipts = store.listReceiptsByInteraction("i-null");
    expect(receipts[0]?.tx_hash).toBeUndefined();
  });

  it("migrates older interaction tables to include the service column", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "afi-store-migrate-"));
    const dbPath = join(dataDir, "afi.sqlite");
    const db = openDatabase({ dbPath, dataDir });
    db.exec("drop table interactions");
    db.exec(`
      create table interactions (
        id text primary key,
        created_at text not null,
        agent_id text,
        wallet_address text,
        counterparty text,
        protocol text not null,
        summary text not null
      );
    `);

    const migratedStore = new Store({ dbPath, dataDir });
    migratedStore.upsertInteraction({
      id: "i-migrated",
      created_at: "2024-01-01T00:00:00Z",
      wallet_address: "0xwallet",
      counterparty: "svc",
      service: "/quote",
      protocol: "x402",
      summary: {},
    });

    expect(migratedStore.getInteraction("i-migrated")?.service).toBe("/quote");
  });

  it("round-trips prices and protocol labels", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "afi-store-enrichment-"));
    const store = new Store({ dbPath: ":memory:", dataDir });

    store.upsertPrice({
      id: "8453:0xtoken",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "USDC",
      price_usd: "1.01",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: { source: "test" },
    });

    store.upsertProtocolLabel({
      id: "8453:0xcontract",
      contract_address: "0xcontract",
      chain_id: 8453,
      protocol_name: "EscrowX",
      protocol_category: "escrow",
      source: "dune",
      metadata: { txHash: "0xtx" },
      created_at: "2024-01-01T00:00:00Z",
    });
    store.upsertProtocolLabel({
      id: "8453:0xcontract-null",
      contract_address: "0xcontract-null",
      chain_id: 8453,
      protocol_name: undefined,
      protocol_category: undefined,
      source: "dune",
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    });

    expect(store.getLatestPrice("0xTOKEN", 8453)).toEqual(
      expect.objectContaining({
        symbol: "USDC",
        price_usd: "1.01",
      }),
    );

    expect(store.getProtocolLabel("0xCONTRACT", 8453)).toEqual(
      expect.objectContaining({
        protocol_name: "EscrowX",
        protocol_category: "escrow",
      }),
    );
    expect(store.getProtocolLabel("0xcontract-null", 8453)).toEqual(
      expect.objectContaining({
        protocol_name: undefined,
        protocol_category: undefined,
      }),
    );

    expect(store.getLatestPrice("0xmissing", 8453)).toBeUndefined();
    expect(store.getProtocolLabel("0xmissing", 8453)).toBeUndefined();
  });

  it("lists only active wallets within the requested window", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "afi-store-active-"));
    const store = new Store({ dbPath: ":memory:", dataDir });

    store.upsertInteraction({
      id: "recent",
      created_at: new Date().toISOString(),
      wallet_address: "0xactive",
      protocol: "x402",
      summary: {},
    });
    store.upsertInteraction({
      id: "old",
      created_at: "2020-01-01T00:00:00Z",
      wallet_address: "0xold",
      protocol: "x402",
      summary: {},
    });

    expect(store.getActiveWallets(7)).toEqual(["0xactive"]);
  });

  it("normalizes nullish optional fields for prices and protocol labels", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "afi-store-nullish-"));
    const store = new Store({ dbPath: ":memory:", dataDir });

    store.upsertPrice({
      id: "price-nullish",
      token_address: "0xnull",
      chain_id: 0,
      price_usd: "1",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });
    store.upsertProtocolLabel({
      id: "label-nullish",
      contract_address: "0xcontract-null",
      chain_id: 0,
      source: "dune",
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    });

    expect(store.getLatestPrice("0xnull", 0)).toEqual(
      expect.objectContaining({
        token_address: "0xnull",
        chain_id: 0,
        symbol: undefined,
      }),
    );
    expect(store.getProtocolLabel("0xcontract-null", 0)).toEqual(
      expect.objectContaining({
        chain_id: 0,
        protocol_name: undefined,
        protocol_category: undefined,
      }),
    );
  });

  it("lists observed tokens from token transfer history", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "afi-store-observed-"));
    const store = new Store({ dbPath: ":memory:", dataDir });

    store.upsertTokenTransfers([
      {
        id: "transfer-observed",
        tx_hash: "0xtx",
        token_address: "0xtoken",
        token_symbol: "TOK",
        raw: {},
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "transfer-observed-2",
        tx_hash: "0xtx2",
        token_address: "0xtoken-2",
        token_symbol: undefined,
        raw: {},
        created_at: "2024-01-02T00:00:00Z",
      },
    ]);

    expect(store.listObservedTokens()).toEqual([
      { address: "0xtoken-2", chainId: 8453, symbol: undefined },
      { address: "0xtoken", chainId: 8453, symbol: "TOK" },
    ]);
  });

  it("normalizes null observed-token symbols to undefined", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "afi-store-observed-null-"));
    const store = new Store({ dbPath: ":memory:", dataDir });

    store.upsertTokenTransfers([
      {
        id: "transfer-observed-null",
        tx_hash: "0xtx-null",
        token_address: "0xtoken-null",
        token_symbol: undefined,
        raw: {},
        created_at: "2024-01-03T00:00:00Z",
      },
    ]);

    expect(store.listObservedTokens()).toEqual([{ address: "0xtoken-null", chainId: 8453, symbol: undefined }]);
  });
});
