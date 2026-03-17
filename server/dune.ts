import { HttpClient } from "./http-client";
import { RateLimiter } from "./rate-limiter";

interface DuneExecuteResponse {
  execution_id: string;
  state?: string;
}

interface DuneResultsResponse {
  execution_id: string;
  query_id?: number;
  state: "QUERY_STATE_PENDING" | "QUERY_STATE_EXECUTING" | "QUERY_STATE_COMPLETED" | "QUERY_STATE_FAILED";
  result?: {
    rows?: Array<Record<string, unknown>>;
    metadata?: {
      column_names?: string[];
      [key: string]: unknown;
    };
  };
}

export interface ProtocolActivity {
  blockTime?: string;
  txHash?: string;
  protocolName?: string;
  category?: string;
  fromAddress?: string;
  toAddress?: string;
  amountUSD?: number;
  contractAddress?: string;
  chainId?: number;
}

/**
 * Dune Data API client for protocol semantics
 * Free tier: 15 rpm (low) / 40 rpm (high)
 * Solves Problem 2: Protocol labeling via SQL queries
 */
export class DuneClient extends HttpClient {
  constructor(apiKey: string) {
    super({
      baseUrl: "https://api.dune.com/api/v1",
      defaultHeaders: {
        "X-DUNE-API-KEY": apiKey,
      },
      rateLimiter: new RateLimiter({ requestsPerMinute: 15 }), // Conservative limit
    });
  }

  /**
   * Execute a SQL query and wait for results
   * Uses polling to wait for query completion
   */
  async executeQuery(sql: string, params?: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    // Step 1: Submit query for execution
    const execution = await this.post<DuneExecuteResponse>("/sql/execute", {
      sql,
      parameters: params,
      performance: "medium",
    });

    const executionId = execution.execution_id;

    // Step 2: Poll for results
    const maxAttempts = 30; // 30 * 2 seconds = 1 minute max wait
    const pollInterval = 2000; // 2 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      const results = await this.get<DuneResultsResponse>(`/execution/${executionId}/results`);

      if (results.state === "QUERY_STATE_COMPLETED") {
        return results.result?.rows || [];
      }

      if (results.state === "QUERY_STATE_FAILED") {
        throw new Error("Dune query failed");
      }

      // Continue polling if still executing or pending
    }

    throw new Error("Dune query timeout");
  }

  /**
   * Get protocol activity for a wallet address
   * Queries DEX trades, bridges, lending, etc.
   */
  async getProtocolActivity(address: string, startDate: string): Promise<ProtocolActivity[]> {
    const sql = `
      SELECT
        block_time as blockTime,
        tx_hash as txHash,
        protocol as protocolName,
        category,
        "from" as fromAddress,
        "to" as toAddress,
        amount_usd as amountUSD,
        contract_address as contractAddress,
        8453 as chainId
      FROM dex.trades
      WHERE blockchain = 'base'
        AND (lower("from") = lower(@address) OR lower("to") = lower(@address))
        AND block_time > @start_date
      ORDER BY block_time DESC
      LIMIT 100
    `;

    try {
      const rows = await this.executeQuery(sql, {
        address,
        start_date: startDate,
      });

      return rows.map((row) => ({
        blockTime: row.blockTime as string | undefined,
        txHash: row.txHash as string | undefined,
        protocolName: row.protocolName as string | undefined,
        category: row.category as string | undefined,
        fromAddress: row.fromAddress as string | undefined,
        toAddress: row.toAddress as string | undefined,
        amountUSD: typeof row.amountUSD === "number" ? row.amountUSD : undefined,
        contractAddress: row.contractAddress as string | undefined,
        chainId: typeof row.chainId === "number" ? row.chainId : 8453,
      }));
    } catch (error) {
      console.error("Dune protocol activity query failed:", error);
      return [];
    }
  }

  /**
   * Get escrow completions for a wallet
   * Looks for completed escrow/payment protocols
   */
  async getEscrowCompletions(address: string): Promise<ProtocolActivity[]> {
    // Note: This is a simplified example. Real implementation would need
    // a specific escrow protocol table or custom query
    const sql = `
      SELECT
        block_time as blockTime,
        tx_hash as txHash,
        protocol as protocolName,
        'escrow' as category,
        "from" as fromAddress,
        "to" as toAddress,
        amount_usd as amountUSD,
        contract_address as contractAddress,
        8453 as chainId
      FROM base.transactions
      WHERE lower("from") = lower(@address)
        OR lower("to") = lower(@address)
      ORDER BY block_time DESC
      LIMIT 50
    `;

    try {
      const rows = await this.executeQuery(sql, { address });

      return rows.map((row) => ({
        blockTime: row.blockTime as string | undefined,
        txHash: row.txHash as string | undefined,
        protocolName: row.protocolName as string | undefined,
        category: (row.category as string | undefined) || "escrow",
        fromAddress: row.fromAddress as string | undefined,
        toAddress: row.toAddress as string | undefined,
        amountUSD: typeof row.amountUSD === "number" ? row.amountUSD : undefined,
        contractAddress: row.contractAddress as string | undefined,
        chainId: typeof row.chainId === "number" ? row.chainId : 8453,
      }));
    } catch (error) {
      console.error("Dune escrow query failed:", error);
      return [];
    }
  }
}
