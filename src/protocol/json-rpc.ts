export interface JsonRpcError {
  code: number
  message: string
}

export interface JsonRpcRequest {
  id: number
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  error?: JsonRpcError
  id: number
  jsonrpc: '2.0'
  result?: unknown
}

export function createJsonRpcError(id: number, code: number, message: string): JsonRpcResponse {
  return {
    error: { code, message },
    id,
    jsonrpc: '2.0',
  }
}

export function createJsonRpcResult(id: number, result: unknown): JsonRpcResponse {
  return {
    id,
    jsonrpc: '2.0',
    result,
  }
}
