import {
  ENCODED_PUBLIC_KEY_LENGTH_BYTES,
  NOSTR_EVENT_KIND_MWA,
  REMOTE_WALLET_DEFAULT_ACCOUNT_FEATURES,
} from '../protocol/constants.ts'
import {
  createHelloRequest,
  decryptMessage,
  encryptMessage,
  getSequenceNumber,
  parseHelloResponse,
  toArrayBuffer,
} from '../protocol/crypto.ts'
import { base64ToBytes, bytesToBase58, bytesToBase64 } from '../protocol/encoding.ts'
import {
  createNostrAssociationUrl,
  createNostrEvent,
  deriveNostrSessionIdentifier,
  generateNostrKeypair,
  getNostrEventTags,
  isNostrEvent,
  parseNostrRelayMessage,
  verifyNostrEvent,
} from '../protocol/index.ts'

export const REMOTE_WALLET_PAIRING_TTL_MS = 60_000

const MIN_DAPP_CONNECT_TIMEOUT_MS = 30_000
const remoteWalletSessionRuntimeOptions = new WeakMap<RemoteWalletPairingSession, RemoteWalletSessionRuntimeOptions>()

type ProtocolVersion = 'legacy' | 'v1'

interface RemoteWalletAuthorizationResult {
  accounts: RemoteWalletAuthorizationResultAccount[]
  auth_token: string
  sign_in_result?: RemoteWalletSignInResult
  wallet_icon?: string
  wallet_uri_base?: string
}

interface RemoteWalletAuthorizationResultAccount {
  address: string
  chains?: readonly string[]
  features?: readonly string[]
  icon?: string
  label?: string
}

interface RemoteWalletJsonRpcError {
  code: number
  message: string
}

interface RemoteWalletJsonRpcResponse<TResult> {
  error?: RemoteWalletJsonRpcError
  id: number
  jsonrpc: '2.0'
  result?: TResult
}

interface RemoteWalletSignAndSendTransactionsResult {
  signatures: string[]
}

interface RemoteWalletSignInResult {
  address: string
  signature: string
  signature_type?: string
  signed_message: string
}

interface RemoteWalletSignMessagesResult {
  signed_payloads: string[]
}

interface RemoteWalletSignTransactionsResult {
  signed_payloads: string[]
}

export interface ConnectRemoteWalletSessionOptions {
  identity?: RemoteWalletIdentity
  onStatusChange?: (status: RemoteWalletPairingStatus) => void
  session: RemoteWalletPairingSession
  timeoutMs?: number
}

export interface CreateRemoteWalletSessionOptions {
  chains?: readonly string[]
  connect?: boolean
  identity?: RemoteWalletIdentity
  relayUrl: string
  timeoutMs?: number
}

export interface RemoteWalletAuthorizedAccount {
  address: string
  chains: readonly string[]
  features: readonly string[]
  icon?: string
  label?: string
  publicKey: Uint8Array
}

export interface RemoteWalletAuthorizedSession {
  accounts: readonly RemoteWalletAuthorizedAccount[]
  authToken: string
  chain: string
  close: () => void
  disconnect: () => Promise<void>
  signAndSendTransactions: (
    inputs: readonly RemoteWalletSignAndSendTransactionInput[],
  ) => Promise<readonly RemoteWalletSignAndSendTransactionOutput[]>
  signIn: (input?: RemoteWalletSignInInput) => Promise<RemoteWalletSignInOutput>
  signMessages: (inputs: readonly RemoteWalletSignMessageInput[]) => Promise<readonly RemoteWalletSignMessageOutput[]>
  signTransactions: (
    inputs: readonly RemoteWalletSignTransactionInput[],
  ) => Promise<readonly RemoteWalletSignTransactionOutput[]>
}

export interface RemoteWalletIdentity {
  name: string
  uri: string
}

export interface RemoteWalletPairingSession {
  associationKeyPair: CryptoKeyPair
  authorizedSession?: Promise<RemoteWalletAuthorizedSession>
  cancel: () => void
  chain: string
  close: () => void
  connect: (options?: Omit<ConnectRemoteWalletSessionOptions, 'session'>) => Promise<RemoteWalletAuthorizedSession>
  dappNostrPrivateKey: Uint8Array
  dappNostrPubkey: string
  expiresAt: string
  pairingUrl: string
  relayDomain: string
  relayUrl: string
  sessionIdentifier: string
  status: RemoteWalletPairingStatus
}

