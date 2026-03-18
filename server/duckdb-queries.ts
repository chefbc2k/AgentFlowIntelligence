import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type DatabaseConnection = {
  prepare(sql: string): {
    all(...params: SQLInputValue[]): unknown[];
  };
  close?: () => void;
};

export interface DashboardAnalyticsFilters {
  wallet?: string;
  counterparty?: string;
  protocol?: string;
  startDate?: string;
  endDate?: string;
}

export interface DashboardAnalyticsOptions {
  topLimit?: number;
  recentLimit?: number;
}

export interface DashboardAnalyticsResult {
  filters: DashboardAnalyticsFilters;
  totals: {
    totalInteractions: number;
    uniqueWallets: number;
    uniqueCounterparties: number;
    confirmedSettlements: number;
    settlementRate: number;
  };
  dailySeries: Array<{ date: string; count: number }>;
  topWallets: Array<{ wallet_address: string; count: number }>;
  topCounterparties: Array<{ counterparty: string; count: number }>;
  protocolSeries: Array<{ protocol: string; count: number }>;
  settlementSuccessRateByCounterparty: Array<{ counterparty: string; total: number; confirmed: number; rate: number }>;
  recentInteractions: Array<{
    id: string;
    created_at: string;
    wallet_address: string | null;
    counterparty: string | null;
    service: string | null;
    settlement_status: string | null;
    tx_hash: string | null;
  }>;
}

/**
 * SQLite-backed analytical query engine.
 * Provides analytical queries over AFI data using node:sqlite.
 */
export class DuckDBQueryEngine {
  private db: DatabaseConnection;
  private ownsConnection: boolean;

  constructor(dbPathOrConnection: string | DatabaseConnection = ":memory:") {
    if (typeof dbPathOrConnection === "string") {
      this.db = new DatabaseSync(dbPathOrConnection);
      this.ownsConnection = true;
    } else {
      this.db = dbPathOrConnection;
      this.ownsConnection = false;
    }
  }

