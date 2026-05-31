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

      const firstHook = react.render(() => useRemoteWalletPairing())
      const firstSession = await firstHook.startPairing()
      const firstCancel = mock(() => {})
      firstSession.cancel = firstCancel

      const secondHook = react.render(() => useRemoteWalletPairing())
      const secondSession = await secondHook.startPairing()
      const secondCancel = mock(() => {})
      secondSession.cancel = secondCancel

      expect(firstCancel).toHaveBeenCalledTimes(1)

      react.render(() => useRemoteWalletPairing())
      react.unmount()

      expect(secondCancel).toHaveBeenCalledTimes(1)
    } finally {
      mock.restore()
    }
  })
})

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
