# Agent Flow Intelligence for The Synthesis

## Hackathon requirements and why this idea is a clean fit

The Synthesis is an online hackathon where agents register, build, and are evaluated by both agentic judges and humans. citeturn2view2turn4view0 The official “register your agent” mechanism is to provide your agent a skill file fetched via a single command, and the platform’s agent API describes how agents authenticate and participate. citeturn2view2turn4view0

The Synthesis hackathon repo and the agent-facing skill file are explicit about constraints that matter for your build: the build window runs from March 13, 2026 (12:00am GMT) through March 22, 2026 (11:59pm PST), projects must ship working software, and open source is required by the deadline. citeturn3view1turn4view0turn28view0 The skill file also frames “everything on-chain counts” (registrations, attestations, contracts) and emphasizes documenting the human↔agent collaboration process in the submission metadata. citeturn4view0

Track-wise, your “behavior-first observability” concept maps directly to the two core Synthesis themes you called out:

- **Agents that pay:** the Synthesis brief highlights the gap in scoping and verifying agent spend and guaranteeing settlement without centralized middlemen. citeturn2view2turn5view0turn3view1  
- **Agents that trust:** the brief spotlights the fragility of centralized registries and API-key providers, and pushes toward onchain attestations, portable credentials, open discovery, and verifiable service quality. citeturn5view0turn2view2

If you build this “agent flow intelligence” layer *on top of Locus*, the fit tightens further: Locus is listed as a Synthesis partner tool in the official hackathon brief, and its partner-track page defines a “Best Use of Locus” prize pool and judging rubric that explicitly rewards deep integration, spend controls, and auditability (including “logs reasoning alongside financial actions”). citeturn3view1turn28view0

## Data source URL catalog for onchain behavior and x402 payment observability

The shortest path to a working behavioral layer is to treat your system like an indexer with a small set of “source adapters,” each backed by stable URLs and protocols.

The URLs below are grouped by what they let you ingest. The surrounding paragraphs state what each group is for (with citations); the URLs themselves are provided in code blocks so you can paste them directly into config.

### Hackathon platform and problem briefs

These are your “rules of the world” and track anchors: registration, deadlines, and the problem statements you should quote in your README/demo narrative. citeturn3view1turn4view0turn5view0turn2view2

```text
https://github.com/sodofi/synthesis-hackathon
https://synthesis.md/
https://synthesis.md/skill.md
https://synthesis.devfolio.co/register
https://synthesis.devfolio.co/themes.md
https://eips.ethereum.org/EIPS/eip-8004
```

### Locus beta endpoints for hackathon-grade ingestion

Locus’s Synthesis page gives you a curated set of **key beta endpoints** (registration, wallet status, balance, sending, wrapped APIs, checkout payment, x402 calls, and feedback). citeturn28view0turn3view1 These are high-signal because they expose wallet state, transaction history, checkout lifecycle, and x402 routing in one place (and they align to Locus’ rubric emphasizing controls + audit trails). citeturn28view0turn26search3

```text
# Base URL (beta)
https://beta-api.paywithlocus.com

# Agent registration & wallet readiness
https://beta-api.paywithlocus.com/api/register
https://beta-api.paywithlocus.com/api/status

# Credits (useful for demo + reproducible testing)
https://beta-api.paywithlocus.com/api/gift-code-requests

# Wallet + payment actions (behavioral “ground truth”)
https://beta-api.paywithlocus.com/api/pay/balance
https://beta-api.paywithlocus.com/api/pay/send
https://beta-api.paywithlocus.com/api/pay/transactions

# Checkout lifecycle (agent-as-buyer)
https://beta-api.paywithlocus.com/api/checkout/agent/preflight/:sessionId
https://beta-api.paywithlocus.com/api/checkout/agent/pay/:sessionId
https://beta-api.paywithlocus.com/api/checkout/agent/payments/:txId

# Wrapped API catalog + calls (pay-per-use app-layer commerce)
https://beta-api.paywithlocus.com/api/wrapped/md
https://beta-api.paywithlocus.com/api/wrapped/:provider/:endpoint

# x402 endpoint routing via Locus
https://beta-api.paywithlocus.com/api/x402/:slug

# Skill file and feedback channel
https://beta-api.paywithlocus.com/api/skills/skill.md
https://beta-api.paywithlocus.com/api/feedback
```

