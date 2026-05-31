import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import type { Readable } from 'node:stream'
import { SolanaTestValidatorContainer, type StartedSolanaTestValidatorContainer } from '@beeman/testcontainers'
import { expect, test } from '@playwright/test'
import { NostrRelayContainer, type StartedNostrRelayContainer } from './support/nostr-relay-container.ts'

const AIRDROP_LAMPORTS = 1_000_000_000
const CHAIN = 'solana:localnet'
const FIXTURE_APP_PATH = 'test/e2e/fixtures/remote-wallet-test-dapp/server.ts'
const SOLANA_TEST_VALIDATOR_IMAGE = 'beeman/solana-test-validator:4.0.0'

interface JsonEvent {
  event: string
  [key: string]: unknown
}

interface ManagedProcess {
  process: ChildProcessByStdio<null, Readable, Readable>
  stderr: string
  stdout: string
}

test.describe('remote wallet adapter transaction flow', () => {
  let appPort: number
  let appProcess: ManagedProcess | undefined
  let relay: StartedNostrRelayContainer | undefined
  let validator: StartedSolanaTestValidatorContainer | undefined
  let walletProcess: ManagedProcess | undefined

  test.beforeAll(async () => {
    validator = await new SolanaTestValidatorContainer(SOLANA_TEST_VALIDATOR_IMAGE).start()
    relay = await new NostrRelayContainer().start()
    appPort = await getAvailablePort()
    appProcess = spawnManagedProcess('bun', [FIXTURE_APP_PATH], {
      REMOTE_WALLET_TEST_CHAIN: CHAIN,
      REMOTE_WALLET_TEST_PORT: String(appPort),
      REMOTE_WALLET_TEST_RELAY_URL: relay.url,
      REMOTE_WALLET_TEST_RPC_URL: validator.url,
    })

    await waitForOutput(appProcess, /Remote Wallet Test Dapp listening/u, 30_000)
  })

  test.afterAll(async () => {
    await stopManagedProcess(walletProcess)
    await stopManagedProcess(appProcess)
    await relay?.stop()
    await validator?.stop()
  })

  test('pairs the CLI wallet, signs payloads, and submits a localnet transaction', async ({ page }) => {
    const startedRelay = assertDefined(relay, 'Nostr relay')
    const startedValidator = assertDefined(validator, 'Solana test validator')

    const appUrl = `http://127.0.0.1:${appPort}`

    await page.goto(appUrl)
    await expect(page.getByTestId('configured-chain')).toHaveText(CHAIN)
    await expect(page.getByTestId('adapter-features')).toContainText('solana:signAndSendTransaction')
    await expect(page.getByTestId('configured-relay')).toHaveText(startedRelay.url)
    await expect(page.getByTestId('configured-rpc')).toHaveText(startedValidator.url)
    await expect(page.getByTestId('registered-wallets')).toHaveText('Remote Wallet')

    await page.getByTestId('start-pairing').click()
    await expect(page.getByTestId('pairing-url')).toContainText('solana-wallet:/v1/associate/remote/nostr')

    const pairingUrl = await page.getByTestId('pairing-url').textContent()

    if (!pairingUrl) {
      throw new Error('Expected the fixture app to render a pairing URL')
    }

    walletProcess = spawnManagedProcess('bun', [
      'src/bin/remote-wallet.ts',
      '--url',
      pairingUrl,
      '--chain',
      CHAIN,
      '--rpc-url',
      startedValidator.url,
      '--timeout',
      '120000',
    ])

    const walletReadyEvent = await waitForJsonEvent(walletProcess, 'wallet-ready', 30_000)
    const walletAddress = getStringField(walletReadyEvent, 'address')

    await requestAirdrop(startedValidator.url, walletAddress, AIRDROP_LAMPORTS)
    await expect(page.getByTestId('pairing-status')).toHaveText('connected', { timeout: 60_000 })
    await expect(page.getByTestId('connected-wallet-address')).toHaveText(walletAddress)
    await expect(page.getByTestId('connected-wallet-label')).toHaveText('Agent Remote Wallet')

    await page.getByTestId('sign-in').click()
    await expect(page.getByTestId('sign-in-status')).toHaveText('signed', { timeout: 60_000 })
    await expect(page.getByTestId('sign-in-address')).toHaveText(walletAddress)

    await page.getByTestId('sign-message').click()
    await expect(page.getByTestId('sign-message-status')).toHaveText('signed', { timeout: 60_000 })

    const messageSignature = await page.getByTestId('sign-message-signature').textContent()

    if (!messageSignature) {
      throw new Error('Expected the fixture app to render a message signature')
    }

    await page.getByTestId('sign-transaction').click()
    await expect(page.getByTestId('sign-transaction-status')).toHaveText('signed', { timeout: 60_000 })

    const signedTransactionSignature = await page.getByTestId('sign-transaction-signature').textContent()

    if (!signedTransactionSignature) {
      throw new Error('Expected the fixture app to render a signed transaction signature')
    }

    await page.getByTestId('send-transaction').click()
    await expect(page.getByTestId('transaction-status')).toHaveText('sent', { timeout: 60_000 })

    const signature = await page.getByTestId('transaction-signature').textContent()

    if (!signature) {
      throw new Error('Expected the fixture app to render a transaction signature')
    }

    await waitForSignature(startedValidator.url, signature)
  })
})

