import express from "express";
import cors from "cors";
import { getConfig } from "./config";
import { Store } from "./store";
import { extractX402Headers } from "./x402";
import { normalizeInteraction, normalizeLocusInteraction } from "./normalize";
import { LocusClient } from "./locus";
import { fetchBaseTokenTransfers, fetchBaseTx, fetchBaseTxHistory } from "./base";
import { computeAgentMetrics, computeCounterpartyMetrics } from "./metrics";
import { fetchEasAttestations } from "./eas";
import { parsePeacReceipt } from "./peac";
import type { WalletSnapshotRecord } from "./types";

const config = getConfig();
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const store = new Store({ dbPath: config.dbPath, dataDir: config.dataDir });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/interactions", (_req, res) => {
  res.json(store.listInteractions());
});

app.get("/api/interactions/:id", (req, res) => {
  const interaction = store.getInteraction(req.params.id);
  if (!interaction) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const evidence = store.getEvidence(req.params.id);
  const settlement = store.getSettlement(req.params.id);
  const walletSnapshot = store.getWalletSnapshot(req.params.id);
  const receipts = store.listReceiptsByInteraction(req.params.id);
  res.json({ interaction, evidence, settlement, walletSnapshot, receipts });
});

app.post("/api/ingest/x402", async (req, res) => {
  const headers = extractX402Headers(req.body?.headers ?? {});
  const locusMetadata = req.body?.locusMetadata ?? undefined;
  const txHash = req.body?.txHash ?? undefined;
  const agentId = req.body?.agentId ?? config.locusAgentId;
  const walletAddress = req.body?.walletAddress ?? undefined;
  const counterparty = req.body?.counterparty ?? undefined;
  const walletSnapshotInput = req.body?.walletSnapshot as WalletSnapshotRecord | undefined;

  const bundle = normalizeInteraction({
    agentId,
    walletAddress,
    counterparty,
    paymentHeaders: headers,
    txHash,
    locusMetadata,
    walletSnapshot: walletSnapshotInput,
  });

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

  const peac = parsePeacReceipt(headers.peacReceipt);
  if (peac) {
    store.upsertReceipts([
      {
        id: peac.id,
        interaction_id: bundle.interaction.id,
        tx_hash: txHash,
        raw: { status: peac.status, decoded: peac.decoded ?? null, raw: peac.raw },
        created_at: new Date().toISOString(),
      },
    ]);
  }

  if (txHash) {
    try {
      const baseTx = await fetchBaseTx(txHash, { etherscanApiKey: config.etherscanApiKey });
      store.upsertBaseTransaction({
        tx_hash: baseTx.txHash,
        status: baseTx.status,
        block_number: baseTx.blockNumber,
        from: baseTx.from,
        to: baseTx.to,
        value: baseTx.value,
        raw: baseTx.raw ?? {},
        created_at: new Date().toISOString(),
      });
      store.upsertSettlement({
        ...bundle.settlement,
        status: baseTx.status,
        metadata: { ...bundle.settlement.metadata, baseTx: baseTx.raw ?? {} },
      });
      store.upsertEvidence([
        {
          id: `${bundle.interaction.id}:base_tx`,
          interaction_id: bundle.interaction.id,
          kind: "base_tx",
          created_at: new Date().toISOString(),
          payload: baseTx.raw ?? { txHash },
        },
      ]);
    } catch (error) {
      // Observability-only failure: ingestion succeeds even if enrichment fails.
      // eslint-disable-next-line no-console
      console.warn("base_enrichment_failed", { txHash, error });
    }
  }

  res.json({ ok: true, interactionId: bundle.interaction.id });
});

app.post("/api/enrich/base", async (req, res) => {
  const txHash = req.body?.txHash as string | undefined;
  if (!txHash) {
    res.status(400).json({ error: "missing_tx_hash" });
    return;
  }
  const result = await fetchBaseTx(txHash, { etherscanApiKey: config.etherscanApiKey });
  res.json(result);
});

app.get("/api/base/tx/:hash", async (req, res) => {
  const result = await fetchBaseTx(req.params.hash, { etherscanApiKey: config.etherscanApiKey });
  res.json(result);
});

app.get("/api/base/txs/:address", async (req, res) => {
  const result = await fetchBaseTxHistory(req.params.address, { etherscanApiKey: config.etherscanApiKey });
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
  res.json(result);
});

