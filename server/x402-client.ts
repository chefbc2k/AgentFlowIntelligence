import { extractX402Headers } from "./x402";

export interface CapturedX402 {
  headers: {
    paymentRequired?: string;
    paymentSignature?: string;
    paymentResponse?: string;
    peacReceipt?: string;
  };
  status: number;
  url: string;
}

export async function fetchWithX402Capture(url: string, options?: RequestInit): Promise<{ response: Response; capture: CapturedX402 }> {
  const response = await fetch(url, options);
  const rawHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    rawHeaders[key] = value;
  });
  const headers = extractX402Headers(rawHeaders);
  return {
    response,
    capture: {
      headers,
      status: response.status,
      url,
    },
  };
}
