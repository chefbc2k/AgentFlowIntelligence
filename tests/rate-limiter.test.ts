import { describe, expect, it } from "vitest";
import { RateLimiter } from "../server/rate-limiter";

describe("RateLimiter", () => {
  it("allows requests within rate limit", async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 60 });

    // Should allow first request immediately
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10); // Should be nearly instant
  });

  it("throttles requests exceeding rate limit", async () => {
    // Use very low rate limit: 120 rpm = 2 req/sec
    const limiter = new RateLimiter({ requestsPerMinute: 120 });

    // Bucket starts with 120 tokens, consume them all
    for (let i = 0; i < 120; i++) {
      await limiter.acquire();
    }

    // Tokens should be depleted
    expect(limiter.getTokenCount()).toBeLessThan(1);

    // Next request should wait for refill (1 token needs 500ms at 2/sec)
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(450); // Allow margin
    expect(elapsed).toBeLessThan(700);
  });

  it("refills tokens over time", async () => {
    // 60 rpm = 1 req/sec = 1 token per 1000ms
    const limiter = new RateLimiter({ requestsPerMinute: 60 });

    // Consume all 60 tokens
    for (let i = 0; i < 60; i++) {
      await limiter.acquire();
    }

    expect(limiter.getTokenCount()).toBeLessThan(1);

    // Wait for partial refill
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have ~0.5 token available (500ms * 1 token/1000ms)
    const tokenCount = limiter.getTokenCount();
    expect(tokenCount).toBeGreaterThan(0.4);
    expect(tokenCount).toBeLessThan(0.6);
  });

  it("does not exceed max tokens", async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 60 });

    // Wait to ensure refill
    await new Promise((resolve) => setTimeout(resolve, 100));

    const tokenCount = limiter.getTokenCount();
    expect(tokenCount).toBeLessThanOrEqual(60);
  });

  it("handles high rate limits correctly", async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 300 }); // 5 req/sec

    const start = Date.now();

    // Should allow 5 requests immediately
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // Should be very fast
  });
});
