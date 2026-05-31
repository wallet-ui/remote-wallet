import { describe, expect, test } from 'bun:test'
import { formatJsonEvent } from '../../src/cli/index.ts'

describe('formatJsonEvent', () => {
  test('formats one JSON event per line', () => {
    expect(formatJsonEvent('connected', { address: 'abc' })).toBe('{"event":"connected","address":"abc"}\n')
  })

  test('keeps the explicit event when payload includes event', () => {
    expect(formatJsonEvent('connected', { event: 'payload-event' })).toBe('{"event":"connected"}\n')
  })
})
