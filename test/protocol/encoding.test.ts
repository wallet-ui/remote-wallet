import { describe, expect, test } from 'bun:test'
import { bytesToBase64, bytesToHex, hexToBytes } from '../../src/protocol/index.ts'

describe('encoding helpers', () => {
  test('encodes base64 without mutating input bytes', () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111])

    expect(bytesToBase64(bytes)).toBe('aGVsbG8=')
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111])
  })

  test('round trips hex bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])

    expect(Array.from(hexToBytes(bytesToHex(bytes)))).toEqual(Array.from(bytes))
  })
})
