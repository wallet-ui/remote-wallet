import { REMOTE_WALLET_DEFAULT_ACCOUNT_FEATURES } from '../protocol/index.ts'
import { createRemoteWalletProvider, type RemoteWalletProvider } from './create-remote-wallet-provider.ts'
import type {
  RemoteWalletAuthorizedAccount,
  RemoteWalletAuthorizedSession,
  RemoteWalletIdentity,
  RemoteWalletPairingSession,
  RemoteWalletSignAndSendTransactionInput,
  RemoteWalletSignInInput,
  RemoteWalletSignInOutput,
  RemoteWalletSignMessageInput,
  RemoteWalletSignMessageOutput,
  RemoteWalletSignTransactionInput,
  RemoteWalletSignTransactionOutput,
} from './create-remote-wallet-session.ts'

export const REMOTE_WALLET_ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTIiIGZpbGw9IiNmZmYiLz48cGF0aCBmaWxsPSIjMTExIiBkPSJNMTAgMTBoMTZ2MTZIMTB6TTM4IDEwaDE2djE2SDM4ek0xMCAzOGgxNnYxNkgxMHpNMzAgMzBoOHY4aC04ek00MiAzMGg0djRoLTR6TTUwIDMwaDR2OGgtNHpNMzAgNDJoNHYxMmgtNHpNMzggNDJoOHY0aC04ek01MCA0Nmg0djhoLTR6TTQyIDUwaDR2NGgtNHpNMTQgMTR2OGg4di04em0yOCAwdjhoOHYtOHptLTI4IDI4djhoOHYtOHoiLz48L3N2Zz4='
export const REMOTE_WALLET_NAME = 'Remote Wallet'
export const SOLANA_SIGN_AND_SEND_TRANSACTION = 'solana:signAndSendTransaction'
export const SOLANA_SIGN_IN = 'solana:signIn'
export const SOLANA_SIGN_MESSAGE = 'solana:signMessage'
export const SOLANA_SIGN_TRANSACTION = 'solana:signTransaction'
export const STANDARD_CONNECT = 'standard:connect'
export const STANDARD_DISCONNECT = 'standard:disconnect'
export const STANDARD_EVENTS = 'standard:events'

export interface CreateRemoteWalletStandardWalletOptions {
  chains?: readonly string[]
  identity?: RemoteWalletIdentity
  name?: string
  provider?: RemoteWalletProvider
  relayUrl?: string
  timeoutMs?: number
}

export interface RegisterRemoteWalletOptions extends CreateRemoteWalletStandardWalletOptions {}

export interface RemoteWalletStandardAccount {
  address: string
  chains: readonly string[]
  features: readonly string[]
  icon?: string
  label?: string
  publicKey: Uint8Array
}

export interface RemoteWalletStandardChangeProperties {
  accounts?: readonly RemoteWalletStandardAccount[]
}

export interface RemoteWalletStandardConnectInput {
  silent?: boolean
}

export interface RemoteWalletStandardConnectOutput {
  accounts: readonly RemoteWalletStandardAccount[]
  session?: RemoteWalletPairingSession
}

export interface RemoteWalletStandardWallet {
  accounts: readonly RemoteWalletStandardAccount[]
  chains: readonly string[]
  features: RemoteWalletStandardWalletFeatures
  icon: string
  name: string
  version: '1.0.0'
}

