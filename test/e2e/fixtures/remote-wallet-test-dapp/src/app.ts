/// <reference lib="dom" />

import {
  address,
  appendTransactionMessageInstruction,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getTransactionCodec,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import {
  createRemoteWalletProvider,
  type RemoteWalletPairingSession,
  type RemoteWalletPairingStatus,
  type RemoteWalletStandardWallet,
  registerRemoteWallet,
  SOLANA_SIGN_AND_SEND_TRANSACTION,
  SOLANA_SIGN_IN,
  SOLANA_SIGN_MESSAGE,
  SOLANA_SIGN_TRANSACTION,
  STANDARD_CONNECT,
  STANDARD_DISCONNECT,
} from '../../../../../src/browser/index.ts'

interface RemoteWalletTestDappConfig {
  chain: string
  relayUrl: string
  rpcUrl: string
}

interface RemoteWalletTestDappState {
  error?: string
  messageSignature?: string
  messageStatus: RemoteWalletActionStatus
  pairingSession?: RemoteWalletPairingSession
  signInAddress?: string
  signInStatus: RemoteWalletActionStatus
  signTransactionSignature?: string
  signTransactionStatus: RemoteWalletActionStatus
  status: RemoteWalletPairingStatus | 'idle'
  transactionSignature?: string
  transactionStatus: 'idle' | 'sending' | 'sent'
}

type RemoteWalletActionStatus = 'idle' | 'signed' | 'signing'

declare global {
  interface Window {
    __REMOTE_WALLET_TEST_DAPP__?: {
      getPairingUrl: () => string | undefined
      getRegisteredWallets: () => readonly RemoteWalletStandardWallet[]
      getStatus: () => RemoteWalletTestDappState['status']
      wallet: RemoteWalletStandardWallet
    }
  }
}

const config = await loadConfig()
const rootElement = document.querySelector<HTMLDivElement>('#app')

if (!rootElement) {
  throw new Error('Missing #app root element')
}

const root = rootElement
const provider = createRemoteWalletProvider({ relayUrl: config.relayUrl })
const registeredWallets: RemoteWalletStandardWallet[] = []

installWalletStandardAppRegistry(registeredWallets)

const wallet = registerRemoteWallet({
  chains: [config.chain],
  identity: {
    name: 'Remote Wallet Test Dapp',
    uri: window.location.origin,
  },
  provider,
})
const state: RemoteWalletTestDappState = {
  messageStatus: 'idle',
  signInStatus: 'idle',
  signTransactionStatus: 'idle',
  status: 'idle',
  transactionStatus: 'idle',
}

provider.subscribe(syncPairingState)

window.__REMOTE_WALLET_TEST_DAPP__ = {
  getPairingUrl: () => state.pairingSession?.pairingUrl,
  getRegisteredWallets: () => registeredWallets,
  getStatus: () => state.status,
  wallet,
}

render()

function createStatusBadge() {
  const status = document.createElement('span')

  status.className = `status status-${state.status}`
  status.dataset.testid = 'pairing-status'
  status.textContent = state.status

  return status
}

function render() {
  const canCancel = Boolean(state.pairingSession)
  const canStartPairing = !state.pairingSession
  const connectedAccount = wallet.accounts[0]
  const hasConnectedAccount = Boolean(connectedAccount)
  const isMessageSigning = state.messageStatus === 'signing'
  const isSignInSigning = state.signInStatus === 'signing'
  const isSignTransactionSigning = state.signTransactionStatus === 'signing'
  const isSendingTransaction = state.transactionStatus === 'sending'
  const registeredWalletNames = registeredWallets
    .map((registeredWallet) => registeredWallet.name)
    .sort()
    .join(', ')

  root.replaceChildren(
    el('section', { className: 'shell' }, [
      el('header', { className: 'header' }, [
        el('div', { className: 'header-copy' }, [
          el('p', { className: 'eyebrow' }, ['remote-wallet fixture']),
          el('h1', {}, ['Remote Wallet Test Dapp']),
        ]),
        createStatusBadge(),
      ]),
      el('section', { className: 'panel' }, [
        el('div', { className: 'section-header' }, [
          el('h2', {}, ['Connected Wallet']),
          el('span', { className: hasConnectedAccount ? 'chip success' : 'chip' }, [
            hasConnectedAccount ? 'Connected' : 'Not connected',
          ]),
        ]),
        createReadonlyGrid([
          ['Address', connectedAccount?.address ?? 'Not connected', 'connected-wallet-address'],
          ['Label', connectedAccount?.label ?? 'Not connected', 'connected-wallet-label'],
        ]),
      ]),
      el('section', { className: 'panel' }, [
        el('div', { className: 'section-header' }, [
          el('h2', {}, ['Adapter']),
          el('span', { className: 'chip', dataset: { testid: 'adapter-name' } }, [wallet.name]),
        ]),
        createReadonlyGrid([
          ['Chain', config.chain, 'configured-chain'],
          ['Features', Object.keys(wallet.features).sort().join(', '), 'adapter-features'],
          ['Registered wallets', registeredWalletNames, 'registered-wallets'],
          ['Relay', config.relayUrl, 'configured-relay'],
          ['RPC', config.rpcUrl, 'configured-rpc'],
        ]),
      ]),
      el('section', { className: 'panel' }, [
        el('div', { className: 'section-header' }, [
          el('h2', {}, ['Pairing']),
          el('div', { className: 'actions' }, [
            el(
              'button',
              {
                dataset: { testid: 'start-pairing' },
                disabled: !canStartPairing,
                events: {
                  click: () => {
                    void startPairing()
                  },
                },
                type: 'button',
              },
              ['Start pairing'],
            ),
            el(
              'button',
              {
                dataset: { testid: 'cancel-pairing' },
                disabled: !canCancel,
                events: {
                  click: cancelPairing,
                },
                type: 'button',
              },
              ['Cancel'],
            ),
          ]),
        ]),
        createPairingPanel(),
      ]),
      el('section', { className: 'panel' }, [
        el('div', { className: 'section-header' }, [
          el('h2', {}, ['Sign In']),
          el('span', { className: state.signInStatus === 'signed' ? 'chip success' : 'chip' }, [state.signInStatus]),
        ]),
        el('p', { className: 'muted' }, ['Request a Solana sign-in signature from the connected remote wallet.']),
        el(
          'button',
          {
            dataset: { testid: 'sign-in' },
            disabled: !hasConnectedAccount || isSignInSigning,
            events: {
              click: () => {
                void signIn()
              },
            },
            type: 'button',
          },
          [isSignInSigning ? 'Signing...' : 'Sign in'],
        ),
        el('span', { className: 'transaction-status', dataset: { testid: 'sign-in-status' } }, [state.signInStatus]),
        state.signInAddress ? el('code', { dataset: { testid: 'sign-in-address' } }, [state.signInAddress]) : null,
      ]),
      el('section', { className: 'panel' }, [
        el('div', { className: 'section-header' }, [
          el('h2', {}, ['Sign Message']),
          el('span', { className: state.messageStatus === 'signed' ? 'chip success' : 'chip' }, [state.messageStatus]),
        ]),
        el('p', { className: 'muted' }, ['Ask the connected remote wallet to sign a short test message.']),
        el(
          'button',
          {
            dataset: { testid: 'sign-message' },
            disabled: !hasConnectedAccount || isMessageSigning,
            events: {
              click: () => {
                void signMessage()
              },
            },
            type: 'button',
          },
          [isMessageSigning ? 'Signing...' : 'Sign message'],
        ),
        el('span', { className: 'transaction-status', dataset: { testid: 'sign-message-status' } }, [
          state.messageStatus,
        ]),
        state.messageSignature
          ? el('code', { dataset: { testid: 'sign-message-signature' } }, [state.messageSignature])
          : null,
      ]),
      el('section', { className: 'panel' }, [
        el('div', { className: 'section-header' }, [
          el('h2', {}, ['Sign Transaction']),
          el('span', { className: state.signTransactionStatus === 'signed' ? 'chip success' : 'chip' }, [
            state.signTransactionStatus,
          ]),
        ]),
        el('p', { className: 'muted' }, ['Sign a memo transaction without submitting it to the cluster.']),
        el(
          'button',
          {
            dataset: { testid: 'sign-transaction' },
            disabled: !hasConnectedAccount || isSignTransactionSigning,
            events: {
              click: () => {
                void signTransaction()
              },
            },
            type: 'button',
          },
          [isSignTransactionSigning ? 'Signing...' : 'Sign transaction'],
        ),
        el('span', { className: 'transaction-status', dataset: { testid: 'sign-transaction-status' } }, [
          state.signTransactionStatus,
        ]),
        state.signTransactionSignature
          ? el('code', { dataset: { testid: 'sign-transaction-signature' } }, [state.signTransactionSignature])
          : null,
      ]),
      el('section', { className: 'panel' }, [
        el('div', { className: 'section-header' }, [
          el('h2', {}, ['Transaction']),
          el('span', { className: state.transactionStatus === 'sent' ? 'chip success' : 'chip' }, [
            state.transactionStatus === 'sent' ? 'Sent' : hasConnectedAccount ? 'Ready' : 'Waiting for wallet',
          ]),
        ]),
        el('p', { className: 'muted' }, ['Submit a memo transaction through the connected remote session.']),
        el(
          'button',
          {
            dataset: { testid: 'send-transaction' },
            disabled: !hasConnectedAccount || isSendingTransaction,
            events: {
              click: () => {
                void sendTestTransaction()
              },
            },
            type: 'button',
          },
          [isSendingTransaction ? 'Sending...' : 'Send test transaction'],
        ),
        el('span', { className: 'transaction-status', dataset: { testid: 'transaction-status' } }, [
          state.transactionStatus,
        ]),
        state.transactionSignature
          ? el('code', { dataset: { testid: 'transaction-signature' } }, [state.transactionSignature])
          : null,
      ]),
      state.error ? el('pre', { className: 'error', dataset: { testid: 'error-message' } }, [state.error]) : null,
    ]),
  )
}

function cancelPairing() {
  state.error = undefined
  state.messageSignature = undefined
  state.messageStatus = 'idle'
  state.pairingSession?.cancel()
  state.pairingSession = undefined
  state.signInAddress = undefined
  state.signInStatus = 'idle'
  state.signTransactionSignature = undefined
  state.signTransactionStatus = 'idle'
  state.status = 'idle'
  state.transactionSignature = undefined
  state.transactionStatus = 'idle'
  void wallet.features[STANDARD_DISCONNECT].disconnect()
  render()
}

function createPairingPanel() {
  if (!state.pairingSession) {
    return el('p', { className: 'muted', dataset: { testid: 'pairing-empty' } }, [
      'Start pairing to produce a remote wallet URL.',
    ])
  }

  return el('div', { className: 'pairing-grid' }, [
    createReadonlyGrid([
      ['Pairing URL', state.pairingSession.pairingUrl, 'pairing-url'],
      ['Relay domain', state.pairingSession.relayDomain, 'pairing-relay-domain'],
      ['Expires at', state.pairingSession.expiresAt, 'pairing-expires-at'],
    ]),
    el('textarea', {
      dataset: { testid: 'pairing-url-textarea' },
      readOnly: true,
      value: state.pairingSession.pairingUrl,
    }),
  ])
}

function createReadonlyGrid(rows: readonly (readonly [string, string, string])[]) {
  return el(
    'dl',
    { className: 'details' },
    rows.flatMap(([label, value, testId]) => [
      el('dt', {}, [label]),
      el('dd', { dataset: { testid: testId } }, [value]),
    ]),
  )
}

function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  options: {
    className?: string
    dataset?: Record<string, string>
    disabled?: boolean
    events?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>
    readOnly?: boolean
    type?: string
    value?: string
  } = {},
  children: readonly (HTMLElement | null | string)[] = [],
) {
  const node = document.createElement(tagName)

  if (options.className) {
    node.className = options.className
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      node.dataset[key] = value
    }
  }
  if (options.disabled !== undefined && 'disabled' in node) {
    node.disabled = options.disabled
  }
  if (options.events) {
    for (const [eventName, listener] of Object.entries(options.events)) {
      node.addEventListener(eventName, listener)
    }
  }
  if (options.readOnly !== undefined && 'readOnly' in node) {
    node.readOnly = options.readOnly
  }
  if (options.type !== undefined && 'type' in node) {
    node.setAttribute('type', options.type)
  }
  if (options.value !== undefined && 'value' in node) {
    node.value = options.value
  }

  for (const child of children) {
    if (child) {
      node.append(child)
    }
  }

  return node
}