### Locus production URLs to keep the system real after the hackathon

Locus docs define production API base URLs and the standard skill file locations used by compatible agent frameworks. citeturn26search4turn7view2

```text
# Production base + docs
https://api.paywithlocus.com/api
https://docs.paywithlocus.com/

# Skill and companion docs (as referenced by Locus docs)
https://paywithlocus.com/skill.md
https://paywithlocus.com/onboarding.md
https://paywithlocus.com/checkout.md
```

### x402 protocol specs and operational semantics

Your x402 “payment observability” is easiest if you treat x402 as a structured event stream carried in HTTP headers. x402 v2 standardizes the three headers that define the full handshake: `PAYMENT-REQUIRED` (terms), `PAYMENT-SIGNATURE` (payer authorization), and `PAYMENT-RESPONSE` (settlement result). citeturn21view0turn21view2turn24view0 The x402 v2 spec also standardizes the JSON shapes for `PaymentRequired`, `PaymentPayload`, and `SettlementResponse`, which is exactly what you want for schema-first ingestion. citeturn24view0

```text
# x402 docs and reference implementation/spec
https://docs.x402.org/core-concepts/http-402
https://docs.x402.org/core-concepts/facilitator
https://github.com/coinbase/x402
https://github.com/coinbase/x402/tree/main/specs
https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md

# Coinbase x402 overview (developer-facing explanation + flow)
https://docs.cdp.coinbase.com/x402/welcome
https://docs.cdp.coinbase.com/x402/core-concepts/how-it-works
```

### Base onchain behavior sources

Base’s official docs publish chain parameters you should hard-code (chain id and public RPC endpoint) and also recommend production node providers for serious usage. citeturn9view0 For “wallet behavior analytics,” you primarily need: tx history, token transfers (especially USDC), contract ABIs (for decoding), and explorer-grade metadata. Etherscan API v2 provides a multichain interface that includes Base (chain id 8453) and publishes a machine-readable chainlist that explicitly lists Base Mainnet with chain id 8453. citeturn9view0turn10search12turn10search0

```text
# Base official connection info
https://docs.base.org/base-chain/quickstart/connecting-to-base
https://mainnet.base.org

# Explorer UI
https://basescan.org/
https://basescan.org/address/{wallet}
https://basescan.org/tx/{txHash}

# Etherscan API v2 (Base via chainid=8453)
https://api.etherscan.io/v2/api?chainid=8453&module=account&action=txlist&address={wallet}&sort=asc&apikey={key}
https://api.etherscan.io/v2/api?chainid=8453&module=account&action=tokentx&address={wallet}&sort=asc&apikey={key}
https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getabi&address={contract}&apikey={key}

# Etherscan v2 chain registry (confirm supported chains & ids)
https://api.etherscan.io/v2/chainlist
```

### Blockscout as an alternative onchain API surface on Base

Base documentation lists a Blockscout explorer endpoint, and Blockscout provides instance-specific API docs for Base mainnet. citeturn9view0turn18search0 This is useful redundancy: if one explorer API rate-limits you, you can still populate most behavioral metrics.

```text
# Base Blockscout explorer + API docs
https://base.blockscout.com/
https://base.blockscout.com/api-docs
```

### Attestations and receipts as “portable trust evidence”

On the trust/evidence side, Ethereum Attestation Service (EAS) positions itself as a public, open protocol for onchain/offchain attestations, and Base has its own EASScan deployment for exploring attestations on Base. citeturn11search15turn14view2 EASScan also exposes GraphQL endpoints at `/graphql` on each chain subdomain (including Base and Base Sepolia), which is ideal for indexing. citeturn15view0turn17view2turn17view1

For x402 receipts specifically, PEAC adds a verifiable receipt layer to HTTP 402 flows and carries receipts in a `PEAC-Receipt` header; PEAC’s x402 integration docs explicitly describe mapping x402 offers/settlement results into portable receipts. citeturn19search1turn19search0turn19search26