export interface RemoteWalletStandardWalletFeatures {
  [SOLANA_SIGN_AND_SEND_TRANSACTION]: {
    signAndSendTransaction: (
      ...inputs: readonly RemoteWalletSolanaSignAndSendTransactionInput[]
    ) => Promise<readonly RemoteWalletSolanaSignAndSendTransactionOutput[]>
    supportedTransactionVersions: readonly ('legacy' | number)[]
    version: '1.0.0'
  }
  [SOLANA_SIGN_IN]: {
    signIn: (...inputs: readonly RemoteWalletSignInInput[]) => Promise<readonly RemoteWalletSignInOutput[]>
    version: '1.0.0'
  }
  [SOLANA_SIGN_MESSAGE]: {
    signMessage: (
      ...inputs: readonly RemoteWalletSolanaSignMessageInput[]
    ) => Promise<readonly RemoteWalletSignMessageOutput[]>
    version: '1.0.0'
  }
  [SOLANA_SIGN_TRANSACTION]: {
    signTransaction: (
      ...inputs: readonly RemoteWalletSolanaSignTransactionInput[]
    ) => Promise<readonly RemoteWalletSignTransactionOutput[]>
    supportedTransactionVersions: readonly ('legacy' | number)[]
    version: '1.0.0'
  }
  [STANDARD_CONNECT]: {
    connect: (input?: RemoteWalletStandardConnectInput) => Promise<RemoteWalletStandardConnectOutput>
    version: '1.0.0'
  }
  [STANDARD_DISCONNECT]: {
    disconnect: () => Promise<void>
    version: '1.0.0'
  }
  [STANDARD_EVENTS]: {
    on: (event: 'change', listener: (properties: RemoteWalletStandardChangeProperties) => void) => () => void
    version: '1.0.0'
  }
}

export interface RemoteWalletSolanaSignAndSendTransactionInput {
  account: RemoteWalletStandardAccount
  options?: RemoteWalletSignAndSendTransactionInput['options']
  transaction: ArrayBuffer | Uint8Array
}

export interface RemoteWalletSolanaSignAndSendTransactionOutput {
  signature: Uint8Array
}

export interface RemoteWalletSolanaSignMessageInput {
  account: RemoteWalletStandardAccount
  message: ArrayBuffer | Uint8Array
}

export interface RemoteWalletSolanaSignTransactionInput {
  account: RemoteWalletStandardAccount
  transaction: ArrayBuffer | Uint8Array
}

