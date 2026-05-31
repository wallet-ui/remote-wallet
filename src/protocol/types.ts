export interface PairingDetails {
  associationPublicKey: Uint8Array
  dappNostrPubkey: string
  relayDomain: string
  relayUrl: string
  sessionIdentifier: string
}

export interface RemoteWalletAccount {
  address: string
  chains: string[]
  features: string[]
  label: string
  publicKey?: Uint8Array
}

export interface RemoteWalletSignInPayload {
  address?: string
  chainId?: string
  domain?: string
  expirationTime?: string
  issuedAt?: string
  nonce?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
  statement?: string
  uri?: string
  version?: string
}
