import crypto from "node:crypto";
import type { X402Packet, X402PaymentPayload, X402PaymentRequired, X402SettlementResponse } from "./types";

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

function asRecord<T extends Record<string, unknown>>(value?: Record<string, unknown>): T | undefined {
  return value as T | undefined;
}

function extractString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function decodePaymentRequired(raw?: string): X402PaymentRequired | undefined {
  return asRecord<X402PaymentRequired>(parseJsonHeader(raw));
}

export function decodePaymentPayload(raw?: string): X402PaymentPayload | undefined {
  return asRecord<X402PaymentPayload>(parseJsonHeader(raw));
}

export function decodeSettlementResponse(raw?: string): X402SettlementResponse | undefined {
  return asRecord<X402SettlementResponse>(parseJsonHeader(raw));
}

export function extractSettlementTxHash(paymentResponse?: X402SettlementResponse): string | undefined {
  if (!paymentResponse) return undefined;

  const candidates = ["transaction", "txHash", "tx", "hash"] as const;
  for (const key of candidates) {
    const value = paymentResponse[key];
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      if (typeof nested.hash === "string") return nested.hash;
    }
  }

  return undefined;
}

export function extractSettlementSuccess(paymentResponse?: X402SettlementResponse): boolean | undefined {
  if (!paymentResponse) return undefined;
  return typeof paymentResponse.success === "boolean" ? paymentResponse.success : undefined;
}

export function extractSettlementReason(paymentResponse?: X402SettlementResponse): string | undefined {
  if (!paymentResponse) return undefined;
  return (
    extractString(paymentResponse.reason) ??
    extractString(paymentResponse.error) ??
    extractString(paymentResponse.message)
  );
}

export function buildX402Packet(
  headers: X402Headers,
  overrides: { txHash?: string } = {},
): X402Packet {
  const challenge = decodePaymentRequired(headers.paymentRequired);
  const authorization = decodePaymentPayload(headers.paymentSignature);
  const settlement = decodeSettlementResponse(headers.paymentResponse);
  const txHash = overrides.txHash ?? extractSettlementTxHash(settlement);
  const network = extractString(settlement?.network) ?? extractString(challenge?.network) ?? extractString(authorization?.network);
  const payer = extractString(settlement?.payer) ?? extractString(authorization?.payer);
  const payTo = extractString(settlement?.payTo) ?? extractString(challenge?.payTo);
  const success = extractSettlementSuccess(settlement) ?? null;
  const reason = extractSettlementReason(settlement);

  return {
    challenge: {
      present: Boolean(headers.paymentRequired),
      raw: headers.paymentRequired,
      decoded: challenge,
    },
    authorization: {
      present: Boolean(headers.paymentSignature),
      raw: headers.paymentSignature,
      decoded: authorization,
      hasSignature: Boolean(headers.paymentSignature),
    },
    settlement: {
      present: Boolean(headers.paymentResponse),
      raw: headers.paymentResponse,
      decoded: settlement,
      txHash,
      network,
      payer,
      payTo,
      success,
      reason,
    },
  };
}
