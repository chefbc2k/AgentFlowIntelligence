import { ParquetWriter, ParquetSchema } from "./parquet-lib";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import type { Store } from "./store";
import type {
  AttestationRecord,
  EvidenceRecord,
  InteractionRecord,
  ReceiptRecord,
  SettlementRecord,
  WalletSnapshotRecord,
} from "./types";

export interface ParquetExportOptions {
  dataDir: string;
  partitionBy?: "date" | "wallet" | "none";
}

export interface ExportResult {
  filePath: string;
  rowCount: number;
  timestamp: string;
}

/**
 * Parquet export service for analytical storage
 * Exports AFI data to columnar Parquet format for efficient querying
 */
export class ParquetExporter {
  private dataDir: string;
  private partitionBy: "date" | "wallet" | "none";

  constructor(options: ParquetExportOptions) {
    this.dataDir = options.dataDir;
    this.partitionBy = options.partitionBy ?? "date";
    this.ensureDataDir();
  }

  private ensureDataDir() {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private getPartitionPath(entityType: string, partitionKey?: string): string {
    if (this.partitionBy === "none" || !partitionKey) {
      return join(this.dataDir, entityType);
    }

    if (this.partitionBy === "date") {
      const [year, month, day] = partitionKey.split("-");
      return join(this.dataDir, entityType, year, month, day);
    }

    // wallet partition
    return join(this.dataDir, entityType, partitionKey);
  }

  private ensurePartitionDir(path: string) {
    mkdirSync(path, { recursive: true });
  }

  private failedExport(timestamp: string): ExportResult {
    return {
      filePath: "",
      rowCount: 0,
      timestamp,
    };
  }

  /**
   * Export interactions to Parquet
   */
  async exportInteractions(store: Store, options?: { startDate?: string; endDate?: string }): Promise<ExportResult> {
    const interactions = store.listInteractions();
    const filtered = options?.startDate || options?.endDate
      ? interactions.filter(i => {
          const date = i.created_at.slice(0, 10);
          if (options.startDate && date < options.startDate) return false;
          if (options.endDate && date > options.endDate) return false;
          return true;
        })
      : interactions;

    if (filtered.length === 0) {
      const timestamp = new Date().toISOString();
      const partitionKey = this.partitionBy === "date" ? timestamp.slice(0, 10) : undefined;
      const partitionPath = this.getPartitionPath("interactions", partitionKey);
      return {
        filePath: join(partitionPath, `interactions-${timestamp}.parquet`),
        rowCount: 0,
        timestamp,
      };
    }

    // Group by partition key
    const partitions = new Map<string, InteractionRecord[]>();
    for (const interaction of filtered) {
      const key = this.partitionBy === "date"
        ? interaction.created_at.slice(0, 10)
        : this.partitionBy === "wallet"
          ? interaction.wallet_address ?? "unknown"
          : "all";

      if (!partitions.has(key)) {
        partitions.set(key, []);
      }
      partitions.get(key)!.push(interaction);
    }

    const timestamp = new Date().toISOString();
    const results: ExportResult[] = [];

    for (const [partitionKey, rows] of partitions) {
      const partitionPath = this.getPartitionPath("interactions", partitionKey);
      this.ensurePartitionDir(partitionPath);

      const filePath = join(partitionPath, `interactions-${timestamp}.parquet`);

      const schema = new ParquetSchema({
        id: { type: "UTF8" },
        created_at: { type: "UTF8" },
        agent_id: { type: "UTF8", optional: true },
        wallet_address: { type: "UTF8", optional: true },
        counterparty: { type: "UTF8", optional: true },
        service: { type: "UTF8", optional: true },
        protocol: { type: "UTF8", optional: true },
        summary_json: { type: "UTF8" },
      });

      const writer = await ParquetWriter.openFile(schema, filePath);

      for (const row of rows) {
        await writer.appendRow({
          id: row.id,
          created_at: row.created_at,
          agent_id: row.agent_id ?? null,
          wallet_address: row.wallet_address ?? null,
          counterparty: row.counterparty ?? null,
          service: row.service ?? null,
          protocol: row.protocol ?? null,
          summary_json: JSON.stringify(row.summary ?? {}),
        });
      }

      await writer.close();

      results.push({
        filePath,
        rowCount: rows.length,
        timestamp,
      });
    }

    // Return aggregated result
    return {
      filePath: results[0].filePath,
      rowCount: results.reduce((sum, r) => sum + r.rowCount, 0),
      timestamp,
    };
  }

  /**
   * Export settlements to Parquet
   */
  async exportSettlements(store: Store): Promise<ExportResult> {
    const interactions = store.listInteractions();
    const settlements: SettlementRecord[] = [];

    for (const interaction of interactions) {
      const settlement = store.getSettlement(interaction.id);
      if (settlement) {
        settlements.push(settlement);
      }
    }

    const timestamp = new Date().toISOString();

    if (settlements.length === 0) {
      const partitionPath = this.getPartitionPath("settlements", undefined);
      return {
        filePath: join(partitionPath, `settlements-${timestamp}.parquet`),
        rowCount: 0,
        timestamp,
      };
    }

    const partitionPath = this.getPartitionPath("settlements", undefined);
    this.ensurePartitionDir(partitionPath);

    const filePath = join(partitionPath, `settlements-${timestamp}.parquet`);

    const schema = new ParquetSchema({
      id: { type: "UTF8" },
      interaction_id: { type: "UTF8" },
      tx_hash: { type: "UTF8", optional: true },
      chain_id: { type: "INT64", optional: true },
      status: { type: "UTF8" },
      metadata_json: { type: "UTF8" },
    });

    const writer = await ParquetWriter.openFile(schema, filePath);

    for (const settlement of settlements) {
      await writer.appendRow({
        id: settlement.id,
        interaction_id: settlement.interaction_id,
        tx_hash: settlement.tx_hash ?? null,
        chain_id: settlement.chain_id ?? null,
        status: settlement.status,
        metadata_json: JSON.stringify(settlement.metadata ?? {}),
      });
    }

    await writer.close();

    return {
      filePath,
      rowCount: settlements.length,
      timestamp,
    };
  }

  /**
   * Export evidence to Parquet
   */
  async exportEvidence(store: Store): Promise<ExportResult> {
    const interactions = store.listInteractions();
    const allEvidence: EvidenceRecord[] = [];

    for (const interaction of interactions) {
      const evidence = store.getEvidence(interaction.id);
      allEvidence.push(...evidence);
    }

    const timestamp = new Date().toISOString();

    if (allEvidence.length === 0) {
      const partitionPath = this.getPartitionPath("evidence", undefined);
      return {
        filePath: join(partitionPath, `evidence-${timestamp}.parquet`),
        rowCount: 0,
        timestamp,
      };
    }

    const partitionPath = this.getPartitionPath("evidence", undefined);
    this.ensurePartitionDir(partitionPath);

    const filePath = join(partitionPath, `evidence-${timestamp}.parquet`);

    const schema = new ParquetSchema({
      id: { type: "UTF8" },
      interaction_id: { type: "UTF8" },
      kind: { type: "UTF8" },
      payload_json: { type: "UTF8" },
      created_at: { type: "UTF8" },
    });

    const writer = await ParquetWriter.openFile(schema, filePath);

    for (const evidence of allEvidence) {
      await writer.appendRow({
        id: evidence.id,
        interaction_id: evidence.interaction_id,
        kind: evidence.kind,
        payload_json: JSON.stringify(evidence.payload ?? {}),
        created_at: evidence.created_at,
      });
    }

    await writer.close();

    return {
      filePath,
      rowCount: allEvidence.length,
      timestamp,
    };
  }

  /**
   * Export wallet snapshots to Parquet
   */
  async exportWalletSnapshots(store: Store): Promise<ExportResult> {
    const interactions = store.listInteractions();
    const snapshots: WalletSnapshotRecord[] = [];

    for (const interaction of interactions) {
      const snapshot = store.getWalletSnapshot(interaction.id);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }

    const timestamp = new Date().toISOString();

    if (snapshots.length === 0) {
      const partitionPath = this.getPartitionPath("wallet_snapshots", undefined);
      return {
        filePath: join(partitionPath, `wallet_snapshots-${timestamp}.parquet`),
        rowCount: 0,
        timestamp,
      };
    }

    const partitionPath = this.getPartitionPath("wallet_snapshots", undefined);
    this.ensurePartitionDir(partitionPath);

    const filePath = join(partitionPath, `wallet_snapshots-${timestamp}.parquet`);

    const schema = new ParquetSchema({
      id: { type: "UTF8" },
      interaction_id: { type: "UTF8" },
      wallet_address: { type: "UTF8", optional: true },
      balance: { type: "UTF8", optional: true },
      allowance: { type: "UTF8", optional: true },
      max_tx: { type: "UTF8", optional: true },
      approvals_required: { type: "BOOLEAN", optional: true },
      metadata_json: { type: "UTF8" },
      created_at: { type: "UTF8" },
    });

    const writer = await ParquetWriter.openFile(schema, filePath);

    for (const snapshot of snapshots) {
      await writer.appendRow({
        id: snapshot.id,
        interaction_id: snapshot.interaction_id,
        wallet_address: snapshot.wallet_address ?? null,
        balance: snapshot.balance ?? null,
        allowance: snapshot.allowance ?? null,
        max_tx: snapshot.max_tx ?? null,
        approvals_required: snapshot.approvals_required ?? null,
        metadata_json: JSON.stringify(snapshot.metadata ?? {}),
        created_at: snapshot.created_at,
      });
    }

    await writer.close();

    return {
      filePath,
      rowCount: snapshots.length,
      timestamp,
    };
  }

  /**
   * Export attestations to Parquet
   */
  async exportAttestations(store: Store, wallet?: string): Promise<ExportResult> {
    const attestations: AttestationRecord[] = wallet ? store.listAttestationsByWallet(wallet) : [];

    const timestamp = new Date().toISOString();

    if (attestations.length === 0) {
      const partitionPath = this.getPartitionPath("attestations", undefined);
      return {
        filePath: join(partitionPath, `attestations-${timestamp}.parquet`),
        rowCount: 0,
        timestamp,
      };
    }

    const partitionPath = this.getPartitionPath("attestations", undefined);
    this.ensurePartitionDir(partitionPath);

    const filePath = join(partitionPath, `attestations-${timestamp}.parquet`);

    const schema = new ParquetSchema({
      id: { type: "UTF8" },
      attester: { type: "UTF8", optional: true },
      recipient: { type: "UTF8", optional: true },
      schema_id: { type: "UTF8", optional: true },
      tx_hash: { type: "UTF8", optional: true },
      chain_id: { type: "INT64", optional: true },
      raw_json: { type: "UTF8" },
      created_at: { type: "UTF8" },
    });

    const writer = await ParquetWriter.openFile(schema, filePath);

    for (const attestation of attestations) {
      await writer.appendRow({
        id: attestation.id,
        attester: attestation.attester ?? null,
        recipient: attestation.recipient ?? null,
        schema_id: attestation.schema_id ?? null,
        tx_hash: attestation.tx_hash ?? null,
        chain_id: attestation.chain_id ?? null,
        raw_json: JSON.stringify(attestation.raw ?? {}),
        created_at: attestation.created_at,
      });
    }

    await writer.close();

    return {
      filePath,
      rowCount: attestations.length,
      timestamp,
    };
  }

  /**
   * Export receipts to Parquet
   */
  async exportReceipts(store: Store, interactionId?: string): Promise<ExportResult> {
    const interaction = interactionId ? store.getInteraction(interactionId) : undefined;
    const interactions = interaction ? [interaction] : store.listInteractions();
    const allReceipts: ReceiptRecord[] = [];

    for (const interaction of interactions) {
      const receipts = store.listReceiptsByInteraction(interaction.id);
      allReceipts.push(...receipts);
    }

    const timestamp = new Date().toISOString();

    if (allReceipts.length === 0) {
      const partitionPath = this.getPartitionPath("receipts", undefined);
      return {
        filePath: join(partitionPath, `receipts-${timestamp}.parquet`),
        rowCount: 0,
        timestamp,
      };
    }

    const partitionPath = this.getPartitionPath("receipts", undefined);
    this.ensurePartitionDir(partitionPath);

    const filePath = join(partitionPath, `receipts-${timestamp}.parquet`);

    const schema = new ParquetSchema({
      id: { type: "UTF8" },
      interaction_id: { type: "UTF8", optional: true },
      tx_hash: { type: "UTF8", optional: true },
      raw_json: { type: "UTF8" },
      created_at: { type: "UTF8" },
    });

    const writer = await ParquetWriter.openFile(schema, filePath);

    for (const receipt of allReceipts) {
      await writer.appendRow({
        id: receipt.id,
        interaction_id: receipt.interaction_id ?? null,
        tx_hash: receipt.tx_hash ?? null,
        raw_json: JSON.stringify(receipt.raw ?? {}),
        created_at: receipt.created_at,
      });
    }

    await writer.close();

    return {
      filePath,
      rowCount: allReceipts.length,
      timestamp,
    };
  }

  /**
   * Export base transactions to Parquet
   */
  async exportBaseTransactions(store: Store, wallet: string): Promise<ExportResult> {
    const transactions = store.listBaseTransactionsByWallet(wallet);
    const timestamp = new Date().toISOString();

    if (transactions.length === 0) {
      const partitionKey = this.partitionBy === "wallet" ? wallet : undefined;
      const partitionPath = this.getPartitionPath("base_transactions", partitionKey);
      return {
        filePath: join(partitionPath, `base_tx-${timestamp}.parquet`),
        rowCount: 0,
        timestamp,
      };
    }

    const partitionKey = this.partitionBy === "wallet" ? wallet : undefined;
    const partitionPath = this.getPartitionPath("base_transactions", partitionKey);
    this.ensurePartitionDir(partitionPath);

    const filePath = join(partitionPath, `base_tx-${timestamp}.parquet`);

    const schema = new ParquetSchema({
      tx_hash: { type: "UTF8" },
      status: { type: "UTF8" },
      block_number: { type: "UTF8", optional: true },
      from: { type: "UTF8", optional: true },
      to: { type: "UTF8", optional: true },
      value: { type: "UTF8", optional: true },
      created_at: { type: "UTF8" },
    });

    const writer = await ParquetWriter.openFile(schema, filePath);

    for (const tx of transactions) {
      await writer.appendRow({
        tx_hash: tx.tx_hash,
        status: tx.status,
        block_number: tx.block_number ?? null,
        from: tx.from ?? null,
        to: tx.to ?? null,
        value: tx.value ?? null,
        created_at: tx.created_at,
      });
    }

    await writer.close();

    return {
      filePath,
      rowCount: transactions.length,
      timestamp,
    };
  }

  /**
   * Export token transfers to Parquet
   */
  async exportTokenTransfers(store: Store, wallet: string): Promise<ExportResult> {
    const transfers = store.listTokenTransfersByWallet(wallet);
    const timestamp = new Date().toISOString();

    if (transfers.length === 0) {
      const partitionKey = this.partitionBy === "wallet" ? wallet : undefined;
      const partitionPath = this.getPartitionPath("token_transfers", partitionKey);
      return {
        filePath: join(partitionPath, `transfers-${timestamp}.parquet`),
        rowCount: 0,
        timestamp,
      };
    }

    const partitionKey = this.partitionBy === "wallet" ? wallet : undefined;
    const partitionPath = this.getPartitionPath("token_transfers", partitionKey);
    this.ensurePartitionDir(partitionPath);

    const filePath = join(partitionPath, `transfers-${timestamp}.parquet`);

    const schema = new ParquetSchema({
      id: { type: "UTF8" },
      tx_hash: { type: "UTF8" },
      token_address: { type: "UTF8", optional: true },
      token_symbol: { type: "UTF8", optional: true },
      from: { type: "UTF8", optional: true },
      to: { type: "UTF8", optional: true },
      value: { type: "UTF8", optional: true },
      created_at: { type: "UTF8" },
    });

    const writer = await ParquetWriter.openFile(schema, filePath);

    for (const transfer of transfers) {
      await writer.appendRow({
        id: transfer.id,
        tx_hash: transfer.tx_hash,
        token_address: transfer.token_address ?? null,
        token_symbol: transfer.token_symbol ?? null,
        from: transfer.from ?? null,
        to: transfer.to ?? null,
        value: transfer.value ?? null,
        created_at: transfer.created_at,
      });
    }

    await writer.close();

    return {
      filePath,
      rowCount: transfers.length,
      timestamp,
    };
  }

  /**
   * Export full dataset (all entities)
   */
  async exportAll(store: Store): Promise<Record<string, ExportResult>> {
    const results: Record<string, ExportResult> = {};

    try {
      results.interactions = await this.exportInteractions(store);
    } catch (error) {
      console.error("Failed to export interactions:", error);
      results.interactions = this.failedExport(new Date().toISOString());
    }

    try {
      results.settlements = await this.exportSettlements(store);
    } catch (error) {
      console.error("Failed to export settlements:", error);
      results.settlements = this.failedExport(new Date().toISOString());
    }

    try {
      results.evidence = await this.exportEvidence(store);
    } catch (error) {
      console.error("Failed to export evidence:", error);
      results.evidence = this.failedExport(new Date().toISOString());
    }

    try {
      results.walletSnapshots = await this.exportWalletSnapshots(store);
    } catch (error) {
      console.error("Failed to export wallet snapshots:", error);
      results.walletSnapshots = this.failedExport(new Date().toISOString());
    }

    try {
      results.receipts = await this.exportReceipts(store);
    } catch (error) {
      console.error("Failed to export receipts:", error);
      results.receipts = this.failedExport(new Date().toISOString());
    }

    const wallets = store.getActiveWallets(365);
    for (const wallet of wallets) {
      try {
        const baseTxResult = await this.exportBaseTransactions(store, wallet);
        results[`baseTransactions_${wallet}`] = baseTxResult;
      } catch (error) {
        console.error(`Failed to export base transactions for wallet ${wallet}:`, error);
        results[`baseTransactions_${wallet}`] = this.failedExport(new Date().toISOString());
      }

      try {
        const transfersResult = await this.exportTokenTransfers(store, wallet);
        results[`tokenTransfers_${wallet}`] = transfersResult;
      } catch (error) {
        console.error(`Failed to export token transfers for wallet ${wallet}:`, error);
        results[`tokenTransfers_${wallet}`] = this.failedExport(new Date().toISOString());
      }

      try {
        const attestationsResult = await this.exportAttestations(store, wallet);
        results[`attestations_${wallet}`] = attestationsResult;
      } catch (error) {
        console.error(`Failed to export attestations for wallet ${wallet}:`, error);
        results[`attestations_${wallet}`] = this.failedExport(new Date().toISOString());
      }
    }

    return results;
  }

  /**
   * Bootstrap function: Export all existing SQLite data to Parquet
   * This is a one-time operation to migrate existing data
   */
  async bootstrapExport(store: Store): Promise<{
    success: boolean;
    results: Record<string, ExportResult>;
    errors: string[];
  }> {
    console.log("Starting bootstrap export of all SQLite data to Parquet...");
    const errors: string[] = [];
    const results = await this.exportAll(store);

    for (const [key, result] of Object.entries(results)) {
      if (result.rowCount > 0) {
        console.log(`Exported ${key}: ${result.rowCount} records to ${result.filePath}`);
      } else if (result.filePath === "") {
        errors.push(`Failed to export ${key}`);
      }
    }

    const success = errors.length === 0;

    console.log(`Bootstrap export completed. Success: ${success}, Errors: ${errors.length}`);

    return {
      success,
      results,
      errors,
    };
  }
}
