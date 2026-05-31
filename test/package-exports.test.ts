import { describe, expect, test } from 'bun:test'
import packageJson from '../package.json' with { type: 'json' }

describe('package exports', () => {
  test('exposes public runtime entrypoints', () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual(['.', './browser', './node', './protocol', './react'])
  })

  test('keeps the remote-wallet binary name stable', () => {
    expect(packageJson.bin).toEqual({
      'remote-wallet': 'dist/bin/remote-wallet.mjs',
    })
  })

  test('uses ESM-only package exports', () => {
    expect(Object.entries(packageJson.exports['.'])).toEqual([
      ['types', './dist/index.d.mts'],
      ['import', './dist/index.mjs'],
      ['default', './dist/index.mjs'],
    ])
    expect(JSON.stringify(packageJson.exports)).not.toContain('require')
    expect(JSON.stringify(packageJson.exports)).not.toContain('.cjs')
  })
})
