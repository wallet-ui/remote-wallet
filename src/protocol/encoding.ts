import { bytesToHex as nobleBytesToHex, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js'
import { getBase58Decoder, getBase58Encoder, getBase64Decoder, getBase64Encoder } from '@solana/kit'

const base58Decoder = getBase58Decoder()
const base58Encoder = getBase58Encoder()
const base64Decoder = getBase64Decoder()
const base64Encoder = getBase64Encoder()

export function base58ToBytes(base58: string) {
  return new Uint8Array(base58Encoder.encode(base58))
}

export function base64ToBytes(base64: string) {
  return new Uint8Array(base64Encoder.encode(base64))
}

export function base64UrlToBytes(value: string) {
  const normalizedValue = value.replaceAll(' ', '+').replaceAll('-', '+').replaceAll('_', '/')
  const paddedValue = normalizedValue.padEnd(Math.ceil(normalizedValue.length / 4) * 4, '=')

  return base64ToBytes(paddedValue)
}

export function bytesToBase58(bytes: Uint8Array) {
  return base58Decoder.decode(bytes)
}

export function bytesToBase64(bytes: Uint8Array) {
  return base64Decoder.decode(bytes)
}

export function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

export function bytesToHex(bytes: Uint8Array) {
  return nobleBytesToHex(bytes)
}

export function concatBytes(...chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

export function hexToBytes(hex: string) {
  return nobleHexToBytes(hex)
}
