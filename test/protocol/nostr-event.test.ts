import { describe, expect, test } from 'bun:test'
import { createNostrEvent, generateNostrKeypair, verifyNostrEvent } from '../../src/protocol/index.ts'

describe('Nostr event helpers', () => {
  test('creates verifiable Nostr events', () => {
    const keypair = generateNostrKeypair()
    const event = createNostrEvent('content', 20012, [['d', 'session']], keypair.privateKey)

    expect(event.pubkey).toBe(keypair.publicKey)
    expect(verifyNostrEvent(event)).toBe(true)
  })
})
