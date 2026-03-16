export interface EasConfig {
  baseUrl: string;
}

export interface EasAttestation {
  id: string;
  attester?: string;
  recipient?: string;
  schemaId?: string;
  txHash?: string;
  time?: number;
  raw: Record<string, unknown>;
}

const ATTESTATIONS_QUERY = `
  query Attestations($address: String!) {
    attestations(
      where: { or: [{ attester: $address }, { recipient: $address }] }
      orderBy: time
      orderDirection: desc
    ) {
      id
      attester
      recipient
      schemaId
      txid
      time
      data
    }
  }
`;

export async function fetchEasAttestations(config: EasConfig, address: string): Promise<EasAttestation[]> {
  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: ATTESTATIONS_QUERY, variables: { address: address.toLowerCase() } }),
  });
  if (!response.ok) {
    throw new Error(`EAS GraphQL failed: ${response.status}`);
  }
  const payload = await response.json();
  const rows = payload?.data?.attestations ?? [];
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    attester: typeof row.attester === "string" ? row.attester : undefined,
    recipient: typeof row.recipient === "string" ? row.recipient : undefined,
    schemaId: typeof row.schemaId === "string" ? row.schemaId : undefined,
    txHash: typeof row.txid === "string" ? row.txid : undefined,
    time: typeof row.time === "number" ? row.time : Number(row.time),
    raw: row,
  }));
}
