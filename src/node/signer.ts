import { ed25519 } from '@noble/curves/ed25519.js'
import { getTransactionCodec, type SignatureBytes } from '@solana/kit'
import { REMOTE_WALLET_DEFAULT_ACCOUNT_FEATURES } from '../protocol/constants.ts'
import { base64ToBytes, bytesToBase58, bytesToBase64, concatBytes, hexToBytes } from '../protocol/encoding.ts'
import type { RemoteWalletSignInPayload } from '../protocol/types.ts'

const SIGNATURE_LENGTH_IN_BYTES = 64
const transactionCodec = getTransactionCodec()

export interface CreateRemoteWalletSignerOptions {
  chain?: string
  label: string
  rpcUrl?: string
  secretKey?: string
}

export interface RemoteWalletSigner {
  account: {
    address: string
    chains: string[]
    features: string[]
    label: string
    publicKey: Uint8Array
  }
  authToken: string
  chain: string
  publicKey: Uint8Array
  publicKeyBase58: string
  publicKeyBase64: string
  rpcUrl?: string
  secretKey: Uint8Array
  signIn: (input?: RemoteWalletSignInPayload) => {
    address: string
    signature: string
    signature_type: 'ed25519'
    signed_message: string
  }
  signMessages: (
    inputs: readonly { addresses?: string[]; payload: Uint8Array }[],
  ) => Promise<readonly { signature: Uint8Array; signedMessage: Uint8Array }[]>
  signTransactions: (
    inputs: readonly { transaction: Uint8Array }[],
  ) => Promise<readonly { signature: Uint8Array; signedTransaction: Uint8Array }[]>
}

export function createRemoteWalletSigner(options: CreateRemoteWalletSignerOptions): RemoteWalletSigner {
  const secretKey = options.secretKey ? parseSecretKey(options.secretKey) : ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secretKey)
  const publicKeyBase58 = bytesToBase58(publicKey)
  const publicKeyBase64 = bytesToBase64(publicKey)
  const chain = options.chain ?? 'solana:devnet'
  const signer: RemoteWalletSigner = {
    account: {
      address: publicKeyBase58,
      chains: [chain],
      features: [...REMOTE_WALLET_DEFAULT_ACCOUNT_FEATURES],
      label: options.label,
      publicKey,
    },
    authToken: crypto.randomUUID(),
    chain,
    publicKey,
    publicKeyBase58,
    publicKeyBase64,
    rpcUrl: options.rpcUrl,
    secretKey,
    signIn(input) {
      return signSignInPayload(normalizeSignInPayload(input, signer), signer)
    },
    async signMessages(inputs) {
      return inputs.map((input, index) => {
        if (input.addresses?.length && !input.addresses.some((address) => signerOwnsAddress(signer, address))) {
          throw new Error(`Cannot sign for unknown address at index ${index}`)
        }

        const signature = ed25519.sign(input.payload, secretKey)

        return {
          signature,
          signedMessage: concatBytes(input.payload, signature),
        }
      })
    },
    async signTransactions(inputs) {
      return Promise.all(
        inputs.map(async (input, index) => {
          const transaction = transactionCodec.decode(input.transaction)

          if (!Object.hasOwn(transaction.signatures, publicKeyBase58)) {
            throw new Error(`Cannot sign transaction for unknown signer at index ${index}`)
          }

          const signature = ed25519.sign(new Uint8Array(transaction.messageBytes), secretKey) as SignatureBytes
          const signedTransaction = {
            ...transaction,
            signatures: {
              ...transaction.signatures,
              [publicKeyBase58]: signature,
            },
          }

          return {
            signature,
            signedTransaction: new Uint8Array(transactionCodec.encode(signedTransaction)),
          }
        }),
      )
    },
  }

  return signer
}

export function createRemoteWalletAuthorizationAccount(signer: RemoteWalletSigner) {
  return {
    address: signer.publicKeyBase64,
    chains: [signer.chain],
    features: [...REMOTE_WALLET_DEFAULT_ACCOUNT_FEATURES],
    label: signer.account.label,
  }
}

