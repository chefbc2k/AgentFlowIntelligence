import { describe, expect, it } from "vitest";
import { normalizeInteraction, normalizeLocusInteraction } from "../server/normalize";

describe("normalizeInteraction", () => {
  it("builds deterministic interaction bundle", () => {
    const bundle = normalizeInteraction({
      agentId: "agent-1",
      walletAddress: "0xabc",
      url: "https://example.com/paid?token=redacted",
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        paymentSignature: "{\"sig\":\"0xabc\"}",
        paymentResponse: "{\"tx\":\"0xdef\"}",
        peacReceipt: "{\"receipt\":\"ok\"}",
      },
      txHash: "0xdef",
      locusMetadata: { status: "ok" },
      walletSnapshot: {
        id: "ws1",
        interaction_id: "i1",
        wallet_address: "0xabc",
        balance: "1",
        allowance: "1",
        max_tx: "1",
        approvals_required: true,
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    });
    expect(bundle.interaction.id).toHaveLength(64);
    expect(bundle.evidence.length).toBeGreaterThanOrEqual(3);
    expect(bundle.settlement.tx_hash).toBe("0xdef");
    expect(bundle.interaction.counterparty).toBe("example.com");
    expect(bundle.interaction.service).toBe("/paid");
    expect(bundle.evidence.some((row) => row.kind === "wallet_snapshot")).toBe(true);
    expect(bundle.interaction.summary.controls).toEqual(
      expect.objectContaining({
        amount: 1,
        approvalRequired: true,
        withinAllowance: true,
        withinMaxTx: true,
        source: "wallet_snapshot",
      }),
    );
    expect(bundle.interaction.summary.x402).toEqual(
      expect.objectContaining({
        challenge: expect.objectContaining({ present: true }),
        authorization: expect.objectContaining({ hasSignature: true }),
        settlement: expect.objectContaining({ txHash: "0xdef", success: null }),
      }),
    );
  });

  it("handles raw PEAC receipts and missing tx hashes", () => {
    const bundle = normalizeInteraction({
      agentId: "agent-1",
      counterparty: "service-x",
      walletAddress: "0xabc",
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        peacReceipt: "{not-json}",
      },
    });
    expect(bundle.settlement.status).toBe("unknown");
    const peac = bundle.evidence.find((row) => row.kind === "peac");
    expect(peac?.payload.decoded).toBeNull();
    expect((bundle.interaction.summary.controls as { source: string }).source).toBe("none");
  });

  it("infers counterparty + service from request url when explicit values are absent", () => {
    const bundle = normalizeInteraction({
      url: "https://payments.example.com/v1/quote?asset=usdc",
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
      },
    });

    expect(bundle.interaction.counterparty).toBe("payments.example.com");
    expect(bundle.interaction.service).toBe("/v1/quote");
  });

  it("falls back cleanly when request url is invalid", () => {
    const bundle = normalizeInteraction({
      url: "not a url",
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
      },
    });

    expect(bundle.interaction.counterparty).toBeUndefined();
    expect(bundle.interaction.service).toBeUndefined();
  });

  it("keeps path-based service hints even when the url has no hostname", () => {
    const bundle = normalizeInteraction({
      url: "file:///paid/endpoint",
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
      },
    });

    expect(bundle.interaction.counterparty).toBeUndefined();
    expect(bundle.interaction.service).toBe("/paid/endpoint");
  });

  it("infers wrapped-api service details from locus metadata", () => {
    const bundle = normalizeInteraction({
      locusMetadata: { provider: "github", endpoint: "/repos/openai/codex" },
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
      },
    });

    expect(bundle.interaction.counterparty).toBe("github");
    expect(bundle.interaction.service).toBe("/repos/openai/codex");
  });

  it("infers x402 slugs from locus metadata", () => {
    const bundle = normalizeInteraction({
      locusMetadata: { slug: "demo-paid-endpoint" },
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
      },
    });

    expect(bundle.interaction.counterparty).toBeUndefined();
    expect(bundle.interaction.service).toBe("demo-paid-endpoint");
  });

  it("infers tx hash from payment response when txHash is omitted", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        paymentResponse: "{\"transaction\":{\"hash\":\"0xtx\"}}",
      },
    });

    expect(bundle.settlement.tx_hash).toBe("0xtx");
    expect(bundle.settlement.status).toBe("pending");
    expect(bundle.evidence.some((row) => row.kind === "base")).toBe(true);
  });

  it("keeps challenge and settlement distinct inside the canonical packet while preserving raw evidence", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\",\"network\":\"base\",\"payTo\":\"0xmerchant\"}",
        paymentSignature: "{\"payer\":\"0xpayer\"}",
        paymentResponse: "{\"success\":true,\"transaction\":\"0xtx\",\"payer\":\"0xpayer\"}",
      },
    });

    expect(bundle.interaction.summary.x402).toEqual(
      expect.objectContaining({
        challenge: expect.objectContaining({
          present: true,
          decoded: expect.objectContaining({ amount: "1", payTo: "0xmerchant" }),
        }),
        authorization: expect.objectContaining({
          hasSignature: true,
          decoded: expect.objectContaining({ payer: "0xpayer" }),
        }),
        settlement: expect.objectContaining({
          present: true,
          success: true,
          txHash: "0xtx",
          payer: "0xpayer",
          payTo: "0xmerchant",
        }),
      }),
    );
    expect(bundle.evidence.find((row) => row.kind === "x402")?.payload).toEqual(
      expect.objectContaining({
        paymentRequired: expect.objectContaining({ amount: "1" }),
        paymentResponse: expect.objectContaining({ success: true }),
      }),
    );
  });

  it("persists transcript evidence and derives headers/url from the transcript when raw headers are omitted", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: {},
      transcript: {
        requestUrl: "https://example.com/paid",
        challenge: {
          status: 402,
          headers: {
            paymentRequired: "{\"amount\":\"3\",\"network\":\"base\"}",
          },
        },
        authorization: {
          paymentSignature: "{\"payer\":\"0xpayer\"}",
        },
        settlement: {
          status: 200,
          headers: {
            paymentResponse: "{\"success\":true,\"transaction\":\"0xtx\"}",
            peacReceipt: "{\"receipt\":\"ok\"}",
          },
        },
      },
    });

    expect(bundle.interaction.counterparty).toBe("example.com");
    expect(bundle.interaction.service).toBe("/paid");
    expect(bundle.interaction.summary.x402Transcript).toEqual(
      expect.objectContaining({ requestUrl: "https://example.com/paid" }),
    );
    expect(bundle.interaction.summary.x402).toEqual(
      expect.objectContaining({
        authorization: expect.objectContaining({ hasSignature: true }),
        settlement: expect.objectContaining({ txHash: "0xtx", success: true }),
      }),
    );
    expect(bundle.evidence.find((row) => row.kind === "peac")?.payload).toEqual(
      expect.objectContaining({ status: "decoded" }),
    );
    expect(bundle.evidence.find((row) => row.kind === "x402")?.payload).toEqual(
      expect.objectContaining({
        transcript: expect.objectContaining({ requestUrl: "https://example.com/paid" }),
      }),
    );
  });

  it("infers service identity from locus metadata provider/endpoint", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: { paymentRequired: "{\"amount\":\"1\"}" },
      locusMetadata: { provider: "locus", endpoint: "/wrapped/demo" },
    });
    expect(bundle.interaction.counterparty).toBe("locus");
    expect(bundle.interaction.service).toBe("/wrapped/demo");
  });

  it("infers service identity from locus metadata slug when provider/endpoint are missing", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: { paymentRequired: "{\"amount\":\"1\"}" },
      locusMetadata: { slug: "x402-demo" },
    });
    expect(bundle.interaction.service).toBe("x402-demo");
  });

  it("handles invalid service urls without throwing", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: { paymentRequired: "{\"amount\":\"1\"}" },
      url: "not a url",
    });
    expect(bundle.interaction.counterparty).toBeUndefined();
    expect(bundle.interaction.service).toBeUndefined();
  });

  it("ignores nested transaction hashes that are not strings", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        paymentResponse: "{\"transaction\":{\"hash\":123}}",
      },
    });

    expect(bundle.settlement.tx_hash).toBeUndefined();
    expect(bundle.settlement.status).toBe("unknown");
    expect(bundle.evidence.some((row) => row.kind === "base")).toBe(false);
  });

  it("marks settlement as failed when payment response reports success=false", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        paymentResponse: "{\"success\":false}",
      },
    });

    expect(bundle.settlement.status).toBe("failed");
    expect(bundle.settlement.tx_hash).toBeUndefined();
    expect(bundle.evidence.some((row) => row.kind === "base")).toBe(false);
  });

  it("handles missing optional inputs and raw PEAC receipts", () => {
    const bundle = normalizeInteraction({
      paymentHeaders: {
        paymentRequired: "{\"amount\":\"1\"}",
        peacReceipt: "{not-json}",
      },
    });

    expect(bundle.settlement.status).toBe("unknown");
    expect(bundle.evidence.some((row) => row.kind === "locus")).toBe(false);
    expect(bundle.evidence.some((row) => row.kind === "base")).toBe(false);

    const peac = bundle.evidence.find((row) => row.kind === "peac");
    expect(peac?.payload).toEqual(expect.objectContaining({ status: "raw", decoded: null }));
  });

  it("builds locus interaction bundle", () => {
    const bundle = normalizeLocusInteraction({
      agentId: "agent-1",
      walletAddress: "0xabc",
      locusTx: { id: "tx-1", amount: "2", createdAt: "2024-01-01T00:00:00Z", provider: "svc", endpoint: "/wrapped" },
      txHash: "0xabc",
      walletSnapshot: {
        id: "ws2",
        interaction_id: "i2",
        wallet_address: "0xabc",
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
      },
    });
    expect(bundle.interaction.protocol).toBe("locus");
    expect(bundle.interaction.counterparty).toBe("svc");
    expect(bundle.interaction.service).toBe("/wrapped");
    expect(bundle.evidence.length).toBeGreaterThan(0);
    expect(bundle.evidence.some((row) => row.kind === "wallet_snapshot")).toBe(true);
  });

  it("infers wrapped-api provider and endpoint from locus transactions", () => {
    const bundle = normalizeLocusInteraction({
      walletAddress: "0xabc",
      locusTx: {
        provider: "github",
        endpoint: "/repos/openai/codex",
      },
    });

    expect(bundle.interaction.counterparty).toBe("github");
    expect(bundle.interaction.service).toBe("/repos/openai/codex");
  });

  it("infers slug-only locus services", () => {
    const bundle = normalizeLocusInteraction({
      locusTx: {
        slug: "demo-paid-endpoint",
      },
    });

    expect(bundle.interaction.counterparty).toBeUndefined();
    expect(bundle.interaction.service).toBe("demo-paid-endpoint");
  });

  it("builds locus bundles even when optional locus fields are missing", () => {
    const bundle = normalizeLocusInteraction({
      agentId: "agent-1",
      walletAddress: "0xabc",
      counterparty: "service-y",
      locusTx: {},
    });
    expect(bundle.settlement.status).toBe("unknown");
    expect(bundle.evidence).toHaveLength(1);
  });

  it("builds locus bundle without tx hash or wallet snapshot", () => {
    const bundle = normalizeLocusInteraction({
      locusTx: { amount: "2" },
    });
    expect(bundle.interaction.protocol).toBe("locus");
    expect(bundle.settlement.status).toBe("unknown");
    expect(bundle.evidence.some((row) => row.kind === "base")).toBe(false);
    expect(bundle.evidence.some((row) => row.kind === "wallet_snapshot")).toBe(false);
  });
});
