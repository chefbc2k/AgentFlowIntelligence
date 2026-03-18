import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Store } from "../server/store";
import {
  buildProtocolLabelRecord,
  getProtocolAttribution,
  normalizeProtocolCategory,
  refreshProtocolLabelForInteraction,
  resolveProtocolContract,
} from "../server/protocol-labels";

function createTestStore() {
  const dataDir = mkdtempSync(join(tmpdir(), "afi-protocol-labels-"));
  return new Store({ dbPath: ":memory:", dataDir });
}

describe("protocol labels", () => {
  it("normalizes all supported protocol categories", () => {
    expect(normalizeProtocolCategory()).toBe("other");
    expect(normalizeProtocolCategory("DEX")).toBe("dex");
    expect(normalizeProtocolCategory("swap")).toBe("dex");
    expect(normalizeProtocolCategory("bridge")).toBe("bridge");
    expect(normalizeProtocolCategory("escrow")).toBe("escrow");
    expect(normalizeProtocolCategory("borrow")).toBe("lending");
    expect(normalizeProtocolCategory("staking")).toBe("staking");
    expect(normalizeProtocolCategory("unknown")).toBe("other");
  });

  it("builds normalized protocol label records and rejects incomplete activity", () => {
    expect(
      buildProtocolLabelRecord({ contractAddress: undefined, protocolName: "EscrowX" }, "background", "2024-01-01T00:00:00Z"),
    ).toBeNull();
    expect(
      buildProtocolLabelRecord({ contractAddress: "0xContract", protocolName: undefined }, "background", "2024-01-01T00:00:00Z"),
    ).toBeNull();

    expect(
      buildProtocolLabelRecord(
        {
          contractAddress: "0xContract",
          protocolName: "EscrowX",
          category: "Escrow",
          txHash: "0xtx",
          blockTime: "2024-01-01T00:00:00Z",
          amountUSD: 2.5,
        },
        "background",
        "2024-01-01T00:00:00Z",
      ),
    ).toEqual(
      expect.objectContaining({
        contract_address: "0xcontract",
        protocol_category: "escrow",
        metadata: expect.objectContaining({
          refreshMode: "background",
          attempts: [expect.objectContaining({ outcome: "matched" })],
        }),
      }),
    );
  });

  it("resolves protocol contracts from settlement metadata and falls back to counterparty", () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "with-base-tx",
      created_at: "2024-01-01T00:00:00Z",
      counterparty: "0xfallback",
      protocol: "x402",
      summary: {},
    });
    store.upsertSettlement({
      id: "with-base-tx:settlement",
      interaction_id: "with-base-tx",
      status: "confirmed",
      metadata: { baseTx: { to: "0xcontract" } },
    });
    store.upsertInteraction({
      id: "fallback-only",
      created_at: "2024-01-01T00:00:00Z",
      counterparty: "0xfallback",
      protocol: "x402",
      summary: {},
    });
    store.upsertInteraction({
      id: "missing-contract",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: {},
    });

    expect(resolveProtocolContract(store, store.getInteraction("with-base-tx")!)).toBe("0xcontract");
    expect(resolveProtocolContract(store, store.getInteraction("fallback-only")!)).toBe("0xfallback");
    expect(resolveProtocolContract(store, store.getInteraction("missing-contract")!)).toBeUndefined();
  });

  it("refreshes protocol labels from Dune activity using settlement sender fallbacks and stable sorting", async () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "refresh-target",
      created_at: "2024-01-10T00:00:00Z",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {},
    });
    store.upsertSettlement({
      id: "refresh-target:settlement",
      interaction_id: "refresh-target",
      status: "confirmed",
      metadata: { baseTx: { from: "0xfrom", to: "0xcontract" } },
    });

    const duneClient = {
      getProtocolActivity: vi.fn(async (walletAddress: string) => {
        expect(walletAddress).toBe("0xfrom");
        return [
          {
            contractAddress: "0xother",
            protocolName: "Other",
            category: "DEX",
            blockTime: "2024-01-03T00:00:00Z",
            txHash: "0xother",
          },
          {
            contractAddress: "0xcontract",
            protocolName: "EscrowOld",
            category: "Escrow",
            blockTime: "not-a-date",
            txHash: "0xaaa",
          },
          {
            contractAddress: "0xcontract",
            protocolName: "EscrowX",
            category: "Escrow",
            blockTime: "2024-01-09T00:00:00Z",
            txHash: "0xbbb",
            amountUSD: 5,
          },
          {
            contractAddress: "0xcontract",
            protocolName: "EscrowTie",
            category: "Escrow",
            txHash: "0xaaa",
          },
          {
            contractAddress: "0xcontract",
            protocolName: "EscrowTieWinner",
            category: "Escrow",
            txHash: "0xccc",
          },
        ];
      }),
    };

    const result = await refreshProtocolLabelForInteraction(
      store,
      store.getInteraction("refresh-target")!,
      duneClient as never,
      "2024-01-10T12:00:00Z",
    );

    expect(result).toEqual(
      expect.objectContaining({
        kind: "resolved",
        contractAddress: "0xcontract",
        protocolLabel: expect.objectContaining({
          protocol_name: "EscrowX",
          metadata: expect.objectContaining({
            refreshMode: "interaction",
            evidence: expect.objectContaining({
              blockTime: "2024-01-09T00:00:00Z",
              amountUSD: 5,
            }),
          }),
        }),
      }),
    );
  });

  it("falls back to the contract address when no wallet query address is available", async () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "contract-fallback",
      created_at: "2024-01-10T00:00:00Z",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {},
    });

    const duneClient = {
      getProtocolActivity: vi.fn(async (walletAddress: string) => {
        expect(walletAddress).toBe("0xcontract");
        return [
          {
            contractAddress: "0xcontract",
            protocolName: "EscrowFallback",
            category: "Escrow",
            txHash: "0xfallback",
          },
        ];
      }),
    };

    await expect(
      refreshProtocolLabelForInteraction(
        store,
        store.getInteraction("contract-fallback")!,
        duneClient as never,
        "2024-01-10T12:00:00Z",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "resolved",
        contractAddress: "0xcontract",
        protocolLabel: expect.objectContaining({
          protocol_name: "EscrowFallback",
        }),
      }),
    );
  });

  it("prefers defined transaction hashes when matching activities tie on block time", async () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "txhash-tiebreak",
      created_at: "2024-01-10T00:00:00Z",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {},
      wallet_address: "0xwallet",
    });

    const duneClient = {
      getProtocolActivity: vi.fn(async (walletAddress: string) => {
        expect(walletAddress).toBe("0xwallet");
        return [
          {
            contractAddress: "0xcontract",
            protocolName: "MissingHash",
            category: "Escrow",
          },
          {
            contractAddress: "0xcontract",
            protocolName: "HashWinner",
            category: "Escrow",
            txHash: "0xbbb",
          },
          {
            contractAddress: "0xcontract",
            protocolName: "HashRunnerUp",
            category: "Escrow",
            txHash: "0xaaa",
          },
        ];
      }),
    };

    await expect(
      refreshProtocolLabelForInteraction(
        store,
        store.getInteraction("txhash-tiebreak")!,
        duneClient as never,
        "2024-01-10T12:00:00Z",
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "resolved",
        protocolLabel: expect.objectContaining({
          protocol_name: "HashWinner",
        }),
      }),
    );
  });

  it("returns unresolved when the matched activity cannot build a stored label", async () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "invalid-match",
      created_at: "2024-01-01T00:00:00Z",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {},
    });

    await expect(
      refreshProtocolLabelForInteraction(
        store,
        store.getInteraction("invalid-match")!,
        {
          getProtocolActivity: vi.fn(async () => [{ contractAddress: "0xcontract", txHash: "0xtx" }]),
        } as never,
      ),
    ).resolves.toEqual({ kind: "unresolved", contractAddress: "0xcontract" });
  });

  it("returns unresolved and attribution fallbacks when labels cannot be refreshed", async () => {
    const store = createTestStore();
    store.upsertInteraction({
      id: "no-label",
      created_at: "2024-01-01T00:00:00Z",
      counterparty: "0xcontract",
      protocol: "x402",
      summary: {},
    });
    store.upsertInteraction({
      id: "missing-contract",
      created_at: "2024-01-01T00:00:00Z",
      protocol: "x402",
      summary: {},
    });
    store.upsertProtocolLabel({
      id: "8453:0xcontract",
      contract_address: "0xcontract",
      chain_id: 8453,
      protocol_name: "EscrowX",
      protocol_category: "escrow",
      source: "dune",
      metadata: { ok: true },
      created_at: "2024-01-01T00:00:00Z",
    });

    await expect(
      refreshProtocolLabelForInteraction(
        store,
        store.getInteraction("no-label")!,
        { getProtocolActivity: vi.fn(async () => {
          throw new Error("boom");
        }) } as never,
      ),
    ).resolves.toEqual({ kind: "unresolved", contractAddress: "0xcontract" });

    expect(getProtocolAttribution(store, store.getInteraction("no-label")!)).toEqual(
      expect.objectContaining({
        contractAddress: "0xcontract",
        attribution: expect.objectContaining({
          source: "dune",
          contract: "0xcontract",
          metadata: { ok: true },
        }),
      }),
    );
    expect(getProtocolAttribution(store, store.getInteraction("missing-contract")!)).toEqual({
      contractAddress: undefined,
      label: undefined,
      attribution: undefined,
    });
  });
});