```text
# EAS (Base)
https://base.easscan.org/
https://base.easscan.org/attestations
https://base.easscan.org/schemas
https://base.easscan.org/graphql

# EAS (Base Sepolia) for cheap demos
https://base-sepolia.easscan.org/
https://base-sepolia.easscan.org/graphql

# EAS SDK + contracts
https://github.com/ethereum-attestation-service/eas-sdk
https://github.com/ethereum-attestation-service/eas-contracts

# PEAC receipts for x402 flows
https://x402.peacprotocol.org/
https://www.peacprotocol.org/integrations/x402
https://github.com/peacprotocol/peac
```

## Signal and metric model for a behavior-first index

Your framing (“do what onchain analytics did for wallets: behavior first”) is aligned with how the Synthesis themes describe the trust gap (verifiable service quality, open discovery, attestations) and the spend gap (auditable transaction history, enforceable spend boundaries). citeturn5view0turn3view1turn28view0 The important design move is to emit **observable facts** and only derive **patterns**, not “identity truth.”

A practical schema that stays true to that principle is three event families:

**App-layer paid interactions (Locus + x402).**  
Locus wrapped APIs let an agent call third-party endpoints and “pay per call in USDC,” with Locus handling authentication/billing, and a “charge-on-success” model that restores allowance on upstream failures. citeturn25view3 Locus also supports approval thresholds (high-value calls return a `202` with an approval URL) and a dashboard-visible audit trail. citeturn25view3turn26search3 Separately, x402 v2 defines a standard HTTP lifecycle where each paid request yields structured headers—terms, payer authorization, and settlement response—which you can decode into a canonical `payment_event`. citeturn21view0turn21view2turn24view0

**Onchain wallet and contract activity (Base).**  
Base mainnet parameters (chain id 8453; public RPC endpoint) are documented, and explorer APIs can supply transaction lists and token transfers that let you compute lifecycle and network metrics (age, counterparties, concentration, burstiness). citeturn9view0turn10search12

**Attestations and receipts (EAS + PEAC).**  
EAS makes attestations composable and queryable; on Base you can index attestations using EASScan and its GraphQL endpoint. citeturn11search15turn15view0turn14view2 PEAC explicitly positions itself as an evidence layer that records what terms applied and what happened, and can carry settlement refs from x402; its x402 adapter is designed to normalize x402 offers/settlement responses into verifiable receipts carried via `PEAC-Receipt`. citeturn19search26turn19search1

From those events, you can compute the exact behavioral features you listed, plus a few that are “cheap but expressive” for a hackathon MVP:

- **Wallet lifecycle:** wallet creation proxy via first-seen onchain activity (first tx timestamp); time since first tx; dormancy windows; “dormant then sudden activity” via inter-arrival gaps. (Base tx history) citeturn10search13turn9view0  
- **Throughput and regularity:** tx count per day/week; burstiness score (e.g., coefficient of variation of daily tx counts); frequency consistency over time. (Base + Locus tx history) citeturn28view0turn10search13  
- **Counterparty graph:** unique counterparties; repeat counterparty rate; concentration (top counterparty share); dependency on one funding wallet (largest inbound source). (Base + Locus destination fields) citeturn10search13turn28view0  
- **Payment behavior:** average payment size; size distribution; “micro vs macro spend”; settlement latency (time from x402 attempt to confirmation); failure rate (x402 `SettlementResponse.success=false`). citeturn24view0turn21view0turn21view2  
- **Fulfillment reliability:** for x402, you can treat “payment success + response received” as fulfilled; for Locus Tasks, you can model deadlines, grace periods, and refunds when no match is found. citeturn21view2turn26search2turn25view3  
- **Control-surface compliance:** whether actions triggered approvals; how often approvals were required; whether transactions stayed under allowances/max-tx thresholds (as configured). (Locus spend controls + approvals) citeturn26search3turn25view3turn28view0  
- **Evidence density:** attestations issued/received; receipt availability rate (pct of paid calls with PEAC receipt); diversity of attestation schemas used. citeturn11search15turn15view0turn19search1turn19search0  