async function startPairing() {
  state.error = undefined
  state.messageSignature = undefined
  state.messageStatus = 'idle'
  state.signInAddress = undefined
  state.signInStatus = 'idle'
  state.signTransactionSignature = undefined
  state.signTransactionStatus = 'idle'
  state.status = 'waiting-for-wallet'
  state.transactionSignature = undefined
  state.transactionStatus = 'idle'
  render()

  try {
    await wallet.features[STANDARD_CONNECT].connect()
    state.status = 'connected'
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    state.status = 'idle'
    render()
  }
}

async function getLatestBlockhash() {
  const response = await postRpc<{
    value: {
      blockhash: string
      lastValidBlockHeight: number
    }
  }>('getLatestBlockhash', [{ commitment: 'processed' }])

  return {
    blockhash: response.value.blockhash as Blockhash,
    lastValidBlockHeight: BigInt(response.value.lastValidBlockHeight),
  }
}

async function createMemoTransactionBytes(accountAddress: string, memo: string) {
  const latestBlockhash = await getLatestBlockhash()
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(address(accountAddress), message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message),
    (message) =>
      appendTransactionMessageInstruction(
        {
          data: new TextEncoder().encode(memo),
          programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        },
        message,
      ),
  )
  const transaction = compileTransaction(transactionMessage)

  return new Uint8Array(getTransactionCodec().encode(transaction))
}

