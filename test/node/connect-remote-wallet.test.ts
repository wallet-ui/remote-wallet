import { describe, expect, test } from 'bun:test'
import { createRemoteWalletSigner } from '../../src/node/index.ts'

describe('connectRemoteWallet', () => {
  test('exposes signer state for connection orchestration', () => {
    const signer = createRemoteWalletSigner({ label: 'Agent Remote Wallet' })

    expect(signer.account.label).toBe('Agent Remote Wallet')
  })
})
