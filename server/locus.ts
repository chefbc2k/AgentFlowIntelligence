import { z } from "zod";

const locusStatusSchema = z.object({
  address: z.string().optional(),
  balance: z.string().optional(),
  status: z.string().optional(),
});

const locusTxSchema = z.array(
  z.object({
    id: z.string().optional(),
    amount: z.string().optional(),
    currency: z.string().optional(),
    status: z.string().optional(),
    createdAt: z.string().optional(),
    txHash: z.string().optional(),
    counterparty: z.string().optional(),
  }).passthrough(),
);

const locusBalanceSchema = z
  .object({
    balance: z.string().optional(),
    allowance: z.string().optional(),
    maxTx: z.string().optional(),
    approvalsRequired: z.boolean().optional(),
  })
  .passthrough();

export interface LocusClientConfig {
  baseUrl: string;
  apiKey: string;
  agentId?: string;
}

export class LocusClient {
  constructor(private readonly config: LocusClientConfig) {}

  private async getJson<T>(path: string) {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Locus request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private async postJson<T>(path: string, body?: Record<string, unknown>) {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`Locus request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async getStatus() {
    return locusStatusSchema.parse(await this.getJson("/api/status"));
  }

  async register(payload?: Record<string, unknown>) {
    return this.postJson("/api/register", payload);
  }

  async getBalance() {
    return locusBalanceSchema.parse(await this.getJson("/api/pay/balance"));
  }

  async sendPayment(payload: Record<string, unknown>) {
    return this.postJson("/api/pay/send", payload);
  }

  async getTransactions() {
    return locusTxSchema.parse(await this.getJson("/api/pay/transactions"));
  }

  async getWrappedCatalog() {
    return this.getJson("/api/wrapped/md");
  }

  async callWrapped(provider: string, endpoint: string, payload?: Record<string, unknown>) {
    return this.postJson(`/api/wrapped/${provider}/${endpoint}`, payload);
  }

  async callX402(slug: string, payload?: Record<string, unknown>) {
    return this.postJson(`/api/x402/${slug}`, payload);
  }

  async checkoutPreflight(sessionId: string) {
    return this.getJson(`/api/checkout/agent/preflight/${sessionId}`);
  }

  async checkoutPay(sessionId: string, payload?: Record<string, unknown>) {
    return this.postJson(`/api/checkout/agent/pay/${sessionId}`, payload);
  }

  async checkoutPayment(txId: string) {
    return this.getJson(`/api/checkout/agent/payments/${txId}`);
  }
}
