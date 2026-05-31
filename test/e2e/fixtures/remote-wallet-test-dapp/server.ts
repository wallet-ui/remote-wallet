import index from './index.html'

const chain = Bun.env.REMOTE_WALLET_TEST_CHAIN ?? 'solana:localnet'
const port = Number(Bun.env.REMOTE_WALLET_TEST_PORT ?? 4173)
const relayUrl = Bun.env.REMOTE_WALLET_TEST_RELAY_URL ?? 'ws://127.0.0.1:8080'
const rpcUrl = Bun.env.REMOTE_WALLET_TEST_RPC_URL ?? 'http://127.0.0.1:8899'

const server = Bun.serve({
  development: {
    console: true,
    hmr: true,
  },
  port,
  routes: {
    '/': index,
    '/config.json': Response.json({ chain, relayUrl, rpcUrl }),
  },
})

console.log(`Remote Wallet Test Dapp listening on ${server.url}`)
