import { describe, expect, mock, test } from 'bun:test'
import { sendSignedTransaction } from '../../src/node/index.ts'

describe('sendSignedTransaction', () => {
  test('posts a base64 encoded transaction to JSON-RPC', async () => {
    let requestInit: RequestInit | undefined
    const fetchMock = mock(async (_input: Request | URL | string, init?: RequestInit) => {
      requestInit = init

      return Response.json({
        id: 1,
        jsonrpc: '2.0',
        result: 'transaction-signature',
      })
    })

    const signature = await sendSignedTransaction({
      fetch: fetchMock,
      rpcUrl: 'https://api.devnet.solana.com',
      signedTransaction: new Uint8Array([1, 2, 3]),
    })

    expect(signature).toBe('transaction-signature')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal)
  })
})
