import { describe, expect, test } from 'bun:test'
import {
  createRemoteWalletSession,
  type RemoteWalletIdentity,
  type RemoteWalletPairingSession,
} from '../../src/browser/index.ts'
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  createNostrEvent,
  decryptMessage,
  deriveSharedSecret,
  ENCODED_PUBLIC_KEY_LENGTH_BYTES,
  encryptMessage,
  generateNostrKeypair,
  type NostrEvent,
  parseNostrAssociationUrl,
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

describe('createRemoteWalletSession', () => {
  test('creates a pairing URL after relay subscription', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const sessionPromise = createRemoteWalletSession({
        relayUrl: 'wss://relay.example.com',
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))

      const session = await sessionPromise

      expect(session.pairingUrl.startsWith('solana-wallet:/v1/associate/remote/nostr')).toBe(true)
      expect(typeof session.cancel).toBe('function')
    })
  })

  test('waits for subscription before resolving the pairing session', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      let resolved = false
      const sessionPromise = createRemoteWalletSession({
        relayUrl: 'wss://relay.example.com',
      }).then((session) => {
        resolved = true

        return session
      })
      const socket = await waitForSocket(sockets)

      socket.open()
      await waitForMicrotasks()

      expect(resolved).toBe(false)

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))
      await sessionPromise

      expect(resolved).toBe(true)
    })
  })

  test('subscribes with the derived session identifier', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const sessionPromise = createRemoteWalletSession({
        relayUrl: 'wss://relay.example.com',
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))

      const session = await sessionPromise
      const pairing = parseNostrAssociationUrl(session.pairingUrl)

      expect(request[2]['#d']).toEqual([pairing.sessionIdentifier])
      expect(request[2]['#d']).toEqual([session.sessionIdentifier])
    })
  })

  test('uses the enforced connect timeout for the pairing expiry', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const before = Date.now()
      const sessionPromise = createRemoteWalletSession({
        relayUrl: 'wss://relay.example.com',
        timeoutMs: 1,
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))

      const session = await sessionPromise
      const expiryDelayMs = Date.parse(session.expiresAt) - before

      expect(expiryDelayMs).toBeGreaterThanOrEqual(30_000)
      expect(expiryDelayMs).toBeLessThan(35_000)
    })
  })

  test('ignores empty startup events until a valid CONNECT arrives', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const sessionPromise = createRemoteWalletSession({
        relayUrl: 'wss://relay.example.com',
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))

      const session = await sessionPromise
      const walletNostrKeypair = generateNostrKeypair()
      const nonConnectEvent = createNostrEvent(
        '',
        20012,
        [
          ['d', session.sessionIdentifier],
          ['p', session.dappNostrPubkey],
        ],
        walletNostrKeypair.privateKey,
      )

      dispatchNostrEvent(socket, request[1], nonConnectEvent)
      await waitForMicrotasks()

      expect(socket.sentMessages).toHaveLength(1)

      const connectEvent = createNostrEvent(
        '',
        20012,
        [
          ['d', session.sessionIdentifier],
          ['p', session.dappNostrPubkey],
          ['msg', 'CONNECT'],
        ],
        walletNostrKeypair.privateKey,
      )

      dispatchNostrEvent(socket, request[1], connectEvent)
      await waitForSentMessages(socket, 2)

      const helloRequest = JSON.parse(socket.sentMessages[1] ?? '[]') as ['EVENT', NostrEvent]

      expect(helloRequest[0]).toBe('EVENT')
      expect(helloRequest[1].content.length).toBeGreaterThan(0)
    })
  })

  test('uses the session identity for sign in reauthorization', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const identity: RemoteWalletIdentity = {
        name: 'Spec Test Dapp',
        uri: 'https://dapp.example.com',
      }
      const sessionPromise = createRemoteWalletSession({
        identity,
        relayUrl: 'wss://relay.example.com',
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))

      const session = await sessionPromise
      const authorizedSessionPromise = session.connect()
      const walletNostrKeypair = generateNostrKeypair()
      const connectEvent = createWalletNostrEvent(session, walletNostrKeypair.privateKey, '', [['msg', 'CONNECT']])

      dispatchNostrEvent(socket, request[1], connectEvent)
      await waitForSentMessages(socket, 2)

      const helloRequest = getSentNostrEvent(socket, 1)
      const helloResponse = await createWalletHelloResponse(session, helloRequest)
      const helloResponseEvent = createWalletNostrEvent(session, walletNostrKeypair.privateKey, helloResponse.content)

      dispatchNostrEvent(socket, request[1], helloResponseEvent)
      await waitForSentMessages(socket, 3)

      const accountAddress = bytesToBase64(new Uint8Array(32).fill(1))
      const authorizeRequest = await decryptJsonRpcRequest(getSentNostrEvent(socket, 2), helloResponse.sharedSecret)

      expect(authorizeRequest.method).toBe('authorize')
      expect(authorizeRequest.params.identity).toEqual(identity)

      const authorizeResponseEvent = await createWalletJsonRpcResponseEvent({
        id: authorizeRequest.id,
        result: {
          accounts: [{ address: accountAddress }],
          auth_token: 'auth-token',
        },
        sequenceNumber: 2,
        session,
        sharedSecret: helloResponse.sharedSecret,
        walletNostrPrivateKey: walletNostrKeypair.privateKey,
      })

      dispatchNostrEvent(socket, request[1], authorizeResponseEvent)

      const authorizedSession = await authorizedSessionPromise
      const signInPromise = authorizedSession.signIn({ domain: 'dapp.example.com' })

      await waitForSentMessages(socket, 4)

      const signInAuthorizeRequest = await decryptJsonRpcRequest(
        getSentNostrEvent(socket, 3),
        helloResponse.sharedSecret,
      )

      expect(signInAuthorizeRequest.method).toBe('authorize')
      expect(signInAuthorizeRequest.params.identity).toEqual(identity)
      expect(signInAuthorizeRequest.params.sign_in_payload).toMatchObject({
        domain: 'dapp.example.com',
      })

      const signInResponseEvent = await createWalletJsonRpcResponseEvent({
        id: signInAuthorizeRequest.id,
        result: {
          accounts: [{ address: accountAddress }],
          auth_token: 'sign-in-auth-token',
          sign_in_result: {
            address: accountAddress,
            signature: bytesToBase64(new Uint8Array(64).fill(2)),
            signature_type: 'ed25519',
            signed_message: bytesToBase64(new TextEncoder().encode('signed message')),
          },
        },
        sequenceNumber: 3,
        session,
        sharedSecret: helloResponse.sharedSecret,
        walletNostrPrivateKey: walletNostrKeypair.privateKey,
      })

      dispatchNostrEvent(socket, request[1], signInResponseEvent)

      await signInPromise
      authorizedSession.close()
    })
  })

  test('rejects pending authorization when the relay closes after subscription', async () => {
    await withMockWebSocket(async ({ sockets }) => {
      const sessionPromise = createRemoteWalletSession({
        relayUrl: 'wss://relay.example.com',
      })
      const socket = await waitForSocket(sockets)

      socket.open()

      const request = getSubscriptionRequest(socket)

      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))

      const session = await sessionPromise
      const authorizedSession = session.connect({ timeoutMs: 10_000 })

      socket.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify(['CLOSED', request[1], 'error: subscription closed']),
        }),
      )

      await expect(
        Promise.race([
          authorizedSession,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Authorization did not reject')), 50)),
        ]),
      ).rejects.toThrow('Nostr relay relay.example.com closed subscription: error: subscription closed')
    })
  })
})