function assertDefined<TValue>(value: TValue | undefined, label: string) {
  if (!value) {
    throw new Error(`${label} was not started`)
  }

  return value
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function getAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate an available port'))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

function getProcessLog(process: ManagedProcess) {
  return [process.stdout, process.stderr].filter(Boolean).join('\n')
}

function getStringField(event: JsonEvent, key: string) {
  const value = event[key]

  if (typeof value !== 'string') {
    throw new Error(`Expected ${event.event} event field ${key} to be a string`)
  }

  return value
}

async function postRpc<TResult>(rpcUrl: string, method: string, params: unknown[] = []) {
  const response = await fetch(rpcUrl, {
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
    throw new Error(`RPC ${rpcUrl} returned HTTP ${response.status}`)
  }

  const body = (await response.json()) as {
    error?: { message?: string }
    result?: TResult
  }

  if (body.result === undefined) {
    throw new Error(body.error?.message ?? `RPC ${rpcUrl} did not return a result for ${method}`)
  }

  return body.result
}

async function requestAirdrop(rpcUrl: string, address: string, lamports: number) {
  await postRpc<string>(rpcUrl, 'requestAirdrop', [address, lamports])
  await waitForBalance(rpcUrl, address, lamports)
}

function spawnManagedProcess(command: string, args: string[], env: Record<string, string> = {}): ManagedProcess {
  const childProcess = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const managedProcess: ManagedProcess = {
    process: childProcess,
    stderr: '',
    stdout: '',
  }

  childProcess.stderr.setEncoding('utf8')
  childProcess.stderr.on('data', (chunk: string) => {
    managedProcess.stderr += chunk
  })
  childProcess.stdout.setEncoding('utf8')
  childProcess.stdout.on('data', (chunk: string) => {
    managedProcess.stdout += chunk
  })

  return managedProcess
}

async function stopManagedProcess(managedProcess: ManagedProcess | undefined) {
  if (!managedProcess || managedProcess.process.killed) {
    return
  }

  managedProcess.process.kill()
  await delay(250)
}

async function waitForBalance(rpcUrl: string, address: string, lamports: number) {
  const expiresAt = Date.now() + 30_000

  while (Date.now() < expiresAt) {
    const balance = await postRpc<{ value: number }>(rpcUrl, 'getBalance', [address, { commitment: 'confirmed' }])

    if (balance.value >= lamports) {
      return
    }

    await delay(500)
  }

  throw new Error(`Timed out waiting for ${address} to receive ${lamports} lamports`)
}

async function waitForJsonEvent(process: ManagedProcess, eventName: string, timeoutMs: number) {
  return new Promise<JsonEvent>((resolve, reject) => {
    let buffer = ''
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      process.process.off('exit', handleExit)
      process.process.stdout.off('data', handleData)
    }
    const handleData = (chunk: string) => {
      buffer += chunk

      while (buffer.includes('\n')) {
        const newlineIndex = buffer.indexOf('\n')
        const line = buffer.slice(0, newlineIndex).trim()

        buffer = buffer.slice(newlineIndex + 1)

        if (!line) {
          continue
        }

        try {
          const event = JSON.parse(line) as JsonEvent

          if (event.event === eventName) {
            cleanup()
            resolve(event)
          }
        } catch {}
      }
    }
    const handleExit = (code: number | null) => {
      cleanup()
      reject(new Error(`Process exited before ${eventName}: ${code ?? 'signal'}\n${getProcessLog(process)}`))
    }

    timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${eventName}\n${getProcessLog(process)}`))
    }, timeoutMs)

    process.process.on('exit', handleExit)
    process.process.stdout.on('data', handleData)
  })
}

async function waitForOutput(process: ManagedProcess, pattern: RegExp, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      process.process.off('exit', handleExit)
      process.process.stderr.off('data', handleData)
      process.process.stdout.off('data', handleData)
    }
    const handleData = () => {
      if (pattern.test(getProcessLog(process))) {
        cleanup()
        resolve()
      }
    }
    const handleExit = (code: number | null) => {
      cleanup()
      reject(new Error(`Process exited before matching ${pattern}: ${code ?? 'signal'}\n${getProcessLog(process)}`))
    }

    timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${pattern}\n${getProcessLog(process)}`))
    }, timeoutMs)

    process.process.on('exit', handleExit)
    process.process.stderr.on('data', handleData)
    process.process.stdout.on('data', handleData)
    handleData()
  })
}

async function waitForSignature(rpcUrl: string, signature: string) {
  const expiresAt = Date.now() + 60_000

  while (Date.now() < expiresAt) {
    const statuses = await postRpc<{
      value: ({ confirmationStatus?: string; err: unknown } | null)[]
    }>(rpcUrl, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }])
    const status = statuses.value[0]

    if (status?.err) {
      throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`)
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return
    }

    await delay(500)
  }

  throw new Error(`Timed out waiting for transaction ${signature} to confirm`)
}
