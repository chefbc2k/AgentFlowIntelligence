import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getConfig } from "./config";
import { Store } from "./store";
import { extractX402Headers } from "./x402";
import { normalizeInteraction, normalizeLocusInteraction } from "./normalize";
import { LocusClient } from "./locus";
import { fetchBaseTokenTransfers, fetchBaseTx, fetchBaseTxHistory } from "./base";
import { computeAgentMetrics, computeCounterpartyMetrics, enrichInteractionForReadModel } from "./metrics";
import { fetchEasAttestations } from "./eas";
import { parsePeacReceipt } from "./peac";
import { deriveControls } from "./controls";
import { PricingService } from "./pricing";
import { DuneClient } from "./dune";
import { JobScheduler } from "./jobs";
import { buildInteractionContext, buildPortableInteractionPacket } from "./packet";
import { refreshProtocolLabelForInteraction } from "./protocol-labels";
import type { WalletSnapshotRecord } from "./types";
import type { AppConfig } from "./config";

export interface CreateAppOptions {
  config?: AppConfig;
  store?: Store;
}

export type ApiResponse<T> = { status: number; body: T };

type ApiErrorBody = { error: string };

function ok<T>(body: T): ApiResponse<T> {
  return { status: 200, body };
}

function fail(status: number, error: string): ApiResponse<ApiErrorBody> {
  return { status, body: { error } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return undefined;
}

function getNestedStringField(record: Record<string, unknown>, keys: string[], nestedKeys: string[]) {
  for (const key of keys) {
    const nested = record[key];
    if (!isRecord(nested)) {
      continue;
    }

    const value = getStringField(nested, nestedKeys);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function attachAfiCapture<T>(payload: T, afi: { interactionId: string; txHash?: string; counterparty?: string; service?: string }) {
  if (isRecord(payload)) {
    return { ...payload, afi };
  }

  return { result: payload, afi };
}

export type JsonResponder = {
  status: (code: number) => JsonResponder;
  json: (body: unknown) => unknown;
};

export function send(res: JsonResponder, result: ApiResponse<unknown>) {
  res.status(result.status).json(result.body);
}

// API Request Validation Schemas
const walletSnapshotSchema = z.object({
  id: z.string().optional(),
  interaction_id: z.string().optional(),
  wallet_address: z.string().optional(),
  balance: z.string().optional(),
  allowance: z.string().optional(),
  max_tx: z.string().optional(),
  approvals_required: z
    .union([z.boolean(), z.literal(0), z.literal(1)])
    .transform((value) => value === true || value === 1)
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().optional(),
});

const x402TranscriptStepSchema = z.object({
  status: z.number(),
  headers: z.object({
    paymentRequired: z.string().optional(),
    paymentSignature: z.string().optional(),
    paymentResponse: z.string().optional(),
    peacReceipt: z.string().optional(),
  }),
});

const x402TranscriptSchema = z.object({
  requestUrl: z.string(),
  challenge: x402TranscriptStepSchema.optional(),
  authorization: z
    .object({
      paymentSignature: z.string().optional(),
    })
    .optional(),
  settlement: x402TranscriptStepSchema.optional(),
});

const headerValueSchema = z.union([z.string(), z.array(z.string()), z.undefined()]);

const ingestX402Schema = z.object({
  headers: z.record(z.string(), headerValueSchema).optional(),
  paymentSignature: z.string().optional(),
  locusMetadata: z.record(z.string(), z.unknown()).optional(),
  txHash: z.string().optional(),
  agentId: z.string().optional(),
  walletAddress: z.string().optional(),
  counterparty: z.string().optional(),
  service: z.string().optional(),
  url: z.string().optional(),
  transcript: x402TranscriptSchema.optional(),
  walletSnapshot: walletSnapshotSchema.optional(),
});

const peacReceiptSchema = z.object({
  receipt: z.string(),
  interactionId: z.string().optional(),
  txHash: z.string().optional(),
});

function validateRequest<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { success: false, error: result.error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join("; ") };
  }
  return { success: true, data: result.data };
}

export function createApi({ config, store }: { config: AppConfig; store: Store }) {
  const duneClient = config.duneApiKey ? new DuneClient(config.duneApiKey) : undefined;
  const withLocus = async <T,>(handler: (client: LocusClient) => Promise<T> | T): Promise<ApiResponse<T | ApiErrorBody>> => {
    if (!config.locusApiKey) {
      return fail(400, "missing_locus_key");
    }
    const client = new LocusClient({
      baseUrl: config.locusBaseUrl,
      apiKey: config.locusApiKey,
      agentId: config.locusAgentId,
    });
    const payload = await handler(client);
    return ok(payload);
  };

  const captureWalletSnapshot = async (client: LocusClient, interactionId: string) => {
    try {
      const [status, balance] = await Promise.all([client.getStatus(), client.getBalance()]);

      return {
        id: `wallet:${status.address ?? "unknown"}:${Date.now()}`,
        interaction_id: interactionId,
        wallet_address: status.address,
        balance: balance.balance ?? status.balance,
        allowance: balance.allowance,
        max_tx: balance.maxTx,
        approvals_required: balance.approvalsRequired,
        metadata: { status, balance },
        created_at: new Date().toISOString(),
      } satisfies WalletSnapshotRecord;
    } catch (error) {
      // The payment/action already succeeded upstream; keep AFI capture best-effort but observable.
      console.warn("locus_snapshot_capture_failed", { interactionId, error });
      return undefined;
    }
  };

  const captureLocusAction = async (
    client: LocusClient,
    action:
      | { kind: "send"; body?: Record<string, unknown> }
      | { kind: "wrapped"; provider: string; endpoint: string; body?: Record<string, unknown> }
      | { kind: "x402"; slug: string; body?: Record<string, unknown> }
      | { kind: "checkout_pay"; sessionId: string; body?: Record<string, unknown> },
    payload: unknown,
  ) => {
    const response = isRecord(payload) ? payload : {};
    const createdAt =
      getStringField(response, ["createdAt", "created_at", "timestamp"]) ??
      getNestedStringField(response, ["payment", "transaction"], ["createdAt", "created_at", "timestamp"]) ??
      new Date().toISOString();
    const txHash =
      getStringField(response, ["txHash", "tx_hash", "transactionHash", "transaction_hash"]) ??
      getNestedStringField(response, ["payment", "transaction"], ["txHash", "tx_hash", "hash"]);
    const responseCounterparty =
      getStringField(response, ["counterparty", "provider", "merchant", "payTo", "recipient", "to"]) ??
      getNestedStringField(response, ["payment", "transaction"], ["counterparty", "merchant", "payTo", "recipient", "to"]);
    const amount =
      getStringField(response, ["amount", "value"]) ??
      getStringField(action.body ?? {}, ["amount", "value"]);
    const currency =
      getStringField(response, ["currency", "asset", "tokenSymbol"]) ??
      getStringField(action.body ?? {}, ["currency", "asset", "tokenSymbol"]);
    const status =
      getStringField(response, ["status", "state"]) ??
      getNestedStringField(response, ["payment", "transaction"], ["status", "state"]);
    const actionKey = `${action.kind}:${randomUUID()}`;
    const walletSnapshot = await captureWalletSnapshot(client, actionKey);

    const locusTx: Record<string, unknown> = {
      ...(isRecord(payload) ? payload : { result: payload }),
      action: action.kind,
      createdAt,
      ...(action.kind === "wrapped" ? { provider: action.provider, endpoint: action.endpoint } : {}),
      ...(action.kind === "x402" ? { slug: action.slug } : {}),
      ...(action.kind === "checkout_pay" ? { sessionId: action.sessionId, checkoutPath: `/checkout/${action.sessionId}/pay` } : {}),
      ...(action.kind === "send" ? { endpoint: "/pay/send" } : {}),
      ...(action.body ? { request: action.body } : {}),
      ...(txHash ? { txHash } : {}),
      ...(amount ? { amount } : {}),
      ...(currency ? { currency } : {}),
      ...(status ? { status } : {}),
    };

    const bundle = normalizeLocusInteraction({
      agentId: config.locusAgentId,
      walletAddress: walletSnapshot?.wallet_address,
      counterparty:
        action.kind === "wrapped"
          ? action.provider
          : action.kind === "send"
            ? getStringField(action.body ?? {}, ["counterparty", "recipient", "to"])
            : responseCounterparty,
      service:
        action.kind === "wrapped"
          ? action.endpoint
          : action.kind === "x402"
            ? action.slug
            : action.kind === "checkout_pay"
              ? `/checkout/${action.sessionId}/pay`
              : "/pay/send",
      locusTx,
      txHash,
      walletSnapshot,
      actionKey,
      createdAt,
    });

    store.upsertInteraction(bundle.interaction);
    store.upsertSettlement(bundle.settlement);
    store.upsertEvidence(bundle.evidence);
    if (walletSnapshot) {
      store.upsertWalletSnapshot({
        ...walletSnapshot,
        id: `${walletSnapshot.id}:${bundle.interaction.id}`,
        interaction_id: bundle.interaction.id,
      });
    }
    store.upsertLocusTransactions([
      {
        id: getStringField(locusTx, ["id", "txId", "paymentId"]) ?? bundle.interaction.id,
        interaction_id: bundle.interaction.id,
        tx_hash: txHash,
        status,
        counterparty: bundle.interaction.counterparty,
        amount,
        currency,
        created_at: createdAt,
        raw: locusTx,
      },
    ]);

    return attachAfiCapture(payload, {
      interactionId: bundle.interaction.id,
      txHash,
      counterparty: bundle.interaction.counterparty,
      service: bundle.interaction.service,
    });
  };

  return {
    health: () => ok({ ok: true, timestamp: new Date().toISOString() }),
    listInteractions: () => ok(store.listInteractions().map((interaction) => enrichInteractionForReadModel(store, interaction))),
    getInteraction: (id: string) => {
      const interaction = store.getInteraction(id);
      if (!interaction) return fail(404, "not_found");
      const evidence = store.getEvidence(id);
      const settlement = store.getSettlement(id);
      const walletSnapshot = store.getWalletSnapshot(id);
      const receipts = store.listReceiptsByInteraction(id);
      const controls = deriveControls(interaction, walletSnapshot);
      const x402 = interaction.summary.x402;
      const transcript = interaction.summary.x402Transcript ?? interaction.summary.transcript;
      const baseTransaction = settlement?.tx_hash ? store.getBaseTransaction(settlement.tx_hash) : undefined;
      const attestationRows = [
        ...(interaction.wallet_address ? store.listAttestationsByWallet(interaction.wallet_address) : []),
        ...(settlement?.tx_hash ? store.listAttestationsByTxHash(settlement.tx_hash) : []),
      ];
      const attestations = Array.from(new Map(attestationRows.map((row) => [row.id, row])).values());
      return ok({ interaction, controls, x402, transcript, evidence, settlement, baseTransaction, walletSnapshot, receipts, attestations });
    },
    getInteractionEnriched: (id: string) => {
      const interaction = store.getInteraction(id);
      if (!interaction) return fail(404, "not_found");
      const enrichedInteraction = enrichInteractionForReadModel(store, interaction);
      const context = buildInteractionContext(store, interaction);
      return ok({
        interaction: enrichedInteraction,
        amountUSD: enrichedInteraction.amountUSD,
        controls: context.controls,
        x402: context.x402,
        transcript: context.transcript,
        evidence: context.evidence,
        settlement: context.settlement,
        baseTransaction: context.baseTransaction,
        walletSnapshot: context.walletSnapshot,
        receipts: context.receipts,
        attestations: context.attestations,
      });
    },
    getInteractionPacket: (id: string) => {
      const interaction = store.getInteraction(id);
      if (!interaction) return fail(404, "not_found");
      return ok(buildPortableInteractionPacket(store, interaction));
    },
    enrichProtocolLabel: async (id: string) => {
      const interaction = store.getInteraction(id);
      if (!interaction) return fail(404, "not_found");

      const result = await refreshProtocolLabelForInteraction(store, interaction, duneClient);
      if (result.kind === "missing_contract") {
        return fail(400, "missing_protocol_contract");
      }

      if (result.kind === "missing_enrichment_config") {
        return fail(400, "missing_protocol_enrichment_config");
      }

      if (result.kind === "unresolved") {
        return ok({
          ok: true,
          refreshed: false,
          interactionId: id,
          contractAddress: result.contractAddress,
          message: "Protocol label not resolved",
        });
      }

      return ok({
        ok: true,
        refreshed: result.refreshed,
        interactionId: id,
        contractAddress: result.contractAddress,
        protocolLabel: result.protocolLabel,
        message: "Protocol label refreshed",
      });
    },
    ingestX402: async (body: unknown) => {
      const validation = validateRequest(ingestX402Schema, body);
      if (!validation.success) {
        return fail(400, `validation_error: ${validation.error}`);
      }
      const validated = validation.data;

      const headers = extractX402Headers(validated.headers ?? {});
      const paymentSignature = validated.paymentSignature;
      if (!headers.paymentSignature && paymentSignature) {
        headers.paymentSignature = paymentSignature;
      }
      const locusMetadata = validated.locusMetadata;
      const txHash = validated.txHash;
      const agentId = validated.agentId ?? config.locusAgentId;
      const walletAddress = validated.walletAddress;
      const counterparty = validated.counterparty;
      const service = validated.service;
      const url = validated.url;
      const transcript = validated.transcript;
      const walletSnapshotInput = validated.walletSnapshot as WalletSnapshotRecord | undefined;

      const bundle = normalizeInteraction({
        agentId: typeof agentId === "string" ? agentId : undefined,
        walletAddress: typeof walletAddress === "string" ? walletAddress : undefined,
        counterparty: typeof counterparty === "string" ? counterparty : undefined,
        service: typeof service === "string" ? service : undefined,
        url: typeof url === "string" ? url : undefined,
        paymentHeaders: headers,
        transcript: transcript && typeof transcript === "object" ? (transcript as Parameters<typeof normalizeInteraction>[0]["transcript"]) : undefined,
        txHash: typeof txHash === "string" ? txHash : undefined,
        locusMetadata: locusMetadata as Record<string, unknown> | undefined,
        walletSnapshot: walletSnapshotInput,
      });
      const bundleTxHash = bundle.settlement.tx_hash;

      store.upsertInteraction(bundle.interaction);
      store.upsertSettlement(bundle.settlement);
      store.upsertEvidence(bundle.evidence);
      if (walletSnapshotInput) {
        const snapshot: WalletSnapshotRecord = {
          ...walletSnapshotInput,
          interaction_id: walletSnapshotInput.interaction_id ?? bundle.interaction.id,
          created_at: walletSnapshotInput.created_at ?? new Date().toISOString(),
          metadata: walletSnapshotInput.metadata ?? {},
        };
        store.upsertWalletSnapshot(snapshot);
      }

      const peacPayload = bundle.evidence.find((row) => row.kind === "peac")?.payload as
        | { status: string; decoded?: unknown; raw?: unknown }
        | undefined;
      if (peacPayload && typeof peacPayload.raw === "string") {
        const peac = parsePeacReceipt(peacPayload.raw)!;
        store.upsertReceipts([
          {
            id: peac.id,
            interaction_id: bundle.interaction.id,
            tx_hash: bundleTxHash,
            raw: { status: peac.status, decoded: peac.decoded ?? null, raw: peac.raw },
            created_at: new Date().toISOString(),
          },
        ]);
      }

      if (bundleTxHash) {
        try {
          const baseTx = await fetchBaseTx(bundleTxHash, { etherscanApiKey: config.etherscanApiKey });
          const baseCreatedAt = baseTx.confirmedAt ?? new Date().toISOString();
          store.upsertBaseTransaction({
            tx_hash: baseTx.txHash,
            status: baseTx.status,
            block_number: baseTx.blockNumber,
            from: baseTx.from,
            to: baseTx.to,
            value: baseTx.value,
            raw: baseTx.raw,
            created_at: baseCreatedAt,
          });
          store.upsertSettlement({
            ...bundle.settlement,
            status: baseTx.status,
            metadata: { ...bundle.settlement.metadata, baseTx: baseTx.raw },
          });
          store.upsertEvidence([
            {
              id: `${bundle.interaction.id}:base_tx`,
              interaction_id: bundle.interaction.id,
              kind: "base_tx",
              created_at: baseCreatedAt,
              payload: baseTx.raw,
            },
          ]);
        } catch (error) {
          // Observability-only failure: ingestion succeeds even if enrichment fails.
          console.warn("base_enrichment_failed", { txHash: bundleTxHash, error });
        }
      }

      return ok({ ok: true, interactionId: bundle.interaction.id });
    },
    enrichBase: async (body: Record<string, unknown> | undefined) => {
      const txHash = body?.txHash;
      if (typeof txHash !== "string" || !txHash) return fail(400, "missing_tx_hash");
      return ok(await fetchBaseTx(txHash, { etherscanApiKey: config.etherscanApiKey }));
    },
    baseTx: async (hash: string) => ok(await fetchBaseTx(hash, { etherscanApiKey: config.etherscanApiKey })),
    baseTxHistory: async (address: string) => {
      const result = await fetchBaseTxHistory(address, { etherscanApiKey: config.etherscanApiKey });
      const now = new Date().toISOString();
      for (const item of result) {
        if (!item.hash) continue;
        store.upsertBaseTransaction({
          tx_hash: item.hash,
          status: item.isError === "1" ? "failed" : item.blockNumber ? "confirmed" : "unknown",
          block_number: item.blockNumber,
          from: item.from,
          to: item.to,
          value: item.value,
          raw: item as Record<string, unknown>,
          created_at: item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : now,
        });
      }
      return ok(result);
    },
    baseTransfers: async (address: string) => {
      const result = await fetchBaseTokenTransfers(address, { etherscanApiKey: config.etherscanApiKey });
      const now = new Date().toISOString();
      store.upsertTokenTransfers(
        result
          .filter((item) => item.hash)
          .map((item) => ({
            id: `${item.hash}:${item.logIndex ?? "0"}`,
            tx_hash: item.hash,
            token_address: item.contractAddress,
            token_symbol: item.tokenSymbol,
            from: item.from,
            to: item.to,
            value: item.value,
            raw: item as Record<string, unknown>,
            created_at: item.timeStamp ? new Date(Number(item.timeStamp) * 1000).toISOString() : now,
          })),
      );
      return ok(result);
    },
    locusStatus: () => withLocus((client) => client.getStatus()),
    locusTransactions: () => withLocus((client) => client.getTransactions()),
    locusRegister: (body: Record<string, unknown> | undefined) => withLocus((client) => client.register(body)),
    locusBalance: () => withLocus((client) => client.getBalance()),
    locusSend: (body: Record<string, unknown> | undefined) =>
      withLocus(async (client) => captureLocusAction(client, { kind: "send", body }, await client.sendPayment(body ?? {}))),
    locusWrappedMd: () => withLocus((client) => client.getWrappedCatalog()),
    locusWrappedCall: (provider: string, endpoint: string, body: Record<string, unknown> | undefined) =>
      withLocus(async (client) =>
        captureLocusAction(client, { kind: "wrapped", provider, endpoint, body }, await client.callWrapped(provider, endpoint, body)),
      ),
    locusX402: (slug: string, body: Record<string, unknown> | undefined) =>
      withLocus(async (client) => captureLocusAction(client, { kind: "x402", slug, body }, await client.callX402(slug, body))),
    locusCheckoutPreflight: (sessionId: string) => withLocus((client) => client.checkoutPreflight(sessionId)),
    locusCheckoutPay: (sessionId: string, body: Record<string, unknown> | undefined) =>
      withLocus(async (client) =>
        captureLocusAction(client, { kind: "checkout_pay", sessionId, body }, await client.checkoutPay(sessionId, body)),
      ),
    locusCheckoutPayment: (txId: string) => withLocus((client) => client.checkoutPayment(txId)),
    locusIngestTransactions: () =>
      withLocus(async (client) => {
        const [status, balance, transactions] = await Promise.all([
          client.getStatus(),
          client.getBalance(),
          client.getTransactions(),
        ]);

        const syncInteractionId = `locus:sync:${status.address ?? "unknown"}`;
        store.upsertInteraction({
          id: syncInteractionId,
          created_at: new Date().toISOString(),
          agent_id: config.locusAgentId,
          wallet_address: status.address,
          counterparty: "locus",
          service: "locus_sync",
          protocol: "locus",
          summary: { kind: "locus_sync", status, balance },
        });

        const walletSnapshot: WalletSnapshotRecord = {
          id: `wallet:${status.address ?? "unknown"}:${Date.now()}`,
          interaction_id: syncInteractionId,
          wallet_address: status.address,
          balance: balance.balance ?? status.balance,
          allowance: balance.allowance,
          max_tx: balance.maxTx,
          approvals_required: balance.approvalsRequired,
          metadata: { status, balance },
          created_at: new Date().toISOString(),
        };
        store.upsertWalletSnapshot(walletSnapshot);

        const locusRows = transactions.map((tx) => {
          const txRecord = tx as Record<string, unknown>;
          const provider = typeof txRecord.provider === "string" ? txRecord.provider : undefined;
          const endpoint = typeof txRecord.endpoint === "string" ? txRecord.endpoint : undefined;
          const slug = typeof txRecord.slug === "string" ? txRecord.slug : undefined;

          const bundle = normalizeLocusInteraction({
            agentId: config.locusAgentId,
            walletAddress: status.address,
            counterparty: tx.counterparty ?? provider,
            service: endpoint ?? slug,
            locusTx: txRecord,
            txHash: tx.txHash,
            walletSnapshot,
          });
          store.upsertInteraction(bundle.interaction);
          store.upsertSettlement(bundle.settlement);
          store.upsertEvidence(bundle.evidence);
          return {
            id: String(tx.id ?? bundle.interaction.id),
            interaction_id: bundle.interaction.id,
            tx_hash: tx.txHash,
            status: tx.status,
            counterparty: tx.counterparty,
            amount: tx.amount,
            currency: tx.currency,
            created_at: tx.createdAt,
            raw: tx as Record<string, unknown>,
          };
        });

        store.upsertLocusTransactions(locusRows);

        return { ok: true, count: locusRows.length };
      }),
    easAttestations: async (address: string) => {
      if (!address) return fail(400, "missing_address");
      const attestations = await fetchEasAttestations({ baseUrl: config.easBaseUrl }, address);
      store.upsertAttestations(
        attestations.map((att) => ({
          id: att.id,
          attester: att.attester,
          recipient: att.recipient,
          schema_id: att.schemaId,
          tx_hash: att.txHash,
          chain_id: 8453,
          raw: att.raw,
          created_at: new Date().toISOString(),
        })),
      );
      return ok(attestations);
    },
    peacReceipt: async (body: unknown) => {
      const validation = validateRequest(peacReceiptSchema, body);
      if (!validation.success) {
        return fail(400, `validation_error: ${validation.error}`);
      }
      const validated = validation.data;

      const receipt = validated.receipt;
      const interactionId = validated.interactionId;
      const txHash = validated.txHash;
      const parsed = parsePeacReceipt(receipt);
      if (!parsed) return fail(400, "invalid_receipt");
      store.upsertReceipts([
        {
          id: parsed.id,
          interaction_id: interactionId,
          tx_hash: txHash,
          raw: { status: parsed.status, decoded: parsed.decoded ?? null, raw: parsed.raw },
          created_at: new Date().toISOString(),
        },
      ]);
      if (interactionId) {
        store.upsertEvidence([
          {
            id: `${interactionId}:peac`,
            interaction_id: interactionId,
            kind: "peac",
            created_at: new Date().toISOString(),
            payload: { status: parsed.status, decoded: parsed.decoded ?? null, raw: parsed.raw },
          },
        ]);
      }
      return ok({ ok: true, id: parsed.id });
    },
    agentMetrics: (wallet: string) => ok(computeAgentMetrics(store, wallet)),
    counterpartyMetrics: (id: string) => ok(computeCounterpartyMetrics(store, id)),
  };
}

export function createRouteHandlers(api: ReturnType<typeof createApi>) {
  return {
    health: (_req: unknown, res: JsonResponder) => send(res, api.health()),
    listInteractions: (_req: unknown, res: JsonResponder) => send(res, api.listInteractions()),
    getInteraction: (req: { params: { id: string | string[] } }, res: JsonResponder) =>
      send(res, api.getInteraction(String(req.params.id))),
    getInteractionEnriched: (req: { params: { id: string | string[] } }, res: JsonResponder) =>
      send(res, api.getInteractionEnriched(String(req.params.id))),
    getInteractionPacket: (req: { params: { id: string | string[] } }, res: JsonResponder) =>
      send(res, api.getInteractionPacket(String(req.params.id))),
    enrichProtocolLabel: async (req: { params: { id: string | string[] } }, res: JsonResponder) =>
      send(res, await api.enrichProtocolLabel(String(req.params.id))),
    ingestX402: async (req: { body?: unknown }, res: JsonResponder) => send(res, await api.ingestX402(req.body)),
    enrichBase: async (req: { body?: Record<string, unknown> }, res: JsonResponder) => send(res, await api.enrichBase(req.body)),
    baseTx: async (req: { params: { hash: string | string[] } }, res: JsonResponder) => send(res, await api.baseTx(String(req.params.hash))),
    baseTxHistory: async (req: { params: { address: string | string[] } }, res: JsonResponder) =>
      send(res, await api.baseTxHistory(String(req.params.address))),
    baseTransfers: async (req: { params: { address: string | string[] } }, res: JsonResponder) =>
      send(res, await api.baseTransfers(String(req.params.address))),
    locusStatus: async (_req: unknown, res: JsonResponder) => send(res, await api.locusStatus()),
    locusTransactions: async (_req: unknown, res: JsonResponder) => send(res, await api.locusTransactions()),
    locusRegister: async (req: { body?: Record<string, unknown> }, res: JsonResponder) => send(res, await api.locusRegister(req.body ?? undefined)),
    locusBalance: async (_req: unknown, res: JsonResponder) => send(res, await api.locusBalance()),
    locusSend: async (req: { body?: Record<string, unknown> }, res: JsonResponder) => send(res, await api.locusSend(req.body ?? undefined)),
    locusWrappedMd: async (_req: unknown, res: JsonResponder) => send(res, await api.locusWrappedMd()),
    locusWrappedCall: async (
      req: { params: { provider: string | string[]; endpoint: string | string[] }; body?: Record<string, unknown> },
      res: JsonResponder,
    ) =>
      send(res, await api.locusWrappedCall(String(req.params.provider), String(req.params.endpoint), req.body ?? undefined)),
    locusX402: async (req: { params: { slug: string | string[] }; body?: Record<string, unknown> }, res: JsonResponder) =>
      send(res, await api.locusX402(String(req.params.slug), req.body ?? undefined)),
    locusCheckoutPreflight: async (req: { params: { sessionId: string | string[] } }, res: JsonResponder) =>
      send(res, await api.locusCheckoutPreflight(String(req.params.sessionId))),
    locusCheckoutPay: async (req: { params: { sessionId: string | string[] }; body?: Record<string, unknown> }, res: JsonResponder) =>
      send(res, await api.locusCheckoutPay(String(req.params.sessionId), req.body ?? undefined)),
    locusCheckoutPayment: async (req: { params: { txId: string | string[] } }, res: JsonResponder) =>
      send(res, await api.locusCheckoutPayment(String(req.params.txId))),
    locusIngestTransactions: async (_req: unknown, res: JsonResponder) => send(res, await api.locusIngestTransactions()),
    easAttestations: async (req: { query: { address?: string | string[] } }, res: JsonResponder) =>
      send(res, await api.easAttestations(String(req.query.address ?? ""))),
    peacReceipt: async (req: { body?: unknown }, res: JsonResponder) => send(res, await api.peacReceipt(req.body)),
    agentMetrics: (req: { params: { wallet: string | string[] } }, res: JsonResponder) =>
      send(res, api.agentMetrics(String(req.params.wallet))),
    counterpartyMetrics: (req: { params: { id: string | string[] } }, res: JsonResponder) =>
      send(res, api.counterpartyMetrics(String(req.params.id))),
  };
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? getConfig();
  const store = options.store ?? new Store({ dbPath: config.dbPath, dataDir: config.dataDir });
  const api = createApi({ config, store });
  const handlers = createRouteHandlers(api);

  // Initialize background services
  const pricingService = new PricingService();

  const duneClient = config.duneApiKey ? new DuneClient(config.duneApiKey) : undefined;

  const jobScheduler = new JobScheduler({
    config,
    store,
    pricingService,
    duneClient,
  });

  // Start background jobs
  jobScheduler.start();

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, stopping background jobs");
    jobScheduler.stop();
  });

  process.on("SIGINT", () => {
    console.log("SIGINT received, stopping background jobs");
    jobScheduler.stop();
    process.exit(0);
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", handlers.health as never);
  app.get("/api/interactions", handlers.listInteractions as never);
  app.get("/api/interactions/:id", handlers.getInteraction as never);
  app.get("/api/interactions/:id/enriched", handlers.getInteractionEnriched as never);
  app.get("/api/interactions/:id/packet", handlers.getInteractionPacket as never);
  app.post("/api/interactions/:id/enrich/protocol", handlers.enrichProtocolLabel as never);
  app.post("/api/ingest/x402", handlers.ingestX402 as never);
  app.post("/api/enrich/base", handlers.enrichBase as never);
  app.get("/api/base/tx/:hash", handlers.baseTx as never);
  app.get("/api/base/txs/:address", handlers.baseTxHistory as never);
  app.get("/api/base/transfers/:address", handlers.baseTransfers as never);

  app.get("/api/locus/status", handlers.locusStatus as never);
  app.get("/api/locus/transactions", handlers.locusTransactions as never);
  app.post("/api/locus/register", handlers.locusRegister as never);
  app.get("/api/locus/balance", handlers.locusBalance as never);
  app.post("/api/locus/send", handlers.locusSend as never);
  app.get("/api/locus/wrapped/md", handlers.locusWrappedMd as never);
  app.post("/api/locus/wrapped/:provider/:endpoint", handlers.locusWrappedCall as never);
  app.post("/api/locus/x402/:slug", handlers.locusX402 as never);
  app.get("/api/locus/checkout/preflight/:sessionId", handlers.locusCheckoutPreflight as never);
  app.post("/api/locus/checkout/pay/:sessionId", handlers.locusCheckoutPay as never);
  app.get("/api/locus/checkout/payments/:txId", handlers.locusCheckoutPayment as never);
  app.post("/api/locus/ingest/transactions", handlers.locusIngestTransactions as never);

  app.get("/api/eas/attestations", handlers.easAttestations as never);
  app.post("/api/peac/receipt", handlers.peacReceipt as never);
  app.get("/api/metrics/agent/:wallet", handlers.agentMetrics as never);
  app.get("/api/metrics/counterparty/:id", handlers.counterpartyMetrics as never);

  return app;
}
