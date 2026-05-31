export interface RemoteWalletCliConfig {
  chain: string
  label: string
  pairingUrl: string
  printSecret: boolean
  rpcUrl?: string
  secretKey?: string
  timeoutMs: number
}

export function parseCliArgs(args: string[]): RemoteWalletCliConfig {
  const values = [...args]
  let chain = 'solana:devnet'
  let label = 'Agent Remote Wallet'
  let pairingUrl: string | undefined
  let printSecret = false
  let rpcUrl: string | undefined
  let secretKey: string | undefined
  let timeoutMs = 60_000

  while (values.length > 0) {
    const value = values.shift()

    if (!value) {
      continue
    }
    if (value === '--chain') {
      chain = requireValue(value, values.shift())
    } else if (value === '--label') {
      label = requireValue(value, values.shift())
    } else if (value === '--print-secret') {
      printSecret = true
    } else if (value === '--rpc-url') {
      rpcUrl = requireValue(value, values.shift())
    } else if (value === '--secret-key') {
      secretKey = requireValue(value, values.shift())
    } else if (value === '--timeout') {
      timeoutMs = Number(requireValue(value, values.shift()))
    } else if (value === '--url') {
      pairingUrl = requireValue(value, values.shift())
    } else if (!pairingUrl && !value.startsWith('--')) {
      pairingUrl = value
    } else {
      throw new Error(`Unexpected argument: ${value}`)
    }
  }

  if (!pairingUrl) {
    throw new Error('Missing pairing URL. Pass it as an argument or with --url.')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout must be a positive integer in milliseconds')
  }

  return { chain, label, pairingUrl, printSecret, rpcUrl, secretKey, timeoutMs }
}

function requireValue(flag: string, value: string | undefined) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }

  return value
}
