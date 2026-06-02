import { describe, expect, test } from 'bun:test'
import { connectRemoteWallet, createRemoteWalletSigner } from '../../src/node/index.ts'
import {
  createNostrEvent,
  deriveNostrSessionIdentifier,
  generateNostrKeypair,
  getNostrEventTags,
  type NostrEvent,
  type PairingDetails,
} from '../../src/protocol/index.ts'

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

describe('connectRemoteWallet', () => {
  test('exposes signer state for connection orchestration', () => {
    const signer = createRemoteWalletSigner({ label: 'Agent Remote Wallet' })

    expect(signer.account.label).toBe('Agent Remote Wallet')
  })

  test('sends a spec-shaped CONNECT event after subscription', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const context = createTestContext()
      const connection = connectRemoteWallet({
        pairing: context.pairing,
        signer: createRemoteWalletSigner({ label: 'Agent Remote Wallet' }),
        timeoutMs: 1,
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))
      await waitForSentMessages(socket, 2)

      const connectMessage = JSON.parse(socket.sentMessages[1] ?? '[]') as ['EVENT', NostrEvent]
      const connectEvent = connectMessage[1]
      const tags = getNostrEventTags(connectEvent)

      expect(connectMessage[0]).toBe('EVENT')
      expect(connectEvent.content).toBe('')
      expect(tags.d).toEqual([context.pairing.sessionIdentifier])
      expect(tags.msg).toEqual(['CONNECT'])
      expect(tags.p).toEqual([context.pairing.dappNostrPubkey])

      dispatchNostrEvent(socket, request[1], createSessionEndEvent(context, connectEvent.pubkey))
      await connection
    })
  })

  test('ignores SESSION_END from an unexpected dapp pubkey', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const context = createTestContext()
      const connection = connectRemoteWallet({
        pairing: context.pairing,
        signer: createRemoteWalletSigner({ label: 'Agent Remote Wallet' }),
        timeoutMs: 1,
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))
      await waitForSentMessages(socket, 2)

      const connectMessage = JSON.parse(socket.sentMessages[1] ?? '[]') as ['EVENT', NostrEvent]
      const wrongDappKeypair = generateNostrKeypair()
      const spoofedSessionEnd = createNostrEvent(
        '',
        20012,
        [
          ['d', context.pairing.sessionIdentifier],
          ['p', connectMessage[1].pubkey],
          ['msg', 'SESSION_END'],
        ],
        wrongDappKeypair.privateKey,
      )

      dispatchNostrEvent(socket, request[1], spoofedSessionEnd)
      await waitForMicrotasks()

      expect(socket.readyState).toBe(MockWebSocket.OPEN)

      dispatchNostrEvent(socket, request[1], createSessionEndEvent(context, connectMessage[1].pubkey))
      await connection
    })
  })

  test('rejects when the relay closes the active subscription', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const context = createTestContext()
      const connection = connectRemoteWallet({
        pairing: context.pairing,
        signer: createRemoteWalletSigner({ label: 'Agent Remote Wallet' }),
        timeoutMs: 1,
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify(['CLOSED', request[1], 'error: subscription closed']),
        }),
      )

      await expect(connection).rejects.toThrow(
        'Nostr relay relay.example.com closed subscription: error: subscription closed',
      )
    })
  })

  test('rejects when the relay rejects a sent event', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const context = createTestContext()
      const connection = connectRemoteWallet({
        pairing: context.pairing,
        signer: createRemoteWalletSigner({ label: 'Agent Remote Wallet' }),
        timeoutMs: 1,
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))
      await waitForSentMessages(socket, 2)

      const connectMessage = JSON.parse(socket.sentMessages[1] ?? '[]') as ['EVENT', NostrEvent]

      socket.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify(['OK', connectMessage[1].id, false, 'blocked: write denied']),
        }),
      )

      await expect(connection).rejects.toThrow('Nostr relay relay.example.com rejected event: blocked: write denied')
    })
  })
})

interface TestContext {
  dappNostrPrivateKey: Uint8Array
  pairing: PairingDetails
}

function createSessionEndEvent(context: TestContext, walletNostrPubkey: string) {
  return createNostrEvent(
    '',
    20012,
    [
      ['d', context.pairing.sessionIdentifier],
      ['p', walletNostrPubkey],
      ['msg', 'SESSION_END'],
    ],
    context.dappNostrPrivateKey,
  )
}

function createTestContext(): TestContext {
  const associationPublicKey = new Uint8Array(65).fill(7)
  const dappNostrKeypair = generateNostrKeypair()

  return {
    dappNostrPrivateKey: dappNostrKeypair.privateKey,
    pairing: {
      associationMode: 'remote',
      associationPublicKey,
      dappNostrPubkey: dappNostrKeypair.publicKey,
      relayDomain: 'relay.example.com',
      relayUrl: 'wss://relay.example.com',
      sessionIdentifier: deriveNostrSessionIdentifier(associationPublicKey),
    },
  }
}

function dispatchNostrEvent(socket: MockWebSocket, subscriptionId: string, event: NostrEvent) {
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EVENT', subscriptionId, event]) }))
}

function getSubscriptionRequest(socket: MockWebSocket) {
  return JSON.parse(socket.sentMessages[0] ?? '[]') as ['REQ', string, { '#d': string[]; kinds: number[] }]
}

async function waitForMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitForSentMessages(socket: MockWebSocket, count: number) {
  for (let index = 0; index < 20; index++) {
    if (socket.sentMessages.length >= count) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected WebSocket to send ${count} messages`)
}

async function waitForSocket(sockets: MockWebSocket[]) {
  for (let index = 0; index < 20; index++) {
    const socket = sockets[0]

    if (socket) {
      return socket
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error('Expected wallet to open a WebSocket')
}

async function withMockWebSocket(testFn: (context: { sockets: MockWebSocket[] }) => Promise<void>) {
  const originalWebSocket = globalThis.WebSocket
  const sockets: MockWebSocket[] = []

  globalThis.WebSocket = class extends MockWebSocket {
    constructor() {
      super()
      sockets.push(this)
    }
  } as unknown as typeof WebSocket

  try {
    await testFn({ sockets })
  } finally {
    globalThis.WebSocket = originalWebSocket
  }
}
