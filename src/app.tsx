import { useEffect, useMemo, useState } from "react";

type InteractionRow = {
  id: string;
  created_at: string;
  agent_id?: string;
  wallet_address?: string;
  counterparty?: string;
  protocol: string;
};

type InteractionDetail = {
  interaction: InteractionRow;
  evidence: Array<{ id: string; kind: string; payload: unknown; created_at: string }>;
  settlement: { id: string; status: string; tx_hash?: string };
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
  evidenceDensity: number;
};

type CounterpartyMetrics = {
  counterparty: string;
  volume: { totalInteractions: number; uniqueWallets: number };
  paymentBehavior: { count: number; avg: number; min: number; max: number; median: number };
  fulfillment: { total: number; successRate: number };
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
      const right = interaction.counterparty ?? "unknown";
      const key = `${left}→${right}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([key, count]) => {
      const [from, to] = key.split("→");
      return { from, to, count };
    });
  }, [interactions]);

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
                <span>Evidence density</span>
                <strong>{agentMetrics.evidenceDensity.toFixed(1)}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="afi-panel">
          <h2>Counterparty Profile</h2>
          <div className="afi-form">
            <input
              placeholder="Counterparty ID / service"
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
            </div>
          )}
        </section>

        <section className="afi-panel">
          <h2>Flow Explorer</h2>
          <p className="afi-muted">Agent → Counterparty edges grouped by interaction count.</p>
          <div className="afi-flow">
            {flowEdges.length === 0 && <p>No interactions yet.</p>}
            {flowEdges.map((edge) => (
              <div key={`${edge.from}-${edge.to}`} className="afi-edge">
                <div className="afi-edge-label">
                  <span>{edge.from}</span>
                  <span>→</span>
                  <span>{edge.to}</span>
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
                    <span>Status</span>
                    <strong>{selected.settlement?.status ?? "unknown"}</strong>
                  </div>
                </div>
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
