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

## 2026-03-17

- Shipped the AFI portable-packet slice end to end: added a typed canonical packet builder + backend export route contract, normalized `GET /api/interactions/:id` and `/api/interactions/:id/packet` onto the same packet envelope, and persisted x402 transcript chronology into packet protocol evidence.
- Strengthened evidence correlation and presentation: receipt lookup now includes settlement-hash correlation, packets expose nested `protocol/evidence/correlations/provenance` sections, and the UI renders structured transcript, settlement, receipt, attestation, and evidence-timeline panels instead of treating the packet as a raw dump.
- Made explorer/profile workflows navigable from the packet surface: flow helpers and UI interactions now drive packet selection plus agent/counterparty profile loading from explorer nodes, and packet downloads now use the backend export route rather than client-side `data:` serialization.
- Files/modules affected: `server/packet.ts`, `server/index.ts`, `server/normalize.ts`, `server/store.ts`, `server/types.d.ts`, `src/app.tsx`, `package.json`, `tests/api.test.ts`, `tests/packet.test.ts`, `tests/ui/app.test.tsx`.
- Validation status: `npm run validate` passed cleanly on March 17, 2026 with lint green, `tsc --noEmit` green, build green, server coverage `1357/1357` statements / `345/345` functions / `1047/1047` branches, and UI coverage `115/115` statements / `42/42` functions / `177/177` branches.

- Promoted AFI packet export from an internal-detail dump to a first-class canonical packet flow: the API now serves `/api/interactions/:id/packet`, the UI renders packet metadata + verifier references directly from that contract, and packet downloads come from the canonical export route.
- Root cause fixed at source: the repo had been partially migrated to the packet contract without the shared `server/packet.ts` source-of-truth module, so typecheck failed and packet/API/UI consumers drifted. Added the missing builder, merged transcript-derived headers during normalization, correlated tx-hash-only receipts into packets, normalized the UI flow helpers so filtering/profile-loading paths stay testable, and fixed the flaky rate-limit regression test by starting from a known empty token bucket instead of timing a burn-down loop.
- Files/modules affected: `server/packet.ts`, `server/index.ts`, `server/normalize.ts`, `server/store.ts`, `server/types.d.ts`, `src/app.tsx`, `src/styles.css`, `tests/packet.test.ts`, `tests/api.test.ts`, `tests/http-client.test.ts`, `tests/normalize.test.ts`, `tests/store.test.ts`, `tests/ui/app.test.tsx`, `package.json`, `README.md`.
- Validation status: `npm run validate` passed cleanly on March 17, 2026 with lint green, `tsc --noEmit` green, the UI build green, and both server + UI coverage at 100% lines / 100% statements / 100% functions / 100% branches.

- Closed the remaining AFI enrichment-slice validation regressions by fixing the coverage runner’s shared-temp-dir collision and by covering the last protocol-aware metrics + UI flow-label branches.
- Root cause fixed at source: counterparty-share math now divides by the real interaction count, `scripts/run-with-tmpdir.mjs` allocates a unique temp workspace per run, and coverage scripts emit into dedicated JSON report directories so server/UI V8 artifacts do not collide.
- Added regression coverage for protocol-category rollups, inbound/outbound USD transfer totals, numeric stored price values, missing tx targets during protocol labeling, protocol-name/service flow labels, and packet amount rendering when `amountUSD` is present.
- Validation status: `npm run validate` passed cleanly on March 17, 2026 with lint green, `tsc --noEmit` green, build green, and server + UI coverage enforced at 100% lines / 100% statements / 100% functions / 100% branches.
- Files/modules affected: `server/metrics.ts`, `tests/metrics.test.ts`, `tests/ui/app.test.tsx`, `scripts/run-with-tmpdir.mjs`, `vitest.config.ts`, `vitest.ui.config.ts`, `package.json`.

- Restored repo-wide validation to green by closing coverage gaps introduced by the new x402 transcript + onchain metrics slice.
- Added targeted regression tests for:
  - Base block timestamp parsing edge cases (hex + non-hex formats, zero timestamps).
  - x402 capture handshake branches (no signature, signature via retry headers).
  - `GET /api/interactions/:id` behavior for Locus interactions (x402 transcript omitted when protocol is not x402).
  - UI handshake/settlement render branches (authorized, recorded, failed, settled, and fallback states).
- Revalidated locally with `npm run validate` passing cleanly with 100% lines/statements/functions/branches for server + UI.
- Replaced AFI’s raw x402-header-only packet view with a typed x402 transcript: added challenge/authorization/settlement decoders, captured two-step handshake state in the x402 client, exposed canonical x402 + correlated Base transaction sections on `GET /api/interactions/:id`, and rendered those protocol states directly in the packet panel.
- Fixed a repo-level metrics contract regression by implementing `Store.listWalletsByCounterparty`, aligning async metrics endpoint tests with the current API, and removing dead branch logic in packet/onchain summaries that was blocking the repo-wide 100% coverage gate.
- Added regression coverage for typed x402 decoding, handshake capture, canonical packet normalization, locus-vs-x402 packet API responses, Base timestamp parsing, metrics/onchain edge cases, and all UI handshake render states (`complete`, `authorized`, `challenge-only`, `settled`, `not-captured`, plus settlement `success`/`failed`/`recorded`).
- Revalidated locally with `npm run validate`; lint passed, `tsc --noEmit` passed, the UI build passed, and both server + UI finished at 100% lines/statements/functions/branches.
- Extended Base enrichment to attach a `confirmedAt` timestamp to confirmed transactions (via block timestamp lookup) and expanded agent metrics to include onchain transaction + token-transfer behavior (counterparty concentration, token diversity, inbound/outbound counts), rendered in the UI.
- Upgraded the x402 client to capture a full paid-call transcript (402 challenge → signature → settlement) via an optional `onPaymentRequired` callback and added typed x402 packet decoding helpers; revalidated `npm run validate` with 100% coverage.
- Closed AFI’s live-Locus observability gap by persisting wrapped API calls, Locus-routed x402 calls, checkout payments, and direct send actions into the interaction/evidence store immediately instead of waiting for the later transaction-sync endpoint.
- Root cause fixed at source: the live Locus routes were proxy-only, so first-party paid actions disappeared from the AFI behavior graph unless `/api/locus/ingest/transactions` ran afterward; thin upstream `{ ok: true }` responses also risked collapsing multiple actions onto the same synthetic interaction id. Added a shared live-action capture path, enriched best-effort wallet snapshots with explicit warning logs on snapshot failure, and salted normalization ids so repeated thin responses remain distinct interactions.
- Added regression coverage for immediate live-action persistence, AFI response metadata, repeated thin-response collision avoidance, snapshot-failure observability, and live wallet snapshot fallbacks when Locus omits address/balance fields.
- Files/modules affected: `server/index.ts`, `server/normalize.ts`, `tests/api.test.ts`.
- Validation status: `npm run validate` passed cleanly on March 17, 2026 with lint green, `tsc --noEmit` green, build green, server coverage `1399/1399` statements / `351/351` functions / `1122/1122` branches, and UI coverage `115/115` statements / `42/42` functions / `177/177` branches.

## 2026-03-15

- Confirmed Synthesis registration flow and project submission status.
- Decided on AFI as the new build direction (behavior-first observability).

## 2026-03-14

- Documented Synthesis constraints and possible integrations for paid-agent observability.

## 2026-03-13

- Initial hackathon planning and exploration of fit across Synthesis themes.
