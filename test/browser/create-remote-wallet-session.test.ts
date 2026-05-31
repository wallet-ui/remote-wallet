import { describe, expect, test } from 'bun:test'
import { createRemoteWalletSession } from '../../src/browser/index.ts'

class MockWebSocket extends EventTarget {
  static readonly CLOSED = 3
  static readonly CLOSING = 2
  static readonly CONNECTING = 0
  static readonly OPEN = 1

  readonly sentMessages: string[] = []
  readyState = MockWebSocket.CONNECTING

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  send(message: string) {
    this.sentMessages.push(message)
  }
}

describe('createRemoteWalletSession', () => {
  test('creates a pairing URL and cancel function', async () => {
    const session = await createRemoteWalletSession({
      relayUrl: 'wss://relay.example.com',
    })

    expect(session.pairingUrl.startsWith('solana-wallet:/v1/associate/remote/nostr')).toBe(true)
    expect(typeof session.cancel).toBe('function')
  })

  test('rejects pending authorization when the relay closes after subscription', async () => {
    const originalWebSocket = globalThis.WebSocket
    const sockets: MockWebSocket[] = []

    globalThis.WebSocket = class extends MockWebSocket {
      constructor() {
        super()
        sockets.push(this)
      }
    } as unknown as typeof WebSocket

    try {
      const session = await createRemoteWalletSession({
        relayUrl: 'wss://relay.example.com',
      })
      const authorizedSession = session.connect({ timeoutMs: 10_000 })
      const socket = sockets[0]

      if (!socket) {
        throw new Error('Expected session to open a WebSocket')
      }

      socket.open()

      const request = JSON.parse(socket.sentMessages[0] ?? '[]') as [string, string]

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))
      socket.close()

      await expect(
        Promise.race([
          authorizedSession,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Authorization did not reject')), 50)),
        ]),
      ).rejects.toThrow('Nostr relay relay.example.com closed')
    } finally {
      globalThis.WebSocket = originalWebSocket
    }
  })
})