type RemoteWalletPendingConnect = {
  promise: Promise<RemoteWalletStandardConnectOutput>
  reject: (reason?: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}

class RemoteWalletStandardWalletImpl implements RemoteWalletStandardWallet {
  readonly icon = REMOTE_WALLET_ICON
  readonly name: string
  readonly version = '1.0.0'

  get accounts() {
    return this.#accounts
  }

  get chains() {
    return this.#chains
  }

  get features() {
    return this.#features
  }

  #accounts: readonly RemoteWalletStandardAccount[] = []
  readonly #chains: readonly string[]
  readonly #features: RemoteWalletStandardWalletFeatures
  readonly #identity?: RemoteWalletIdentity
  readonly #listeners = new Set<(properties: RemoteWalletStandardChangeProperties) => void>()
  #pendingConnect: RemoteWalletPendingConnect | undefined
  readonly #provider: RemoteWalletProvider
  #remoteSession: RemoteWalletAuthorizedSession | undefined
  readonly #timeoutMs: number

  constructor({
    chains = ['solana:devnet'],
    identity,
    name = REMOTE_WALLET_NAME,
    provider,
    relayUrl,
    timeoutMs,
  }: CreateRemoteWalletStandardWalletOptions) {
    this.#chains = chains
    this.#identity = identity
    this.name = name
    this.#provider = provider ?? createRemoteWalletProvider({ relayUrl })
    this.#timeoutMs = timeoutMs ?? 60_000
    this.#features = {
      [SOLANA_SIGN_AND_SEND_TRANSACTION]: {
        signAndSendTransaction: this.#signAndSendTransaction,
        supportedTransactionVersions: ['legacy', 0],
        version: '1.0.0',
      },
      [SOLANA_SIGN_IN]: {
        signIn: this.#signIn,
        version: '1.0.0',
      },
      [SOLANA_SIGN_MESSAGE]: {
        signMessage: this.#signMessage,
        version: '1.0.0',
      },
      [SOLANA_SIGN_TRANSACTION]: {
        signTransaction: this.#signTransaction,
        supportedTransactionVersions: ['legacy', 0],
        version: '1.0.0',
      },
      [STANDARD_CONNECT]: {
        connect: this.#connect,
        version: '1.0.0',
      },
      [STANDARD_DISCONNECT]: {
        disconnect: this.#disconnect,
        version: '1.0.0',
      },
      [STANDARD_EVENTS]: {
        on: this.#on,
        version: '1.0.0',
      },
    }

    this.#provider.subscribe(() => {
      if (!this.#provider.getSnapshot().session) {
        this.#rejectPendingConnect(new Error('Remote Wallet pairing cancelled'))
      }

      this.#emit({})
    })
  }

  #clearPendingConnectTimeout() {
    if (!this.#pendingConnect) {
      return
    }

    clearTimeout(this.#pendingConnect.timeoutId)
  }

  #connect = (input?: RemoteWalletStandardConnectInput): Promise<RemoteWalletStandardConnectOutput> => {
    if (input?.silent && !this.#accounts.length) {
      return Promise.resolve({ accounts: [] })
    }
    if (this.#accounts.length) {
      return Promise.resolve({ accounts: this.#accounts })
    }
    if (this.#pendingConnect) {
      return this.#pendingConnect.promise
    }

    let resolveConnect!: (result: RemoteWalletStandardConnectOutput) => void
    let rejectConnect!: (reason?: unknown) => void
    const promise = new Promise<RemoteWalletStandardConnectOutput>((resolve, reject) => {
      rejectConnect = reject
      resolveConnect = resolve
    })
    const pendingConnect: RemoteWalletPendingConnect = {
      promise,
      reject: rejectConnect,
      timeoutId: setTimeout(() => this.#provider.cancelPairing(), this.#timeoutMs),
    }

    this.#pendingConnect = pendingConnect
    this.#provider
      .startPairing({
        chains: this.#chains,
        timeoutMs: this.#timeoutMs,
      })
      .then((pairingSession) => {
        if (this.#pendingConnect !== pendingConnect) {
          pairingSession.cancel()

          return
        }

        pairingSession
          .connect({
            identity: this.#identity,
            onStatusChange: () => {
              this.#provider.notifyPairingChange?.()
            },
            timeoutMs: this.#timeoutMs,
          })
          .then((authorizedSession) => {
            if (this.#pendingConnect !== pendingConnect) {
              authorizedSession.close()

              return
            }

            this.#clearPendingConnectTimeout()
            this.#pendingConnect = undefined
            this.#remoteSession = authorizedSession
            this.#accounts = authorizedSession.accounts.map(mapRemoteWalletAccount)
            this.#provider.notifyPairingChange?.()
            this.#emit({ accounts: this.#accounts })
            resolveConnect({ accounts: this.#accounts, session: pairingSession })
          })
          .catch((error: unknown) => {
            if (this.#pendingConnect === pendingConnect) {
              this.#rejectPendingConnect(error)
            }
          })
      })
      .catch((error: unknown) => {
        if (this.#pendingConnect === pendingConnect) {
          this.#rejectPendingConnect(error)
        }
      })

    return promise
  }

  #disconnect = async () => {
    try {
      this.#rejectPendingConnect(new Error('Remote Wallet pairing cancelled'))
      await this.#remoteSession?.disconnect()
    } finally {
      this.#accounts = []
      this.#remoteSession = undefined
      this.#provider.cancelPairing()
      this.#emit({ accounts: this.#accounts })
    }
  }

  #emit(properties: RemoteWalletStandardChangeProperties) {
    for (const listener of this.#listeners) {
      listener(properties)
    }
  }

  #getRemoteSession() {
    if (!this.#remoteSession) {
      throw new Error('Remote Wallet is not connected')
    }

    return this.#remoteSession
  }

  #on = (event: 'change', listener: (properties: RemoteWalletStandardChangeProperties) => void) => {
    if (event === 'change') {
      this.#listeners.add(listener)
    }

    return () => {
      this.#listeners.delete(listener)
    }
  }

  #rejectPendingConnect(reason: unknown) {
    const pendingConnect = this.#pendingConnect

    if (!pendingConnect) {
      return
    }

    this.#clearPendingConnectTimeout()
    this.#pendingConnect = undefined
    pendingConnect.reject(reason)
  }

  #signAndSendTransaction = (...inputs: readonly RemoteWalletSolanaSignAndSendTransactionInput[]) => {
    return this.#getRemoteSession()
      .signAndSendTransactions(
        inputs.map((input) => ({
          options: input.options,
          transaction: toUint8Array(input.transaction),
        })),
      )
      .then((outputs) => outputs.map((output) => ({ signature: output.signature })))
  }

  #signIn = async (...inputs: readonly RemoteWalletSignInInput[]) => {
    const remoteSession = this.#getRemoteSession()
    const signInInputs = inputs.length > 0 ? inputs : [undefined]
    const outputs: RemoteWalletSignInOutput[] = []

    for (const input of signInInputs) {
      outputs.push(await remoteSession.signIn(input))
    }

    this.#accounts = remoteSession.accounts.map(mapRemoteWalletAccount)
    this.#emit({ accounts: this.#accounts })

    return outputs
  }

  #signMessage = (...inputs: readonly RemoteWalletSolanaSignMessageInput[]) => {
    return this.#getRemoteSession().signMessages(
      inputs.map(
        (input): RemoteWalletSignMessageInput => ({
          message: toUint8Array(input.message),
          publicKey: toUint8Array(input.account.publicKey),
        }),
      ),
    )
  }

  #signTransaction = (...inputs: readonly RemoteWalletSolanaSignTransactionInput[]) => {
    return this.#getRemoteSession().signTransactions(
      inputs.map(
        (input): RemoteWalletSignTransactionInput => ({
          transaction: toUint8Array(input.transaction),
        }),
      ),
    )
  }
}

