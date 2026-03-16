import crypto from "node:crypto";

export interface PeacParseResult {
  id: string;
  raw: string;
  decoded?: Record<string, unknown>;
  status: "decoded" | "raw";
}

function stableIdFromInput(input: string) {
  const hash = crypto.createHash("sha256");
  hash.update(input);
  return hash.digest("hex");
}

export function parsePeacReceipt(receipt?: string): PeacParseResult | undefined {
  if (!receipt) return undefined;
  const trimmed = receipt.trim();
  const id = stableIdFromInput(trimmed);
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const decoded = JSON.parse(trimmed) as Record<string, unknown>;
      return { id, raw: trimmed, decoded, status: "decoded" };
    } catch {
      return { id, raw: trimmed, status: "raw" };
    }
  }
  if (trimmed.split(".").length === 3) {
    const [, payload] = trimmed.split(".");
    try {
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
      const decodedPayload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
      return { id, raw: trimmed, decoded: decodedPayload, status: "decoded" };
    } catch {
      return { id, raw: trimmed, status: "raw" };
    }
  }
  return { id, raw: trimmed, status: "raw" };
}
