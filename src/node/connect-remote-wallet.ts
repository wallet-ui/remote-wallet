import { ENCODED_PUBLIC_KEY_LENGTH_BYTES, NOSTR_EVENT_KIND_MWA } from '../protocol/constants.ts'
import {
  decryptMessage,
  deriveSharedSecret,
  encryptMessage,
  getSequenceNumber,
  toArrayBuffer,
  verifyAssociationSignature,
} from '../protocol/crypto.ts'
import { base58ToBytes, base64ToBytes, bytesToBase64, concatBytes } from '../protocol/encoding.ts'
import type { JsonRpcRequest, PairingDetails, RemoteWalletSignInPayload } from '../protocol/index.ts'
import {
  createNostrEvent,
  generateNostrKeypair,
  getNostrEventTags,
  isNostrEvent,
  type NostrEvent,
  parseNostrRelayMessage,
  verifyNostrEvent,
} from '../protocol/nostr-event.ts'
import { sendSignedTransaction } from './send-signed-transaction.ts'
import { createRemoteWalletAuthorizationAccount, getSolanaRpcUrl, type RemoteWalletSigner } from './signer.ts'

type SessionState =
  | {
      lastInboundSequenceNumber: number
      lastOutboundSequenceNumber: number
      sharedSecret: CryptoKey
      type: 'connected'
    }
  | { type: 'waiting-for-hello' }

export interface ConnectRemoteWalletOptions {
  pairing: PairingDetails
  signer: RemoteWalletSigner
  timeoutMs: number
  writeEvent?: (event: string, payload: Record<string, unknown>) => void
}

