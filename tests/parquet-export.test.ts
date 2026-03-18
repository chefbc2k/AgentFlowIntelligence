import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetExporter } from "../server/parquet-export";
import { Store } from "../server/store";
import { ParquetReader } from "parquetjs";

describe("ParquetExporter", () => {
  let dataDir: string;
  let store: Store;
  let exporter: ParquetExporter;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "parquet-test-"));
    store = new Store({ dbPath: ":memory:", dataDir });
    exporter = new ParquetExporter({ dataDir });
  });

  afterEach(() => {
    if (existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  describe("constructor and initialization", () => {
    it("creates data directory if it does not exist", () => {
      const newDir = join(dataDir, "new-parquet-dir");
      const newExporter = new ParquetExporter({ dataDir: newDir });
      expect(existsSync(newDir)).toBe(true);
      rmSync(newDir, { recursive: true, force: true });
    });

    it("supports different partition strategies", () => {
      const dateExporter = new ParquetExporter({ dataDir, partitionBy: "date" });
      const walletExporter = new ParquetExporter({ dataDir, partitionBy: "wallet" });
      const noneExporter = new ParquetExporter({ dataDir, partitionBy: "none" });

      expect(dateExporter).toBeInstanceOf(ParquetExporter);
      expect(walletExporter).toBeInstanceOf(ParquetExporter);
      expect(noneExporter).toBeInstanceOf(ParquetExporter);
    });

    it("defaults to date partitioning", () => {
      const defaultExporter = new ParquetExporter({ dataDir });
      expect(defaultExporter).toBeInstanceOf(ParquetExporter);
    });
  });

  describe("exportInteractions", () => {
    it("exports empty dataset with zero rows", async () => {
      const result = await exporter.exportInteractions(store);

      expect(result.rowCount).toBe(0);
      expect(result.filePath).toContain("interactions");
      expect(result.timestamp).toBeDefined();
    });

    it("exports interactions to parquet file", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        agent_id: "agent-1",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        protocol: "x402",
        summary: { amount: "100" },
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        agent_id: "agent-1",
        wallet_address: "0xwallet",
        counterparty: "merchant-2",
        service: "service-2",
        protocol: "locus",
        summary: { amount: "200" },
      });

      const result = await exporter.exportInteractions(store);

      expect(result.rowCount).toBe(2);
      expect(result.filePath).toContain("parquet");
      expect(existsSync(result.filePath)).toBe(true);

      // Verify parquet file can be read
      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      let record = await cursor.next();
      let count = 0;
      while (record) {
        count++;
        expect(record.id).toBeDefined();
        expect(record.created_at).toBeDefined();
        record = await cursor.next();
      }
      await reader.close();
      expect(count).toBe(2);
    });

    it("partitions by date", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        agent_id: "agent-1",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-16T10:00:00Z",
        agent_id: "agent-1",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = await exporter.exportInteractions(store);

      expect(result.rowCount).toBe(2);
      expect(result.filePath).toContain("interactions");
      // Should have created date partitions
      const interactionsDir = join(dataDir, "interactions");
      expect(existsSync(interactionsDir)).toBe(true);
    });

    it("partitions by wallet", async () => {
      const walletExporter = new ParquetExporter({ dataDir, partitionBy: "wallet" });

      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-15T11:00:00Z",
        wallet_address: "0xwallet2",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = await walletExporter.exportInteractions(store);

      expect(result.rowCount).toBe(2);
      // Should have created wallet partitions
      const interactionsDir = join(dataDir, "interactions");
      expect(existsSync(interactionsDir)).toBe(true);
    });

    it("handles no partitioning", async () => {
      const noneExporter = new ParquetExporter({ dataDir, partitionBy: "none" });

      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = await noneExporter.exportInteractions(store);

      expect(result.rowCount).toBe(1);
      expect(result.filePath).toContain("interactions");
    });

    it("filters by date range", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-20T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-3",
        created_at: "2024-01-25T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = await exporter.exportInteractions(store, {
        startDate: "2024-01-17",
        endDate: "2024-01-23",
      });

      expect(result.rowCount).toBe(1);
    });

    it("filters with only start date", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-20T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = await exporter.exportInteractions(store, {
        startDate: "2024-01-18",
      });

      expect(result.rowCount).toBe(1);
    });

    it("filters with only end date", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertInteraction({
        id: "int-2",
        created_at: "2024-01-20T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = await exporter.exportInteractions(store, {
        endDate: "2024-01-18",
      });

      expect(result.rowCount).toBe(1);
    });

    it("handles interactions with null optional fields", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        summary: {},
      });

      const result = await exporter.exportInteractions(store);

      expect(result.rowCount).toBe(1);

      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      const record = await cursor.next();
      await reader.close();

      expect(record?.id).toBe("int-1");
      expect(record?.agent_id).toBeNull();
      expect(record?.wallet_address).toBeNull();
    });

    it("serializes summary as JSON", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: { amount: "100", currency: "USDC", nested: { key: "value" } },
      });

      const result = await exporter.exportInteractions(store);

      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      const record = await cursor.next();
      await reader.close();

      expect(record?.summary_json).toBeDefined();
      const parsed = JSON.parse(record!.summary_json as string);
      expect(parsed.amount).toBe("100");
      expect(parsed.nested.key).toBe("value");
    });
  });

  describe("exportSettlements", () => {
    it("exports empty settlements with zero rows", async () => {
      const result = await exporter.exportSettlements(store);

      expect(result.rowCount).toBe(0);
      expect(result.filePath).toContain("settlements");
    });

    it("exports settlements to parquet file", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertSettlement({
        id: "settlement-1",
        interaction_id: "int-1",
        tx_hash: "0xtx1",
        status: "confirmed",
        metadata: { confirmations: 12 },
      });

      const result = await exporter.exportSettlements(store);

      expect(result.rowCount).toBe(1);
      expect(existsSync(result.filePath)).toBe(true);

      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      const record = await cursor.next();
      await reader.close();

      expect(record?.id).toBe("settlement-1");
      expect(record?.tx_hash).toBe("0xtx1");
      expect(record?.status).toBe("confirmed");
    });

    it("handles settlements with null tx_hash", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertSettlement({
        id: "settlement-1",
        interaction_id: "int-1",
        status: "pending",
        metadata: {},
      });

      const result = await exporter.exportSettlements(store);

      expect(result.rowCount).toBe(1);

      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      const record = await cursor.next();
      await reader.close();

      expect(record?.tx_hash).toBeNull();
    });

    it("serializes metadata as JSON", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertSettlement({
        id: "settlement-1",
        interaction_id: "int-1",
        status: "confirmed",
        metadata: { confirmations: 12, gasUsed: "21000" },
      });

      const result = await exporter.exportSettlements(store);

      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      const record = await cursor.next();
      await reader.close();

      const parsed = JSON.parse(record!.metadata_json as string);
      expect(parsed.confirmations).toBe(12);
      expect(parsed.gasUsed).toBe("21000");
    });
  });

  describe("exportBaseTransactions", () => {
    it("exports empty transactions with zero rows", async () => {
      const result = await exporter.exportBaseTransactions(store, "0xwallet");

      expect(result.rowCount).toBe(0);
      expect(result.filePath).toContain("base_tx");
    });

    it("exports base transactions to parquet file", async () => {
      store.upsertBaseTransaction({
        tx_hash: "0xtx1",
        status: "confirmed",
        block_number: "12345",
        from: "0xfrom",
        to: "0xto",
        value: "1000000000000000000",
        raw: {},
        created_at: "2024-01-15T10:00:00Z",
      });

      store.upsertBaseTransaction({
        tx_hash: "0xtx2",
        status: "confirmed",
        block_number: "12346",
        from: "0xwallet",
        to: "0xto",
        value: "2000000000000000000",
        raw: {},
        created_at: "2024-01-15T10:05:00Z",
      });

      const result = await exporter.exportBaseTransactions(store, "0xwallet");

      expect(result.rowCount).toBe(1);
      expect(existsSync(result.filePath)).toBe(true);

      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      const record = await cursor.next();
      await reader.close();

      expect(record?.tx_hash).toBe("0xtx2");
      expect(record?.from).toBe("0xwallet");
    });

    it("handles transactions with null optional fields", async () => {
      store.upsertBaseTransaction({
        tx_hash: "0xtx1",
        status: "pending",
        raw: {},
        created_at: "2024-01-15T10:00:00Z",
      });

      const result = await exporter.exportBaseTransactions(store, "0xwallet");

      expect(result.rowCount).toBe(0);
    });
  });

  describe("exportTokenTransfers", () => {
    it("exports empty transfers with zero rows", async () => {
      const result = await exporter.exportTokenTransfers(store, "0xwallet");

      expect(result.rowCount).toBe(0);
      expect(result.filePath).toContain("transfers");
    });

    it("exports token transfers to parquet file", async () => {
      store.upsertTokenTransfers([
        {
          id: "transfer-1",
          tx_hash: "0xtx1",
          token_address: "0xusdc",
          token_symbol: "USDC",
          from: "0xwallet",
          to: "0xto",
          value: "1000000",
          raw: {},
          created_at: "2024-01-15T10:00:00Z",
        },
        {
          id: "transfer-2",
          tx_hash: "0xtx2",
          token_address: "0xusdt",
          token_symbol: "USDT",
          from: "0xfrom",
          to: "0xwallet",
          value: "2000000",
          raw: {},
          created_at: "2024-01-15T10:05:00Z",
        },
      ]);

      const result = await exporter.exportTokenTransfers(store, "0xwallet");

      expect(result.rowCount).toBe(2);
      expect(existsSync(result.filePath)).toBe(true);

      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      let record = await cursor.next();
      let count = 0;
      while (record) {
        count++;
        expect(record.id).toBeDefined();
        record = await cursor.next();
      }
      await reader.close();
      expect(count).toBe(2);
    });

    it("handles transfers with null token information", async () => {
      store.upsertTokenTransfers([
        {
          id: "transfer-1",
          tx_hash: "0xtx1",
          from: "0xwallet",
          to: "0xto",
          value: "1000000",
          raw: {},
          created_at: "2024-01-15T10:00:00Z",
        },
      ]);

      const result = await exporter.exportTokenTransfers(store, "0xwallet");

      expect(result.rowCount).toBe(1);

      const reader = await ParquetReader.openFile(result.filePath);
      const cursor = reader.getCursor();
      const record = await cursor.next();
      await reader.close();

      expect(record?.token_address).toBeNull();
      expect(record?.token_symbol).toBeNull();
    });
  });

  describe("exportAll", () => {
    it("exports all entities", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertSettlement({
        id: "settlement-1",
        interaction_id: "int-1",
        status: "confirmed",
        metadata: {},
      });

      const results = await exporter.exportAll(store);

      expect(results.interactions).toBeDefined();
      expect(results.settlements).toBeDefined();
      expect(results.interactions.rowCount).toBe(1);
      expect(results.settlements.rowCount).toBe(1);
    });

    it("handles empty store", async () => {
      const results = await exporter.exportAll(store);

      expect(results.interactions.rowCount).toBe(0);
      expect(results.settlements.rowCount).toBe(0);
    });

    it("exports evidence records", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertEvidence([
        {
          id: "evidence-1",
          interaction_id: "int-1",
          kind: "x402",
          payload: { test: "data" },
          created_at: "2024-01-15T10:00:00Z",
        },
      ]);

      const result = await exporter.exportEvidence(store);

      expect(result.rowCount).toBe(1);
      expect(existsSync(result.filePath)).toBe(true);
    });

    it("exports wallet snapshots", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertWalletSnapshot({
        id: "snapshot-1",
        interaction_id: "int-1",
        wallet_address: "0xwallet",
        balance: "1000000",
        allowance: "500000",
        max_tx: "100000",
        approvals_required: false,
        metadata: {},
        created_at: "2024-01-15T10:00:00Z",
      });

      const result = await exporter.exportWalletSnapshots(store);

      expect(result.rowCount).toBe(1);
      expect(existsSync(result.filePath)).toBe(true);
    });

    it("exports receipts", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      store.upsertReceipts([
        {
          id: "receipt-1",
          interaction_id: "int-1",
          tx_hash: "0xtx1",
          raw: { status: "success" },
          created_at: "2024-01-15T10:00:00Z",
        },
      ]);

      const result = await exporter.exportReceipts(store);

      expect(result.rowCount).toBe(1);
      expect(existsSync(result.filePath)).toBe(true);
    });
  });

  describe("bootstrapExport", () => {
    it("bootstraps all data successfully", async () => {
      store.upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      const result = await exporter.bootstrapExport(store);

      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.results.interactions).toBeDefined();
      expect(result.results.interactions.rowCount).toBe(1);
    });

    it("handles empty store during bootstrap", async () => {
      const result = await exporter.bootstrapExport(store);

      expect(result.success).toBe(true);
      expect(result.results.interactions.rowCount).toBe(0);
    });
  });
});