interface RemoteWalletSessionRuntimeOptions {
  identity?: RemoteWalletIdentity
  onStatusChange?: (status: RemoteWalletPairingStatus) => void
}

export type RemoteWalletPairingStatus =
  | 'authorizing'
  | 'cancelled'
  | 'connected'
  | 'waiting-for-wallet'
  | 'wallet-joined'

export interface RemoteWalletSignAndSendTransactionInput {
  options?: RemoteWalletSignAndSendTransactionOptions
  transaction: Uint8Array
}

export interface RemoteWalletSignAndSendTransactionOptions {
  commitment?: string
  maxRetries?: number
  minContextSlot?: number
  skipPreflight?: boolean
}

export interface RemoteWalletSignAndSendTransactionOutput {
  signature: Uint8Array
}

export interface RemoteWalletSignInInput {
  address?: string
  chainId?: string
  domain?: string
  expirationTime?: string
  issuedAt?: string
  nonce?: string
  notBefore?: string
  requestId?: string
  resources?: readonly string[]
  statement?: string
  uri?: string
  version?: string
}

export interface RemoteWalletSignInOutput {
  account: RemoteWalletAuthorizedAccount
  signature: Uint8Array
  signatureType?: 'ed25519'
  signedMessage: Uint8Array
}

export interface RemoteWalletSignMessageInput {
  message: Uint8Array
  publicKey: Uint8Array
}

export interface RemoteWalletSignMessageOutput {
  signature: Uint8Array
  signatureType: 'ed25519'
  signedMessage: Uint8Array
}

export interface RemoteWalletSignTransactionInput {
  transaction: Uint8Array
}

export interface RemoteWalletSignTransactionOutput {
  signedTransaction: Uint8Array
}

class RemoteWalletRpcClient {
  readonly #getIdentity: () => RemoteWalletIdentity
  readonly #getNextJsonRpcMessageId: () => number
  readonly #pendingRequests = new Map<
    number,
    {
      reject: (reason?: unknown) => void
      resolve: (result: unknown) => void
      timeoutId: ReturnType<typeof setTimeout>
    }
  >()
  readonly #sendNostrEvent: (content: string, recipientPubkey: string) => void
  readonly #sharedSecret: CryptoKey
  readonly #timeoutMs: number
  readonly #walletNostrPubkey: string

  constructor({
    getIdentity,
    getNextJsonRpcMessageId,
    sendNostrEvent,
    sharedSecret,
    timeoutMs,
    walletNostrPubkey,
  }: {
    getIdentity: () => RemoteWalletIdentity
    getNextJsonRpcMessageId: () => number
    sendNostrEvent: (content: string, recipientPubkey: string) => void
    sharedSecret: CryptoKey
    timeoutMs: number
    walletNostrPubkey: string
  }) {
    this.#getIdentity = getIdentity
    this.#getNextJsonRpcMessageId = getNextJsonRpcMessageId
    this.#sendNostrEvent = sendNostrEvent
    this.#sharedSecret = sharedSecret
    this.#timeoutMs = timeoutMs
    this.#walletNostrPubkey = walletNostrPubkey
  }

  async disconnect(authToken: string) {
    await this.request<Record<string, never>>('deauthorize', { auth_token: authToken })
  }

  async request<TResult>(method: string, params: unknown): Promise<TResult> {
    const id = this.#getNextJsonRpcMessageId()
    const binaryMessage = await this.#encryptJsonRpcMessage({ id, jsonrpc: '2.0' as const, method, params })
    const responsePromise = new Promise<TResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.#pendingRequests.delete(id)
        reject(new Error(`Remote Wallet request timed out: ${method}`))
      }, this.#timeoutMs)

