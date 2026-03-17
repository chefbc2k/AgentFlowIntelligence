import { HttpClient } from "./http-client";
import { RateLimiter } from "./rate-limiter";

export interface ProtocolInfo {
  id?: string;
  name?: string;
  address?: string;
  symbol?: string;
  url?: string;
  description?: string;
  chain?: string;
  logo?: string;
  category?: string;
  tvl?: number;
  [key: string]: unknown;
}

export interface ChainMetrics {
  tokenSymbol?: string;
  tvl?: number;
  chainId?: number;
  [key: string]: unknown;
}

export interface PriceData {
  price: number;
  symbol?: string;
  timestamp?: number;
  confidence?: number;
}

/**
 * DefiLlama API client for protocol metadata and fallback pricing
 * Free tier with unspecified limits (use conservative rate limiting)
 */
export class DefiLlamaClient extends HttpClient {
  constructor() {
    super({
      baseUrl: "https://api.llama.fi",
      rateLimiter: new RateLimiter({ requestsPerMinute: 60 }), // Conservative limit
    });
  }

  /**
   * Get current prices for multiple tokens
   * Format: "chain:address" e.g., "base:0x833..."
   */
  async getCurrentPrices(coinIds: string[]): Promise<Record<string, PriceData>> {
    const coinIdsStr = coinIds.join(",");

    try {
      const response = await this.get<{
        coins: Record<
          string,
          {
            price?: number;
            symbol?: string;
            timestamp?: number;
            confidence?: number;
          }
        >;
      }>(`https://coins.llama.fi/prices/current/${coinIdsStr}`, {
        cacheTTL: 300, // Cache for 5 minutes
      });

      const result: Record<string, PriceData> = {};
      for (const [key, data] of Object.entries(response.coins || {})) {
        if (typeof data.price === "number") {
          result[key] = {
            price: data.price,
            symbol: data.symbol,
            timestamp: data.timestamp,
            confidence: data.confidence,
          };
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  /**
   * Get protocol metadata by slug
   */
  async getProtocolMetadata(protocolSlug: string): Promise<ProtocolInfo | null> {
    try {
      const response = await this.get<ProtocolInfo>(`/protocol/${protocolSlug}`, {
        cacheTTL: 3600, // Cache for 1 hour
      });
      return response;
    } catch {
      return null;
    }
  }

  /**
   * Get chain TVL and metrics
   */
  async getChainTVL(chain: string): Promise<ChainMetrics | null> {
    try {
      const response = await this.get<ChainMetrics>(`/charts/${chain}`, {
        cacheTTL: 3600, // Cache for 1 hour
      });
      return response;
    } catch {
      return null;
    }
  }

  /**
   * List all protocols
   * Useful for building a protocol name → category mapping
   */
  async listProtocols(): Promise<ProtocolInfo[]> {
    try {
      const response = await this.get<ProtocolInfo[]>("/protocols", {
        cacheTTL: 86400, // Cache for 24 hours
      });
      return response || [];
    } catch {
      return [];
    }
  }

  /**
   * Get protocol categories
   * Maps protocol names to categories (dex, lending, bridge, etc.)
   */
  async getProtocolCategories(): Promise<Record<string, string>> {
    const protocols = await this.listProtocols();
    const categories: Record<string, string> = {};

    for (const protocol of protocols) {
      if (protocol.name && protocol.category) {
        categories[protocol.name.toLowerCase()] = protocol.category.toLowerCase();
      }
    }

    return categories;
  }
}