export function createRemoteWalletStandardWallet(options: CreateRemoteWalletStandardWalletOptions = {}) {
  return new RemoteWalletStandardWalletImpl(options)
}

export function getRemoteWalletStandardFeatures() {
  return [...REMOTE_WALLET_DEFAULT_ACCOUNT_FEATURES]
}

export function registerRemoteWallet(options: RegisterRemoteWalletOptions = {}) {
  const wallet = createRemoteWalletStandardWallet(options)

  registerWalletStandardWallet(wallet)

  return wallet
}

function mapRemoteWalletAccount(account: RemoteWalletAuthorizedAccount): RemoteWalletStandardAccount {
  return {
    address: account.address,
    chains: account.chains,
    features: account.features,
    icon: account.icon,
    label: account.label,
    publicKey: account.publicKey,
  }
}

function registerWalletStandardWallet(wallet: RemoteWalletStandardWallet) {
  const browserGlobal = globalThis as typeof globalThis & {
    addEventListener?: (type: string, listener: EventListener) => void
    dispatchEvent?: (event: Event) => boolean
  }

  if (!browserGlobal.addEventListener || !browserGlobal.dispatchEvent || typeof CustomEvent === 'undefined') {
    return
  }

  const register = (api: { register?: (...wallets: readonly RemoteWalletStandardWallet[]) => void }) => {
    api.register?.(wallet)
  }
  const handleAppReady = (event: Event) => {
    register((event as CustomEvent<{ register?: (...wallets: readonly RemoteWalletStandardWallet[]) => void }>).detail)
  }

  browserGlobal.dispatchEvent(
    new CustomEvent('wallet-standard:register-wallet', {
      detail: register,
    }),
  )
  browserGlobal.addEventListener('wallet-standard:app-ready', handleAppReady)
}

function toUint8Array(bytes: ArrayBuffer | Uint8Array) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}
