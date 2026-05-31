# Remote Wallet Test Dapp

Minimal browser fixture for remote-wallet e2e tests.

The app intentionally starts fresh instead of copying the POC app. It keeps the e2e surface small: one Remote Wallet adapter, one pairing URL, and stable DOM hooks for Playwright.

Run it directly with Bun:

```sh
bun test/e2e/fixtures/remote-wallet-test-dapp/server.ts
```

Useful environment variables:

- `REMOTE_WALLET_TEST_CHAIN`: Solana chain id used when creating the pairing session.
- `REMOTE_WALLET_TEST_PORT`: HTTP port for the fixture app.
- `REMOTE_WALLET_TEST_RELAY_URL`: Nostr relay URL for remote wallet pairing.
- `REMOTE_WALLET_TEST_RPC_URL`: Solana RPC URL displayed for the transaction fixture wiring.