      this.#pendingRequests.set(id, {
        reject,
        resolve: (result) => resolve(result as TResult),
        timeoutId,
      })
    })

    this.#sendNostrEvent(bytesToBase64(binaryMessage), this.#walletNostrPubkey)

    return responsePromise
  }

  rejectPendingRequests(error: Error) {
    for (const pendingRequest of this.#pendingRequests.values()) {
      clearTimeout(pendingRequest.timeoutId)
      pendingRequest.reject(error)
    }

    this.#pendingRequests.clear()
  }

  async resolveResponse(message: Uint8Array) {
    const response = await this.#decryptJsonRpcMessage(message)
    const pendingRequest = this.#pendingRequests.get(response.id)

    if (!pendingRequest) {
      return
    }

    this.#pendingRequests.delete(response.id)
    clearTimeout(pendingRequest.timeoutId)

    if (response.error) {
      pendingRequest.reject(new Error(response.error.message))
      return
    }

    pendingRequest.resolve(response.result)
  }

  async signAndSendTransactions(inputs: readonly RemoteWalletSignAndSendTransactionInput[]) {
    const result = await this.request<RemoteWalletSignAndSendTransactionsResult>('sign_and_send_transactions', {
      ...normalizeRemoteWalletSignAndSendTransactionOptions(inputs),
      payloads: inputs.map((input) => bytesToBase64(input.transaction)),
    })

    return result.signatures.map((signature) => ({ signature: base64ToBytes(signature) }))
  }

  async signIn(chain: string, protocolVersion: ProtocolVersion, input?: RemoteWalletSignInInput) {
    return authorizeRemoteWallet({
      chain,
      getIdentity: this.#getIdentity,
      protocolVersion,
      rpcClient: this,
      signInPayload: normalizeRemoteWalletSignInPayload(input),
    })
  }

  async signMessages(inputs: readonly RemoteWalletSignMessageInput[]) {
    const result = await this.request<RemoteWalletSignMessagesResult>('sign_messages', {
      addresses: inputs.map((input) => bytesToBase64(input.publicKey)),
      payloads: inputs.map((input) => bytesToBase64(input.message)),
    })

    return result.signed_payloads.map((signedPayload) => {
      const signedMessage = base64ToBytes(signedPayload)

      return {
        signature: signedMessage.slice(-64),
        signatureType: 'ed25519' as const,
        signedMessage,
      }
    })
  }

  async signTransactions(inputs: readonly RemoteWalletSignTransactionInput[]) {
    const result = await this.request<RemoteWalletSignTransactionsResult>('sign_transactions', {
      payloads: inputs.map((input) => bytesToBase64(input.transaction)),
    })

    return result.signed_payloads.map((signedPayload) => ({ signedTransaction: base64ToBytes(signedPayload) }))
  }

  async #decryptJsonRpcMessage(message: Uint8Array) {
    const plaintext = await decryptMessage(toArrayBuffer(message), this.#sharedSecret)

    return JSON.parse(plaintext) as RemoteWalletJsonRpcResponse<unknown>
  }

  async #encryptJsonRpcMessage(jsonRpcMessage: { id: number; jsonrpc: '2.0'; method: string; params: unknown }) {
    return encryptMessage(JSON.stringify(jsonRpcMessage), jsonRpcMessage.id, this.#sharedSecret)
  }
}

export async function connectRemoteWalletSession({
  identity,
  onStatusChange,
  session,
  timeoutMs = REMOTE_WALLET_PAIRING_TTL_MS,
}: ConnectRemoteWalletSessionOptions): Promise<RemoteWalletAuthorizedSession> {
  setRemoteWalletSessionRuntimeOptions(session, { identity, onStatusChange })
  await prepareRemoteWalletSession({ session, timeoutMs: getDappConnectTimeoutMs(timeoutMs) })

  if (!session.authorizedSession) {
    throw new Error('Remote Wallet session was not prepared')
  }

  return session.authorizedSession
}

export async function createRemoteWalletSession({
  chains = ['solana:devnet'],
  connect = false,
  identity,
  relayUrl,
  timeoutMs = REMOTE_WALLET_PAIRING_TTL_MS,
}: CreateRemoteWalletSessionOptions): Promise<RemoteWalletPairingSession> {
  const associationKeyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
  const associationPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', associationKeyPair.publicKey))
  const chain = chains[0] ?? 'solana:devnet'
  const { privateKey: dappNostrPrivateKey, publicKey: dappNostrPubkey } = generateNostrKeypair()
  const relay = normalizeRelayUrl(relayUrl)
  const sessionIdentifier = deriveNostrSessionIdentifier(associationPublicKey)
  const effectiveTimeoutMs = getDappConnectTimeoutMs(timeoutMs)
  const session: RemoteWalletPairingSession = {
    associationKeyPair,
    cancel() {
      setSessionStatus(session, 'cancelled')
    },
    chain,
    close() {
      setSessionStatus(session, 'cancelled')
    },
    connect: (options = {}) => connectRemoteWalletSession({ ...options, session }),
    dappNostrPrivateKey,
    dappNostrPubkey,
    expiresAt: new Date(Date.now() + effectiveTimeoutMs).toISOString(),
    pairingUrl: createNostrAssociationUrl({
      associationPublicKey,
      dappNostrPubkey,
      relayUrl: relay,
    }),
    relayDomain: new URL(relay).host,
    relayUrl: relay,
    sessionIdentifier,
    status: 'waiting-for-wallet',
  }

  setRemoteWalletSessionRuntimeOptions(session, { identity })
  await prepareRemoteWalletSession({ session, timeoutMs: effectiveTimeoutMs })

  if (connect) {
    void session.authorizedSession?.catch(() => undefined)
  }

  return session
}

