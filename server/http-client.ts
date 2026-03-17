import type { RateLimiter } from "./rate-limiter";
import type { Cache } from "./cache";

export interface HttpClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  rateLimiter?: RateLimiter;
  cache?: Cache;
  retryConfig?: {
    maxRetries: number;
    backoffMs: number;
  };
}

export interface RequestOptions {
  headers?: Record<string, string>;
  cacheTTL?: number; // Cache TTL in seconds (only for GET requests)
  skipCache?: boolean; // Force skip cache
  skipRateLimit?: boolean; // Skip rate limiting (use carefully)
}

/**
 * Base HTTP client with rate limiting, caching, and retry logic
 * Designed for external API integrations with free tier limits
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly rateLimiter?: RateLimiter;
  private readonly cache?: Cache;
  private readonly maxRetries: number;
  private readonly backoffMs: number;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl;
    this.defaultHeaders = config.defaultHeaders || {};
    this.rateLimiter = config.rateLimiter;
    this.cache = config.cache;
    this.maxRetries = config.retryConfig?.maxRetries ?? 3;
    this.backoffMs = config.retryConfig?.backoffMs ?? 1000;
  }

  /**
   * GET request with optional caching
   */
  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    const cacheKey = this.resolveUrl(path);

    // Check cache first (if enabled and not skipped)
    if (this.cache && options?.cacheTTL && !options?.skipCache) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    // Execute request with retries
    const response = await this.executeWithRetry<T>("GET", path, undefined, options);

    // Cache successful response (if TTL provided)
    if (this.cache && options?.cacheTTL && response) {
      this.cache.set(cacheKey, response, options.cacheTTL);
    }

    return response;
  }

  /**
   * POST request (no caching)
   */
  async post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.executeWithRetry<T>("POST", path, body, options);
  }

  /**
   * Executes HTTP request with retry logic and rate limiting
   */
  private async executeWithRetry<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    let lastError = new Error("Request failed after retries");

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // Apply rate limiting
        if (this.rateLimiter && !options?.skipRateLimit) {
          await this.rateLimiter.acquire();
        }

        // Build request
        const url = this.resolveUrl(path);
        const headers = {
          ...this.defaultHeaders,
          ...options?.headers,
        };

        const fetchOptions: RequestInit = {
          method,
          headers,
        };

        if (body !== undefined) {
          fetchOptions.body = JSON.stringify(body);
          if (!headers["content-type"] && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
          }
        }

        // Execute fetch
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Parse JSON response
        const data = await response.json();
        return data as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          break;
        }

        // Exponential backoff
        const backoff = this.backoffMs * Math.pow(2, attempt);
        await this.sleep(backoff);
      }
    }

    throw lastError;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resolveUrl(path: string): string {
    if (/^https?:\/\//u.test(path)) {
      return path;
    }

    return `${this.baseUrl}${path}`;
  }
}
