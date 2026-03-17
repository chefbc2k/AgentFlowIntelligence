/**
 * Token bucket rate limiter for API request throttling
 * Ensures compliance with free tier rate limits
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(private readonly config: { requestsPerMinute: number }) {
    this.maxTokens = config.requestsPerMinute;
    this.tokens = this.maxTokens;
    this.refillRate = config.requestsPerMinute / 60000; // convert to tokens per ms
    this.lastRefill = Date.now();
  }

  /**
   * Acquires a token from the bucket, waiting if necessary
   * Uses token bucket algorithm with continuous refill
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time until next token is available
    const tokensNeeded = 1 - this.tokens;
    const waitMs = Math.ceil(tokensNeeded / this.refillRate);

    await this.sleep(waitMs);
    this.refill();
    this.tokens -= 1;
  }

  /**
   * Refills tokens based on time elapsed since last refill
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Returns current token count (for testing/monitoring)
   */
  getTokenCount(): number {
    this.refill();
    return this.tokens;
  }
}