async function authorizeRemoteWallet({
  chain,
  getIdentity,
  protocolVersion,
  rpcClient,
  signInPayload,
}: {
  chain: string
  getIdentity: () => RemoteWalletIdentity
  protocolVersion: ProtocolVersion
  rpcClient: RemoteWalletRpcClient
  signInPayload?: RemoteWalletSignInInput
}) {
  const legacyCluster = chainToLegacyCluster(chain)

  return rpcClient.request<RemoteWalletAuthorizationResult>('authorize', {
    ...(protocolVersion === 'legacy' && legacyCluster ? { cluster: legacyCluster } : null),
    chain,
    identity: getIdentity(),
    ...(signInPayload ? { sign_in_payload: signInPayload } : null),
  })
}

function chainToLegacyCluster(chain: string) {
  switch (chain) {
    case 'solana:devnet':
      return 'devnet'
    case 'solana:mainnet':
      return 'mainnet-beta'
    case 'solana:testnet':
      return 'testnet'
    default:
      return undefined
  }
}

async function prepareRemoteWalletSession({
  session,
  timeoutMs,
}: {
  session: RemoteWalletPairingSession
  timeoutMs: number
}) {
  if (session.authorizedSession) {
    return
  }

  const relay = await connectToNostrRelay({
    getIdentity: () => remoteWalletSessionRuntimeOptions.get(session)?.identity ?? getDefaultIdentity(),
    getOnStatusChange: () => remoteWalletSessionRuntimeOptions.get(session)?.onStatusChange,
    session,
    timeoutMs,
  })

  session.authorizedSession = relay.authorizedSession
  session.cancel = relay.close
  session.close = relay.close
}

