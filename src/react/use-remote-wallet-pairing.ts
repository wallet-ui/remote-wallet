import * as React from 'react'
import { createRemoteWalletSession, type RemoteWalletPairingSession } from '../browser/index.ts'

export const REMOTE_WALLET_PAIRING_DEFAULT_RELAY = 'wss://relay.damus.io'

export function useRemoteWalletPairing(relayUrl = REMOTE_WALLET_PAIRING_DEFAULT_RELAY) {
  const [session, setSession] = React.useState<RemoteWalletPairingSession | null>(null)
  const sessionRef = React.useRef<RemoteWalletPairingSession | null>(null)

  const cancelPairing = React.useCallback(() => {
    sessionRef.current?.cancel()
    sessionRef.current = null
    setSession(null)
  }, [])
  const startPairing = React.useCallback(async () => {
    const nextSession = await createRemoteWalletSession({ relayUrl })

    sessionRef.current = nextSession
    setSession((previous) => {
      previous?.cancel()

      return nextSession
    })

    return nextSession
  }, [relayUrl])

  React.useEffect(() => {
    return () => {
      sessionRef.current?.cancel()
      sessionRef.current = null
    }
  }, [])

  return {
    cancelPairing,
    session,
    startPairing,
  }
}
