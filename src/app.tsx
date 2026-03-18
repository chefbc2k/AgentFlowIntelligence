import { useEffect, useMemo, useState } from "react";

type InteractionRow = {
  id: string;
  created_at: string;
  agent_id?: string;
  wallet_address?: string;
  counterparty?: string;
  service?: string;
  protocol: string;
  amountUSD?: number | null;
  protocolName?: string;
  protocolCategory?: string;
};

type ProtocolLabelAttribution = {
  contract?: string;
  name?: string;
  category?: string;
  source: "dune" | "graph" | "defillama";
  labeledAt: string;
  metadata: Record<string, unknown>;
};

type X402Packet = {
  challenge: { present: boolean; decoded?: { amount?: string; asset?: string; network?: string; payTo?: string } };
  authorization: { hasSignature: boolean; decoded?: { payer?: string; network?: string } };
  settlement: {
    present: boolean;
    success: boolean | null;
    txHash?: string;
    network?: string;
    payer?: string;
    payTo?: string;
    reason?: string;
  };
};

type X402Transcript = {
  requestUrl: string;
  challenge?: { status: number; headers?: Record<string, string | undefined> };
  authorization?: { paymentSignature?: string };
  settlement?: { status: number; headers?: Record<string, string | undefined> };
};

type InteractionDetail = {
  version: string;
  exportedAt: string;
  interaction: InteractionRow;
  controls: {
    amount: number | null;
    currency: string | null;
    approvalRequired: boolean | null;
    withinAllowance: boolean | null;
    withinMaxTx: boolean | null;
    source: string;
  };
  protocol: {
    kind: string;
    x402?: {
      packet: X402Packet;
      transcript?: X402Transcript;
    };
    locus?: {
      transaction?: Record<string, unknown>;
    };
  };
  evidence: {
    timeline: Array<{ id: string; kind: string; payload: unknown; created_at: string }>;
    receipts: Array<{ id: string; tx_hash?: string; status?: string; decoded?: unknown; raw: unknown; created_at: string }>;
    attestations: Array<{ id: string; schemaId?: string; txHash?: string; chainId?: number; created_at: string; raw: unknown }>;
  };
  correlations: {
    settlement?: { id: string; status: string; tx_hash?: string };
    baseTransaction?: { tx_hash: string; status: string; block_number?: string; from?: string; to?: string; value?: string };
    walletSnapshot?: {
      wallet_address?: string;
      balance?: string;
      allowance?: string;
      max_tx?: string;
      approvals_required?: boolean;
      metadata?: unknown;
    };
    protocolLabel?: ProtocolLabelAttribution;
  };
  provenance: {
    source: "afi";
    interactionId: string;
    exportRoute: string;
    schemaVersion: string;
  };
  summary: {
    handshakeStatus: string;
    controlStatus: string;
    settlementStatus: string;
    receiptCount: number;
    attestationCount: number;
    evidenceKinds: string[];
  };
  references: {
    wallet?: { address: string; explorerUrl: string };
    counterparty?: { id: string; explorerUrl?: string };
    service?: string;
    transaction?: { txHash: string; explorerUrl: string };
    protocol?: { name?: string; category?: string; contract?: string };
  };
};