function connectToNostrRelay({
  getIdentity,
  getOnStatusChange,
  session,
  timeoutMs,
}: {
  getIdentity: () => RemoteWalletIdentity
  getOnStatusChange: () => ((status: RemoteWalletPairingStatus) => void) | undefined
  session: RemoteWalletPairingSession
  timeoutMs: number
}) {
  return new Promise<{
    authorizedSession: Promise<RemoteWalletAuthorizedSession>
    close: () => void
  }>((resolve, reject) => {
    const authorization = createRemoteWalletAuthorizationPromise()
    const socket = new WebSocket(session.relayUrl)
    const subscriptionId = crypto.randomUUID()
    let lastKnownInboundSequenceNumber = 0
    let nextJsonRpcMessageId = 1
    let closeRequested = false
    let settled = false
    let state:
      | { ecdhPrivateKey: CryptoKey; type: 'hello-req-sent'; walletNostrPubkey: string }
      | { rpcClient: RemoteWalletRpcClient; type: 'connected'; walletNostrPubkey: string }
      | { type: 'subscribed' }
      | { type: 'waiting-for-subscription' } = { type: 'waiting-for-subscription' }
    let walletNostrPubkey: string | undefined
    const timeoutId = setTimeout(() => {
      cleanup()
      socket.close()
      reject(new Error(`Timed out connecting to Nostr relay ${session.relayDomain}`))
    }, timeoutMs)
    const setStatus = (status: RemoteWalletPairingStatus) => {
      setSessionStatus(session, status)
      getOnStatusChange()?.(status)
    }
    const rejectAuthorization = (error: Error) => {
      if (state.type === 'connected') {
        state.rpcClient.rejectPendingRequests(error)
      }

      authorization.reject(error)
    }
    const sendNostrEvent = (content: string, recipientPubkey: string, extraTags: string[][] = []) => {
      const event = createNostrEvent(
        content,
        NOSTR_EVENT_KIND_MWA,
        [['d', session.sessionIdentifier], ['p', recipientPubkey], ...extraTags],
        session.dappNostrPrivateKey,
      )

      socket.send(JSON.stringify(['EVENT', event]))
    }
    const close = () => {
      if (closeRequested) {
        return
      }

      closeRequested = true
      setStatus('cancelled')

      if (walletNostrPubkey && socket.readyState === WebSocket.OPEN) {
        sendNostrEvent('', walletNostrPubkey, [['msg', 'SESSION_END']])
        setTimeout(() => socket.close(), 250)
      } else {
        socket.close()
      }

      cleanup()
      rejectAuthorization(new Error('Remote Wallet session closed'))
    }
    const cleanup = () => {
      clearTimeout(timeoutId)
      socket.removeEventListener('close', handleClose)
      socket.removeEventListener('error', handleError)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('open', handleOpen)
    }
    const resolveSubscription = () => {
      if (settled) {
        return
      }

      settled = true
      state = { type: 'subscribed' }
      clearTimeout(timeoutId)
      socket.removeEventListener('open', handleOpen)
      resolve({
        authorizedSession: authorization.promise,
        close,
      })
    }
    const handleClose = () => {
      if (!settled) {
        cleanup()
        reject(new Error(`Nostr relay ${session.relayDomain} closed before subscribing`))
        return
      }

      cleanup()
      rejectAuthorization(new Error(`Nostr relay ${session.relayDomain} closed`))
    }
    const handleError = () => {
      if (!settled) {
        cleanup()
        reject(new Error(`Failed to connect to Nostr relay ${session.relayDomain}`))
        return
      }

      cleanup()
      rejectAuthorization(new Error(`Nostr relay ${session.relayDomain} errored`))
    }
    const handleOpen = () => {
      socket.send(
        JSON.stringify(['REQ', subscriptionId, { '#d': [session.sessionIdentifier], kinds: [NOSTR_EVENT_KIND_MWA] }]),
      )
    }
    const handleMessage = async (event: MessageEvent<string>) => {
      const message = parseNostrRelayMessage(event.data)

      if (message?.[0] === 'CLOSED' && message[1] === subscriptionId) {
        failSession(new Error(`Nostr relay ${session.relayDomain} closed subscription: ${String(message[2] ?? '')}`))
        return
      }
      if (message?.[0] === 'EOSE' && message[1] === subscriptionId) {
        resolveSubscription()
        return
      }
      if (message?.[0] === 'OK' && message[2] === false) {
        failSession(new Error(`Nostr relay ${session.relayDomain} rejected event: ${String(message[3] ?? '')}`))
        return
      }
      if (message?.[0] !== 'EVENT') {
        return
      }

      const nostrEvent = message[2]

      if (!isNostrEvent(nostrEvent) || !verifyNostrEvent(nostrEvent)) {
        return
      }

      const eventTags = getNostrEventTags(nostrEvent)

      if (
        nostrEvent.kind !== NOSTR_EVENT_KIND_MWA ||
        eventTags.d?.[0] !== session.sessionIdentifier ||
        !eventTags.p?.includes(session.dappNostrPubkey)
      ) {
        return
      }

      try {
        switch (state.type) {
          case 'connected': {
            if (nostrEvent.pubkey !== state.walletNostrPubkey || nostrEvent.content.length === 0) {
              return
            }

            const responsePayload = base64ToBytes(nostrEvent.content)
            const sequenceNumber = getSequenceNumber(responsePayload)

            if (sequenceNumber !== lastKnownInboundSequenceNumber + 1) {
              throw new Error('Encrypted message has invalid sequence number')
            }

            lastKnownInboundSequenceNumber = sequenceNumber
            await state.rpcClient.resolveResponse(responsePayload)
            break
          }
          case 'hello-req-sent': {
            if (nostrEvent.pubkey !== state.walletNostrPubkey || nostrEvent.content.length === 0) {
              return
            }

            const responsePayload = base64ToBytes(nostrEvent.content)
            const sharedSecret = await parseHelloResponse(
              responsePayload,
              session.associationKeyPair.publicKey,
              state.ecdhPrivateKey,
            )
            const sessionPropertiesBuffer = responsePayload.slice(ENCODED_PUBLIC_KEY_LENGTH_BYTES)
            const protocolVersion =
              sessionPropertiesBuffer.byteLength !== 0
                ? await (async () => {
                    const sequenceNumber = getSequenceNumber(sessionPropertiesBuffer)

                    if (sequenceNumber !== lastKnownInboundSequenceNumber + 1) {
                      throw new Error('Encrypted session properties have invalid sequence number')
                    }

                    lastKnownInboundSequenceNumber = sequenceNumber

                    return parseSessionProtocolVersion(sessionPropertiesBuffer, sharedSecret)
                  })()
                : 'legacy'

            setStatus('authorizing')
            const rpcClient = new RemoteWalletRpcClient({
              getIdentity,
              getNextJsonRpcMessageId: () => nextJsonRpcMessageId++,
              sendNostrEvent,
              sharedSecret,
              timeoutMs,
              walletNostrPubkey: state.walletNostrPubkey,
            })

            state = { rpcClient, type: 'connected', walletNostrPubkey: state.walletNostrPubkey }

            const authorizationResult = await rpcClient.request<RemoteWalletAuthorizationResult>('authorize', {
              ...(protocolVersion === 'legacy' && chainToLegacyCluster(session.chain)
                ? { cluster: chainToLegacyCluster(session.chain) }
                : null),
              chain: session.chain,
              identity: getIdentity(),
            })
            let accounts = authorizationResult.accounts.map((account) => mapRemoteWalletAccount(account, session.chain))
            let authToken = authorizationResult.auth_token

            setStatus('connected')
            authorization.resolve({
              get accounts() {
                return accounts
              },
              get authToken() {
                return authToken
              },
              chain: session.chain,
              close,
              disconnect: async () => {
                try {
                  await rpcClient.disconnect(authToken)
                } finally {
                  close()
                }
              },
              signAndSendTransactions: (inputs) => rpcClient.signAndSendTransactions(inputs),
              signIn: async (input) => {
                const signInAuthorizationResult = await rpcClient.signIn(session.chain, protocolVersion, input)
                const signInResult = signInAuthorizationResult.sign_in_result

                if (!signInResult) {
                  throw new Error('Sign in failed, no sign in result returned by wallet')
                }
                if (signInResult.signature_type && signInResult.signature_type !== 'ed25519') {
                  throw new Error(`Unsupported Sign In signature type: ${signInResult.signature_type}`)
                }

                accounts = signInAuthorizationResult.accounts.map((account) =>
                  mapRemoteWalletAccount(account, session.chain),
                )
                authToken = signInAuthorizationResult.auth_token

                return {
                  account: getRemoteWalletAuthorizedAccount(accounts, signInResult.address, session.chain),
                  signature: base64ToBytes(signInResult.signature),
                  signatureType: signInResult.signature_type === 'ed25519' ? 'ed25519' : undefined,
                  signedMessage: base64ToBytes(signInResult.signed_message),
                }
              },
              signMessages: (inputs) => rpcClient.signMessages(inputs),
              signTransactions: (inputs) => rpcClient.signTransactions(inputs),
            })
            break
          }
          case 'subscribed': {
            if (nostrEvent.content.length !== 0 || !eventTags.msg?.includes('CONNECT')) {
              return
            }

            walletNostrPubkey = nostrEvent.pubkey
            setStatus('wallet-joined')

            const ecdhKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
              'deriveBits',
            ])
            const helloRequest = await createHelloRequest(ecdhKeyPair.publicKey, session.associationKeyPair.privateKey)

            sendNostrEvent(bytesToBase64(helloRequest), walletNostrPubkey)
            state = { ecdhPrivateKey: ecdhKeyPair.privateKey, type: 'hello-req-sent', walletNostrPubkey }
            break
          }
          case 'waiting-for-subscription':
            break
        }
      } catch (error) {
        rejectAuthorization(error instanceof Error ? error : new Error(String(error)))
        close()
      }
    }
    const failSession = (error: Error) => {
      cleanup()

      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      if (!settled) {
        reject(error)
        return
      }

      rejectAuthorization(error)
    }

    socket.addEventListener('close', handleClose)
    socket.addEventListener('error', handleError)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('open', handleOpen)
  })
}