async function postRpc<TResult>(method: string, params: unknown[] = []) {
  const response = await fetch(config.rpcUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method,
      params,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`RPC ${config.rpcUrl} returned HTTP ${response.status}`)
  }

  const body = (await response.json()) as {
    error?: { message?: string }
    result?: TResult
  }

  if (body.result === undefined) {
    throw new Error(body.error?.message ?? `RPC ${config.rpcUrl} did not return a result for ${method}`)
  }

  return body.result
}

async function signIn() {
  if (!wallet.accounts[0]) {
    return
  }

  state.error = undefined
  state.signInAddress = undefined
  state.signInStatus = 'signing'
  render()

  try {
    const [output] = await wallet.features[SOLANA_SIGN_IN].signIn({
      domain: window.location.host,
      statement: 'Sign in to Remote Wallet Test Dapp',
      uri: window.location.origin,
    })

    if (!output) {
      throw new Error('Remote Wallet did not return a sign-in result')
    }

    state.signInAddress = output.account.address
    state.signInStatus = 'signed'
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    state.signInStatus = 'idle'
    render()
  }
}

async function signMessage() {
  const account = wallet.accounts[0]

  if (!account) {
    return
  }

  state.error = undefined
  state.messageSignature = undefined
  state.messageStatus = 'signing'
  render()

  try {
    const [output] = await wallet.features[SOLANA_SIGN_MESSAGE].signMessage({
      account,
      message: new TextEncoder().encode('Remote Wallet Test Dapp message'),
    })

    if (!output) {
      throw new Error('Remote Wallet did not return a message signature')
    }

    state.messageSignature = getBase58Decoder().decode(output.signature)
    state.messageStatus = 'signed'
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    state.messageStatus = 'idle'
    render()
  }
}

