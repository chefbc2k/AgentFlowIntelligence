import { extractX402Headers } from "./x402";
import type { X402Transcript } from "./types";

export interface CapturePaymentResult {
  paymentSignature?: string;
  retryInit?: RequestInit;
}

export interface FetchWithX402CaptureOptions extends RequestInit {
  onPaymentRequired?: (challenge: { response: Response; headers: ReturnType<typeof extractX402Headers> }) => Promise<CapturePaymentResult | void>;
}

function responseStep(response: Response) {
  const rawHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    rawHeaders[key] = value;
  });
  return {
    status: response.status,
    headers: extractX402Headers(rawHeaders),
  };
}

export async function fetchWithX402Capture(
  url: string,
  options: FetchWithX402CaptureOptions = {},
): Promise<{ response: Response; capture: X402Transcript }> {
  const { onPaymentRequired, ...initialRequest } = options;
  const initialResponse = await fetch(url, initialRequest);
  const initialStep = responseStep(initialResponse);

  if (initialResponse.status !== 402 || !onPaymentRequired) {
    return {
      response: initialResponse,
      capture: {
        requestUrl: url,
        settlement: initialStep,
      },
    };
  }

  const payment = (await onPaymentRequired({ response: initialResponse, headers: initialStep.headers })) ?? {};
  const retryHeaders = new Headers(payment.retryInit?.headers ?? initialRequest.headers ?? {});
  if (payment.paymentSignature) {
    retryHeaders.set("payment-signature", payment.paymentSignature);
  }
  const retryInit: RequestInit = {
    ...initialRequest,
    ...payment.retryInit,
    headers: retryHeaders,
  };
  const finalResponse = await fetch(url, retryInit);
  const settlement = responseStep(finalResponse);

  return {
    response: finalResponse,
    capture: {
      requestUrl: url,
      challenge: initialStep,
      authorization: {
        paymentSignature: payment.paymentSignature ?? retryHeaders.get("payment-signature") ?? undefined,
      },
      settlement,
    },
  };
}
