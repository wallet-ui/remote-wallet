import { describe, expect, test } from 'bun:test'
import { createSequenceNumberVector } from '../../src/protocol/crypto.ts'

describe('crypto helpers', () => {
  test('reports the 32-bit sequence number limit', () => {
    expect(() => createSequenceNumberVector(4_294_967_296)).toThrow(
      'Outbound sequence number overflow. The maximum sequence number is 32-bits.',
    )
  })
})
