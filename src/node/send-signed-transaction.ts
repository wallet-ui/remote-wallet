import { bytesToBase64 } from '../protocol/encoding.ts'

type Fetch = (input: Request | URL | string, init?: RequestInit) => Promise<Response>

export interface SendSignedTransactionOptions {
  commitment?: string
  fetch?: Fetch
  maxRetries?: number
  minContextSlot?: number
  rpcUrl: string
  signedTransaction: Uint8Array
  skipPreflight?: boolean
  timeoutMs?: number
}

export async function sendSignedTransaction({
  commitment,
  fetch: fetchImpl = fetch,
  maxRetries,
  minContextSlot,
  rpcUrl,
  signedTransaction,
  skipPreflight,
  timeoutMs = 30_000,
}: SendSignedTransactionOptions) {
  const config: Record<string, boolean | number | string> = {
    encoding: 'base64',
  }

  if (commitment) {
    config.preflightCommitment = commitment
  }
  if (maxRetries !== undefined) {
    config.maxRetries = maxRetries
  }
  if (minContextSlot !== undefined) {
    config.minContextSlot = minContextSlot
  }
  if (skipPreflight !== undefined) {
    config.skipPreflight = skipPreflight
  }

  const response = await fetchImpl(rpcUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'sendTransaction',
      params: [bytesToBase64(signedTransaction), config],
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`RPC ${rpcUrl} returned HTTP ${response.status}`)
  }

  const responseBody = (await response.json()) as { error?: { message?: string }; result?: unknown }

  if (typeof responseBody.result !== 'string') {
    throw new Error(responseBody.error?.message ?? `RPC ${rpcUrl} did not return a transaction signature`)
  }

  return responseBody.result
}
