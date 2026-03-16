import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeInteraction } from "../server/normalize";
import { extractX402Headers } from "../server/x402";

describe("integration fixture", () => {
  it("normalizes a fixture packet", () => {
    const raw = JSON.parse(readFileSync("./tests/fixtures/interaction.json", "utf8")) as Record<string, unknown>;
    const headers = extractX402Headers(raw.headers as Record<string, string>);
    const bundle = normalizeInteraction({
      paymentHeaders: headers,
      txHash: raw.txHash as string,
      agentId: raw.agentId as string,
      walletAddress: raw.walletAddress as string,
      counterparty: raw.counterparty as string,
    });
    expect(bundle.interaction.id).toHaveLength(64);
    expect(bundle.evidence.length).toBeGreaterThan(0);
  });
});
