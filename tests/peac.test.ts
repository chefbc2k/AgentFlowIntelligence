import { describe, expect, it } from "vitest";
import { parsePeacReceipt } from "../server/peac";

describe("PEAC receipt parsing", () => {
  it("decodes JSON receipt", () => {
    const result = parsePeacReceipt("{\"ok\":true}");
    expect(result?.status).toBe("decoded");
    expect(result?.decoded?.ok).toBe(true);
  });

  it("returns raw for invalid receipt", () => {
    const result = parsePeacReceipt("not-json");
    expect(result?.status).toBe("raw");
  });
});
