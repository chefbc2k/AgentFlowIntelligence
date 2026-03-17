export interface BaseTxResult {
  txHash: string;
  status: "confirmed" | "failed" | "unknown";
  blockNumber?: string;
  confirmedAt?: string;
  from?: string;
  to?: string;
  value?: string;
  raw: Record<string, unknown>;
}

function parseHexTimestamp(timestampHex?: string): string | undefined {
  if (!timestampHex || typeof timestampHex !== "string") return undefined;
  const normalized = timestampHex.startsWith("0x") ? timestampHex : `0x${timestampHex}`;
  const seconds = Number.parseInt(normalized, 16);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

async function fetchBlockTimestampFromEtherscan(apiKey: string, blockNumberHex: string): Promise<string | undefined> {
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", "8453");
  url.searchParams.set("module", "proxy");
  url.searchParams.set("action", "eth_getBlockByNumber");
  url.searchParams.set("tag", blockNumberHex);
  url.searchParams.set("boolean", "false");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Etherscan failed: ${response.status}`);
  }
  const payload = await response.json();
  const result = payload?.result as { timestamp?: string } | null;
  return parseHexTimestamp(result?.timestamp);
}

async function fetchBlockTimestampFromBlockscout(blockNumberHex: string): Promise<string | undefined> {
  const url = new URL("https://base.blockscout.com/api");
  url.searchParams.set("module", "proxy");
  url.searchParams.set("action", "eth_getBlockByNumber");
  url.searchParams.set("tag", blockNumberHex);
  url.searchParams.set("boolean", "false");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Blockscout failed: ${response.status}`);
  }
  const payload = await response.json();
  const result = payload?.result as { timestamp?: string } | null;
  return parseHexTimestamp(result?.timestamp);
}

export async function fetchBaseTxFromEtherscan(apiKey: string, txHash: string): Promise<BaseTxResult> {
  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", "8453");
  url.searchParams.set("module", "proxy");
  url.searchParams.set("action", "eth_getTransactionByHash");
  url.searchParams.set("txhash", txHash);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Etherscan failed: ${response.status}`);
  }
  const payload = await response.json();
  const result = payload?.result as { hash?: string; blockNumber?: string; from?: string; to?: string; value?: string } | null;
  if (!result?.hash) {
    return { txHash, status: "unknown", raw: payload as Record<string, unknown> };
  }

  let confirmedAt: string | undefined;
  if (result.blockNumber) {
    try {
      confirmedAt = await fetchBlockTimestampFromEtherscan(apiKey, result.blockNumber);
    } catch {
      confirmedAt = undefined;
    }
  }

  return {
    txHash,
    status: result.blockNumber ? "confirmed" : "unknown",
    blockNumber: result.blockNumber,
    confirmedAt,
    from: result.from,
    to: result.to,
    value: result.value,
    raw: payload as Record<string, unknown>,
  };
}

export async function fetchBaseTxFromBlockscout(txHash: string): Promise<BaseTxResult> {
  const url = new URL("https://base.blockscout.com/api");
  url.searchParams.set("module", "proxy");
  url.searchParams.set("action", "eth_getTransactionByHash");
  url.searchParams.set("txhash", txHash);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Blockscout failed: ${response.status}`);
  }
  const payload = await response.json();
  const result = payload?.result as { hash?: string; blockNumber?: string; from?: string; to?: string; value?: string } | null;
  if (!result?.hash) {
    return { txHash, status: "unknown", raw: payload as Record<string, unknown> };
  }

  let confirmedAt: string | undefined;
  if (result.blockNumber) {
    try {
      confirmedAt = await fetchBlockTimestampFromBlockscout(result.blockNumber);
    } catch {
      confirmedAt = undefined;
    }
  }

  return {
    txHash,
    status: result.blockNumber ? "confirmed" : "unknown",
    blockNumber: result.blockNumber,
    confirmedAt,
    from: result.from,
    to: result.to,
    value: result.value,
    raw: payload as Record<string, unknown>,
  };
}

export async function fetchBaseTx(
  txHash: string,
  options: { etherscanApiKey?: string },
): Promise<BaseTxResult> {
  if (options.etherscanApiKey) {
    try {
      return await fetchBaseTxFromEtherscan(options.etherscanApiKey, txHash);
    } catch {
      return fetchBaseTxFromBlockscout(txHash);
    }
  }
  return fetchBaseTxFromBlockscout(txHash);
}

export interface BaseTxListItem {
  hash?: string;
  blockNumber?: string;
  timeStamp?: string;
  from?: string;
  to?: string;
  value?: string;
  isError?: string;
}

export interface TokenTransferItem {
  hash?: string;
  blockNumber?: string;
  timeStamp?: string;
  from?: string;
  to?: string;
  contractAddress?: string;
  tokenSymbol?: string;
  value?: string;
  logIndex?: string;
}

async function fetchEtherscanList<T>(path: URL): Promise<T> {
  const response = await fetch(path.toString());
  if (!response.ok) {
    throw new Error(`Etherscan failed: ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.status === "0" && payload?.message === "NOTOK") {
    throw new Error(`Etherscan error: ${payload?.result ?? "unknown"}`);
  }
  return payload?.result as T;
}

export async function fetchBaseTxHistory(address: string, options: { etherscanApiKey?: string }) {
  if (options.etherscanApiKey) {
    const url = new URL("https://api.etherscan.io/v2/api");
    url.searchParams.set("chainid", "8453");
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "txlist");
    url.searchParams.set("address", address);
    url.searchParams.set("sort", "asc");
    url.searchParams.set("apikey", options.etherscanApiKey);
    try {
      return await fetchEtherscanList<BaseTxListItem[]>(url);
    } catch {
      return fetchBaseTxHistoryFromBlockscout(address);
    }
  }
  return fetchBaseTxHistoryFromBlockscout(address);
}

export async function fetchBaseTokenTransfers(address: string, options: { etherscanApiKey?: string }) {
  if (options.etherscanApiKey) {
    const url = new URL("https://api.etherscan.io/v2/api");
    url.searchParams.set("chainid", "8453");
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "tokentx");
    url.searchParams.set("address", address);
    url.searchParams.set("sort", "asc");
    url.searchParams.set("apikey", options.etherscanApiKey);
    try {
      return await fetchEtherscanList<TokenTransferItem[]>(url);
    } catch {
      return fetchBaseTokenTransfersFromBlockscout(address);
    }
  }
  return fetchBaseTokenTransfersFromBlockscout(address);
}

async function fetchBlockscoutList<T>(address: string, action: "txlist" | "tokentx"): Promise<T> {
  const url = new URL("https://base.blockscout.com/api");
  url.searchParams.set("module", "account");
  url.searchParams.set("action", action);
  url.searchParams.set("address", address);
  url.searchParams.set("sort", "asc");
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Blockscout failed: ${response.status}`);
  }
  const payload = await response.json();
  return payload?.result as T;
}

export async function fetchBaseTxHistoryFromBlockscout(address: string) {
  return fetchBlockscoutList<BaseTxListItem[]>(address, "txlist");
}

export async function fetchBaseTokenTransfersFromBlockscout(address: string) {
  return fetchBlockscoutList<TokenTransferItem[]>(address, "tokentx");
}
