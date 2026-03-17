import { useEffect, useMemo, useState } from "react";

type InteractionRow = {
  id: string;
  created_at: string;
  agent_id?: string;
  wallet_address?: string;
  counterparty?: string;
  service?: string;
  protocol: string;
};

type InteractionDetail = {
  interaction: InteractionRow;
  x402?: {
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
  controls?: {
    amount: number | null;
    currency: string | null;
    approvalRequired: boolean | null;
    withinAllowance: boolean | null;
    withinMaxTx: boolean | null;
    source: string;
  };
  evidence: Array<{ id: string; kind: string; payload: unknown; created_at: string }>;
  settlement: { id: string; status: string; tx_hash?: string };
  baseTransaction?: { tx_hash: string; status: string; block_number?: string; from?: string; to?: string; value?: string };
  walletSnapshot?: {
    wallet_address?: string;
    balance?: string;
    allowance?: string;
    max_tx?: string;
    approvals_required?: boolean;
    metadata?: unknown;
  };
  receipts?: Array<{ id: string; raw: unknown; created_at: string }>;
};

type AgentMetrics = {
  wallet: string;
  lifecycle: { firstSeen?: string; lastSeen?: string; ageDays: number };
  throughput: { totalInteractions: number; dailyCounts: number[]; burstiness: number };
  counterparty: { unique: number; top: { id: string; share: number } | null; repeatRate: number };
  paymentBehavior: { count: number; avg: number; min: number; max: number; median: number };
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
      uniqueTokens: number;
      topToken: { symbol: string; share: number } | null;
    };
  };
};

type CounterpartyMetrics = {
  counterparty: string;
  volume: { totalInteractions: number; uniqueWallets: number };
  paymentBehavior: { count: number; avg: number; min: number; max: number; median: number };
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

export function App() {
  const [interactions, setInteractions] = useState<InteractionRow[]>([]);
  const [selected, setSelected] = useState<InteractionDetail | null>(null);
  const [wallet, setWallet] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [agentMetrics, setAgentMetrics] = useState<AgentMetrics | null>(null);
  const [counterpartyMetrics, setCounterpartyMetrics] = useState<CounterpartyMetrics | null>(null);

  useEffect(() => {
    fetch("/api/interactions")
      .then((res) => res.json())
      .then(setInteractions)
      .catch(() => setInteractions([]));
  }, []);

  const loadDetail = (id: string) => {
    fetch(`/api/interactions/${id}`)
      .then((res) => res.json())
      .then(setSelected)
      .catch(() => setSelected(null));
  };

  const loadAgentMetrics = () => {
    if (!wallet) return;
    fetch(`/api/metrics/agent/${wallet}`)
      .then((res) => res.json())
      .then(setAgentMetrics)
      .catch(() => setAgentMetrics(null));
  };

  const loadCounterpartyMetrics = () => {
    if (!counterparty) return;
    fetch(`/api/metrics/counterparty/${counterparty}`)
      .then((res) => res.json())
      .then(setCounterpartyMetrics)
      .catch(() => setCounterpartyMetrics(null));
  };

  const flowEdges = useMemo(() => {
    const map = new Map<string, number>();
    for (const interaction of interactions) {
      const left = interaction.wallet_address ?? "unknown";
      const counterpartyLabel = interaction.counterparty ?? "unknown";
      const key = interaction.service ? `${left}→${counterpartyLabel}→${interaction.service}` : `${left}→${counterpartyLabel}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([key, count]) => ({ nodes: key.split("→"), count }));
  }, [interactions]);

  const formatControlStatus = (controls?: InteractionDetail["controls"]) => {
    if (!controls) return "—";
    if (controls.withinAllowance === null && controls.withinMaxTx === null) return "—";
    if (controls.withinAllowance === false || controls.withinMaxTx === false) return "over-limit";
    return "within-limits";
  };

  const formatHandshakeStatus = (selectedDetail: InteractionDetail) => {
    const packet = selectedDetail.x402;
    if (!packet) return "not-captured";
    if (packet.challenge.present && packet.authorization.hasSignature && packet.settlement.present) return "complete";
    if (packet.challenge.present && !packet.authorization.hasSignature) return "challenge-only";
    if (packet.authorization.hasSignature && !packet.settlement.present) return "authorized";
    if (packet.settlement.present) return "settled";
    return "not-captured";
  };

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
            <input
              placeholder="Wallet address (Base)"
              value={wallet}
              onChange={(event) => setWallet(event.target.value)}
            />
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
                <strong>
                  {agentMetrics.counterparty.top ? `${agentMetrics.counterparty.top.id}` : "—"}
                </strong>
              </div>
              <div>
                <span>Settlement success</span>
                <strong>{(agentMetrics.settlement.successRate * 100).toFixed(0)}%</strong>
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
          <div className="afi-flow">
            {flowEdges.length === 0 && <p>No interactions yet.</p>}
            {flowEdges.map((edge) => (
              <div key={edge.nodes.join("→")} className="afi-edge">
                <div className="afi-edge-label">
                  {edge.nodes.map((node, idx) => (
                    <span key={`${node}:${idx}`}>
                      {idx === 0 ? node : `→ ${node}`}
                    </span>
                  ))}
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
              {interactions.map((row) => (
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
                    <span>x402 Handshake</span>
                    <strong>{formatHandshakeStatus(selected)}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{selected.settlement?.status ?? "unknown"}</strong>
                  </div>
                  <div>
                    <span>Amount</span>
                    <strong>
                      {selected.controls?.amount === null || selected.controls?.amount === undefined
                        ? "—"
                        : `${selected.controls.amount}${selected.controls.currency ? ` ${selected.controls.currency}` : ""}`}
                    </strong>
                  </div>
                  <div>
                    <span>Controls</span>
                    <strong>{formatControlStatus(selected.controls)}</strong>
                  </div>
                </div>
                {selected.x402 && (
                  <div className="afi-metrics">
                    <div>
                      <span>Challenge</span>
                      <strong>{selected.x402.challenge.present ? "captured" : "missing"}</strong>
                    </div>
                    <div>
                      <span>Authorization</span>
                      <strong>{selected.x402.authorization.hasSignature ? "signature-recorded" : "missing"}</strong>
                    </div>
                    <div>
                      <span>Settlement</span>
                      <strong>
                        {selected.x402.settlement.present
                          ? selected.x402.settlement.success === null
                            ? "recorded"
                            : selected.x402.settlement.success
                              ? "success"
                              : "failed"
                          : "missing"}
                      </strong>
                    </div>
                    <div>
                      <span>Settlement tx</span>
                      <strong>{selected.x402.settlement.txHash ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Network</span>
                      <strong>{selected.x402.settlement.network ?? selected.x402.challenge.decoded?.network ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Pay To</span>
                      <strong>{selected.x402.settlement.payTo ?? selected.x402.challenge.decoded?.payTo ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Payer</span>
                      <strong>{selected.x402.settlement.payer ?? selected.x402.authorization.decoded?.payer ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Base correlation</span>
                      <strong>{selected.baseTransaction ? selected.baseTransaction.status : "missing"}</strong>
                    </div>
                  </div>
                )}
                <pre>{JSON.stringify(selected, null, 2)}</pre>
                <a
                  href={`data:application/json,${encodeURIComponent(JSON.stringify(selected))}`}
                  download={`afi-${selected.interaction.id}.json`}
                >
                  Download JSON
                </a>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