export function getSolanaRpcUrl(chain: string, rpcUrl?: string) {
  if (rpcUrl) {
    return rpcUrl
  }

  switch (chain) {
    case 'devnet':
    case 'solana:devnet':
      return 'https://api.devnet.solana.com'
    case 'mainnet-beta':
    case 'solana:mainnet':
    case 'solana:mainnet-beta':
      return 'https://api.mainnet-beta.solana.com'
    case 'solana:testnet':
    case 'testnet':
      return 'https://api.testnet.solana.com'
    default:
      throw new Error(`No default RPC URL for chain ${chain}. Pass --rpc-url to the CLI wallet.`)
  }
}

export function getSignatureLengthInBytes() {
  return SIGNATURE_LENGTH_IN_BYTES
}

function createSignInMessage(
  input: Required<Pick<RemoteWalletSignInPayload, 'address' | 'domain'>> & RemoteWalletSignInPayload,
) {
  let message = `${input.domain} wants you to sign in with your Solana account:\n${input.address}`

  if (input.statement) {
    message += `\n\n${input.statement}`
  }

  const fields: string[] = []

  if (input.uri) {
    fields.push(`URI: ${input.uri}`)
  }
  if (input.version) {
    fields.push(`Version: ${input.version}`)
  }
  if (input.chainId) {
    fields.push(`Chain ID: ${input.chainId}`)
  }
  if (input.nonce) {
    fields.push(`Nonce: ${input.nonce}`)
  }
  if (input.issuedAt) {
    fields.push(`Issued At: ${input.issuedAt}`)
  }
  if (input.expirationTime) {
    fields.push(`Expiration Time: ${input.expirationTime}`)
  }
  if (input.notBefore) {
    fields.push(`Not Before: ${input.notBefore}`)
  }
  if (input.requestId) {
    fields.push(`Request ID: ${input.requestId}`)
  }
  if (input.resources?.length) {
    fields.push('Resources:')

    for (const resource of input.resources) {
      fields.push(`- ${resource}`)
    }
  }
  if (fields.length) {
    message += `\n\n${fields.join('\n')}`
  }

  return new TextEncoder().encode(message)
}

function normalizeSignInPayload(
  payload: RemoteWalletSignInPayload | undefined,
  signer: RemoteWalletSigner,
): Required<Pick<RemoteWalletSignInPayload, 'address' | 'domain'>> & RemoteWalletSignInPayload {
  return {
    ...(payload ?? {}),
    address: payload?.address ?? signer.publicKeyBase58,
    chainId: payload?.chainId ?? signer.chain,
    domain: payload?.domain ?? 'localhost',
    version: payload?.version ?? '1',
  }
}

function parseSecretKey(value: string) {
  const normalizedValue = value.trim()
  const secretKey =
    /^[\da-f]+$/iu.test(normalizedValue) && normalizedValue.length % 2 === 0
      ? hexToBytes(normalizedValue)
      : base64ToBytes(normalizedValue)

  if (secretKey.byteLength === 32) {
    return secretKey
  }
  if (secretKey.byteLength === 64) {
    return secretKey.slice(0, 32)
  }

  throw new Error(`Expected 32-byte or 64-byte Ed25519 secret key, received ${secretKey.byteLength} bytes`)
}

function signSignInPayload(
  payload: Required<Pick<RemoteWalletSignInPayload, 'address' | 'domain'>> & RemoteWalletSignInPayload,
  signer: RemoteWalletSigner,
) {
  const signedMessage = createSignInMessage(payload)
  const signature = ed25519.sign(signedMessage, signer.secretKey)

  return {
    address: signer.publicKeyBase64,
    signature: bytesToBase64(signature),
    signature_type: 'ed25519' as const,
    signed_message: bytesToBase64(signedMessage),
  }
}

function signerOwnsAddress(signer: RemoteWalletSigner, address: string) {
  return address === signer.account.address || address === signer.publicKeyBase58 || address === signer.publicKeyBase64
}
