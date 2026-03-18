import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetExporter } from "../server/parquet-export";
import { ParquetReader } from "../server/parquet-lib";
import { Store } from "../server/store";
import type { InteractionRecord } from "../server/types";

describe("ParquetExporter", () => {
  let dataDir: string;
  let store: Store;
  let exporter: ParquetExporter;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "parquet-test-"));
    store = new Store({ dbPath: ":memory:", dataDir });
    exporter = new ParquetExporter({ dataDir });
  });

  const upsertInteraction = (
    overrides: Partial<InteractionRecord> & Pick<InteractionRecord, "id" | "created_at">,
  ) => {
    store.upsertInteraction({
      protocol: "x402",
      summary: {},
      ...overrides,
    });
  };

  afterEach(() => {
    if (existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  describe("constructor and initialization", () => {
    it("creates data directory if it does not exist", () => {
      const newDir = join(dataDir, "new-parquet-dir");
      new ParquetExporter({ dataDir: newDir });
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

    it("exports empty datasets without date partitions when partitioned by wallet", async () => {
      const walletExporter = new ParquetExporter({ dataDir, partitionBy: "wallet" });

      const result = await walletExporter.exportInteractions(store);

      expect(result.rowCount).toBe(0);
      expect(result.filePath).toContain("interactions");
    });

    it("exports interactions to parquet file", async () => {
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        agent_id: "agent-1",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        protocol: "x402",
        summary: { amount: "100" },
      });

      upsertInteraction({
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
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        agent_id: "agent-1",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
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

      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet1",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
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

    it("uses an unknown wallet partition and default summary payload when wallet metadata is missing", async () => {
      const walletExporter = new ParquetExporter({ dataDir, partitionBy: "wallet" });
      vi.spyOn(store, "listInteractions").mockReturnValue(
        [
          {
            id: "int-missing-wallet",
            created_at: "2024-01-15T10:00:00Z",
            protocol: undefined,
            summary: undefined,
          },
        ] as unknown as ReturnType<Store["listInteractions"]>,
      );

      const result = await walletExporter.exportInteractions(store);
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(result.filePath).toContain("unknown");
      expect(record?.protocol).toBeUndefined();
      expect(record?.summary_json).toBe("{}");
    });

    it("handles no partitioning", async () => {
      const noneExporter = new ParquetExporter({ dataDir, partitionBy: "none" });

      upsertInteraction({
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
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
        id: "int-2",
        created_at: "2024-01-20T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
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
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
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
      upsertInteraction({
        id: "int-1",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
        counterparty: "merchant-1",
        service: "service-1",
        summary: {},
      });

      upsertInteraction({
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
      upsertInteraction({
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
      expect(record?.agent_id).toBeUndefined();
      expect(record?.wallet_address).toBeUndefined();
    });

    it("serializes summary as JSON", async () => {
      upsertInteraction({
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
      upsertInteraction({
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
      upsertInteraction({
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

      expect(record?.tx_hash).toBeUndefined();
    });

    it("serializes empty settlement metadata when the record omits it", async () => {
      vi.spyOn(store, "listInteractions").mockReturnValue([
        {
          id: "int-settlement-null",
          created_at: "2024-01-15T10:00:00Z",
          protocol: "x402",
          summary: {},
        },
      ] as unknown as ReturnType<Store["listInteractions"]>);
      vi.spyOn(store, "getSettlement").mockReturnValue({
        id: "settlement-null",
        interaction_id: "int-settlement-null",
        status: "pending",
        metadata: undefined,
      } as unknown as ReturnType<Store["getSettlement"]>);

      const result = await exporter.exportSettlements(store);
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(record?.metadata_json).toBe("{}");
    });

    it("serializes metadata as JSON", async () => {
      upsertInteraction({
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
        status: "unknown",
        raw: {},
        created_at: "2024-01-15T10:00:00Z",
      });

      const result = await exporter.exportBaseTransactions(store, "0xwallet");

      expect(result.rowCount).toBe(0);
    });

    it("supports wallet partitioning for empty and populated base transaction exports", async () => {
      const walletExporter = new ParquetExporter({ dataDir, partitionBy: "wallet" });
      const emptyResult = await walletExporter.exportBaseTransactions(store, "0xwallet");

      expect(emptyResult.filePath).toContain("0xwallet");

      vi.spyOn(store, "listBaseTransactionsByWallet").mockReturnValue([
        {
          tx_hash: "0xtx-wallet",
          status: "confirmed",
          block_number: undefined,
          created_at: "2024-01-15T10:00:00Z",
        },
      ] as unknown as ReturnType<Store["listBaseTransactionsByWallet"]>);

      const result = await walletExporter.exportBaseTransactions(store, "0xwallet");
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(result.filePath).toContain("0xwallet");
      expect(record?.block_number).toBeUndefined();
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

      expect(record?.token_address).toBeUndefined();
      expect(record?.token_symbol).toBeUndefined();
    });

    it("supports wallet partitioning for empty and populated transfer exports", async () => {
      const walletExporter = new ParquetExporter({ dataDir, partitionBy: "wallet" });
      const emptyResult = await walletExporter.exportTokenTransfers(store, "0xwallet");

      expect(emptyResult.filePath).toContain("0xwallet");

      vi.spyOn(store, "listTokenTransfersByWallet").mockReturnValue([
        {
          id: "transfer-wallet",
          tx_hash: "0xtx-wallet",
          token_address: undefined,
          token_symbol: "USDC",
          created_at: "2024-01-15T10:00:00Z",
        },
      ] as unknown as ReturnType<Store["listTokenTransfersByWallet"]>);

      const result = await walletExporter.exportTokenTransfers(store, "0xwallet");
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(result.filePath).toContain("0xwallet");
      expect(record?.token_address).toBeUndefined();
    });
  });

  describe("exportAll", () => {
    it("exports all entities", async () => {
      upsertInteraction({
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
      upsertInteraction({
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

    it("serializes empty evidence payloads when omitted", async () => {
      vi.spyOn(store, "listInteractions").mockReturnValue([
        {
          id: "int-evidence-null",
          created_at: "2024-01-15T10:00:00Z",
          protocol: "x402",
          summary: {},
        },
      ] as unknown as ReturnType<Store["listInteractions"]>);
      vi.spyOn(store, "getEvidence").mockReturnValue([
        {
          id: "evidence-null",
          interaction_id: "int-evidence-null",
          kind: "x402",
          payload: undefined,
          created_at: "2024-01-15T10:00:00Z",
        },
      ] as unknown as ReturnType<Store["getEvidence"]>);

      const result = await exporter.exportEvidence(store);
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(record?.payload_json).toBe("{}");
    });

    it("exports wallet snapshots", async () => {
      upsertInteraction({
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

    it("exports wallet snapshots with nullable optional fields", async () => {
      vi.spyOn(store, "listInteractions").mockReturnValue([
        {
          id: "int-snapshot-null",
          created_at: "2024-01-15T10:00:00Z",
          protocol: "x402",
          summary: {},
        },
      ] as unknown as ReturnType<Store["listInteractions"]>);
      vi.spyOn(store, "getWalletSnapshot").mockReturnValue({
        id: "snapshot-null",
        interaction_id: "int-snapshot-null",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: undefined,
        balance: undefined,
        allowance: undefined,
        max_tx: undefined,
        approvals_required: undefined,
        metadata: undefined,
      } as unknown as ReturnType<Store["getWalletSnapshot"]>);

      const result = await exporter.exportWalletSnapshots(store);
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(record?.wallet_address).toBeUndefined();
      expect(record?.balance).toBeUndefined();
      expect(record?.allowance).toBeUndefined();
      expect(record?.max_tx).toBeUndefined();
      expect(record?.approvals_required).toBeUndefined();
      expect(record?.metadata_json).toBe("{}");
    });

    it("exports receipts", async () => {
      upsertInteraction({
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

    it("exports receipts with nullable optional fields", async () => {
      vi.spyOn(store, "listInteractions").mockReturnValue([
        {
          id: "int-receipt-null",
          created_at: "2024-01-15T10:00:00Z",
          protocol: "x402",
          summary: {},
        },
      ] as unknown as ReturnType<Store["listInteractions"]>);
      vi.spyOn(store, "listReceiptsByInteraction").mockReturnValue([
        {
          id: "receipt-null",
          interaction_id: undefined,
          tx_hash: "0xtx-null",
          raw: undefined,
          created_at: "2024-01-15T10:00:00Z",
        },
      ] as unknown as ReturnType<Store["listReceiptsByInteraction"]>);

      const result = await exporter.exportReceipts(store);
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(record?.interaction_id).toBeUndefined();
      expect(record?.raw_json).toBe("{}");
    });

    it("exports attestations for a wallet", async () => {
      store.upsertAttestations([
        {
          id: "att-1",
          recipient: "0xwallet",
          tx_hash: "0xtx1",
          chain_id: 8453,
          raw: { ok: true },
          created_at: "2024-01-15T10:00:00Z",
        },
      ]);

      const result = await exporter.exportAttestations(store, "0xwallet");
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(result.rowCount).toBe(1);
      expect(record?.id).toBe("att-1");
    });

    it("returns an empty attestation export when no wallet is provided", async () => {
      const result = await exporter.exportAttestations(store);

      expect(result.rowCount).toBe(0);
      expect(result.filePath).toContain("attestations");
    });

    it("exports attestations with nullable optional fields", async () => {
      vi.spyOn(store, "listAttestationsByWallet").mockReturnValue([
        {
          id: "att-nullable",
          attester: undefined,
          recipient: undefined,
          schema_id: undefined,
          tx_hash: undefined,
          chain_id: undefined,
          raw: undefined,
          created_at: "2024-01-15T10:00:00Z",
        },
      ] as unknown as ReturnType<Store["listAttestationsByWallet"]>);

      const result = await exporter.exportAttestations(store, "0xwallet");
      const reader = await ParquetReader.openFile(result.filePath);
      const record = await reader.getCursor().next();
      await reader.close();

      expect(record?.attester).toBeUndefined();
      expect(record?.recipient).toBeUndefined();
      expect(record?.schema_id).toBeUndefined();
      expect(record?.tx_hash).toBeUndefined();
      expect(record?.chain_id).toBeUndefined();
      expect(record?.raw_json).toBe("{}");
    });

    it("exports receipts scoped to a single interaction id", async () => {
      upsertInteraction({
        id: "int-scoped",
        created_at: "2024-01-15T10:00:00Z",
        wallet_address: "0xwallet",
      });
      store.upsertReceipts([
        {
          id: "receipt-scoped",
          interaction_id: "int-scoped",
          raw: { ok: true },
          created_at: "2024-01-15T10:00:00Z",
        },
      ]);

      const result = await exporter.exportReceipts(store, "int-scoped");

      expect(result.rowCount).toBe(1);
      expect(existsSync(result.filePath)).toBe(true);
    });

    it("exports wallet-scoped artifacts during full exports", async () => {
      const createdAt = new Date().toISOString();
      upsertInteraction({
        id: "int-wallet-success",
        created_at: createdAt,
        wallet_address: "0xwallet",
      });
      store.upsertBaseTransaction({
        tx_hash: "0xtx-wallet",
        status: "confirmed",
        from: "0xwallet",
        raw: {},
        created_at: createdAt,
      });
      store.upsertTokenTransfers([
        {
          id: "transfer-wallet",
          tx_hash: "0xtx-wallet",
          from: "0xwallet",
          raw: {},
          created_at: createdAt,
        },
      ]);
      store.upsertAttestations([
        {
          id: "att-wallet",
          recipient: "0xwallet",
          raw: {},
          created_at: createdAt,
        },
      ]);

      const results = await exporter.exportAll(store);

      expect(results["baseTransactions_0xwallet"].rowCount).toBe(1);
      expect(results["tokenTransfers_0xwallet"].rowCount).toBe(1);
      expect(results["attestations_0xwallet"].rowCount).toBe(1);
    });

    it("captures export failures with failed export placeholders", async () => {
      const createdAt = new Date().toISOString();

      upsertInteraction({
        id: "int-wallet",
        created_at: createdAt,
        wallet_address: "0xwallet",
      });
      vi.spyOn(exporter, "exportInteractions").mockRejectedValueOnce(new Error("interactions"));
      vi.spyOn(exporter, "exportSettlements").mockRejectedValueOnce(new Error("settlements"));
      vi.spyOn(exporter, "exportEvidence").mockRejectedValueOnce(new Error("evidence"));
      vi.spyOn(exporter, "exportWalletSnapshots").mockRejectedValueOnce(new Error("walletSnapshots"));
      vi.spyOn(exporter, "exportReceipts").mockRejectedValueOnce(new Error("receipts"));
      vi.spyOn(exporter, "exportBaseTransactions").mockRejectedValueOnce(new Error("baseTransactions"));
      vi.spyOn(exporter, "exportTokenTransfers").mockRejectedValueOnce(new Error("tokenTransfers"));
      vi.spyOn(exporter, "exportAttestations").mockRejectedValueOnce(new Error("attestations"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const results = await exporter.exportAll(store);

      expect(results.interactions).toEqual(expect.objectContaining({ filePath: "", rowCount: 0 }));
      expect(results.settlements).toEqual(expect.objectContaining({ filePath: "", rowCount: 0 }));
      expect(results.evidence).toEqual(expect.objectContaining({ filePath: "", rowCount: 0 }));
      expect(results.walletSnapshots).toEqual(expect.objectContaining({ filePath: "", rowCount: 0 }));
      expect(results.receipts).toEqual(expect.objectContaining({ filePath: "", rowCount: 0 }));
      expect(results["baseTransactions_0xwallet"]).toEqual(expect.objectContaining({ filePath: "", rowCount: 0 }));
      expect(results["tokenTransfers_0xwallet"]).toEqual(expect.objectContaining({ filePath: "", rowCount: 0 }));
      expect(results["attestations_0xwallet"]).toEqual(expect.objectContaining({ filePath: "", rowCount: 0 }));

      consoleSpy.mockRestore();
    });
  });

  describe("bootstrapExport", () => {
    it("bootstraps all data successfully", async () => {
      upsertInteraction({
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

    it("reports failed exports during bootstrap", async () => {
      vi.spyOn(exporter, "exportAll").mockResolvedValue({
        interactions: { filePath: "", rowCount: 0, timestamp: "2024-01-01T00:00:00Z" },
      });
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await exporter.bootstrapExport(store);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(["Failed to export interactions"]);

      consoleSpy.mockRestore();
    });
  });
});