function createRemoteWalletAuthorizationPromise() {
  let rejectAuthorization!: (reason?: unknown) => void
  let resolveAuthorization!: (session: RemoteWalletAuthorizedSession) => void
  const promise = new Promise<RemoteWalletAuthorizedSession>((resolve, reject) => {
    rejectAuthorization = reject
    resolveAuthorization = resolve
  })

  return {
    promise,
    reject: rejectAuthorization,
    resolve: resolveAuthorization,
  }
}

function getDefaultIdentity(): RemoteWalletIdentity {
  const browserGlobal = globalThis as typeof globalThis & {
    document?: { title?: string }
    location?: { host?: string; origin?: string }
  }

  return {
    name: browserGlobal.document?.title || 'Remote Wallet Dapp',
    uri: browserGlobal.location?.origin || 'https://remote-wallet.local',
  }
}

function getDappConnectTimeoutMs(timeoutMs: number) {
  return Math.max(timeoutMs, MIN_DAPP_CONNECT_TIMEOUT_MS)
}

function getRemoteWalletAuthorizedAccount(
  accounts: readonly RemoteWalletAuthorizedAccount[],
  encodedAddress: string,
  chain: string,
) {
  const publicKey = base64ToBytes(encodedAddress)
  const account = accounts.find((candidate) => uint8ArraysEqual(candidate.publicKey, publicKey))

  if (account) {
    return account
  }

  return {
    address: bytesToBase58(publicKey),
    chains: [chain],
    features: [...REMOTE_WALLET_DEFAULT_ACCOUNT_FEATURES],
    publicKey,
  }
}

