import { HttpClient } from "./http-client";
import { RateLimiter } from "./rate-limiter";

export interface BlockscoutTx {
  txHash: string;
  blockNumber?: number;
  timestamp?: string;
  from?: string;
  to?: string;
  value?: string;
  status?: "confirmed" | "failed" | "unknown";
  raw?: unknown;
}

export interface BlockscoutTransfer {
  txHash: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  from?: string;
  to?: string;
  value?: string;
  timestamp?: string;
  raw?: unknown;
}

interface BlockscoutApiTx {
  hash: string;
  block?: number;
  timestamp?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  value?: string;
  status?: string;
  [key: string]: unknown;
}

interface BlockscoutApiTransfer {
  tx_hash?: string;
  token?: { address?: string; symbol?: string };
  from?: { hash?: string };
  to?: { hash?: string };
  total?: { value?: string };
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Transform Blockscout API transaction to normalized format
 */
function transformTx(apiTx: BlockscoutApiTx): BlockscoutTx {
  return {
    txHash: apiTx.hash,
    blockNumber: apiTx.block,
    timestamp: apiTx.timestamp,
    from: apiTx.from?.hash,
    to: apiTx.to?.hash,
    value: apiTx.value,
    status: apiTx.status === "ok" ? "confirmed" : apiTx.status === "error" ? "failed" : "unknown",
    raw: apiTx,
  };
}

/**
 * Transform Blockscout API transfer to normalized format
 */
function transformTransfer(apiTransfer: BlockscoutApiTransfer): BlockscoutTransfer | null {
  if (!apiTransfer.tx_hash) return null;

  return {
    txHash: apiTransfer.tx_hash,
    tokenAddress: apiTransfer.token?.address,
    tokenSymbol: apiTransfer.token?.symbol,
    from: apiTransfer.from?.hash,
    to: apiTransfer.to?.hash,
    value: apiTransfer.total?.value,
    timestamp: apiTransfer.timestamp,
    raw: apiTransfer,
  };
}

/**
 * Blockscout PRO API client for Base blockchain
 * Free tier: 100K API credits/day, 5 req/sec
 */
export class BlockscoutClient extends HttpClient {
  constructor(apiKey: string) {
    super({
      baseUrl: "https://api.blockscout.com/8453/api/v2",
      defaultHeaders: {
        authorization: `Bearer ${apiKey}`,
      },
      rateLimiter: new RateLimiter({ requestsPerMinute: 300 }), // 5 req/sec
    });
  }

  /**
   * Get transaction details by hash
   */
  async getTransaction(txHash: string): Promise<BlockscoutTx | null> {
    try {
      const result = await this.get<BlockscoutApiTx>(`/transactions/${txHash}`);
      return transformTx(result);
    } catch {
      return null;
    }
  }

  /**
   * Get transactions for an address
   */
  async getAddressTransactions(address: string): Promise<BlockscoutTx[]> {
    try {
      const result = await this.get<{ items?: BlockscoutApiTx[] }>(`/addresses/${address}/transactions`, {
        cacheTTL: 60, // Cache for 1 minute
      });
      return (result.items || []).map(transformTx);
    } catch {
      return [];
    }
  }

  /**
   * Get token transfers for an address
   */
  async getTokenTransfers(address: string): Promise<BlockscoutTransfer[]> {
    try {
      const result = await this.get<{ items?: BlockscoutApiTransfer[] }>(`/addresses/${address}/token-transfers`, {
        cacheTTL: 60, // Cache for 1 minute
      });
      return (result.items || []).map(transformTransfer).filter((t): t is BlockscoutTransfer => t !== null);
    } catch {
      return [];
    }
  }
}