export async function connectRemoteWallet({ pairing, signer, timeoutMs, writeEvent }: ConnectRemoteWalletOptions) {
  const { privateKey: nostrPrivateKey, publicKey: walletNostrPubkey } = generateNostrKeypair()
  const subscriptionId = crypto.randomUUID()
  const socket = new WebSocket(pairing.relayUrl)
  let closed = false
  let state: SessionState = { type: 'waiting-for-hello' }

  writeEvent?.('relay-connecting', {
    relayDomain: pairing.relayDomain,
    relayUrl: pairing.relayUrl,
    sessionIdentifier: pairing.sessionIdentifier,
    walletNostrPubkey,
  })

  await new Promise<void>((resolve, reject) => {
    const closeSocket = () => {
      if (closed) {
        return
      }

      closed = true
      socket.close()
    }
    const timeoutId = setTimeout(() => {
      closeSocket()
      reject(new Error(`Timed out waiting for dapp handshake after ${timeoutMs}ms`))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timeoutId)
      socket.removeEventListener('close', handleClose)
      socket.removeEventListener('error', handleError)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('open', handleOpen)
    }
    const sendNostrEvent = (content: string, recipientPubkey: string, extraTags: string[][] = []) => {
      const nostrEvent = createNostrEvent(
        content,
        NOSTR_EVENT_KIND_MWA,
        [['d', pairing.sessionIdentifier], ['p', recipientPubkey], ...extraTags],
        nostrPrivateKey,
      )

      socket.send(JSON.stringify(['EVENT', nostrEvent]))
    }
    const sendJsonRpcResponse = async (
      request: JsonRpcRequest,
      response: { error?: { code: number; message: string }; result?: unknown },
    ) => {
      if (state.type !== 'connected') {
        throw new Error('Cannot send JSON-RPC response before the encrypted session is connected')
      }

      const nextSequenceNumber = state.lastOutboundSequenceNumber + 1
      const binaryMessage = await encryptMessage(
        JSON.stringify({
          ...response,
          id: request.id,
          jsonrpc: '2.0',
        }),
        nextSequenceNumber,
        state.sharedSecret,
      )

      state = {
        ...state,
        lastOutboundSequenceNumber: nextSequenceNumber,
      }

      sendNostrEvent(bytesToBase64(binaryMessage), pairing.dappNostrPubkey)
    }
    const handleClose = () => {
      cleanup()
      writeEvent?.('relay-closed', {})
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error(`Failed to connect to Nostr relay ${pairing.relayUrl}`))
    }
    const handleMessage = async (event: MessageEvent<string>) => {
      try {
        const message = parseNostrRelayMessage(event.data)

        if (message?.[0] === 'EOSE' && message[1] === subscriptionId) {
          sendNostrEvent('', pairing.dappNostrPubkey, [['msg', 'CONNECT']])
          writeEvent?.('wallet-joined', {})
          return
        }
        if (message?.[0] === 'NOTICE') {
          writeEvent?.('relay-notice', { message: String(message[1] ?? '') })
          return
        }
        if (message?.[0] !== 'EVENT') {
          return
        }

        const nostrEvent = message[2]

        if (!isExpectedNostrEvent(nostrEvent, pairing, walletNostrPubkey)) {
          return
        }
        if (nostrEvent.content.length === 0) {
          const tags = getNostrEventTags(nostrEvent)

          if (tags.msg?.includes('SESSION_END')) {
            writeEvent?.('session-ended', {})
            closeSocket()
          }

          return
        }
        if (state.type === 'waiting-for-hello') {
          const helloResult = await respondToHelloRequest({
            pairing,
            sendNostrEvent,
            walletPayload: base64ToBytes(nostrEvent.content),
          })

          state = {
            lastInboundSequenceNumber: 0,
            lastOutboundSequenceNumber: helloResult.lastOutboundSequenceNumber,
            sharedSecret: helloResult.sharedSecret,
            type: 'connected',
          }
          clearTimeout(timeoutId)
          writeEvent?.('hello-complete', {})
          return
        }

        const encryptedPayload = base64ToBytes(nostrEvent.content)
        const sequenceNumber = getSequenceNumber(encryptedPayload)

        if (sequenceNumber !== state.lastInboundSequenceNumber + 1) {
          throw new Error(`Invalid inbound sequence number ${sequenceNumber}`)
        }

        state = {
          ...state,
          lastInboundSequenceNumber: sequenceNumber,
        }

        const request = JSON.parse(
          await decryptMessage(toArrayBuffer(encryptedPayload), state.sharedSecret),
        ) as JsonRpcRequest

        writeEvent?.('request', {
          id: request.id,
          method: request.method,
        })

        try {
          const result = await handleJsonRpcRequest(request, signer, writeEvent)

          await sendJsonRpcResponse(request, { result })
          writeEvent?.('response', {
            id: request.id,
            method: request.method,
          })
        } catch (error) {
          await sendJsonRpcResponse(request, {
            error: {
              code: -32_000,
              message: getErrorMessage(error),
            },
          })
          writeEvent?.('response-error', {
            id: request.id,
            message: getErrorMessage(error),
            method: request.method,
          })
        }
      } catch (error) {
        cleanup()
        closeSocket()
        reject(error)
      }
    }
    const handleOpen = () => {
      socket.send(
        JSON.stringify(['REQ', subscriptionId, { '#d': [pairing.sessionIdentifier], kinds: [NOSTR_EVENT_KIND_MWA] }]),
      )
      writeEvent?.('relay-connected', {})
    }

    socket.addEventListener('close', handleClose)
    socket.addEventListener('error', handleError)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('open', handleOpen)
  })
}

