#!/usr/bin/env bun

import { runRemoteWalletCli } from '../cli/index.ts'

try {
  await runRemoteWalletCli(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