type AgentMetrics = {
  wallet: string;
  lifecycle: { firstSeen?: string; lastSeen?: string; ageDays: number };
  throughput: { totalInteractions: number; dailyCounts: number[]; burstiness: number };
  counterparty: { unique: number; top: { id: string; share: number } | null; repeatRate: number };
  paymentBehavior: { count: number; avg: number; min: number; max: number; median: number };
  paymentBehaviorUSD: { count: number; avg: number; min: number; max: number; median: number; totalVolumeUSD: number };
  protocolActivity: {
    uniqueProtocols: number;
    topProtocol: { name: string; share: number } | null;
    categoryBreakdown: Record<string, number>;
    escrowCompletionRate: number | null;
    stakingMetrics: { staked: number; slashed: number } | null;
  };
  settlement: { total: number; successRate: number };
  settlementLatency: { total: number; avgSeconds: number; minSeconds: number; maxSeconds: number; medianSeconds: number };
  controls: {
    approvals: { total: number; required: number; rate: number };
    allowance: { total: number; compliant: number; overLimit: number; rate: number };
    maxTx: { total: number; compliant: number; overLimit: number; rate: number };
    overall: { total: number; compliant: number; rate: number };
  };
  receiptAvailability: { total: number; withReceipt: number; rate: number };
  evidenceDensity: number;
  onchain?: {
    transactions: {
      total: number;
      confirmed: number;
      failed: number;
      unknown: number;
      uniqueCounterparties: number;
      topCounterparty: { address: string; share: number } | null;
    };
    tokenTransfers: {
      total: number;
      inbound: number;
      outbound: number;
      inboundVolumeUSD: number;
      outboundVolumeUSD: number;
      totalVolumeUSD: number;
      uniqueTokens: number;
      topToken: { symbol: string; share: number } | null;
    };
    protocols: {
      unique: number;
      topProtocol: { name: string; share: number } | null;
      categoryBreakdown: Record<string, number>;
    };
  };
};

type CounterpartyMetrics = {
  counterparty: string;
  volume: { totalInteractions: number; uniqueWallets: number };
  paymentBehavior: { count: number; avg: number; min: number; max: number; median: number };
  paymentBehaviorUSD: { count: number; avg: number; min: number; max: number; median: number; totalVolumeUSD: number };
  protocolActivity: {
    uniqueProtocols: number;
    topProtocol: { name: string; share: number } | null;
    categoryBreakdown: Record<string, number>;
    escrowCompletionRate: number | null;
    stakingMetrics: { staked: number; slashed: number } | null;
  };
  fulfillment: { total: number; successRate: number };
  settlementLatency: { total: number; avgSeconds: number; minSeconds: number; maxSeconds: number; medianSeconds: number };
  controls: {
    approvals: { total: number; required: number; rate: number };
    allowance: { total: number; compliant: number; overLimit: number; rate: number };
    maxTx: { total: number; compliant: number; overLimit: number; rate: number };
    overall: { total: number; compliant: number; rate: number };
  };
  receiptAvailability: { total: number; withReceipt: number; rate: number };
};

type FlowEdge = {
  wallet: string;
  counterparty: string;
  service: string;
  count: number;
};

export function formatAmount(detail: InteractionDetail) {
  if (detail.interaction.amountUSD !== null && detail.interaction.amountUSD !== undefined) {
    return `${detail.interaction.amountUSD.toFixed(2)} USD`;
  }
  if (detail.controls.amount === null || detail.controls.amount === undefined) {
    return "—";
  }
  return `${detail.controls.amount}${detail.controls.currency ? ` ${detail.controls.currency}` : ""}`;
}

export function formatControlStatus(detail: InteractionDetail) {
  if (detail.summary.controlStatus) return detail.summary.controlStatus;
  if (detail.controls.withinAllowance === null && detail.controls.withinMaxTx === null) return "—";
  if (detail.controls.withinAllowance === false || detail.controls.withinMaxTx === false) return "over-limit";
  return "within-limits";
}

export function formatSettlementBadge(packet?: X402Packet) {
  if (!packet?.settlement.present) return "missing";
  if (packet.settlement.success === null) return "recorded";
  return packet.settlement.success ? "success" : "failed";
}

export function formatHttpStatus(status?: number) {
  return status === undefined ? "—" : String(status);
}

export function getFlowServiceLabel(interaction: InteractionRow) {
  return interaction.protocolName
    ? interaction.service
      ? `${interaction.protocolName} ${interaction.service}`
      : interaction.protocolName
    : interaction.service ?? "unknown";
}

