import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPortableInteractionPacket } from "../server/packet";
import { Store } from "../server/store";
import type { InteractionRecord } from "../server/types";

function createTestStore() {
  const dataDir = mkdtempSync(join(tmpdir(), "afi-packet-"));
  return new Store({ dbPath: ":memory:", dataDir });
}

function makeInteraction(overrides: Partial<InteractionRecord> = {}): InteractionRecord {
  return {
    id: "packet-1",
    created_at: "2024-01-01T00:00:00Z",
    wallet_address: "0xabc123",
    counterparty: "0xdef456",
    service: "/paid",
    protocol: "x402",
    summary: {
      paymentRequired: { amount: "2", asset: "0xtoken", network: "8453" },
      x402: {
        challenge: { present: true, decoded: { amount: "2", network: "base", payTo: "0xmerchant" } },
        authorization: { hasSignature: true, decoded: { payer: "0xpayer" } },
        settlement: { present: true, success: true, txHash: "0xtx", network: "base" },
      },
    },
    ...overrides,
  };
}

describe("portable interaction packets", () => {
  it("builds a canonical packet with deduped receipts and attestations", () => {
    const store = createTestStore();
    const interaction = makeInteraction();
    store.upsertInteraction(interaction);
    store.upsertSettlement({
      id: "packet-1:settlement",
      interaction_id: interaction.id,
      tx_hash: "0xtx",
      chain_id: 8453,
      status: "confirmed",
      metadata: { source: "test" },
    });
    store.upsertWalletSnapshot({
      id: "packet-1:wallet",
      interaction_id: interaction.id,
      wallet_address: "0xabc123",
      allowance: "10",
      max_tx: "10",
      approvals_required: false,
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    });
    store.upsertEvidence([
      { id: "packet-1:x402", interaction_id: interaction.id, kind: "x402", payload: { ok: true }, created_at: "2024-01-01T00:00:00Z" },
      { id: "packet-1:peac", interaction_id: interaction.id, kind: "peac", payload: { ok: true }, created_at: "2024-01-01T00:00:00Z" },
    ]);
    store.upsertBaseTransaction({
      tx_hash: "0xtx",
      status: "confirmed",
      from: "0xabc123",
      to: "0xdef456",
      value: "2",
      raw: { hash: "0xtx" },
      created_at: "2024-01-01T00:00:10Z",
    });
    store.upsertReceipts([
      {
        id: "receipt-1",
        interaction_id: interaction.id,
        tx_hash: "0xtx",
        raw: { status: "verified", decoded: { ok: true }, raw: { receipt: "ok" } },
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "receipt-1",
        tx_hash: "0xtx",
        raw: { status: "verified", decoded: { ok: true }, raw: { receipt: "ok" } },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);
    store.upsertAttestations([
      { id: "att-1", recipient: "0xabc123", tx_hash: "0xtx", chain_id: 8453, raw: {}, created_at: "2024-01-01T00:00:00Z" },
      { id: "att-1", recipient: "0xabc123", tx_hash: "0xtx", chain_id: 8453, raw: {}, created_at: "2024-01-01T00:00:00Z" },
    ]);
    store.upsertPrice({
      id: "8453:0xtoken",
      token_address: "0xtoken",
      chain_id: 8453,
      symbol: "USDC",
      price_usd: "1.25",
      source: "coingecko",
      timestamp: "2024-01-01T00:00:00Z",
      raw: {},
    });
    store.upsertProtocolLabel({
      id: "8453:0xdef456",
      contract_address: "0xdef456",
      chain_id: 8453,
      protocol_name: "EscrowX",
      protocol_category: "escrow",
      source: "dune",
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    });

    const packet = buildPortableInteractionPacket(store, interaction, "2024-01-02T00:00:00Z");

    expect(packet.version).toBe("afi.packet/v1");
    expect(packet.exportedAt).toBe("2024-01-02T00:00:00Z");
    expect(packet.interaction).toEqual(expect.objectContaining({ amountUSD: 2.5, protocolName: "EscrowX", protocolCategory: "escrow" }));
    expect(packet.interaction.protocolLabel).toEqual(
      expect.objectContaining({
        source: "dune",
        contract: "0xdef456",
        labeledAt: "2024-01-01T00:00:00Z",
        metadata: {},
      }),
    );
    expect(packet.protocol.x402?.packet.challenge.present).toBe(true);
    expect(packet.evidence.receipts).toEqual([
      expect.objectContaining({ id: "receipt-1", tx_hash: "0xtx", status: "verified", decoded: { ok: true }, raw: { receipt: "ok" } }),
    ]);
    expect(packet.evidence.attestations).toEqual([expect.objectContaining({ id: "att-1", txHash: "0xtx", chainId: 8453 })]);
    expect(packet.correlations.baseTransaction?.tx_hash).toBe("0xtx");
    expect(packet.correlations.walletSnapshot?.wallet_address).toBe("0xabc123");
    expect(packet.correlations.protocolLabel).toEqual(
      expect.objectContaining({
        source: "dune",
        contract: "0xdef456",
      }),
    );
    expect(packet.summary).toEqual(
      expect.objectContaining({
        handshakeStatus: "complete",
        controlStatus: "within-limits",
        settlementStatus: "confirmed",
        receiptCount: 1,
        attestationCount: 1,
      }),
    );
    expect(packet.references.wallet?.explorerUrl).toBe("https://basescan.org/address/0xabc123");
    expect(packet.references.counterparty?.explorerUrl).toBe("https://basescan.org/address/0xdef456");
    expect(packet.references.transaction?.explorerUrl).toBe("https://basescan.org/tx/0xtx");
    expect(packet.summary.evidenceKinds).toEqual(["peac", "x402"]);
  });

  it("preserves evidence sections after JSON serialization", () => {
    const store = createTestStore();
    const interaction = makeInteraction({ id: "packet-json" });
    store.upsertInteraction(interaction);
    store.upsertEvidence([
      { id: "packet-json:x402", interaction_id: interaction.id, kind: "x402", payload: { ok: true }, created_at: "2024-01-01T00:00:00Z" },
    ]);
    store.upsertReceipts([
      {
        id: "packet-json:receipt",
        interaction_id: interaction.id,
        tx_hash: "0xtx",
        raw: { status: "verified", raw: { receipt: "ok" } },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const packet = JSON.parse(JSON.stringify(buildPortableInteractionPacket(store, interaction)));

    expect(packet.evidence).toEqual(
      expect.objectContaining({
        timeline: [expect.objectContaining({ id: "packet-json:x402", kind: "x402" })],
        receipts: [expect.objectContaining({ id: "packet-json:receipt", status: "verified" })],
        attestations: [],
      }),
    );
  });

  it("marks missing x402 and empty controls when optional data is absent", () => {
    const store = createTestStore();
    const interaction = makeInteraction({
      id: "packet-2",
      protocol: "locus",
      counterparty: "github",
      summary: { locusTx: { id: "loc-1" } },
    });
    store.upsertInteraction(interaction);
    store.upsertEvidence([
      { id: "packet-2:locus", interaction_id: interaction.id, kind: "locus", payload: { id: "loc-1" }, created_at: "2024-01-01T00:00:00Z" },
    ]);

    const packet = buildPortableInteractionPacket(store, interaction, "2024-01-02T00:00:00Z");

    expect(packet.summary.handshakeStatus).toBe("not-captured");
    expect(packet.summary.controlStatus).toBe("unknown");
    expect(packet.protocol.kind).toBe("locus");
    expect(packet.protocol.x402).toBeUndefined();
    expect(packet.protocol.locus?.transaction).toEqual({ id: "loc-1" });
    expect(packet.references.counterparty).toEqual({ id: "github", explorerUrl: undefined });
    expect(packet.references.transaction).toBeUndefined();
    expect(packet.references.protocol).toEqual({ name: undefined, category: undefined, contract: "github" });
    expect(packet.interaction.amountUSD).toBeNull();
    expect(packet.correlations.protocolLabel).toBeUndefined();
  });

  it("marks handshake phases correctly", () => {
    const store = createTestStore();
    const challengeOnly = makeInteraction({
      id: "packet-3",
      summary: {
        paymentRequired: { amount: "5" },
        x402: {
          challenge: { present: true, decoded: { amount: "5" } },
          authorization: { hasSignature: false },
          settlement: { present: false, success: null },
        },
      },
    });
    store.upsertInteraction(challengeOnly);
    store.upsertWalletSnapshot({
      id: "packet-3:wallet",
      interaction_id: challengeOnly.id,
      wallet_address: "0xabc123",
      allowance: "1",
      max_tx: "10",
      approvals_required: false,
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    });
    expect(buildPortableInteractionPacket(store, challengeOnly).summary).toEqual(
      expect.objectContaining({ handshakeStatus: "challenge-only", controlStatus: "over-limit" }),
    );

    const authorized = makeInteraction({
      id: "packet-4",
      summary: {
        x402: {
          challenge: { present: false },
          authorization: { hasSignature: true, decoded: { payer: "0xpayer" } },
          settlement: { present: false, success: null },
        },
      },
    });
    store.upsertInteraction(authorized);
    expect(buildPortableInteractionPacket(store, authorized).summary.handshakeStatus).toBe("authorized");

    const settled = makeInteraction({
      id: "packet-5",
      summary: {
        x402: {
          challenge: { present: false },
          authorization: { hasSignature: false },
          settlement: { present: true, success: false, txHash: "0xtx" },
        },
      },
    });
    store.upsertInteraction(settled);
    expect(buildPortableInteractionPacket(store, settled).summary.handshakeStatus).toBe("settled");
  });

  it("keeps non-object receipt payloads raw and avoids fabricating locus transactions", () => {
    const store = createTestStore();
    const interaction = makeInteraction({
      id: "packet-2b",
      protocol: "locus",
      counterparty: "github",
      summary: { locusTx: "invalid-shape" as unknown as Record<string, unknown> },
    });
    store.upsertInteraction(interaction);
    store.upsertReceipts([
      {
        id: "receipt-opaque",
        interaction_id: interaction.id,
        raw: "opaque-receipt" as unknown as never,
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const packet = buildPortableInteractionPacket(store, interaction, "2024-01-02T00:00:00Z");

    expect(packet.protocol.locus?.transaction).toBeUndefined();
    expect(packet.evidence.receipts).toEqual([
      expect.objectContaining({ id: "receipt-opaque", status: "raw", raw: "opaque-receipt" }),
    ]);
  });

  it("correlates tx-hash-only receipts and preserves transcript metadata", () => {
    const store = createTestStore();
    const interaction = makeInteraction({
      id: "packet-7",
      summary: {
        paymentRequired: { amount: "1" },
        x402: {
          challenge: { present: true, decoded: { amount: "1" } },
          authorization: { hasSignature: true, decoded: { payer: "0xpayer" } },
          settlement: { present: true, success: true, txHash: "0xtx7" },
        },
        x402Transcript: {
          requestUrl: "https://example.com/paid",
          challenge: { status: 402, headers: { paymentRequired: "{\"amount\":\"1\"}" } },
          authorization: { paymentSignature: "{\"payer\":\"0xpayer\"}" },
          settlement: { status: 200, headers: { paymentResponse: "{\"success\":true,\"transaction\":\"0xtx7\"}" } },
        },
      },
    });
    store.upsertInteraction(interaction);
    store.upsertSettlement({
      id: "packet-7:settlement",
      interaction_id: interaction.id,
      tx_hash: "0xtx7",
      status: "confirmed",
      metadata: {},
    });
    store.upsertReceipts([{ id: "receipt-by-tx", tx_hash: "0xtx7", raw: { via: "tx-hash" }, created_at: "2024-01-01T00:00:00Z" }]);

    const packet = buildPortableInteractionPacket(store, interaction, "2024-01-02T00:00:00Z");

    expect(packet.evidence.receipts).toEqual([expect.objectContaining({ id: "receipt-by-tx", status: "raw", raw: { via: "tx-hash" } })]);
    expect(packet.protocol.x402?.transcript).toEqual(expect.objectContaining({ requestUrl: "https://example.com/paid" }));
  });

  it("exports explorable references and authorized over-limit packets with raw receipt fallbacks", () => {
    const store = createTestStore();
    const interaction = makeInteraction({
      id: "packet-8",
      counterparty: "0xface",
      summary: {
        paymentRequired: { amount: "5" },
        x402: {
          challenge: { present: false },
          authorization: { hasSignature: true, decoded: { payer: "0xpayer" } },
          settlement: { present: false, success: null },
        },
      },
    });
    store.upsertInteraction(interaction);
    store.upsertWalletSnapshot({
      id: "packet-8:wallet",
      interaction_id: interaction.id,
      wallet_address: "0xabc123",
      allowance: "1",
      max_tx: "10",
      approvals_required: false,
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
    });
    store.upsertReceipts([
      {
        id: "receipt-raw-fallback",
        interaction_id: interaction.id,
        raw: { via: "fallback" },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const packet = buildPortableInteractionPacket(store, interaction, "2024-01-02T00:00:00Z");

    expect(packet.references.counterparty?.explorerUrl).toBe("https://basescan.org/address/0xface");
    expect(packet.summary).toEqual(expect.objectContaining({ handshakeStatus: "authorized", controlStatus: "over-limit" }));
    expect(packet.evidence.receipts).toEqual([
      expect.objectContaining({
        id: "receipt-raw-fallback",
        status: "raw",
        raw: { via: "fallback" },
      }),
    ]);
  });

  it("falls back to legacy transcript + summary tx hash and keeps uncaptured x402 states explorable", () => {
    const store = createTestStore();
    const interaction = makeInteraction({
      id: "packet-9",
      counterparty: "merchant-service",
      summary: {
        txHash: "0xsummary",
        x402: {
          challenge: { present: false },
          authorization: { hasSignature: false },
          settlement: { present: false, success: null },
        },
        transcript: {
          requestUrl: "https://legacy.example/paid",
          settlement: { status: 202, headers: { paymentResponse: "{\"transaction\":\"0xsummary\"}" } },
        },
      },
    });
    store.upsertInteraction(interaction);
    store.upsertReceipts([
      { id: "receipt-summary", tx_hash: "0xsummary", raw: "opaque" as unknown as Record<string, unknown>, created_at: "2024-01-01T00:00:00Z" },
    ]);

    const packet = buildPortableInteractionPacket(store, interaction, "2024-01-02T00:00:00Z");

    expect(packet.summary.handshakeStatus).toBe("not-captured");
    expect(packet.protocol.x402?.transcript).toEqual(expect.objectContaining({ requestUrl: "https://legacy.example/paid" }));
    expect(packet.references.transaction?.explorerUrl).toBe("https://basescan.org/tx/0xsummary");
    expect(packet.references.counterparty).toEqual({ id: "merchant-service", explorerUrl: undefined });
    expect(packet.evidence.receipts).toEqual([expect.objectContaining({ id: "receipt-summary", status: "raw", raw: "opaque" })]);
  });

  it("normalizes opaque receipt payloads and ignores malformed locus transaction summaries", () => {
    const store = createTestStore();
    const interaction = makeInteraction({
      id: "packet-10",
      protocol: "locus",
      summary: { locusTx: "bad-shape" },
    });
    store.upsertInteraction(interaction);
    store.upsertReceipts([
      {
        id: "receipt-opaque",
        interaction_id: interaction.id,
        raw: "opaque" as unknown as Record<string, unknown>,
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const packet = buildPortableInteractionPacket(store, interaction, "2024-01-02T00:00:00Z");

    expect(packet.protocol.locus?.transaction).toBeUndefined();
    expect(packet.evidence.receipts).toEqual([
      expect.objectContaining({
        id: "receipt-opaque",
        status: "raw",
        raw: "opaque",
      }),
    ]);
  });
});