  /**
   * Execute a raw SQL query
   */
  query<T = unknown>(sql: string, params?: SQLInputValue[]): T[] {
    try {
      const stmt = this.db.prepare(sql);
      const result = params ? stmt.all(...params) : stmt.all();
      return result as T[];
    } catch (error) {
      throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildInteractionFilter(filters: DashboardAnalyticsFilters = {}) {
    const clauses: string[] = ["1 = 1"];
    const params: SQLInputValue[] = [];

    if (filters.wallet) {
      clauses.push("LOWER(i.wallet_address) = LOWER(?)");
      params.push(filters.wallet);
    }

    if (filters.counterparty) {
      clauses.push("LOWER(i.counterparty) = LOWER(?)");
      params.push(filters.counterparty);
    }

    if (filters.protocol) {
      clauses.push("LOWER(i.protocol) = LOWER(?)");
      params.push(filters.protocol);
    }

    if (filters.startDate) {
      clauses.push("i.created_at >= ?");
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      clauses.push("i.created_at <= ?");
      params.push(filters.endDate);
    }

    return {
      whereClause: `WHERE ${clauses.join(" AND ")}`,
      params,
    };
  }

  /**
   * Get interaction count by date
   */
  getInteractionCountByDate(): Array<{ date: string; count: number }> {
    return this.query<{ date: string; count: number }>(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM interactions
      GROUP BY DATE(created_at)
      ORDER BY date DESC`
    );
  }

  /**
   * Get top wallets by interaction count
   */
  getTopWalletsByInteractionCount(limit: number = 10): Array<{ wallet_address: string; count: number }> {
    return this.query<{ wallet_address: string; count: number }>(
      `SELECT
        wallet_address,
        COUNT(*) as count
      FROM interactions
      WHERE wallet_address IS NOT NULL
      GROUP BY wallet_address
      ORDER BY count DESC, wallet_address ASC
      LIMIT ?`,
      [limit]
    );
  }

  /**
   * Get top counterparties by interaction count
   */
  getTopCounterparties(limit: number = 10): Array<{ counterparty: string; count: number }> {
    return this.query<{ counterparty: string; count: number }>(
      `SELECT
        counterparty,
        COUNT(*) as count
      FROM interactions
      WHERE counterparty IS NOT NULL
      GROUP BY counterparty
      ORDER BY count DESC, counterparty ASC
      LIMIT ?`,
      [limit]
    );
  }

  /**
   * Get settlement success rate by counterparty
   */
  getSettlementSuccessRate(): Array<{ counterparty: string; total: number; confirmed: number; rate: number }> {
    return this.query<{ counterparty: string; total: number; confirmed: number; rate: number }>(
      `SELECT
        i.counterparty,
        COUNT(*) as total,
        SUM(CASE WHEN s.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        CAST(SUM(CASE WHEN s.status = 'confirmed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as rate
      FROM interactions i
      LEFT JOIN settlements s ON i.id = s.interaction_id
      WHERE i.counterparty IS NOT NULL
      GROUP BY i.counterparty
      ORDER BY total DESC, i.counterparty ASC`
    );
  }

  /**
   * Get protocol usage statistics
   */
  getProtocolUsage(): Array<{ protocol: string; count: number }> {
    return this.query<{ protocol: string; count: number }>(
      `SELECT
        protocol,
        COUNT(*) as count
      FROM interactions
      WHERE protocol IS NOT NULL
      GROUP BY protocol
      ORDER BY count DESC, protocol ASC`
    );
  }

  /**
   * Get wallet activity summary
   */
  getWalletActivitySummary(
    walletAddress: string
  ): Array<{
    wallet_address: string;
    total_interactions: number;
    unique_counterparties: number;
    first_seen: string;
    last_seen: string;
  }> {
    return this.query<{
      wallet_address: string;
      total_interactions: number;
      unique_counterparties: number;
      first_seen: string;
      last_seen: string;
    }>(
      `SELECT
        wallet_address,
        COUNT(*) as total_interactions,
        COUNT(DISTINCT counterparty) as unique_counterparties,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen
      FROM interactions
      WHERE wallet_address = ?
      GROUP BY wallet_address`,
      [walletAddress]
    );
  }

  /**
   * Get time series of interaction counts
   */
  getInteractionTimeSeries(
    granularity: "hour" | "day" | "week" = "day"
  ): Array<{ period: string; count: number }> {
    const dateFormat =
      granularity === "hour"
        ? "strftime('%Y-%m-%d %H:00:00', created_at)"
        : granularity === "week"
          ? "date(created_at, 'weekday 0', '-6 days')"
          : "date(created_at)";

    return this.query<{ period: string; count: number }>(
      `SELECT
        ${dateFormat} as period,
        COUNT(*) as count
      FROM interactions
      GROUP BY period
      ORDER BY period DESC`
    );
  }

  /**
   * Get transactions by status
   */
  getTransactionsByStatus(): Array<{ status: string; count: number }> {
    return this.query<{ status: string; count: number }>(
      `SELECT
        status,
        COUNT(*) as count
      FROM base_transactions
      GROUP BY status
      ORDER BY count DESC, status ASC`
    );
  }

  /**
   * Get token transfer volume by token
   */
  getTokenTransferVolume(): Array<{ token_symbol: string; transfer_count: number }> {
    return this.query<{ token_symbol: string; transfer_count: number }>(
      `SELECT
        COALESCE(token_symbol, 'unknown') as token_symbol,
        COUNT(*) as transfer_count
      FROM token_transfers
      GROUP BY COALESCE(token_symbol, 'unknown')
      ORDER BY transfer_count DESC, token_symbol ASC`
    );
  }

  /**
   * Get wallet interaction heatmap (day of week x hour of day)
   */
  getInteractionHeatmap(walletAddress: string): Array<{ day_of_week: number; hour: number; count: number }> {
    return this.query<{ day_of_week: number; hour: number; count: number }>(
      `SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM interactions
      WHERE wallet_address = ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week ASC, hour ASC`,
      [walletAddress]
    );
  }

  /**
   * Get counterparty repeat rate
   */
  getCounterpartyRepeatRate(): Array<{
    counterparty: string;
    total_interactions: number;
    unique_wallets: number;
    repeat_rate: number;
  }> {
    return this.query<{
      counterparty: string;
      total_interactions: number;
      unique_wallets: number;
      repeat_rate: number;
    }>(
      `SELECT
        counterparty,
        COUNT(*) as total_interactions,
        COUNT(DISTINCT wallet_address) as unique_wallets,
        CAST(COUNT(*) AS REAL) / COUNT(DISTINCT wallet_address) as repeat_rate
      FROM interactions
      WHERE counterparty IS NOT NULL AND wallet_address IS NOT NULL
      GROUP BY counterparty
      HAVING COUNT(*) > 1
      ORDER BY repeat_rate DESC`
    );
  }

  /**
   * Get recent interactions with full context
   */
  getRecentInteractionsWithContext(
    limit: number = 50
  ): Array<{
    id: string;
    created_at: string;
    wallet_address: string | null;
    counterparty: string | null;
    service: string | null;
    settlement_status: string | null;
    tx_hash: string | null;
  }> {
    return this.query<{
      id: string;
      created_at: string;
      wallet_address: string | null;
      counterparty: string | null;
      service: string | null;
      settlement_status: string | null;
      tx_hash: string | null;
    }>(
      `SELECT
        i.id,
        i.created_at,
        i.wallet_address,
        i.counterparty,
        i.service,
        s.status as settlement_status,
        s.tx_hash
      FROM interactions i
      LEFT JOIN settlements s ON i.id = s.interaction_id
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ?`,
      [limit]
    );
  }

  getDashboardOverview(
    filters: DashboardAnalyticsFilters = {},
    options: DashboardAnalyticsOptions = {},
  ): DashboardAnalyticsResult {
    const { whereClause, params } = this.buildInteractionFilter(filters);
    const topLimit = Math.max(1, options.topLimit ?? 5);
    const recentLimit = Math.max(1, options.recentLimit ?? 10);

    const [totals] = this.query<{
      total_interactions: number;
      unique_wallets: number;
      unique_counterparties: number;
      confirmed_settlements: number;
      settlement_rate: number;
    }>(
      `
      SELECT
        COUNT(*) AS total_interactions,
        COUNT(DISTINCT i.wallet_address) AS unique_wallets,
        COUNT(DISTINCT i.counterparty) AS unique_counterparties,
        COALESCE(SUM(CASE WHEN s.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_settlements,
        COALESCE(CAST(SUM(CASE WHEN s.status = 'confirmed' THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(s.id), 0), 0) AS settlement_rate
      FROM interactions i
      LEFT JOIN settlements s ON i.id = s.interaction_id
      ${whereClause}
      `,
      params,
    );

    const dailySeries = this.query<{ date: string; count: number }>(
      `
      SELECT
        DATE(i.created_at) AS date,
        COUNT(*) AS count
      FROM interactions i
      ${whereClause}
      GROUP BY DATE(i.created_at)
      ORDER BY date ASC
      `,
      params,
    );

    const topWallets = this.query<{ wallet_address: string; count: number }>(
      `
      SELECT
        i.wallet_address,
        COUNT(*) AS count
      FROM interactions i
      ${whereClause}
      AND i.wallet_address IS NOT NULL
      GROUP BY i.wallet_address
      ORDER BY count DESC, i.wallet_address ASC
      LIMIT ?
      `,
      [...params, topLimit],
    );

    const topCounterparties = this.query<{ counterparty: string; count: number }>(
      `
      SELECT
        i.counterparty,
        COUNT(*) AS count
      FROM interactions i
      ${whereClause}
      AND i.counterparty IS NOT NULL
      GROUP BY i.counterparty
      ORDER BY count DESC, i.counterparty ASC
      LIMIT ?
      `,
      [...params, topLimit],
    );

    const protocolSeries = this.query<{ protocol: string; count: number }>(
      `
      SELECT
        i.protocol,
        COUNT(*) AS count
      FROM interactions i
      ${whereClause}
      GROUP BY i.protocol
      ORDER BY count DESC, i.protocol ASC
      `,
      params,
    );

    const settlementSuccessRateByCounterparty = this.query<{
      counterparty: string;
      total: number;
      confirmed: number;
      rate: number;
    }>(
      `
      SELECT
        i.counterparty AS counterparty,
        COUNT(*) AS total,
        SUM(CASE WHEN s.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
        CAST(SUM(CASE WHEN s.status = 'confirmed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS rate
      FROM interactions i
      LEFT JOIN settlements s ON i.id = s.interaction_id
      ${whereClause}
      AND i.counterparty IS NOT NULL
      GROUP BY i.counterparty
      ORDER BY total DESC, i.counterparty ASC
      `,
      params,
    );

    const recentInteractions = this.query<{
      id: string;
      created_at: string;
      wallet_address: string | null;
      counterparty: string | null;
      service: string | null;
      settlement_status: string | null;
      tx_hash: string | null;
    }>(
      `
      SELECT
        i.id,
        i.created_at,
        i.wallet_address,
        i.counterparty,
        i.service,
        s.status AS settlement_status,
        s.tx_hash
      FROM interactions i
      LEFT JOIN settlements s ON i.id = s.interaction_id
      ${whereClause}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ?
      `,
      [...params, recentLimit],
    );

    return {
      filters,
      totals: {
        totalInteractions: Number(totals.total_interactions),
        uniqueWallets: Number(totals.unique_wallets),
        uniqueCounterparties: Number(totals.unique_counterparties),
        confirmedSettlements: Number(totals.confirmed_settlements),
        settlementRate: Number(totals.settlement_rate),
      },
      dailySeries,
      topWallets,
      topCounterparties,
      protocolSeries,
      settlementSuccessRateByCounterparty,
      recentInteractions,
    };
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.ownsConnection && this.db.close) {
      this.db.close();
    }
  }
}

/**
 * Feature extraction utilities for ML/analytics
 */
export class FeatureExtractor {
  /**
   * Extract time-based features from ISO timestamp
   */
  extractTimeFeatures(timestamp: string): {
    hour: number;
    dayOfWeek: number;
    dayOfMonth: number;
    month: number;
    isWeekend: boolean;
    isBusinessHours: boolean;
  } {
    const date = new Date(timestamp);
    const hour = date.getUTCHours();
    const dayOfWeek = date.getUTCDay();

    return {
      hour,
      dayOfWeek,
      dayOfMonth: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      isBusinessHours: hour >= 9 && hour < 17 && dayOfWeek >= 1 && dayOfWeek <= 5,
    };
  }

  /**
   * Extract wallet behavior features
   */
  extractWalletFeatures(interactions: Array<{ created_at: string; counterparty?: string | null }>): {
    totalInteractions: number;
    uniqueCounterparties: number;
    repeatRate: number;
    avgInteractionsPerDay: number;
    daysSinceFirst: number;
  } {
    if (interactions.length === 0) {
      return {
        totalInteractions: 0,
        uniqueCounterparties: 0,
        repeatRate: 0,
        avgInteractionsPerDay: 0,
        daysSinceFirst: 0,
      };
    }

    const counterparties = new Set(
      interactions.map((i) => i.counterparty).filter((c): c is string => c !== null && c !== undefined)
    );
    const timestamps = interactions.map((i) => new Date(i.created_at).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const daysSinceFirst = (maxTime - minTime) / (1000 * 60 * 60 * 24);

    return {
      totalInteractions: interactions.length,
      uniqueCounterparties: counterparties.size,
      repeatRate: counterparties.size > 0 ? interactions.length / counterparties.size : 0,
      avgInteractionsPerDay: daysSinceFirst > 0 ? interactions.length / daysSinceFirst : interactions.length,
      daysSinceFirst,
    };
  }

  /**
   * Extract counterparty behavior features
   */
  extractCounterpartyFeatures(interactions: Array<{ wallet_address?: string | null; created_at: string }>): {
    totalInteractions: number;
    uniqueWallets: number;
    avgInteractionsPerWallet: number;
    concentrationRate: number;
  } {
    if (interactions.length === 0) {
      return {
        totalInteractions: 0,
        uniqueWallets: 0,
        avgInteractionsPerWallet: 0,
        concentrationRate: 0,
      };
    }

    const wallets = new Map<string, number>();
    for (const interaction of interactions) {
      const wallet = interaction.wallet_address;
      if (wallet) {
        wallets.set(wallet, (wallets.get(wallet) ?? 0) + 1);
      }
    }

    const maxWalletCount = wallets.size > 0 ? Math.max(...Array.from(wallets.values())) : 0;

    return {
      totalInteractions: interactions.length,
      uniqueWallets: wallets.size,
      avgInteractionsPerWallet: wallets.size > 0 ? interactions.length / wallets.size : 0,
      concentrationRate: wallets.size > 0 ? maxWalletCount / interactions.length : 0,
    };
  }

  /**
   * Calculate basic statistics for numeric array
   */
  calculateStats(values: number[]): {
    count: number;
    sum: number;
    mean: number;
    min: number;
    max: number;
    median: number;
    stdDev: number;
  } {
    if (values.length === 0) {
      return {
        count: 0,
        sum: 0,
        mean: 0,
        min: 0,
        max: 0,
        median: 0,
        stdDev: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);
    const mean = sum / values.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    const variance = values.reduce((acc, val) => acc + (val - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
      count: values.length,
      sum,
      mean,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median,
      stdDev,
    };
  }
}
