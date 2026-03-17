import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../server/http-client";
import { RateLimiter } from "../server/rate-limiter";
import { Cache } from "../server/cache";

const okJson = (payload: unknown) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => payload,
});

const notOk = (status: number, statusText = "Error") => ({
  ok: false,
  status,
  statusText,
  json: async () => ({}),
});

describe("HttpClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes GET requests successfully", async () => {
    const fetchMock = vi.fn(async () => okJson({ data: "test" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({ baseUrl: "https://api.example.com" });
    const result = await client.get<{ data: string }>("/test");

    expect(result).toEqual({ data: "test" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("supports custom response parsers for non-JSON callers", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "plain-text",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({ baseUrl: "https://api.example.com" });
    const result = await client.get<string>("/text", {
      parseResponse: async (response) => response.text(),
    });

    expect(result).toBe("plain-text");
  });

  it("passes through absolute URLs for callers that need a different host", async () => {
    const fetchMock = vi.fn(async () => okJson({ data: "test" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({ baseUrl: "https://api.example.com" });
    const result = await client.get<{ data: string }>("https://other.example.com/test");

    expect(result).toEqual({ data: "test" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://other.example.com/test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("makes POST requests with body", async () => {
    const fetchMock = vi.fn(async () => okJson({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({ baseUrl: "https://api.example.com" });
    const result = await client.post<{ success: boolean }>("/create", { name: "test" });

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/create",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "test" }),
      }),
    );
  });

  it("includes default headers", async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      defaultHeaders: { Authorization: "Bearer token" },
    });

    await client.get("/test");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/test",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });

  it("merges request-specific headers with defaults", async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      defaultHeaders: { Authorization: "Bearer token" },
    });

    await client.get("/test", { headers: { "X-Custom": "value" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "X-Custom": "value",
        }),
      }),
    );
  });

  it("uses cache for GET requests when enabled", async () => {
    const fetchMock = vi.fn(async () => okJson({ data: "test" }));
    vi.stubGlobal("fetch", fetchMock);

    const cache = new Cache();
    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      cache,
    });

    // First request should hit API
    const result1 = await client.get<{ data: string }>("/test", { cacheTTL: 60 });
    expect(result1).toEqual({ data: "test" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second request should use cache
    const result2 = await client.get<{ data: string }>("/test", { cacheTTL: 60 });
    expect(result2).toEqual({ data: "test" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // No additional fetch
  });

  it("skips cache when skipCache option is true", async () => {
    const fetchMock = vi.fn(async () => okJson({ data: "test" }));
    vi.stubGlobal("fetch", fetchMock);

    const cache = new Cache();
    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      cache,
    });

    await client.get("/test", { cacheTTL: 60 });
    await client.get("/test", { cacheTTL: 60, skipCache: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("applies rate limiting", async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal("fetch", fetchMock);

    // Use 120 rpm (2 req/sec) and consume all tokens first
    const rateLimiter = new RateLimiter({ requestsPerMinute: 120 });
    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      rateLimiter,
    });

    // Consume all 120 tokens
    for (let i = 0; i < 120; i++) {
      await client.get(`/test${i}`);
    }

    // Next request should wait for refill (~500ms for 1 token at 2/sec)
    const start = Date.now();
    await client.get("/test-final");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(fetchMock).toHaveBeenCalledTimes(121);
  });

  it("retries failed requests", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt < 3) {
        return notOk(500, "Server Error");
      }
      return okJson({ data: "success" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      retryConfig: { maxRetries: 3, backoffMs: 10 }, // Short backoff for tests
    });

    const result = await client.get<{ data: string }>("/test");

    expect(result).toEqual({ data: "success" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws error after max retries exceeded", async () => {
    const fetchMock = vi.fn(async () => notOk(500, "Server Error"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      retryConfig: { maxRetries: 2, backoffMs: 10 },
    });

    await expect(client.get("/test")).rejects.toThrow("HTTP 500");
    expect(fetchMock).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it("normalizes non-Error throw values during retries", async () => {
    const fetchMock = vi.fn(async () => {
      throw "transport failed";
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      retryConfig: { maxRetries: 0, backoffMs: 10 },
    });

    await expect(client.get("/test")).rejects.toThrow("transport failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache POST requests", async () => {
    const fetchMock = vi.fn(async () => okJson({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    const cache = new Cache();
    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      cache,
    });

    await client.post("/create", { data: "test" });
    await client.post("/create", { data: "test" });

    expect(fetchMock).toHaveBeenCalledTimes(2); // Both requests hit API
  });

  it("sets Content-Type header for POST requests with body", async () => {
    const fetchMock = vi.fn(async () => okJson({}));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({ baseUrl: "https://api.example.com" });
    await client.post("/create", { name: "test" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/create",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("wraps non-Error throwables during retries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw "network-down";
    }));

    const client = new HttpClient({
      baseUrl: "https://api.example.com",
      retryConfig: { maxRetries: 0, backoffMs: 1 },
    });

    await expect(client.get("/test")).rejects.toThrow("network-down");
  });

  it("supports custom response parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("plain-text", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    const client = new HttpClient({ baseUrl: "https://api.example.com" });
    await expect(
      client.get("/text", {
        parseResponse: async (response) => response.text(),
      }),
    ).resolves.toBe("plain-text");
  });
});
