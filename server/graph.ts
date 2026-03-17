import { HttpClient } from "./http-client";
import { RateLimiter } from "./rate-limiter";

export interface Position {
  id: string;
  owner?: string;
  liquidity?: string;
  token0?: { symbol?: string; address?: string };
  token1?: { symbol?: string; address?: string };
  [key: string]: unknown;
}

export interface Deposit {
  id: string;
  user?: string;
  amount?: string;
  reserve?: { symbol?: string; underlyingAsset?: string };
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * The Graph Gateway client for protocol-specific subgraphs
 * Free tier: 100,000 queries/month per subgraph
 * Solves Problem 2: Protocol entity models and semantics
 */
export class GraphClient extends HttpClient {
  constructor(apiKey: string, private subgraphId?: string) {
    super({
      baseUrl: subgraphId
        ? `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`
        : `https://gateway.thegraph.com/api/${apiKey}`,
      defaultHeaders: {
        "Content-Type": "application/json",
      },
      rateLimiter: new RateLimiter({ requestsPerMinute: 1000 }), // Track monthly quota separately
    });
  }

  /**
   * Execute a GraphQL query
   */
  async query<T>(graphql: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await this.post<{ data?: T; errors?: Array<{ message: string }> }>(
      "/",
      {
        query: graphql,
        variables,
      },
      {
        cacheTTL: 60, // Cache for 1 minute
      },
    );

    if (response.errors && response.errors.length > 0) {
      throw new Error(`GraphQL error: ${response.errors[0].message}`);
    }

    if (!response.data) {
      throw new Error("No data returned from GraphQL query");
    }

    return response.data;
  }

  /**
   * Get Uniswap V3 positions for a wallet
   * Example for Uniswap V3 on Base subgraph
   */
  async getUniswapPositions(address: string): Promise<Position[]> {
    const graphql = `
      query GetPositions($owner: String!) {
        positions(where: { owner: $owner }, first: 100, orderBy: liquidity, orderDirection: desc) {
          id
          owner
          liquidity
          token0 {
            symbol
            id
          }
          token1 {
            symbol
            id
          }
          depositedToken0
          depositedToken1
          withdrawnToken0
          withdrawnToken1
        }
      }
    `;

    try {
      const result = await this.query<{ positions: Position[] }>(graphql, {
        owner: address.toLowerCase(),
      });
      return result.positions || [];
    } catch (error) {
      console.error("Graph Uniswap positions query failed:", error);
      return [];
    }
  }

  /**
   * Get Aave V3 deposits for a wallet
   * Example for Aave V3 on Base subgraph
   */
  async getAaveDeposits(address: string): Promise<Deposit[]> {
    const graphql = `
      query GetDeposits($user: String!) {
        deposits(where: { user: $user }, first: 100, orderBy: timestamp, orderDirection: desc) {
          id
          user
          amount
          reserve {
            symbol
            underlyingAsset
          }
          timestamp
        }
      }
    `;

    try {
      const result = await this.query<{ deposits: Deposit[] }>(graphql, {
        user: address.toLowerCase(),
      });
      return result.deposits || [];
    } catch (error) {
      console.error("Graph Aave deposits query failed:", error);
      return [];
    }
  }

  /**
   * Get protocol interactions for a wallet (generic query)
   * Useful for discovering what protocols a wallet has used
   */
  async getProtocolInteractions(address: string): Promise<Array<{ protocol: string; txCount: number }>> {
    const graphql = `
      query GetInteractions($address: String!) {
        account(id: $address) {
          id
          transactionCount
          positions {
            id
          }
        }
      }
    `;

    try {
      const result = await this.query<{
        account?: { transactionCount?: number; positions?: Array<{ id: string }> };
      }>(graphql, {
        address: address.toLowerCase(),
      });

      if (!result.account) {
        return [];
      }

      return [
        {
          protocol: "detected",
          txCount: result.account.transactionCount || 0,
        },
      ];
    } catch (error) {
      console.error("Graph protocol interactions query failed:", error);
      return [];
    }
  }

  /**
   * Create a new client instance for a different subgraph
   */
  forSubgraph(subgraphId: string, apiKey: string): GraphClient {
    return new GraphClient(apiKey, subgraphId);
  }
}
