import { describe, expect, test } from 'bun:test'

describe('README', () => {
  test('documents the agent CLI flow', async () => {
    const readme = await Bun.file('README.md').text()

    expect(readme).toContain('Agent Remote Wallet')
    expect(readme).toContain('bunx remote-wallet')
    expect(readme).toContain('Pairing URL')
  })
})
