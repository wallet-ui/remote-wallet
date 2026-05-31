import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from './encoding.ts'

export interface NostrEvent {
  content: string
  created_at: number
  id: string
  kind: number
  pubkey: string
  sig: string
  tags: string[][]
}

export function computeNostrEventId(
  pubkey: string,
  createdAt: number,
  kind: number,
  tags: string[][],
  content: string,
) {
  const serializedEvent = JSON.stringify([0, pubkey, createdAt, kind, tags, content])

  return bytesToHex(sha256(new TextEncoder().encode(serializedEvent)))
}

export function createNostrEvent(content: string, kind: number, tags: string[][], privateKey: Uint8Array): NostrEvent {
  const createdAt = Math.floor(Date.now() / 1000)
  const pubkey = bytesToHex(schnorr.getPublicKey(privateKey))
  const id = computeNostrEventId(pubkey, createdAt, kind, tags, content)
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), privateKey))

  return { content, created_at: createdAt, id, kind, pubkey, sig, tags }
}

export function generateNostrKeypair(): { privateKey: Uint8Array; publicKey: string } {
  const privateKey = schnorr.utils.randomSecretKey()

  return {
    privateKey,
    publicKey: bytesToHex(schnorr.getPublicKey(privateKey)),
  }
}

export function getNostrEventTags(event: NostrEvent) {
  const tags: Record<string, string[]> = {}

  for (const [name, value] of event.tags) {
    if (!name || !value) {
      continue
    }

    tags[name] = [...(tags[name] ?? []), value]
  }

  return tags
}

export function isNostrEvent(event: unknown): event is NostrEvent {
  if (!event || typeof event !== 'object') {
    return false
  }

  const candidate = event as NostrEvent

  return (
    typeof candidate.content === 'string' &&
    typeof candidate.created_at === 'number' &&
    typeof candidate.id === 'string' &&
    typeof candidate.kind === 'number' &&
    typeof candidate.pubkey === 'string' &&
    typeof candidate.sig === 'string' &&
    Array.isArray(candidate.tags)
  )
}

export function parseNostrRelayMessage(message: string): undefined | unknown[] {
  try {
    const parsedMessage: unknown = JSON.parse(message)

    return Array.isArray(parsedMessage) ? parsedMessage : undefined
  } catch {
    return undefined
  }
}

export function verifyNostrEvent(event: NostrEvent) {
  const id = computeNostrEventId(event.pubkey, event.created_at, event.kind, event.tags, event.content)

  if (id !== event.id) {
    return false
  }

  try {
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(id), hexToBytes(event.pubkey))
  } catch {
    return false
  }
}
