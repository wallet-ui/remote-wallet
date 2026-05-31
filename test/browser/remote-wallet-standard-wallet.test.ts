import { describe, expect, mock, test } from 'bun:test'
import {
  createRemoteWalletStandardWallet,
  type RemoteWalletAuthorizedSession,
  type RemoteWalletPairingSession,
  type RemoteWalletProvider,
  type RemoteWalletStandardWallet,
  registerRemoteWallet,
  SOLANA_SIGN_AND_SEND_TRANSACTION,
  STANDARD_CONNECT,
  STANDARD_DISCONNECT,
} from '../../src/browser/index.ts'

describe('Remote Wallet Standard wallet', () => {
  test('connects through a pairing session and routes signing through the remote session', async () => {
    const account = createTestAccount()
    const signAndSendTransactions = mock(async () => [{ signature: new Uint8Array([9, 8, 7]) }])
    const remoteSession = createRemoteSession({ account, signAndSendTransactions })
    const sessionConnect = mock(async () => remoteSession)
    const session = createPairingSession({ connect: sessionConnect })
    const provider = createTestProvider(session)
    const wallet = createRemoteWalletStandardWallet({
      chains: ['solana:devnet'],
      provider,
    })

    const connectPromise = wallet.features[STANDARD_CONNECT].connect()

    expect(provider.getSnapshot().session).toBe(session)

    const result = await connectPromise
    const connectedAccount = result.accounts[0]

    if (!connectedAccount) {
      throw new Error('Expected Remote Wallet to authorize an account')
    }

    expect(result.session).toBe(session)
    expect(wallet.accounts).toEqual([account])
    expect(sessionConnect).toHaveBeenCalledTimes(1)

    const [output] = await wallet.features[SOLANA_SIGN_AND_SEND_TRANSACTION].signAndSendTransaction({
      account: connectedAccount,
      transaction: new Uint8Array([1, 2, 3]),
    })

    expect(output?.signature).toEqual(new Uint8Array([9, 8, 7]))
    expect(signAndSendTransactions).toHaveBeenCalledTimes(1)

    await wallet.features[STANDARD_DISCONNECT].disconnect()

    expect(wallet.accounts).toEqual([])
  })

  test('shares one pending pairing for concurrent connect calls', async () => {
    const account = createTestAccount()
    const deferredSession = createDeferred<RemoteWalletPairingSession>()
    const remoteSession = createRemoteSession({ account })
    const sessionConnect = mock(async () => remoteSession)
    const session = createPairingSession({ connect: sessionConnect })
    const startPairing = mock(() => deferredSession.promise)
    const provider = createTestProvider(session, { startPairing })
    const wallet = createRemoteWalletStandardWallet({
      chains: ['solana:devnet'],
      provider,
    })

    const firstConnect = wallet.features[STANDARD_CONNECT].connect()
    const secondConnect = wallet.features[STANDARD_CONNECT].connect()

    expect(startPairing).toHaveBeenCalledTimes(1)

    deferredSession.resolve(session)

    const [firstResult, secondResult] = await Promise.all([firstConnect, secondConnect])

    expect(firstResult).toBe(secondResult)
    expect(firstResult.accounts).toEqual([account])
    expect(firstResult.session).toBe(session)
    expect(sessionConnect).toHaveBeenCalledTimes(1)
  })

  test('registers through Wallet Standard browser events', () => {
    const provider = createTestProvider(createPairingSession())
    const registeredWallets: RemoteWalletStandardWallet[] = []
    const handleRegisterWallet = (event: Event) => {
      const registerWallet = (
        event as CustomEvent<(api: { register: (...wallets: readonly RemoteWalletStandardWallet[]) => void }) => void>
      ).detail

      registerWallet({
        register: (...wallets) => registeredWallets.push(...wallets),
      })
    }

    globalThis.addEventListener('wallet-standard:register-wallet', handleRegisterWallet)

    try {
      const wallet = registerRemoteWallet({ provider })

      expect(registeredWallets).toEqual([wallet])
    } finally {
      globalThis.removeEventListener('wallet-standard:register-wallet', handleRegisterWallet)
    }
  })
})

function createDeferred<T>() {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject
    resolve = promiseResolve
  })

  return { promise, reject, resolve }
}

function createPairingSession({
  connect = mock(async () => createRemoteSession({ account: createTestAccount() })),
}: {
  connect?: RemoteWalletPairingSession['connect']
} = {}): RemoteWalletPairingSession {
  return {
    associationKeyPair: {} as CryptoKeyPair,
    cancel() {},
    chain: 'solana:devnet',
    close() {},
    connect,
    dappNostrPrivateKey: new Uint8Array(32),
    dappNostrPubkey: 'f'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    pairingUrl: 'solana-wallet:/v1/associate/remote/nostr?association=abc',
    relayDomain: 'relay.example.com',
    relayUrl: 'wss://relay.example.com',
    sessionIdentifier: 'session-123',
    status: 'waiting-for-wallet',
  }
}

function createRemoteSession({
  account,
  signAndSendTransactions = mock(async () => [{ signature: new Uint8Array([1]) }]),
}: {
  account: RemoteWalletAuthorizedSession['accounts'][number]
  signAndSendTransactions?: RemoteWalletAuthorizedSession['signAndSendTransactions']
}): RemoteWalletAuthorizedSession {
  return {
    accounts: [account],
    authToken: 'auth-token',
    chain: 'solana:devnet',
    close() {},
    disconnect: mock(async () => {}),
    signAndSendTransactions,
    signIn: mock(async () => ({
      account,
      signature: new Uint8Array([1]),
      signatureType: 'ed25519' as const,
      signedMessage: new Uint8Array([2]),
    })),
    signMessages: mock(async () => [
      {
        signature: new Uint8Array([1]),
        signatureType: 'ed25519' as const,
        signedMessage: new Uint8Array([2]),
      },
    ]),
    signTransactions: mock(async () => [{ signedTransaction: new Uint8Array([3]) }]),
  }
}

function createTestAccount(): RemoteWalletAuthorizedSession['accounts'][number] {
  return {
    address: '11111111111111111111111111111111',
    chains: ['solana:devnet'],
    features: ['solana:signAndSendTransaction'],
    label: 'Test Wallet',
    publicKey: new Uint8Array(32),
  }
}

function createTestProvider(
  session: RemoteWalletPairingSession,
  { startPairing }: { startPairing?: RemoteWalletProvider['startPairing'] } = {},
): RemoteWalletProvider {
  const listeners = new Set<() => void>()
  let snapshot: ReturnType<RemoteWalletProvider['getSnapshot']> = {}

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    cancelPairing() {
      snapshot = {}
      emit()
    },
    getSnapshot() {
      return snapshot
    },
    notifyPairingChange() {
      emit()
    },
    async startPairing(options) {
      const nextSession = startPairing ? await startPairing(options) : session

      snapshot = { session: nextSession }
      emit()

      return nextSession
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}