export function filterInteractionsByFlow(
  interactions: InteractionRow[],
  flowFilter: { wallet?: string; counterparty?: string; service?: string } | null,
) {
  if (!flowFilter) return interactions;
  return interactions.filter((interaction) => {
    if (flowFilter.wallet && (interaction.wallet_address ?? "unknown") !== flowFilter.wallet) return false;
    if (flowFilter.counterparty && (interaction.counterparty ?? "unknown") !== flowFilter.counterparty) return false;
    if (flowFilter.service && getFlowServiceLabel(interaction) !== flowFilter.service) return false;
    return true;
  });
}

export function findInteractionForFlow(
  interactions: InteractionRow[],
  filter: { wallet?: string; counterparty?: string; service?: string },
) {
  return interactions.find((interaction) => {
    if (filter.wallet && (interaction.wallet_address ?? "unknown") !== filter.wallet) return false;
    if (filter.counterparty && (interaction.counterparty ?? "unknown") !== filter.counterparty) return false;
    if (filter.service && getFlowServiceLabel(interaction) !== filter.service) return false;
    return true;
  });
}

export function selectInteractionForFlow(
  interactions: InteractionRow[],
  filter: { wallet?: string; counterparty?: string; service?: string },
  onMatch: (id: string) => void,
) {
  const match = findInteractionForFlow(interactions, filter);
  if (!match) return null;
  onMatch(match.id);
  return match;
}

export function buildFlowEdges(interactions: InteractionRow[]): FlowEdge[] {
  const map = new Map<string, FlowEdge>();
  for (const interaction of interactions) {
    const key = [interaction.wallet_address ?? "unknown", interaction.counterparty ?? "unknown", getFlowServiceLabel(interaction)].join("→");
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    map.set(key, {
      wallet: interaction.wallet_address ?? "unknown",
      counterparty: interaction.counterparty ?? "unknown",
      service: getFlowServiceLabel(interaction),
      count: 1,
    });
  }
  return Array.from(map.values());
}

