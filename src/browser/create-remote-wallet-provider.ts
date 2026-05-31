import {
  type CreateRemoteWalletSessionOptions,
  createRemoteWalletSession,
  type RemoteWalletPairingSession,
} from './create-remote-wallet-session.ts'

export interface RemoteWalletProvider {
  cancelPairing: () => void
  getSnapshot: () => RemoteWalletProviderSnapshot
  notifyPairingChange?: () => void
  startPairing: (options?: Partial<CreateRemoteWalletSessionOptions>) => Promise<RemoteWalletPairingSession>
  subscribe: (listener: RemoteWalletProviderListener) => () => void
}

export interface RemoteWalletProviderOptions {
  relayUrl?: string
}

export interface RemoteWalletProviderSnapshot {
  session?: RemoteWalletPairingSession
}

export type RemoteWalletProviderListener = () => void

export function createRemoteWalletProvider({
  relayUrl = 'wss://relay.damus.io',
}: RemoteWalletProviderOptions = {}): RemoteWalletProvider {
  const listeners = new Set<RemoteWalletProviderListener>()
  let snapshot: RemoteWalletProviderSnapshot = {}

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    cancelPairing() {
      snapshot.session?.cancel()
      snapshot = {}
      emit()
    },
    getSnapshot() {
      return snapshot
    },
    notifyPairingChange() {
      emit()
    },
    async startPairing(options = {}) {
      snapshot.session?.cancel()
      const session = await createRemoteWalletSession({
        chains: options.chains,
        connect: options.connect,
        identity: options.identity,
        relayUrl: options.relayUrl ?? relayUrl,
        timeoutMs: options.timeoutMs,
      })

      snapshot = { session }
      emit()

      return session
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}