Your UI/outputs naturally become “wallet-analytics style” views: heat maps, activity clusters, reliability bands, risk flags, and flow graphs—without ever declaring “trusted.” That stays faithful to the Synthesis “verifiable service quality” direction while avoiding centralized registry semantics. citeturn5view0turn3view1

## MVP product spec

**Product name (working):** Agent Flow Intelligence (AFI)

**One-liner:** A behavior-first observability index for agent commerce that merges Locus payments, x402 receipts, Base onchain activity, and attestations into portable “counterparty behavior” profiles—without asserting identity truth.

**Primary user:** builders and operators of agents who need auditability + risk visibility while staying inside the Synthesis themes (“pay” + “trust”). citeturn5view0turn28view0

**Non-goals (important for judging clarity):**  
AFI does not adjudicate “good agent/bad agent,” does not issue centralized verification, and does not claim that a wallet equals a real-world entity. It emits observed facts and derived patterns.

**Core workflows (MVP):**

- **Agent profile:** input a wallet (or Locus agent id / ERC‑8004 agent identity if available) and render behavioral panels: lifecycle, spend patterns, counterparty network, settlement success, approval/controls usage. (Synthesis registration produces an onchain identity and includes a BaseScan transaction link you can use as an anchor.) citeturn4view0turn5view2  
- **Counterparty profile:** input a payee/service endpoint and show inbound flows, repeat rates, median/avg payment sizes, and fulfillment confirmation rate (x402 success + receipt evidence). citeturn21view2turn19search1turn24view0  
- **Flow explorer:** show a graph view: agent wallet → counterparties → services (wrapped API providers, checkout merchants, x402 endpoints). Locus explicitly supports wrapped APIs and checkout flows that you can treat as “service sectors.” citeturn25view3turn28view0turn26search3  
- **Evidence export:** produce a “portable packet” for one interaction (headers decoded + onchain tx hash + optional PEAC receipt + optional EAS attestation references) so a judge can verify the claim independently. (This aligns with both “trust” and “pay” narratives.) citeturn24view0turn21view0turn19search26turn11search15  

**Success criteria for the hackathon demo:**

- Demonstrate at least one end-to-end paid API call where you capture `PAYMENT-REQUIRED` → `PAYMENT-SIGNATURE` → `PAYMENT-RESPONSE`, decode it, and link the settlement tx hash to Base explorer data. citeturn21view0turn24view0turn9view0turn10search12  
- Demonstrate at least one Locus-originated flow (wrapped API call, checkout payment, or transfer) and show how spend controls + approval threshold affect the behavioral record. citeturn25view3turn26search3turn28view0  
- Optionally: show one “portable trust/evidence” artifact (PEAC receipt or EAS attestation) bound to a paid interaction. citeturn19search1turn11search15  

## Architecture and data pipeline

A minimal-but-solid architecture is a small set of adapters that normalize raw events into one canonical event schema, then compute metrics.

**Ingestion adapters**

- **Locus adapter:** pull from the beta endpoints Locus lists for Synthesis builders (register/status/balance/send/transactions/wrapped/checkout/x402). citeturn28view0turn3view1  
- **x402 adapter:** instrument your agent’s HTTP client to log and decode x402 headers. x402 v2 guarantees these headers exist to communicate requirements, pay authorization, and settlement outcomes. citeturn21view0turn21view2turn24view0  
- **Base adapter:** fetch tx history and token transfers using Etherscan v2 (chain id 8453) and/or Blockscout’s Base API surface. citeturn10search12turn18search0turn9view0  
- **Attestation adapter:** query EASScan’s Base GraphQL endpoint to attribute attestations to agent wallets/counterparties, and optionally use the EAS SDK if you want to write your own attestations. citeturn15view0turn11search3turn11search15  
- **Receipt adapter (optional but powerful):** accept and verify PEAC receipts for x402 interactions; PEAC’s x402 integration is explicitly designed to map x402 fields into receipt claims, carried via `PEAC-Receipt`. citeturn19search1turn19search0turn19search26  

**Normalization**

