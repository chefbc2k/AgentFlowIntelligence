import crypto from "node:crypto";

export interface X402Headers {
  paymentRequired?: string;
  paymentSignature?: string;
  paymentResponse?: string;
  peacReceipt?: string;
}

export function extractX402Headers(headers: Record<string, string | string[] | undefined>): X402Headers {
  const getHeader = (name: string) => {
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lower) {
        if (Array.isArray(value)) {
          return value.join(",");
        }
        return value;
      }
    }
    return undefined;
  };

  return {
    paymentRequired: getHeader("payment-required"),
    paymentSignature: getHeader("payment-signature"),
    paymentResponse: getHeader("payment-response"),
    peacReceipt: getHeader("peac-receipt"),
  };
}

export function parseJsonHeader(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function interactionIdFromParts(parts: string[]): string {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("|");
  }
  return hash.digest("hex");
}
