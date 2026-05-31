import { describe, expect, test } from 'bun:test'
import { parseCliArgs } from '../../src/cli/index.ts'

describe('parseCliArgs', () => {
  test('accepts --url and --label', () => {
    expect(parseCliArgs(['--url', 'pairing-url', '--label', 'CI Wallet'])).toMatchObject({
      label: 'CI Wallet',
      pairingUrl: 'pairing-url',
    })
  })

  test('accepts pairing URL as positional argument', () => {
    expect(parseCliArgs(['solana-wallet:/v1/associate/remote/nostr?x=1'])).toMatchObject({
      label: 'Agent Remote Wallet',
      pairingUrl: 'solana-wallet:/v1/associate/remote/nostr?x=1',
      timeoutMs: 60_000,
    })
  })

  test('rejects a flag when a value is required', () => {
    expect(() => parseCliArgs(['--label', '--chain', 'solana:devnet', 'pairing-url'])).toThrow(
      '--label requires a value',
    )
  })

  test('rejects unknown flags', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow('Unexpected argument: --unknown')
  })
})
