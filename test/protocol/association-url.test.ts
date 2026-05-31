import { describe, expect, test } from 'bun:test'
import { createNostrAssociationUrl, parseNostrAssociationUrl } from '../../src/protocol/index.ts'

describe('Nostr association URL', () => {
  test('round trips required pairing details', () => {
    const associationPublicKey = new Uint8Array(65).fill(7)
    const url = createNostrAssociationUrl({
      associationPublicKey,
      dappNostrPubkey: 'f'.repeat(64),
      relayUrl: 'wss://relay.example.com/nostr',
      sessionIdentifier: 'session-123',
    })

    expect(url.startsWith('solana-wallet:/v1/associate/remote/nostr')).toBe(true)
    expect(new URL(url).searchParams.get('relay')).toBe('wss://relay.example.com/nostr')
    expect(parseNostrAssociationUrl(url)).toMatchObject({
      dappNostrPubkey: 'f'.repeat(64),
      relayDomain: 'relay.example.com',
      relayUrl: 'wss://relay.example.com/nostr',
      sessionIdentifier: 'session-123',
    })
  })

  test('uses ws for local relay hosts without an explicit scheme', () => {
    const associationPublicKey = new Uint8Array(65).fill(7)
    const url = createNostrAssociationUrl({
      associationPublicKey,
      dappNostrPubkey: 'f'.repeat(64),
      relayUrl: 'ws://127.0.0.1:8080',
      sessionIdentifier: 'session-123',
    })

    expect(parseNostrAssociationUrl(url)).toMatchObject({
      relayDomain: '127.0.0.1:8080',
      relayUrl: 'ws://127.0.0.1:8080',
    })
  })
})
