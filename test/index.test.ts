import { expect, test } from 'bun:test'
import { NOSTR_EVENT_KIND_MWA } from '../src/index.ts'

test('exports protocol primitives from the root entrypoint', () => {
  expect(NOSTR_EVENT_KIND_MWA).toBe(20012)
})
