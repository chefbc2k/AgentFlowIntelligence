# AFI Collaboration Log (Hackathon Journal)

This is the official human↔agent collaboration log for Synthesis. It is intentionally high-level and safe to publish.

Rules:
- Every agent conversation must be logged the same day.
- Every decision or action that changes the build direction must be logged.
- Do not include secrets, API keys, private hashes, or internal transaction IDs.

## 2026-03-16

- Reset the repo to start a fresh AFI MVP after deciding the previous project direction was not aligned.
- Defined AFI as a behavior-first observability layer focused on x402 + Locus + Base signals.
- Implemented a minimal backend for ingestion, normalization, and evidence packet export.
- Implemented a minimal UI for listing interactions and downloading evidence packets.
- Added a SQLite store for normalized events.
- Wired Locus status/transactions + checkout endpoints for demo use.
- Added x402 header capture helper and fixture-based integration tests.
- Started dev servers and verified UI renders with an empty state.
- Registered the AFI agent on Synthesis and stored credentials locally (secrets kept out of this log).
- Implemented full AFI adapters (Locus, Base, EAS, PEAC), expanded evidence schema, added metrics endpoints, and rebuilt the UI with agent/counterparty/flow views.
- Refactored server runtime to separate testable API logic from the network listener (`server/index.ts` + `server/cli.ts`) and added end-to-end handler tests.
- Fixed `POST /api/locus/ingest/transactions` foreign-key failures by ensuring an interaction exists before inserting wallet snapshots.
- Tightened typing + runtime validation (React JSX TS config, Zod-validated Locus balance responses, and safer header iteration for x402 client).
- Added repo-wide quality gates: ESLint + TypeScript `typecheck` + Vitest coverage thresholds enforcing 100% lines/statements/functions/branches for both server + UI.
- Expanded regression coverage across store normalization, adapters, metrics, and UI flows (interaction list, packet viewer, metrics loaders, and main entry mount).
- Validated locally with `npm run validate` (lint + typecheck + coverage) passing cleanly.
- Improved x402 ingestion to infer settlement tx hashes from `PAYMENT-RESPONSE` when `txHash` is omitted, enabling Base enrichment + evidence packets without manual duplication.
- Added regression tests covering tx hash inference and settlement status derivation while keeping 100% coverage thresholds.
- Revalidated with `npm run validate` (lint + typecheck + server/UI coverage) passing cleanly.
- Correlated stored EAS attestations onto interaction packets (case-insensitive wallet/tx matching) and included receipts/attestations in agent evidence density.
- Fixed local validation reliability under constrained/offline environments by (1) running Vitest with a repo-local temp dir to avoid macOS `/var/folders` ENOSPC failures and (2) swapping the SQLite backend to Node’s built-in `node:sqlite` to avoid native module ABI rebuild requirements.
- Added regression coverage for SQLite transaction rollback and for nullish Locus transaction upserts; revalidated `npm run validate` with 100% lines/statements/functions/branches for server + UI.
- Implemented spend-control compliance + fulfillment latency metrics (approval rate, allowance/max-tx compliance, receipt availability, and settlement latency) for both agent and counterparty profiles; exposed derived control facts on interaction packets and rendered them in the UI.
- Hardened validation ergonomics by isolating server/UI coverage output directories (avoids shared `coverage/.tmp` races) and removing the unused native `better-sqlite3` dependency; revalidated `npm run validate` with 100% lines/statements/functions/branches.
- Tightened the “100% coverage + typechecked boundary” claim by removing the stale `server/types.ts` coverage exclusion, converting the type-only server schema module to `server/types.d.ts`, extending `tsc --noEmit` to check `scripts/**/*.mjs`, and updating the temp-dir helper imports to pass JS typechecking.
- Simplified service inference normalization branches so the runtime model matches actual behavior, then revalidated with `npm run validate` passing cleanly (lint, typecheck, build, server coverage, UI coverage all at 100%).
- Fixed AFI’s service-model blind spot by normalizing `service` alongside `counterparty`, preserving wrapped API provider/endpoint and x402 slug hints from Locus payloads, and upgrading the Flow Explorer to render `wallet -> counterparty -> service` paths instead of collapsing service sectors into one opaque label.
- Added migration + regression coverage for the new interaction `service` column, URL/service inference during x402 ingestion, Locus passthrough parsing, and three-node flow rendering; revalidated `npm run validate` with build + lint + typecheck + 100% lines/statements/functions/branches for server + UI.

## 2026-03-15

- Confirmed Synthesis registration flow and project submission status.
- Decided on AFI as the new build direction (behavior-first observability).

## 2026-03-14

- Documented Synthesis constraints and possible integrations for paid-agent observability.

## 2026-03-13

- Initial hackathon planning and exploration of fit across Synthesis themes.
