import { describe, expect, test } from 'bun:test'
import { createJsonRpcError, createJsonRpcResult } from '../../src/protocol/index.ts'

describe('JSON-RPC helpers', () => {
  test('creates an error response', () => {
    expect(createJsonRpcError(8, -32601, 'Method not found')).toEqual({
      error: {
        code: -32601,
        message: 'Method not found',
      },
      id: 8,
      jsonrpc: '2.0',
    })
  })

  test('creates a result response', () => {
    expect(createJsonRpcResult(7, { ok: true })).toEqual({
      id: 7,
      jsonrpc: '2.0',
      result: { ok: true },
    })
  })
})