interface JsonRpcRequest {
  id: number
  method: string
  params: {
    identity?: unknown
    sign_in_payload?: unknown
  }
}

async function createWalletHelloResponse(session: RemoteWalletPairingSession, helloRequest: NostrEvent) {
  const dappEcdhPublicKey = base64ToBytes(helloRequest.content).slice(0, ENCODED_PUBLIC_KEY_LENGTH_BYTES)
  const pairing = parseNostrAssociationUrl(session.pairingUrl)
  const walletEcdhKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const sharedSecret = await deriveSharedSecret({
    associationPublicKey: pairing.associationPublicKey,
    dappEcdhPublicKey,
    walletEcdhPrivateKey: walletEcdhKeyPair.privateKey,
  })
  const sessionProperties = await encryptMessage(JSON.stringify({ v: 1 }), 1, sharedSecret)
  const walletEcdhPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', walletEcdhKeyPair.publicKey))

  return {
    content: bytesToBase64(concatBytes(walletEcdhPublicKey, sessionProperties)),
    sharedSecret,
  }
}

async function createWalletJsonRpcResponseEvent({
  id,
  result,
  sequenceNumber,
  session,
  sharedSecret,
  walletNostrPrivateKey,
}: {
  id: number
  result: unknown
  sequenceNumber: number
  session: RemoteWalletPairingSession
  sharedSecret: CryptoKey
  walletNostrPrivateKey: Uint8Array
}) {
  const response = await encryptMessage(JSON.stringify({ id, jsonrpc: '2.0', result }), sequenceNumber, sharedSecret)

  return createWalletNostrEvent(session, walletNostrPrivateKey, bytesToBase64(response))
}

function createWalletNostrEvent(
  session: RemoteWalletPairingSession,
  walletNostrPrivateKey: Uint8Array,
  content: string,
  extraTags: string[][] = [],
) {
  return createNostrEvent(
    content,
    20012,
    [['d', session.sessionIdentifier], ['p', session.dappNostrPubkey], ...extraTags],
    walletNostrPrivateKey,
  )
}

async function decryptJsonRpcRequest(event: NostrEvent, sharedSecret: CryptoKey) {
  return JSON.parse(await decryptMessage(base64ToBytes(event.content), sharedSecret)) as JsonRpcRequest
}

function dispatchNostrEvent(socket: MockWebSocket, subscriptionId: string, event: NostrEvent) {
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EVENT', subscriptionId, event]) }))
}

function getSentNostrEvent(socket: MockWebSocket, messageIndex: number) {
  const message = JSON.parse(socket.sentMessages[messageIndex] ?? '[]') as ['EVENT', NostrEvent]

  expect(message[0]).toBe('EVENT')

  return message[1]
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

  throw new Error('Expected session to open a WebSocket')
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
