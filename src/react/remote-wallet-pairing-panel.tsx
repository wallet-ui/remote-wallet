import type { RemoteWalletPairingSession } from '../browser/index.ts'

export interface RemoteWalletPairingPanelProps {
  onCancel?: () => void
  session: RemoteWalletPairingSession
}

export function RemoteWalletPairingPanel({ onCancel, session }: RemoteWalletPairingPanelProps) {
  return (
    <section>
      <label>
        Pairing URL
        <input readOnly value={session.pairingUrl} />
      </label>
      <button onClick={() => void writeClipboardText(session.pairingUrl)} type="button">
        Copy
      </button>
      {onCancel ? (
        <button onClick={onCancel} type="button">
          Cancel
        </button>
      ) : null}
    </section>
  )
}

function writeClipboardText(text: string) {
  const navigatorWithClipboard = globalThis.navigator as
    | { clipboard?: { writeText: (nextText: string) => Promise<void> } }
    | undefined

  return navigatorWithClipboard?.clipboard?.writeText(text)
}
