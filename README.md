# Agent Flow Intelligence (AFI)

Behavior-first observability for agent commerce. AFI captures x402 header flows, Locus payments, and Base transactions, then emits a portable evidence packet instead of identity claims.

## Collaboration Log (Required)

Synthesis requires documenting the human↔agent collaboration process. We do this in `CHANGELOG.md`.

Rules:
- Every conversation with an agent working in this repo must be logged the same day.
- Every code or product decision must be recorded as a short, hackathon-facing journal entry.
- Do not include secrets, API keys, private hashes, or internal transaction IDs.
- Keep entries factual, high-level, and safe to publish.

## Quickstart

```bash
npm install
cp .env.example .env
npm run dev:server
npm run dev:ui
```

## Environment

- `AFI_LOCUS_API_KEY` (required for Locus)
- `AFI_ETHERSCAN_API_KEY` (required for Base enrichment)
- `AFI_BASE_RPC_URL` (optional if you add RPC enrichment later)
- `AFI_EAS_BASE_URL` (optional, defaults to Base EASScan GraphQL)
- `AFI_EAS_SEPOLIA_URL` (optional, defaults to Base Sepolia EASScan GraphQL)

Base enrichment uses Etherscan v2 when a key is present and falls back to Blockscout if not.

## API

- `POST /api/ingest/x402` — ingest a paid call (headers + tx hash + optional `url`/`service` hints)
- `GET /api/interactions` — list interactions
- `GET /api/interactions/:id` — raw interaction detail
- `GET /api/interactions/:id/packet` — canonical AFI portable packet export
- `GET /api/locus/status` — Locus wallet status
- `POST /api/locus/register` — Locus registration
- `GET /api/locus/balance` — Locus balance
- `POST /api/locus/send` — send payment
- `GET /api/locus/transactions` — Locus transactions
- `POST /api/locus/ingest/transactions` — ingest Locus transactions into AFI
- `GET /api/locus/wrapped/md` — wrapped API catalog
- `POST /api/locus/wrapped/:provider/:endpoint` — wrapped API call
- `POST /api/locus/x402/:slug` — Locus x402 call
- `GET /api/locus/checkout/preflight/:sessionId` — Locus checkout preflight
- `POST /api/locus/checkout/pay/:sessionId` — Locus checkout pay
- `GET /api/locus/checkout/payments/:txId` — Locus checkout payment status
- `GET /api/base/tx/:hash` — Base transaction lookup
- `GET /api/base/txs/:address` — Base tx history
- `GET /api/base/transfers/:address` — Base ERC-20 transfers
- `GET /api/eas/attestations?address=...` — EAS attestation lookup
- `POST /api/peac/receipt` — PEAC receipt ingestion
- `GET /api/metrics/agent/:wallet` — agent metrics
- `GET /api/metrics/counterparty/:id` — counterparty metrics

## Demo Flow

1. Make a paid call with x402 headers captured (use `server/x402-client.ts`).
2. POST the headers + tx hash (and optional PEAC receipt) to `/api/ingest/x402`.
3. Ingest Locus transactions via `/api/locus/ingest/transactions`.
4. Open the UI at `http://localhost:5173`.
5. Inspect Agent Profile, Counterparty Profile, and Flow Explorer.
6. Open an interaction and download the canonical packet JSON from the packet panel.

## x402 Capture Example

```ts
import { fetchWithX402Capture } from "./server/x402-client";

const { response, capture } = await fetchWithX402Capture("https://example.com/paid");
await fetch("http://localhost:8787/api/ingest/x402", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ headers: capture.headers, url: capture.url, txHash: "0x..." }),
});
```
