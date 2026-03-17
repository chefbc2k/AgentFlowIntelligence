import { HttpClient } from "./http-client";
import { RateLimiter } from "./rate-limiter";
import { Cache } from "./cache";

interface CoinGeckoPriceResponse {
  [coinId: string]: {
    usd?: number;
    [key: string]: unknown;
  };
}

interface DefiLlamaPriceResponse {
  coins: {
    [coinKey: string]: {
      price?: number;
      timestamp?: number;
      confidence?: number;
      [key: string]: unknown;
    };
  };
}

/**
 * Token info for price lookups
 */
export interface TokenInfo {
  address: string;
  chainId: number;
  symbol?: string;
}

/**
 * Pricing service with CoinGecko (primary) and DefiLlama (fallback)
 * Solves Problem 1: USD normalization for payment amounts
 */
export class PricingService {
  private coingecko: HttpClient;
  private defillama: HttpClient;
  private cache: Cache;

  // Common token mappings for CoinGecko API IDs
  private readonly COINGECKO_IDS: Record<string, string> = {
    // Base mainnet (chain 8453)
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "usd-coin", // USDC
    "0x4200000000000000000000000000000000000006": "weth", // WETH
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": "dai", // DAI
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": "usd-base-coin", // USDbC
  };

  constructor() {
    this.cache = new Cache();

    // CoinGecko Demo API: 30 calls/min, 10k calls/month
    this.coingecko = new HttpClient({
      baseUrl: "https://api.coingecko.com/api/v3",
      rateLimiter: new RateLimiter({ requestsPerMinute: 30 }),
      cache: this.cache,
    });

    // DefiLlama: free, no official rate limit (use conservative limit)
    this.defillama = new HttpClient({
      baseUrl: "https://coins.llama.fi",
      rateLimiter: new RateLimiter({ requestsPerMinute: 60 }),
      cache: this.cache,
    });
  }

  /**
   * Get USD price for a single token
   * Tries CoinGecko first, falls back to DefiLlama
   */
  async getPriceUSD(tokenAddress: string, chainId: number): Promise<number | null> {
    const cacheKey = `price:${chainId}:${tokenAddress.toLowerCase()}`;
    const cached = this.cache.get<number>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    // Try CoinGecko first
    const cgPrice = await this.getCoinGeckoPrice(tokenAddress, chainId);
    if (cgPrice !== null) {
      this.cache.set(cacheKey, cgPrice, 300); // Cache for 5 minutes
      return cgPrice;
    }

    // Fallback to DefiLlama
    const dlPrice = await this.getDefiLlamaPrice(tokenAddress, chainId);
    if (dlPrice !== null) {
      this.cache.set(cacheKey, dlPrice, 300); // Cache for 5 minutes
      return dlPrice;
    }

    return null;
  }

  /**
   * Get USD prices for multiple tokens in a batch
   * More efficient than individual calls
   */
  async batchGetPrices(tokens: TokenInfo[]): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    // Group by chain for efficiency
    const byChain = new Map<number, TokenInfo[]>();
    for (const token of tokens) {
      const existing = byChain.get(token.chainId) || [];
      existing.push(token);
      byChain.set(token.chainId, existing);
    }

    // Fetch prices for each chain
    for (const [chainId, chainTokens] of byChain.entries()) {
      for (const token of chainTokens) {
        const price = await this.getPriceUSD(token.address, chainId);
        if (price !== null) {
          const key = `${chainId}:${token.address.toLowerCase()}`;
          results.set(key, price);
        }
      }
    }

    return results;
  }

  /**
   * Normalize token amount to USD
   */
  async normalizeToUSD(amount: number, tokenAddress: string, chainId: number): Promise<number | null> {
    const price = await this.getPriceUSD(tokenAddress, chainId);
    if (price === null) return null;
    return amount * price;
  }

  /**
   * Get price from CoinGecko
   */
  private async getCoinGeckoPrice(tokenAddress: string, chainId: number): Promise<number | null> {
    // Check if we have a known CoinGecko ID
    const coinId = this.COINGECKO_IDS[tokenAddress.toLowerCase()];
    if (!coinId) {
      // Try contract address lookup (limited support)
      return this.getCoinGeckoByContract(tokenAddress, chainId);
    }

    try {
      const params = new URLSearchParams({
        ids: coinId,
        vs_currencies: "usd",
      });
      const apiKey = process.env.AFI_COINGECKO_API_KEY;
      const response = await this.coingecko.get<CoinGeckoPriceResponse>(
        `/simple/price?${params.toString()}`,
        {
          headers: apiKey
            ? {
                "x-cg-demo-api-key": apiKey,
              }
            : undefined,
        cacheTTL: 300, // 5 minutes
        },
      );

      const price = response[coinId]?.usd;
      return typeof price === "number" ? price : null;
    } catch {
      return null;
    }
  }

  /**
   * Get price from CoinGecko by contract address
   */
  private async getCoinGeckoByContract(tokenAddress: string, chainId: number): Promise<number | null> {
    const platformId = this.getCoingeckoPlatformId(chainId);
    if (!platformId) return null;

    try {
      const apiKey = process.env.AFI_COINGECKO_API_KEY;
      const response = await this.coingecko.get<{ market_data?: { current_price?: { usd?: number } } }>(
        `/coins/${platformId}/contract/${tokenAddress}`,
        {
          headers: apiKey
            ? {
                "x-cg-demo-api-key": apiKey,
              }
            : undefined,
          cacheTTL: 300,
        },
      );

      const price = response.market_data?.current_price?.usd;
      return typeof price === "number" ? price : null;
    } catch {
      return null;
    }
  }

  /**
   * Get price from DefiLlama
   */
  private async getDefiLlamaPrice(tokenAddress: string, chainId: number): Promise<number | null> {
    const chain = this.getDefiLlamaChainName(chainId);
    if (!chain) return null;

    const coinId = `${chain}:${tokenAddress}`;

    try {
      const response = await this.defillama.get<DefiLlamaPriceResponse>(`/prices/current/${coinId}`, {
        cacheTTL: 300,
      });

      const price = response.coins?.[coinId]?.price;
      return typeof price === "number" ? price : null;
    } catch {
      return null;
    }
  }

  /**
   * Map chain ID to CoinGecko platform ID
   */
  private getCoingeckoPlatformId(chainId: number): string | null {
    const platforms: Record<number, string> = {
      1: "ethereum",
      8453: "base",
      10: "optimistic-ethereum",
      42161: "arbitrum-one",
      137: "polygon-pos",
    };
    return platforms[chainId] || null;
  }

  /**
   * Map chain ID to DefiLlama chain name
   */
  private getDefiLlamaChainName(chainId: number): string | null {
    const chains: Record<number, string> = {
      1: "ethereum",
      8453: "base",
      10: "optimism",
      42161: "arbitrum",
      137: "polygon",
    };
    return chains[chainId] || null;
  }

  /**
   * Get common tokens for background polling
   */
  static getCommonTokens(): TokenInfo[] {
    return [
      // Base mainnet
      { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453, symbol: "USDC" },
      { address: "0x4200000000000000000000000000000000000006", chainId: 8453, symbol: "WETH" },
      { address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", chainId: 8453, symbol: "DAI" },
      { address: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", chainId: 8453, symbol: "USDbC" },
    ];
  }
}
