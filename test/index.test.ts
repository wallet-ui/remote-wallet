import { expect, test } from 'bun:test'
import { greet } from '../src/index.ts'

test('greet function returns correct greeting', () => {
  expect(greet('Alice')).toBe('Hello, Alice from remote-wallet!')
})

test('greet function defaults to World if no name is provided', () => {
  expect(greet()).toBe('Hello, World from remote-wallet!')
})