async function signTransaction() {
  const account = wallet.accounts[0]

  if (!account) {
    return
  }

  state.error = undefined
  state.signTransactionSignature = undefined
  state.signTransactionStatus = 'signing'
  render()

  try {
    const transactionBytes = await createMemoTransactionBytes(account.address, `remote-wallet-sign:${Date.now()}`)
    const [output] = await wallet.features[SOLANA_SIGN_TRANSACTION].signTransaction({
      account,
      transaction: transactionBytes,
    })

    if (!output) {
      throw new Error('Remote Wallet did not return a signed transaction')
    }

    const signedTransaction = getTransactionCodec().decode(output.signedTransaction)
    const signature = signedTransaction.signatures[address(account.address)]

    if (!signature) {
      throw new Error('Remote Wallet did not sign the transaction for the connected account')
    }

    state.signTransactionSignature = getBase58Decoder().decode(signature)
    state.signTransactionStatus = 'signed'
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    state.signTransactionStatus = 'idle'
    render()
  }
}

async function sendTestTransaction() {
  const account = wallet.accounts[0]

  if (!account) {
    return
  }

  state.error = undefined
  state.transactionSignature = undefined
  state.transactionStatus = 'sending'
  render()

  try {
    const transactionBytes = await createMemoTransactionBytes(account.address, `remote-wallet:${Date.now()}`)
    const [output] = await wallet.features[SOLANA_SIGN_AND_SEND_TRANSACTION].signAndSendTransaction({
      account,
      options: {
        commitment: 'confirmed',
      },
      transaction: transactionBytes,
    })

    if (!output) {
      throw new Error('Remote Wallet did not return a transaction signature')
    }

    state.transactionSignature = getBase58Decoder().decode(output.signature)
    state.transactionStatus = 'sent'
    render()
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error)
    state.transactionStatus = 'idle'
    render()
  }
}

function installWalletStandardAppRegistry(wallets: RemoteWalletStandardWallet[]) {
  const register = (...nextWallets: readonly RemoteWalletStandardWallet[]) => {
    for (const nextWallet of nextWallets) {
      if (!wallets.some((wallet) => wallet.name === nextWallet.name)) {
        wallets.push(nextWallet)
      }
    }
  }

  window.addEventListener('wallet-standard:register-wallet', (event) => {
    const registerWallet = (event as CustomEvent<(api: { register: typeof register }) => void>).detail

    registerWallet({ register })
  })
  window.dispatchEvent(
    new CustomEvent('wallet-standard:app-ready', {
      detail: { register },
    }),
  )
}

async function loadConfig(): Promise<RemoteWalletTestDappConfig> {
  try {
    const response = await fetch('/config.json')

    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status}`)
    }

    return (await response.json()) as RemoteWalletTestDappConfig
  } catch {
    return {
      chain: 'solana:localnet',
      relayUrl: 'ws://127.0.0.1:8080',
      rpcUrl: 'http://127.0.0.1:8899',
    }
  }
}

function syncPairingState() {
  const session = provider.getSnapshot().session

  state.pairingSession = session
  state.status = session?.status ?? (wallet.accounts.length ? 'connected' : 'idle')
  render()
}
