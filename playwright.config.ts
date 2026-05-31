import { defineConfig } from '@playwright/test'

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  testDir: './test/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 180_000,
  use: {
    trace: 'retain-on-failure',
  },
  workers: 1,
})
