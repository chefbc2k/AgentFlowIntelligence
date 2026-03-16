import { describe, expect, it } from "vitest";
import { parsePeacReceipt } from "../server/peac";

describe("PEAC receipt parsing", () => {
  it("returns undefined when missing", () => {
    expect(parsePeacReceipt()).toBeUndefined();
  });

  it("decodes JSON receipt", () => {
    const result = parsePeacReceipt("{\"ok\":true}");
    expect(result?.status).toBe("decoded");
    expect(result?.decoded?.ok).toBe(true);
  });

  it("returns raw when JSON parsing fails", () => {
    const result = parsePeacReceipt("{not-json}");
    expect(result?.status).toBe("raw");
  });

  it("decodes JWT-like receipts", () => {
    const payload = Buffer.from(JSON.stringify({ ok: true }), "utf8").toString("base64").replace(/=+$/u, "");
    const receipt = `header.${payload}.sig`;
    const result = parsePeacReceipt(receipt);
    expect(result?.status).toBe("decoded");
    expect(result?.decoded?.ok).toBe(true);
  });

  it("returns raw for invalid JWT-like receipts", () => {
    const result = parsePeacReceipt("a.b%.c");
    expect(result?.status).toBe("raw");
  });

  it("returns raw for invalid receipt", () => {
    const result = parsePeacReceipt("not-json");
    expect(result?.status).toBe("raw");
  });
});