function mapRemoteWalletAccount(
  account: RemoteWalletAuthorizationResultAccount,
  chain: string,
): RemoteWalletAuthorizedAccount {
  const publicKey = base64ToBytes(account.address)

  return {
    address: bytesToBase58(publicKey),
    chains: account.chains ?? [chain],
    features: account.features ?? [...REMOTE_WALLET_DEFAULT_ACCOUNT_FEATURES],
    icon: account.icon,
    label: account.label,
    publicKey,
  }
}

function normalizeRelayUrl(relay: string) {
  if (relay.startsWith('ws://') || relay.startsWith('wss://')) {
    return relay
  }

  return `wss://${relay}`
}

function normalizeRemoteWalletSignAndSendTransactionOptions(
  inputs: readonly RemoteWalletSignAndSendTransactionInput[],
) {
  const options = inputs[0]?.options

  if (!options) {
    return {}
  }

  const normalizedOptions = {
    commitment: options.commitment,
    max_retries: options.maxRetries,
    min_context_slot: options.minContextSlot,
    skip_preflight: options.skipPreflight,
  }

  return Object.values(normalizedOptions).some((option) => option !== undefined) ? { options: normalizedOptions } : {}
}

function normalizeRemoteWalletSignInPayload(input?: RemoteWalletSignInInput): RemoteWalletSignInInput {
  const browserGlobal = globalThis as typeof globalThis & { location?: { host?: string } }

  return {
    ...(input ?? {}),
    domain: input?.domain ?? browserGlobal.location?.host ?? 'localhost',
  }
}

async function parseSessionProtocolVersion(message: Uint8Array, sharedSecret: CryptoKey): Promise<ProtocolVersion> {
  const plaintext = await decryptMessage(message, sharedSecret)
  const jsonProperties = JSON.parse(plaintext) as { v?: unknown }

  switch (jsonProperties.v) {
    case 1:
    case '1':
    case 'v1':
      return 'v1'
    case 'legacy':
    case undefined:
      return 'legacy'
    default:
      throw new Error(`Unknown/unsupported protocol version: ${String(jsonProperties.v)}`)
  }
}

function setRemoteWalletSessionRuntimeOptions(
  session: RemoteWalletPairingSession,
  options: RemoteWalletSessionRuntimeOptions,
) {
  const currentOptions = remoteWalletSessionRuntimeOptions.get(session) ?? {}

  remoteWalletSessionRuntimeOptions.set(session, {
    identity: options.identity ?? currentOptions.identity,
    onStatusChange: options.onStatusChange ?? currentOptions.onStatusChange,
  })
}

function setSessionStatus(session: RemoteWalletPairingSession, status: RemoteWalletPairingStatus) {
  session.status = status
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) {
    return false
  }

  return a.every((value, index) => value === b[index])
}
