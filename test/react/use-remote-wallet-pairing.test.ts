import { describe, expect, mock, test } from 'bun:test'
import { REMOTE_WALLET_PAIRING_DEFAULT_RELAY } from '../../src/react/index.ts'

describe('React pairing helpers', () => {
  test('exports the default relay constant', () => {
    expect(REMOTE_WALLET_PAIRING_DEFAULT_RELAY).toBe('wss://relay.damus.io')
  })

  test('cancels replaced and unmounted pairing sessions', async () => {
    const react = createTestReactRuntime()

    mock.module('react', () => react.module)

    try {
      const { useRemoteWalletPairing } = await import(
        `../../src/react/use-remote-wallet-pairing.ts?test=${crypto.randomUUID()}`
      )

      await withMockWebSocket(async ({ sockets }) => {
        const firstHook = react.render(() => useRemoteWalletPairing('wss://relay.example.com'))
        const firstSessionPromise = firstHook.startPairing()
        const firstSocket = await waitForSocket(sockets, 0)

        resolveSubscription(firstSocket)

        const firstSession = await firstSessionPromise
        const firstCancel = mock(() => {})
        firstSession.cancel = firstCancel

        const secondHook = react.render(() => useRemoteWalletPairing('wss://relay.example.com'))
        const secondSessionPromise = secondHook.startPairing()
        const secondSocket = await waitForSocket(sockets, 1)

        resolveSubscription(secondSocket)

        const secondSession = await secondSessionPromise
        const secondCancel = mock(() => {})
        secondSession.cancel = secondCancel

        expect(firstCancel).toHaveBeenCalledTimes(1)

        react.render(() => useRemoteWalletPairing('wss://relay.example.com'))
        react.unmount()

        expect(secondCancel).toHaveBeenCalledTimes(1)
      })
    } finally {
      mock.restore()
    }
  })
})

class MockWebSocket extends EventTarget {
  static readonly CLOSED = 3
  static readonly CLOSING = 2
  static readonly CONNECTING = 0
  static readonly OPEN = 1

  readonly sentMessages: string[] = []
  readyState = MockWebSocket.CONNECTING

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  send(message: string) {
    this.sentMessages.push(message)
  }
}

type EffectCleanup = undefined | (() => void)
type StateUpdater<T> = T | ((previous: T) => T)

function createTestReactRuntime() {
  const effectCleanups: EffectCleanup[] = []
  const refValues: { current: unknown }[] = []
  const stateValues: unknown[] = []
  let effectIndex = 0
  let refIndex = 0
  let stateIndex = 0

  return {
    module: {
      useCallback<TCallback extends (...args: never[]) => unknown>(callback: TCallback) {
        return callback
      },
      useEffect(effect: () => EffectCleanup) {
        const index = effectIndex

        effectIndex += 1

        if (index in effectCleanups) {
          return
        }

        effectCleanups[index] = effect()
      },
      useRef<TValue>(initialValue: TValue) {
        const index = refIndex

        refIndex += 1

        if (!(index in refValues)) {
          refValues[index] = { current: initialValue }
        }

        return refValues[index] as { current: TValue }
      },
      useState<TValue>(initialValue: TValue): [TValue, (nextValue: StateUpdater<TValue>) => void] {
        const index = stateIndex

        stateIndex += 1

        if (!(index in stateValues)) {
          stateValues[index] = initialValue
        }

        return [
          stateValues[index] as TValue,
          (nextValue) => {
            const previous = stateValues[index] as TValue

            stateValues[index] =
              typeof nextValue === 'function' ? (nextValue as (value: TValue) => TValue)(previous) : nextValue
          },
        ]
      },
    },
    render<TResult>(callback: () => TResult) {
      effectIndex = 0
      refIndex = 0
      stateIndex = 0

      return callback()
    },
    unmount() {
      for (const cleanup of effectCleanups) {
        cleanup?.()
      }
    },
  }
}

function getSubscriptionRequest(socket: MockWebSocket) {
  return JSON.parse(socket.sentMessages[0] ?? '[]') as ['REQ', string, { '#d': string[]; kinds: number[] }]
}

function resolveSubscription(socket: MockWebSocket) {
  socket.open()

  const request = getSubscriptionRequest(socket)

  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(['EOSE', request[1]]) }))
}

async function waitForSocket(sockets: MockWebSocket[], index: number) {
  for (let attempts = 0; attempts < 20; attempts++) {
    const socket = sockets[index]

    if (socket) {
      return socket
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(`Expected pairing to open WebSocket ${index}`)
}

async function withMockWebSocket(testFn: (context: { sockets: MockWebSocket[] }) => Promise<void>) {
  const originalWebSocket = globalThis.WebSocket
  const sockets: MockWebSocket[] = []

  globalThis.WebSocket = class extends MockWebSocket {
    constructor() {
      super()
      sockets.push(this)
    }
  } as unknown as typeof WebSocket

  try {
    await testFn({ sockets })
  } finally {
    globalThis.WebSocket = originalWebSocket
  }
}