export function App() {
  const [interactions, setInteractions] = useState<InteractionRow[]>([]);
  const [selected, setSelected] = useState<InteractionDetail | null>(null);
  const [flowFilter, setFlowFilter] = useState<{ wallet?: string; counterparty?: string; service?: string } | null>(null);
  const [wallet, setWallet] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [agentMetrics, setAgentMetrics] = useState<AgentMetrics | null>(null);
  const [counterpartyMetrics, setCounterpartyMetrics] = useState<CounterpartyMetrics | null>(null);
  const [refreshingProtocol, setRefreshingProtocol] = useState(false);
  const [protocolRefreshMessage, setProtocolRefreshMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/interactions")
      .then((res) => res.json())
      .then(setInteractions)
      .catch(() => setInteractions([]));
  }, []);

  const loadDetail = (id: string) => {
    return fetch(`/api/interactions/${id}/packet`)
      .then((res) => res.json())
      .then((detail: InteractionDetail) => {
        setSelected(detail);
        if (detail.references.wallet?.address) {
          setWallet(detail.references.wallet.address);
        }
        if (detail.references.counterparty?.id) {
          setCounterparty(detail.references.counterparty.id);
        }
      })
      .catch(() => setSelected(null));
  };

  const refreshProtocolLabel = (interactionId: string) => {
    setRefreshingProtocol(true);
    setProtocolRefreshMessage(null);

    fetch(`/api/interactions/${interactionId}/enrich/protocol`, { method: "POST" })
      .then(async (res) => {
        const payload = (await res.json()) as { error?: string; message?: string };
        if (!res.ok) {
          throw new Error(payload.error ?? "refresh_failed");
        }
        await loadDetail(interactionId);
        setProtocolRefreshMessage(payload.message ?? "Protocol label refreshed");
      })
      .catch(() => setProtocolRefreshMessage("Protocol refresh failed"))
      .finally(() => setRefreshingProtocol(false));
  };

  const loadAgentMetricsFor = (walletAddress: string) => {
    fetch(`/api/metrics/agent/${walletAddress}`)
      .then((res) => res.json())
      .then(setAgentMetrics)
      .catch(() => setAgentMetrics(null));
  };

  const loadCounterpartyMetricsFor = (counterpartyId: string) => {
    fetch(`/api/metrics/counterparty/${counterpartyId}`)
      .then((res) => res.json())
      .then(setCounterpartyMetrics)
      .catch(() => setCounterpartyMetrics(null));
  };

  const loadAgentMetrics = () => {
    if (!wallet) return;
    loadAgentMetricsFor(wallet);
  };

  const loadCounterpartyMetrics = () => {
    if (!counterparty) return;
    loadCounterpartyMetricsFor(counterparty);
  };

  const flowEdges = useMemo<FlowEdge[]>(() => buildFlowEdges(interactions), [interactions]);

  const visibleInteractions = useMemo(() => filterInteractionsByFlow(interactions, flowFilter), [flowFilter, interactions]);

  const applyFilter = (filter: { wallet?: string; counterparty?: string; service?: string }) => {
    setFlowFilter(filter);
    selectInteractionForFlow(interactions, filter, loadDetail);
  };

  const selectedPacket = selected?.protocol.x402?.packet;
  const selectedTranscript = selected?.protocol.x402?.transcript;

  return (
    <div className="afi-root">
      <div className="afi-hero">
        <div>
          <h1>Agent Flow Intelligence</h1>
          <p>Behavior-first observability for agent commerce: payments, attestations, receipts, and onchain trails.</p>
        </div>
        <div className="afi-actions">
          <a href="https://synthesis.md/" target="_blank" rel="noreferrer">
            Synthesis Brief
          </a>
          <a href="https://paywithlocus.com/skill.md" target="_blank" rel="noreferrer">
            Locus Skill
          </a>
        </div>
      </div>

      <div className="afi-grid">
        <section className="afi-panel">
          <h2>Agent Profile</h2>
          <div className="afi-form">
            <input placeholder="Wallet address (Base)" value={wallet} onChange={(event) => setWallet(event.target.value)} />
            <button onClick={loadAgentMetrics}>Load</button>
          </div>
          {!agentMetrics && <p className="afi-muted">Enter a wallet to compute lifecycle + spend metrics.</p>}
          {agentMetrics && (
            <div className="afi-metrics">
              <div>
                <span>First seen</span>
                <strong>{agentMetrics.lifecycle.firstSeen ?? "—"}</strong>
              </div>
              <div>
                <span>Age (days)</span>
                <strong>{agentMetrics.lifecycle.ageDays.toFixed(1)}</strong>
              </div>
              <div>
                <span>Burstiness</span>
                <strong>{agentMetrics.throughput.burstiness.toFixed(2)}</strong>
              </div>
              <div>
                <span>Top counterparty</span>
                <strong>{agentMetrics.counterparty.top ? agentMetrics.counterparty.top.id : "—"}</strong>
              </div>
              <div>
                <span>Settlement success</span>
                <strong>{(agentMetrics.settlement.successRate * 100).toFixed(0)}%</strong>
              </div>
              <div>
                <span>Total USD volume</span>
                <strong>{(agentMetrics.paymentBehaviorUSD?.totalVolumeUSD ?? 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>Top protocol</span>
                <strong>{agentMetrics.protocolActivity?.topProtocol?.name ?? "—"}</strong>
              </div>
              <div>
                <span>Approval rate</span>
                <strong>{(agentMetrics.controls.approvals.rate * 100).toFixed(0)}%</strong>
              </div>
              <div>
                <span>Limit compliance</span>
                <strong>{(agentMetrics.controls.overall.rate * 100).toFixed(0)}%</strong>
              </div>
              <div>
                <span>Receipt rate</span>
                <strong>{(agentMetrics.receiptAvailability.rate * 100).toFixed(0)}%</strong>
              </div>
              <div>
                <span>Latency (avg s)</span>
                <strong>{agentMetrics.settlementLatency.avgSeconds.toFixed(1)}</strong>
              </div>
              <div>
                <span>Evidence density</span>
                <strong>{agentMetrics.evidenceDensity.toFixed(1)}</strong>
              </div>
              {agentMetrics.onchain && (
                <>
                  <div>
                    <span>Onchain txs</span>
                    <strong>{agentMetrics.onchain.transactions.total}</strong>
                  </div>
                  <div>
                    <span>Onchain counterparties</span>
                    <strong>{agentMetrics.onchain.transactions.uniqueCounterparties}</strong>
                  </div>
                  <div>
                    <span>Top onchain counterparty</span>
                    <strong>{agentMetrics.onchain.transactions.topCounterparty?.address ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Token transfers</span>
                    <strong>{agentMetrics.onchain.tokenTransfers.total}</strong>
                  </div>
                  <div>
                    <span>Top token</span>
                    <strong>{agentMetrics.onchain.tokenTransfers.topToken?.symbol ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Onchain USD volume</span>
                    <strong>{(agentMetrics.onchain.tokenTransfers.totalVolumeUSD ?? 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Onchain protocols</span>
                    <strong>{agentMetrics.onchain.protocols?.unique ?? 0}</strong>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <section className="afi-panel">
          <h2>Counterparty Profile</h2>
          <div className="afi-form">
            <input
              placeholder="Counterparty ID"
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
            />
            <button onClick={loadCounterpartyMetrics}>Load</button>
          </div>
          {!counterpartyMetrics && <p className="afi-muted">Track inbound flows and fulfillment success.</p>}
          {counterpartyMetrics && (
            <div className="afi-metrics">
              <div>
                <span>Interactions</span>
                <strong>{counterpartyMetrics.volume.totalInteractions}</strong>
              </div>
              <div>
                <span>Unique wallets</span>
                <strong>{counterpartyMetrics.volume.uniqueWallets}</strong>
              </div>
              <div>
                <span>Avg payment</span>
                <strong>{counterpartyMetrics.paymentBehavior.avg.toFixed(2)}</strong>
              </div>
              <div>
                <span>Total USD volume</span>
                <strong>{(counterpartyMetrics.paymentBehaviorUSD?.totalVolumeUSD ?? 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>Top protocol</span>
                <strong>{counterpartyMetrics.protocolActivity?.topProtocol?.name ?? "—"}</strong>
              </div>
              <div>
                <span>Success rate</span>
                <strong>{(counterpartyMetrics.fulfillment.successRate * 100).toFixed(0)}%</strong>
              </div>
              <div>
                <span>Limit compliance</span>
                <strong>{(counterpartyMetrics.controls.overall.rate * 100).toFixed(0)}%</strong>
              </div>
              <div>
                <span>Receipt rate</span>
                <strong>{(counterpartyMetrics.receiptAvailability.rate * 100).toFixed(0)}%</strong>
              </div>
            </div>
          )}
        </section>

        <section className="afi-panel">
          <h2>Flow Explorer</h2>
          <p className="afi-muted">Agent → Counterparty → Service paths grouped by interaction count.</p>
          {flowFilter && (
            <div className="afi-form">
              <span>
                Filtered by {[flowFilter.wallet, flowFilter.counterparty, flowFilter.service].filter(Boolean).join(" → ")}
              </span>
              <button onClick={() => setFlowFilter(null)}>Clear</button>
            </div>
          )}
          <div className="afi-flow">
            {flowEdges.length === 0 && <p>No interactions yet.</p>}
            {flowEdges.map((edge, index) => (
              <div key={`${edge.wallet}:${edge.counterparty}:${edge.service}:${index}`} className="afi-edge">
                <div className="afi-edge-label">
                  <button
                    className="afi-edge-action"
                    onClick={() => {
                      setWallet(edge.wallet);
                      loadAgentMetricsFor(edge.wallet);
                      applyFilter({ wallet: edge.wallet });
                    }}
                  >
                    {edge.wallet}
                  </button>
                  <button
                    className="afi-edge-action"
                    onClick={() => {
                      setCounterparty(edge.counterparty);
                      loadCounterpartyMetricsFor(edge.counterparty);
                      applyFilter({ counterparty: edge.counterparty });
                    }}
                  >
                    {`→ ${edge.counterparty}`}
                  </button>
                  <button className="afi-edge-action" onClick={() => applyFilter({ service: edge.service })}>
                    {`→ ${edge.service}`}
                  </button>
                </div>
                <div className="afi-edge-bar">
                  <div style={{ width: `${Math.min(edge.count * 10, 100)}%` }} />
                </div>
                <span className="afi-edge-count">{edge.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="afi-panel afi-wide">
        <h2>Evidence Packets</h2>
        <div className="afi-evidence-grid">
          <div>
            <h3>Interactions</h3>
            <ul className="afi-list">
              {visibleInteractions.map((row) => (
                <li key={row.id}>
                  <button onClick={() => loadDetail(row.id)}>View</button>
                  <span>{row.id.slice(0, 10)}</span>
                  <span>{row.protocol}</span>
                  <span>{new Date(row.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Packet</h3>
            {!selected && <p className="afi-muted">Select an interaction to inspect evidence.</p>}
            {selected && (
              <div className="afi-packet">
                <div className="afi-packet-meta">
                  <div>
                    <span>ID</span>
                    <strong>{selected.interaction.id}</strong>
                  </div>
                  <div>
                    <span>Packet</span>
                    <strong>{selected.version}</strong>
                  </div>
                  <div>
                    <span>x402 Handshake</span>
                    <strong>{selected.summary.handshakeStatus}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{selected.summary.settlementStatus}</strong>
                  </div>
                  <div>
                    <span>Amount</span>
                    <strong>{formatAmount(selected)}</strong>
                  </div>
                  <div>
                    <span>Protocol</span>
                    <strong>{selected.interaction.protocolName ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Controls</span>
                    <strong>{formatControlStatus(selected)}</strong>
                  </div>
                  <div>
                    <span>Exported</span>
                    <strong>{selected.exportedAt ? new Date(selected.exportedAt).toLocaleString() : "—"}</strong>
                  </div>
                </div>

                <div className="afi-subpanel">
                  <h4>Packet Summary</h4>
                  <div className="afi-metrics">
                    <div>
                      <span>Wallet ref</span>
                      <strong>{selected.references.wallet?.address ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Counterparty ref</span>
                      <strong>{selected.references.counterparty?.id ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Service ref</span>
                      <strong>{selected.references.service ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Evidence kinds</span>
                      <strong>{selected.summary.evidenceKinds.join(", ") || "—"}</strong>
                    </div>
                    <div>
                      <span>Receipts</span>
                      <strong>{selected.summary.receiptCount}</strong>
                    </div>
                    <div>
                      <span>Attestations</span>
                      <strong>{selected.summary.attestationCount}</strong>
                    </div>
                    <div>
                      <span>Export route</span>
                      <strong>{selected.provenance.exportRoute}</strong>
                    </div>
                    <div>
                      <span>Schema</span>
                      <strong>{selected.provenance.schemaVersion}</strong>
                    </div>
                  </div>
                </div>

                <div className="afi-subpanel">
                  <h4>x402 Transcript Timeline</h4>
                  <div className="afi-metrics">
                    <div>
                      <span>Transcript URL</span>
                      <strong>{selectedTranscript?.requestUrl ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Challenge</span>
                      <strong>{selectedPacket?.challenge.present ? "captured" : "missing"}</strong>
                    </div>
                    <div>
                      <span>Challenge HTTP</span>
                      <strong>{formatHttpStatus(selectedTranscript?.challenge?.status)}</strong>
                    </div>
                    <div>
                      <span>Authorization</span>
                      <strong>{selectedPacket?.authorization.hasSignature ? "signature-recorded" : "missing"}</strong>
                    </div>
                    <div>
                      <span>Settlement</span>
                      <strong>{formatSettlementBadge(selectedPacket)}</strong>
                    </div>
                    <div>
                      <span>Settlement HTTP</span>
                      <strong>{formatHttpStatus(selectedTranscript?.settlement?.status)}</strong>
                    </div>
                    <div>
                      <span>Settlement tx</span>
                      <strong>{selectedPacket?.settlement.txHash ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Payer</span>
                      <strong>{selectedPacket?.settlement.payer ?? selectedPacket?.authorization.decoded?.payer ?? "—"}</strong>
                    </div>
                  </div>
                </div>

                <div className="afi-subpanel">
                  <h4>Settlement Correlation</h4>
                  <div className="afi-form">
                    <button onClick={() => refreshProtocolLabel(selected.interaction.id)} disabled={refreshingProtocol}>
                      {refreshingProtocol ? "Refreshing..." : "Refresh protocol label"}
                    </button>
                    <span>{protocolRefreshMessage ?? " "}</span>
                  </div>
                  <div className="afi-metrics">
                    <div>
                      <span>Settlement record</span>
                      <strong>{selected.correlations.settlement?.status ?? "missing"}</strong>
                    </div>
                    <div>
                      <span>Settlement tx</span>
                      <strong>{selected.correlations.settlement?.tx_hash ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Base correlation</span>
                      <strong>{selected.correlations.baseTransaction?.status ?? "missing"}</strong>
                    </div>
                    <div>
                      <span>Base tx hash</span>
                      <strong>{selected.correlations.baseTransaction?.tx_hash ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Wallet snapshot</span>
                      <strong>{selected.correlations.walletSnapshot?.wallet_address ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Allowance</span>
                      <strong>{selected.correlations.walletSnapshot?.allowance ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Max tx</span>
                      <strong>{selected.correlations.walletSnapshot?.max_tx ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Tx explorer</span>
                      <strong>{selected.references.transaction?.explorerUrl ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Protocol source</span>
                      <strong>{selected.correlations.protocolLabel?.source ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Labeled at</span>
                      <strong>
                        {selected.correlations.protocolLabel?.labeledAt
                          ? new Date(selected.correlations.protocolLabel.labeledAt).toLocaleString()
                          : "—"}
                      </strong>
                    </div>
                    <div>
                      <span>Protocol contract</span>
                      <strong>{selected.correlations.protocolLabel?.contract ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Matched by</span>
                      <strong>
                        {typeof selected.correlations.protocolLabel?.metadata?.matchedBy === "string"
                          ? selected.correlations.protocolLabel.metadata.matchedBy
                          : "—"}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="afi-subpanel">
                  <h4>Receipts</h4>
                  {selected.evidence.receipts.length === 0 && <p className="afi-muted">No correlated receipts.</p>}
                  <div className="afi-stack">
                    {selected.evidence.receipts.map((receipt) => (
                      <div key={receipt.id} className="afi-record">
                        <strong>{receipt.id}</strong>
                        <span>Status: {receipt.status ?? "raw"}</span>
                        <span>Tx: {receipt.tx_hash ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="afi-subpanel">
                  <h4>Attestations</h4>
                  {selected.evidence.attestations.length === 0 && <p className="afi-muted">No correlated attestations.</p>}
                  <div className="afi-stack">
                    {selected.evidence.attestations.map((attestation) => (
                      <div key={attestation.id} className="afi-record">
                        <strong>{attestation.id}</strong>
                        <span>Schema: {attestation.schemaId ?? "—"}</span>
                        <span>Tx: {attestation.txHash ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="afi-subpanel">
                  <h4>Evidence Timeline</h4>
                  <div className="afi-stack">
                    {selected.evidence.timeline.map((record) => (
                      <div key={record.id} className="afi-record">
                        <strong>{record.kind}</strong>
                        <span>{record.id}</span>
                        <span>{new Date(record.created_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <details className="afi-subpanel">
                  <summary>Raw packet JSON</summary>
                  <pre>{JSON.stringify(selected, null, 2)}</pre>
                </details>

                <a href={selected.provenance.exportRoute} download={`afi-packet-${selected.interaction.id}.json`}>
                  Download packet JSON
                </a>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