app.get("/api/base/transfers/:address", async (req, res) => {
  const result = await fetchBaseTokenTransfers(req.params.address, { etherscanApiKey: config.etherscanApiKey });
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
  res.json(result);
});

app.get("/api/locus/status", async (_req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const status = await client.getStatus();
  res.json(status);
});

app.get("/api/locus/transactions", async (_req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const transactions = await client.getTransactions();
  res.json(transactions);
});

app.post("/api/locus/register", async (req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.register(req.body ?? undefined);
  res.json(payload);
});

app.get("/api/locus/balance", async (_req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.getBalance();
  res.json(payload);
});

app.post("/api/locus/send", async (req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.sendPayment(req.body ?? {});
  res.json(payload);
});

app.get("/api/locus/wrapped/md", async (_req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.getWrappedCatalog();
  res.json(payload);
});

app.post("/api/locus/wrapped/:provider/:endpoint", async (req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.callWrapped(req.params.provider, req.params.endpoint, req.body ?? undefined);
  res.json(payload);
});

app.post("/api/locus/x402/:slug", async (req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.callX402(req.params.slug, req.body ?? undefined);
  res.json(payload);
});

app.get("/api/locus/checkout/preflight/:sessionId", async (req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.checkoutPreflight(req.params.sessionId);
  res.json(payload);
});

app.post("/api/locus/checkout/pay/:sessionId", async (req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.checkoutPay(req.params.sessionId, req.body ?? undefined);
  res.json(payload);
});

app.get("/api/locus/checkout/payments/:txId", async (req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const payload = await client.checkoutPayment(req.params.txId);
  res.json(payload);
});

app.post("/api/locus/ingest/transactions", async (_req, res) => {
  if (!config.locusApiKey) {
    res.status(400).json({ error: "missing_locus_key" });
    return;
  }
  const client = new LocusClient({ baseUrl: config.locusBaseUrl, apiKey: config.locusApiKey, agentId: config.locusAgentId });
  const [status, balance, transactions] = await Promise.all([
    client.getStatus(),
    client.getBalance(),
    client.getTransactions(),
  ]);

  const walletSnapshot: WalletSnapshotRecord = {
    id: `wallet:${status.address ?? "unknown"}:${Date.now()}`,
    interaction_id: "locus:sync",
    wallet_address: status.address,
    balance: balance?.balance ?? status.balance,
    allowance: (balance as Record<string, unknown>)?.allowance as string | undefined,
    max_tx: (balance as Record<string, unknown>)?.maxTx as string | undefined,
    approvals_required: (balance as Record<string, unknown>)?.approvalsRequired as boolean | undefined,
    metadata: { status, balance },
    created_at: new Date().toISOString(),
  };
  store.upsertWalletSnapshot(walletSnapshot);

  const locusRows = transactions.map((tx) => {
    const bundle = normalizeLocusInteraction({
      agentId: config.locusAgentId,
      walletAddress: status.address,
      counterparty: tx.counterparty,
      locusTx: tx as Record<string, unknown>,
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

  res.json({ ok: true, count: locusRows.length });
});

app.get("/api/eas/attestations", async (req, res) => {
  const address = String(req.query.address ?? "");
  if (!address) {
    res.status(400).json({ error: "missing_address" });
    return;
  }
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
  res.json(attestations);
});

app.post("/api/peac/receipt", async (req, res) => {
  const receipt = req.body?.receipt as string | undefined;
  const interactionId = req.body?.interactionId as string | undefined;
  const txHash = req.body?.txHash as string | undefined;
  const parsed = parsePeacReceipt(receipt);
  if (!parsed) {
    res.status(400).json({ error: "missing_receipt" });
    return;
  }
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
  res.json({ ok: true, id: parsed.id });
});

app.get("/api/metrics/agent/:wallet", (req, res) => {
  res.json(computeAgentMetrics(store, req.params.wallet));
});

app.get("/api/metrics/counterparty/:id", (req, res) => {
  res.json(computeCounterpartyMetrics(store, req.params.id));
});

app.listen(Number(config.port), () => {
  // eslint-disable-next-line no-console
  console.log(`AFI server listening on ${config.port}`);
});