function getBooleanOption(options: Record<string, unknown>, key: string) {
  const value = options[key]

  return typeof value === 'boolean' ? value : undefined
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getNumberOption(options: Record<string, unknown>, key: string) {
  const value = options[key]

  return typeof value === 'number' ? value : undefined
}

function getSignAndSendTransactionOptions(params: unknown) {
  const rawOptions = isRecord(params) && isRecord(params.options) ? params.options : {}

  return {
    commitment: getStringOption(rawOptions, 'commitment'),
    maxRetries: getNumberOption(rawOptions, 'max_retries'),
    minContextSlot: getNumberOption(rawOptions, 'min_context_slot'),
    skipPreflight: getBooleanOption(rawOptions, 'skip_preflight'),
  }
}

function getStringOption(options: Record<string, unknown>, key: string) {
  const value = options[key]

  return typeof value === 'string' ? value : undefined
}

async function handleAuthorizeRequest(params: unknown, signer: RemoteWalletSigner) {
  const authorizeParams = isRecord(params) ? params : {}
  const chain = typeof authorizeParams.chain === 'string' ? authorizeParams.chain : signer.chain
  const signInPayload = isRecord(authorizeParams.sign_in_payload)
    ? normalizeSignInPayload(authorizeParams.sign_in_payload, { chain, signer })
    : undefined

  signer.account.chains = [chain]
  signer.authToken = crypto.randomUUID()
  signer.chain = chain

  return {
    accounts: [createRemoteWalletAuthorizationAccount(signer)],
    auth_token: signer.authToken,
    ...(signInPayload
      ? {
          sign_in_result: signer.signIn(signInPayload),
        }
      : null),
  }
}

async function handleJsonRpcRequest(
  request: JsonRpcRequest,
  signer: RemoteWalletSigner,
  writeEvent?: (event: string, payload: Record<string, unknown>) => void,
) {
  switch (request.method) {
    case 'authorize':
      return handleAuthorizeRequest(request.params, signer)
    case 'deauthorize':
      return {}
    case 'get_capabilities':
      return {
        features: signer.account.features,
        max_messages_per_request: 10,
        max_transactions_per_request: 10,
        supported_transaction_versions: ['legacy', 0],
        supports_clone_authorization: false,
        supports_sign_and_send_transactions: true,
      }
    case 'sign_and_send_transactions':
      return handleSignAndSendTransactionsRequest(request.params, signer, writeEvent)
    case 'sign_messages':
      return handleSignMessagesRequest(request.params, signer)
    case 'sign_transactions':
      return handleSignTransactionsRequest(request.params, signer)
    default:
      throw new Error(`Unsupported JSON-RPC method: ${request.method}`)
  }
}

async function handleSignAndSendTransactionsRequest(
  params: unknown,
  signer: RemoteWalletSigner,
  writeEvent?: (event: string, payload: Record<string, unknown>) => void,
) {
  const signedTransactions = await signTransactionPayloads(params, signer, 'sign_and_send_transactions')
  const options = getSignAndSendTransactionOptions(params)
  const rpcUrl = getSolanaRpcUrl(signer.chain, signer.rpcUrl)
  const signatures: string[] = []

  for (const signedTransaction of signedTransactions) {
    const signature = await sendSignedTransaction({
      ...options,
      rpcUrl,
      signedTransaction: signedTransaction.signedTransaction,
    })

    signatures.push(bytesToBase64(base58ToBytes(signature)))
    writeEvent?.('transaction-sent', { rpcUrl, signature })
  }

  return { signatures }
}

function handleSignMessagesRequest(params: unknown, signer: RemoteWalletSigner) {
  if (!isRecord(params) || !Array.isArray(params.payloads)) {
    throw new Error('sign_messages params must include payloads')
  }

  const addresses = Array.isArray(params.addresses) ? params.addresses : []

  return Promise.resolve(
    signer
      .signMessages(
        params.payloads.map((payload, index) => {
          if (typeof payload !== 'string') {
            throw new Error('sign_messages payloads must be base64 strings')
          }

          const address = addresses[index]

          return {
            addresses: typeof address === 'string' ? [address] : undefined,
            payload: base64ToBytes(payload),
          }
        }),
      )
      .then((outputs) => ({
        signed_payloads: outputs.map((output) => bytesToBase64(output.signedMessage)),
      })),
  )
}

async function handleSignTransactionsRequest(params: unknown, signer: RemoteWalletSigner) {
  const signedTransactions = await signTransactionPayloads(params, signer, 'sign_transactions')

  return {
    signed_payloads: signedTransactions.map(({ signedTransaction }) => bytesToBase64(signedTransaction)),
  }
}

function isExpectedNostrEvent(event: unknown, pairing: PairingDetails, walletNostrPubkey: string): event is NostrEvent {
  if (!isNostrEvent(event) || !verifyNostrEvent(event)) {
    return false
  }

  const tags = getNostrEventTags(event)

  return (
    event.kind === NOSTR_EVENT_KIND_MWA &&
    event.pubkey === pairing.dappNostrPubkey &&
    tags.d?.[0] === pairing.sessionIdentifier &&
    Boolean(tags.p?.includes(walletNostrPubkey))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeSignInPayload(
  payload: Record<string, unknown>,
  { chain, signer }: { chain: string; signer: RemoteWalletSigner },
): Required<Pick<RemoteWalletSignInPayload, 'address' | 'domain'>> & RemoteWalletSignInPayload {
  return {
    address: typeof payload.address === 'string' ? payload.address : signer.publicKeyBase58,
    chainId: typeof payload.chainId === 'string' ? payload.chainId : chain,
    domain: typeof payload.domain === 'string' ? payload.domain : 'localhost',
    expirationTime: typeof payload.expirationTime === 'string' ? payload.expirationTime : undefined,
    issuedAt: typeof payload.issuedAt === 'string' ? payload.issuedAt : undefined,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
    notBefore: typeof payload.notBefore === 'string' ? payload.notBefore : undefined,
    requestId: typeof payload.requestId === 'string' ? payload.requestId : undefined,
    resources: Array.isArray(payload.resources)
      ? payload.resources.filter((resource): resource is string => typeof resource === 'string')
      : undefined,
    statement: typeof payload.statement === 'string' ? payload.statement : undefined,
    uri: typeof payload.uri === 'string' ? payload.uri : undefined,
    version: typeof payload.version === 'string' ? payload.version : '1',
  }
}

async function respondToHelloRequest({
  pairing,
  sendNostrEvent,
  walletPayload,
}: {
  pairing: PairingDetails
  sendNostrEvent: (content: string, recipientPubkey: string, extraTags?: string[][]) => void
  walletPayload: Uint8Array
}) {
  const dappEcdhPublicKey = walletPayload.slice(0, ENCODED_PUBLIC_KEY_LENGTH_BYTES)
  const signature = walletPayload.slice(ENCODED_PUBLIC_KEY_LENGTH_BYTES)

  await verifyAssociationSignature({
    associationPublicKey: pairing.associationPublicKey,
    dappEcdhPublicKey,
    signature,
  })

  const walletEcdhKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const sharedSecret = await deriveSharedSecret({
    associationPublicKey: pairing.associationPublicKey,
    dappEcdhPublicKey,
    walletEcdhPrivateKey: walletEcdhKeyPair.privateKey,
  })
  const walletEcdhPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', walletEcdhKeyPair.publicKey))
  const sessionProperties = await encryptMessage(JSON.stringify({ v: 1 }), 1, sharedSecret)

  sendNostrEvent(bytesToBase64(concatBytes(walletEcdhPublicKey, sessionProperties)), pairing.dappNostrPubkey)

  return {
    lastOutboundSequenceNumber: 1,
    sharedSecret,
  }
}

async function signTransactionPayloads(params: unknown, signer: RemoteWalletSigner, method: string) {
  if (!isRecord(params) || !Array.isArray(params.payloads)) {
    throw new Error(`${method} params must include payloads`)
  }

  return signer.signTransactions(
    params.payloads.map((payload) => {
      if (typeof payload !== 'string') {
        throw new Error(`${method} payloads must be base64 strings`)
      }

      return { transaction: base64ToBytes(payload) }
    }),
  )
}
