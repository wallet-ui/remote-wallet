import { describe, expect, test } from 'bun:test'
import {
  bytesToBase64Url,
  createNostrAssociationUrl,
  deriveNostrSessionIdentifier,
  parseNostrAssociationUrl,
} from '../../src/protocol/index.ts'

describe('Nostr association URL', () => {
  test('emits a spec-shaped remote pairing URL with a derived session identifier', () => {
    const associationPublicKey = new Uint8Array(65).fill(7)
    const sessionIdentifier = deriveNostrSessionIdentifier(associationPublicKey)
    const url = createNostrAssociationUrl({
      associationPublicKey,
      dappNostrPubkey: 'f'.repeat(64),
      relayUrl: 'wss://relay.example.com/nostr',
    })
    const parsedUrl = new URL(url)

    expect(url.startsWith('solana-wallet:/v1/associate/remote/nostr')).toBe(true)
    expect(parsedUrl.searchParams.get('relay')).toBe('relay.example.com')
    expect(parsedUrl.searchParams.get('session')).toBeNull()
    expect(parsedUrl.searchParams.get('v')).toBe('1')
    expect(sessionIdentifier).toMatch(/^[0-9a-f]{64}$/u)
    expect(parseNostrAssociationUrl(url)).toMatchObject({
      associationMode: 'remote',
      dappNostrPubkey: 'f'.repeat(64),
      relayDomain: 'relay.example.com',
      relayUrl: 'wss://relay.example.com',
      sessionIdentifier,
    })
  })

  test('round trips local association mode', () => {
    const associationPublicKey = new Uint8Array(65).fill(3)
    const url = createNostrAssociationUrl({
      associationMode: 'local',
      associationPublicKey,
      dappNostrPubkey: 'a'.repeat(64),
      relayUrl: 'ws://127.0.0.1:8080',
    })

    expect(url.startsWith('solana-wallet:/v1/associate/local/nostr')).toBe(true)
    expect(parseNostrAssociationUrl(url)).toMatchObject({
      associationMode: 'local',
      relayDomain: '127.0.0.1:8080',
      relayUrl: 'ws://127.0.0.1:8080',
    })
  })

  test('uses ws for local relay hosts without an explicit scheme', () => {
    const associationPublicKey = new Uint8Array(65).fill(7)
    const url = createNostrAssociationUrl({
      associationPublicKey,
      dappNostrPubkey: 'f'.repeat(64),
      relayUrl: 'ws://127.0.0.1:8080',
    })

    expect(new URL(url).searchParams.get('relay')).toBe('127.0.0.1:8080')
    expect(parseNostrAssociationUrl(url)).toMatchObject({
      relayDomain: '127.0.0.1:8080',
      relayUrl: 'ws://127.0.0.1:8080',
    })
  })

  test('uses ws for IPv6 loopback relay hosts without an explicit scheme', () => {
    const associationPublicKey = new Uint8Array(65).fill(7)
    const url = createNostrAssociationUrl({
      associationPublicKey,
      dappNostrPubkey: 'f'.repeat(64),
      relayUrl: 'ws://[::1]:8080',
    })

    expect(new URL(url).searchParams.get('relay')).toBe('[::1]:8080')
    expect(parseNostrAssociationUrl(url)).toMatchObject({
      relayDomain: '[::1]:8080',
      relayUrl: 'ws://[::1]:8080',
    })
  })

  test('accepts legacy URLs when the session query matches the derived identifier', () => {
    const associationPublicKey = new Uint8Array(65).fill(9)
    const association = bytesToBase64Url(associationPublicKey)
    const sessionIdentifier = deriveNostrSessionIdentifier(associationPublicKey)
    const url = `solana-wallet:/v1/associate/remote/nostr?association=${association}&relay=wss%3A%2F%2Frelay.example.com%2Fnostr&pubkey=${'b'.repeat(64)}&session=${sessionIdentifier}`

    expect(parseNostrAssociationUrl(url)).toMatchObject({
      relayDomain: 'relay.example.com',
      relayUrl: 'wss://relay.example.com/nostr',
      sessionIdentifier,
    })
  })

  test('rejects legacy URLs with a conflicting session query', () => {
    const associationPublicKey = new Uint8Array(65).fill(9)
    const association = bytesToBase64Url(associationPublicKey)
    const url = `solana-wallet:/v1/associate/remote/nostr?association=${association}&relay=relay.example.com&pubkey=${'b'.repeat(64)}&session=session-123`

    expect(() => parseNostrAssociationUrl(url)).toThrow('Pairing URL session does not match derived session identifier')
  })
})
