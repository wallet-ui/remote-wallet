import { describe, expect, test } from 'bun:test'
import { createRemoteWalletSigner } from '../../src/node/index.ts'

describe('remote wallet signer', () => {
  test('creates a wallet account from a generated secret key', () => {
    const signer = createRemoteWalletSigner({ label: 'Agent Remote Wallet' })

    expect(signer.account.address.length).toBeGreaterThan(30)
    expect(signer.account.features).toContain('solana:signMessage')
    expect(signer.account.label).toBe('Agent Remote Wallet')
  })

  test('rejects unknown message signing addresses', async () => {
    const signer = createRemoteWalletSigner({ label: 'Agent Remote Wallet' })

    await expect(
      signer.signMessages([
        {
          addresses: ['not-the-generated-address'],
          payload: new Uint8Array([1, 2, 3]),
        },
      ]),
    ).rejects.toThrow('Cannot sign for unknown address')
  })
})
