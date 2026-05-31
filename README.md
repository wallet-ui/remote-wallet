# remote-wallet

`remote-wallet` is an agent-friendly Solana wallet CLI and protocol toolkit. It lets a dapp expose a copyable remote wallet Pairing URL, then lets an agent connect from a terminal and sign on behalf of the configured wallet key.

## CLI

```bash
bunx remote-wallet "<pairing-url>"
```

Useful options:

```bash
remote-wallet --url "<pairing-url>" --label "Agent Remote Wallet"
remote-wallet --url "<pairing-url>" --rpc-url https://api.devnet.solana.com
remote-wallet --url "<pairing-url>" --secret-key "$REMOTE_WALLET_SECRET_KEY"
```

## Browser

```ts
import { createRemoteWalletSession } from 'remote-wallet/browser'
```

## Node

```ts
import { createRemoteWalletSigner } from 'remote-wallet/node'
```

## Protocol

```ts
import { parseNostrAssociationUrl } from 'remote-wallet/protocol'
```

## React

```tsx
import { RemoteWalletPairingPanel, useRemoteWalletPairing } from 'remote-wallet/react'
```

## Development

```bash
bun install
bun run build
bun run check-types
bun run lint
bun test
```

## License

MIT. See [LICENSE](./LICENSE).
