import { sha256 } from '@noble/hashes/sha2.js'
import { base64UrlToBytes, bytesToBase64Url, bytesToHex } from './encoding.ts'
import type { PairingDetails } from './types.ts'

export interface CreateNostrAssociationUrlInput {
  associationPublicKey: Uint8Array
  dappNostrPubkey: string
  relayUrl: string
  sessionIdentifier: string
}

export function createNostrAssociationUrl(input: CreateNostrAssociationUrlInput) {
  const relayUrl = normalizeRelayUrl(input.relayUrl)
  const url = new URL('solana-wallet:/v1/associate/remote/nostr')

  url.searchParams.set('association', bytesToBase64Url(input.associationPublicKey))
  url.searchParams.set('pubkey', input.dappNostrPubkey)
  url.searchParams.set('relay', relayUrl)
  url.searchParams.set('session', input.sessionIdentifier)
  url.searchParams.set('v', 'v1')

  return url.toString()
}

export function parseNostrAssociationUrl(pairingUrl: string): PairingDetails {
  const url = new URL(pairingUrl)
  const association = url.searchParams.get('association')
  const dappNostrPubkey = url.searchParams.get('pubkey') ?? url.searchParams.get('dapp')
  const relay = url.searchParams.get('relay')

  if (url.protocol !== 'solana-wallet:' || url.pathname !== '/v1/associate/remote/nostr') {
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
  const relayUrl = normalizeRelayUrl(relay)

  return {
    associationPublicKey,
    dappNostrPubkey,
    relayDomain: new URL(relayUrl).host,
    relayUrl,
    sessionIdentifier: url.searchParams.get('session') ?? bytesToHex(sha256(associationPublicKey)),
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
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
}
