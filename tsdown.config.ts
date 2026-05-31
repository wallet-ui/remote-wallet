import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    'bin/remote-wallet': 'src/bin/remote-wallet.ts',
    'browser/index': 'src/browser/index.ts',
    index: 'src/index.ts',
    'node/index': 'src/node/index.ts',
    'protocol/index': 'src/protocol/index.ts',
    'react/index': 'src/react/index.ts',
  },
  format: ['esm'],
  sourcemap: true,
})
