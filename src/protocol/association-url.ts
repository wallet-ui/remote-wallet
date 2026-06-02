import { sha256 } from '@noble/hashes/sha2.js'
import { base64UrlToBytes, bytesToBase64Url, bytesToHex } from './encoding.ts'
import type { PairingDetails } from './types.ts'

export interface CreateNostrAssociationUrlInput {
  associationMode?: 'local' | 'remote'
  associationPublicKey: Uint8Array
  dappNostrPubkey: string
  relayUrl: string
}

export function createNostrAssociationUrl(input: CreateNostrAssociationUrlInput) {
  const relayUrl = normalizeRelayUrl(input.relayUrl)
  const associationMode = input.associationMode ?? 'remote'
  const url = new URL(`solana-wallet:/v1/associate/${associationMode}/nostr`)

  url.searchParams.set('association', bytesToBase64Url(input.associationPublicKey))
  url.searchParams.set('pubkey', input.dappNostrPubkey)
  url.searchParams.set('relay', new URL(relayUrl).host)
  url.searchParams.set('v', '1')

  return url.toString()
}

export function deriveNostrSessionIdentifier(associationPublicKey: Uint8Array) {
  return bytesToHex(sha256(associationPublicKey))
}

export function parseNostrAssociationUrl(pairingUrl: string): PairingDetails {
  const url = new URL(pairingUrl)
  const association = url.searchParams.get('association')
  const dappNostrPubkey = url.searchParams.get('pubkey') ?? url.searchParams.get('dapp')
  const legacySessionIdentifier = url.searchParams.get('session')
  const relay = url.searchParams.get('relay')
  const pathParts = url.pathname.split('/')
  const associationMode = pathParts[3]

  if (
    url.protocol !== 'solana-wallet:' ||
    pathParts.length !== 5 ||
    pathParts[1] !== 'v1' ||
    pathParts[2] !== 'associate' ||
    (associationMode !== 'local' && associationMode !== 'remote') ||
    pathParts[4] !== 'nostr'
  ) {
    throw new Error('Unsupported pairing URL')
  }
  if (!association) {
    throw new Error('Pairing URL is missing association')
  }
  if (!dappNostrPubkey) {
    throw new Error('Pairing URL is missing pubkey')
  }
  if (!relay) {
    throw new Error('Pairing URL is missing relay')
  }

  const associationPublicKey = base64UrlToBytes(association)
  const sessionIdentifier = deriveNostrSessionIdentifier(associationPublicKey)
  const relayUrl = normalizeRelayUrl(relay)

  if (legacySessionIdentifier && legacySessionIdentifier !== sessionIdentifier) {
    throw new Error('Pairing URL session does not match derived session identifier')
  }

  return {
    associationMode,
    associationPublicKey,
    dappNostrPubkey,
    relayDomain: new URL(relayUrl).host,
    relayUrl,
    sessionIdentifier,
  }
}

function normalizeRelayUrl(relay: string) {
  if (relay.startsWith('ws://') || relay.startsWith('wss://')) {
    return relay
  }

  const relayUrl = new URL(`wss://${relay}`)

  return isLocalRelayHost(relayUrl.hostname) ? `ws://${relay}` : `wss://${relay}`
}

function isLocalRelayHost(hostname: string) {
  const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  return normalizedHostname === '127.0.0.1' || normalizedHostname === '::1' || normalizedHostname === 'localhost'
}
