import { ENCODED_PUBLIC_KEY_LENGTH_BYTES, INITIALIZATION_VECTOR_BYTES, SEQUENCE_NUMBER_BYTES } from './constants.ts'
import { concatBytes } from './encoding.ts'

export interface RemoteWalletEncryptedMessage {
  ciphertext: Uint8Array
  sequenceNumber: number
}

export async function createHelloRequest(ecdhPublicKey: CryptoKey, associationKeypairPrivateKey: CryptoKey) {
  const publicKeyBuffer = await crypto.subtle.exportKey('raw', ecdhPublicKey)
  const signatureBuffer = await crypto.subtle.sign(
    { hash: 'SHA-256', name: 'ECDSA' },
    associationKeypairPrivateKey,
    publicKeyBuffer,
  )

  return concatBytes(new Uint8Array(publicKeyBuffer), new Uint8Array(signatureBuffer))
}

export function createSequenceNumberVector(sequenceNumber: number): Uint8Array {
  if (sequenceNumber >= 4_294_967_296) {
    throw new Error('Outbound sequence number overflow. The maximum sequence number is 32-bits.')
  }

  const byteArray = new ArrayBuffer(SEQUENCE_NUMBER_BYTES)
  const view = new DataView(byteArray)

  view.setUint32(0, sequenceNumber, false)

  return new Uint8Array(byteArray)
}

export async function decryptMessage(message: ArrayBuffer | Uint8Array, sharedSecret: CryptoKey) {
  const messageBuffer = message instanceof Uint8Array ? toArrayBuffer(message) : message
  const ciphertext = messageBuffer.slice(SEQUENCE_NUMBER_BYTES + INITIALIZATION_VECTOR_BYTES)
  const initializationVector = messageBuffer.slice(
    SEQUENCE_NUMBER_BYTES,
    SEQUENCE_NUMBER_BYTES + INITIALIZATION_VECTOR_BYTES,
  )
  const sequenceNumberVector = messageBuffer.slice(0, SEQUENCE_NUMBER_BYTES)
  const plaintextBuffer = await crypto.subtle.decrypt(
    getEncryptionAlgorithmParams(sequenceNumberVector, initializationVector),
    sharedSecret,
    ciphertext,
  )

  return new TextDecoder('utf-8').decode(plaintextBuffer)
}

export async function deriveSharedSecret({
  associationPublicKey,
  dappEcdhPublicKey,
  walletEcdhPrivateKey,
}: {
  associationPublicKey: Uint8Array
  dappEcdhPublicKey: Uint8Array
  walletEcdhPrivateKey: CryptoKey
}) {
  const dappPublicKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(dappEcdhPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: dappPublicKey },
    walletEcdhPrivateKey,
    256,
  )
  const ecdhSecretKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    {
      hash: 'SHA-256',
      info: new Uint8Array(),
      name: 'HKDF',
      salt: toArrayBuffer(associationPublicKey),
    },
    ecdhSecretKey,
    { length: 128, name: 'AES-GCM' },
    false,
    ['decrypt', 'encrypt'],
  )
}

export async function encryptMessage(plaintext: string, sequenceNumber: number, sharedSecret: CryptoKey) {
  const initializationVector = crypto.getRandomValues(new Uint8Array(INITIALIZATION_VECTOR_BYTES))
  const sequenceNumberVector = createSequenceNumberVector(sequenceNumber)
  const ciphertext = await crypto.subtle.encrypt(
    getEncryptionAlgorithmParams(sequenceNumberVector, initializationVector),
    sharedSecret,
    new TextEncoder().encode(plaintext),
  )

  return concatBytes(sequenceNumberVector, initializationVector, new Uint8Array(ciphertext))
}

export function getEncryptionAlgorithmParams(
  sequenceNumber: ArrayBuffer | Uint8Array,
  initializationVector: ArrayBuffer | Uint8Array,
) {
  return {
    additionalData: sequenceNumber,
    iv: initializationVector,
    name: 'AES-GCM',
    tagLength: 128,
  }
}

export function getSequenceNumber(message: ArrayBuffer | Uint8Array) {
  const buffer = message instanceof Uint8Array ? toArrayBuffer(message) : message
  const view = new DataView(buffer, 0, SEQUENCE_NUMBER_BYTES)

  return view.getUint32(0, false)
}

export async function parseHelloResponse(
  payload: Uint8Array,
  associationPublicKey: CryptoKey,
  ecdhPrivateKey: CryptoKey,
) {
  const [associationPublicKeyBuffer, walletPublicKey] = await Promise.all([
    crypto.subtle.exportKey('raw', associationPublicKey),
    crypto.subtle.importKey(
      'raw',
      toArrayBuffer(payload.slice(0, ENCODED_PUBLIC_KEY_LENGTH_BYTES)),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    ),
  ])
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: walletPublicKey }, ecdhPrivateKey, 256)
  const ecdhSecretKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    {
      hash: 'SHA-256',
      info: new Uint8Array(),
      name: 'HKDF',
      salt: new Uint8Array(associationPublicKeyBuffer),
    },
    ecdhSecretKey,
    { length: 128, name: 'AES-GCM' },
    false,
    ['decrypt', 'encrypt'],
  )
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new Uint8Array(bytes.byteLength)

  buffer.set(bytes)

  return buffer.buffer
}

export async function verifyAssociationSignature({
  associationPublicKey,
  dappEcdhPublicKey,
  signature,
}: {
  associationPublicKey: Uint8Array
  dappEcdhPublicKey: Uint8Array
  signature: Uint8Array
}) {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(associationPublicKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const verified = await crypto.subtle.verify(
    { hash: 'SHA-256', name: 'ECDSA' },
    publicKey,
    toArrayBuffer(signature),
    toArrayBuffer(dappEcdhPublicKey),
  )

  if (!verified) {
    throw new Error('Invalid association signature in hello request')
  }
}
