import { describe, expect, it, beforeEach } from "vitest";
import { Cache } from "../server/cache";

describe("Cache", () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache();
  });

  it("stores and retrieves values", () => {
    cache.set("key1", "value1", 60);

    const result = cache.get<string>("key1");
    expect(result).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    const result = cache.get<string>("nonexistent");
    expect(result).toBeUndefined();
  });

  it("expires values after TTL", async () => {
    cache.set("key1", "value1", 1); // 1 second TTL

    // Value should be present initially
    expect(cache.get<string>("key1")).toBe("value1");

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Value should be expired
    expect(cache.get<string>("key1")).toBeUndefined();
  });

  it("stores different data types", () => {
    cache.set("string", "text", 60);
    cache.set("number", 42, 60);
    cache.set("object", { foo: "bar" }, 60);
    cache.set("array", [1, 2, 3], 60);

    expect(cache.get<string>("string")).toBe("text");
    expect(cache.get<number>("number")).toBe(42);
    expect(cache.get<{ foo: string }>("object")).toEqual({ foo: "bar" });
    expect(cache.get<number[]>("array")).toEqual([1, 2, 3]);
  });

  it("clears all entries when no pattern provided", () => {
    cache.set("key1", "value1", 60);
    cache.set("key2", "value2", 60);
    cache.set("key3", "value3", 60);

    cache.clear();

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
    expect(cache.get("key3")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("clears entries matching pattern", () => {
    cache.set("user:1", "alice", 60);
    cache.set("user:2", "bob", 60);
    cache.set("post:1", "hello", 60);

    cache.clear("user:");

    expect(cache.get("user:1")).toBeUndefined();
    expect(cache.get("user:2")).toBeUndefined();
    expect(cache.get("post:1")).toBe("hello");
  });

  it("reports correct size", () => {
    expect(cache.size()).toBe(0);

    cache.set("key1", "value1", 60);
    expect(cache.size()).toBe(1);

    cache.set("key2", "value2", 60);
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("cleans up expired entries", async () => {
    cache.set("key1", "value1", 1); // 1 second TTL
    cache.set("key2", "value2", 60); // 60 seconds TTL

    expect(cache.size()).toBe(2);

    // Wait for first entry to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    cache.cleanup();

    expect(cache.size()).toBe(1);
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBe("value2");
  });

  it("overwrites existing values", () => {
    cache.set("key1", "value1", 60);
    cache.set("key1", "value2", 60);

    expect(cache.get<string>("key1")).toBe("value2");
  });
});