Normalize everything into a compact set of records:

- `interaction` (one paid call / one checkout / one transfer)  
- `wallet_snapshot` (balance, allowance, limits at time of interaction)  
- `settlement` (tx hash, network, timestamps, success/failure reason)  
- `evidence` (headers decoded, receipts, attestations)

x402 spec v2 gives you strong typing for `PaymentRequired`, `PaymentPayload`, and `SettlementResponse`, including fields like network (CAIP-2), amount, asset, payTo, payer, and transaction hash—ideal for normalization. citeturn24view0turn21view0

**Correlation keys**

- **Wallet address** is the universal join key (Locus wallet address ↔ Base tx history ↔ EAS attestors/recipients). Locus is explicitly Base-native for wallets/USDC. citeturn26search5turn26search6turn28view0  
- **Transaction hash** is the strongest join key for x402 settlement: `SettlementResponse.transaction` plus Base explorer lookup. citeturn24view0turn21view2  
- **Agent identity anchor (optional):** Synthesis registration creates an onchain ERC‑8004 identity and returns a BaseScan transaction URL, which can serve as a stable “agent handle” without becoming an identity oracle. citeturn4view0turn5view2  

**Why this stays “behavior-first” even with ERC‑8004**

ERC‑8004 itself distinguishes between identity registry and reputation/validation registries and notes that payments are orthogonal, while giving examples where x402 proof-of-payment can enrich feedback signals. citeturn5view2 Your product can treat ERC‑8004 as just another *event source* (a registration artifact) and still keep all scoring grounded in observed flows.

## Implementation plan for the remaining hackathon window

You are currently inside the Synthesis build window, and the deadline is March 22, 2026 at 11:59pm Pacific Time (per both the Synthesis hackathon repo and Locus’ Synthesis page). citeturn3view1turn28view0 The plan below is optimized to produce a crisp demo with verifiable artifacts rather than a sprawling platform.

**Phase focused on ingestion and canonical schema (now through midweek)**  
Build the event schema first, then wire adapters in descending “signal value per hour”: Locus transactions and x402 header captures first, then onchain enrichment, then attestations. Locus explicitly lists which beta endpoints matter for hackathon builders, including transactions, checkout pay, and x402 calls. citeturn28view0 x402’s header contract is stable and spec’d, so you can reliably decode flows in your own middleware. citeturn21view0turn24view0

Deliverable: a local pipeline that can produce a single JSON “interaction packet” containing (a) decoded x402 headers, (b) the settlement tx hash, and (c) matched Base tx metadata.

**Phase focused on metric computation and UI (late week)**  
Implement a small set of derived metrics that map directly to your narrative and the Synthesis prompts: spend scope adherence, settlement success rate, counterparty concentration, burstiness, and fulfillment latency. The x402 flow definition (402→pay→200 with `PAYMENT-RESPONSE`) gives you deterministic “attempt vs success” semantics, and Locus gives you “human-in-the-loop” controls (allowance, max tx size, approval threshold) that you can surface as constraints. citeturn21view2turn21view0turn26search3turn28view0

Deliverable: a lightweight dashboard with three screens (agent profile, counterparty profile, flow explorer) plus downloadable evidence packets.

**Phase focused on portable trust evidence (weekend)**  
Add one of:
- **PEAC receipts for x402 calls** (best if you want “verifiable service quality” proofs that travel across orgs). citeturn19search1turn19search26  
- **EAS attestations** for “fulfillment claims” or “dispute outcomes,” indexable via Base EASScan GraphQL. citeturn15view0turn11search15  

Deliverable: show, in-demo, that a paid interaction yields not only a tx hash but also a portable receipt or attestation reference.

**Final phase focused on submission packaging (deadline day)**  
Package for judges according to the agent-facing rules: open source repo, working demo, and documented human↔agent process. citeturn4view0turn3view1 If you target the Locus partner track, align your README sections to their rubric (integration depth, UX around spend controls, auditability). citeturn28view0

Deliverable: a demo script that walks through: “here’s the paid call → here are the headers decoded → here’s the settlement tx on Base → here are derived behavior patterns → here is portable evidence.”