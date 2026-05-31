import { connectRemoteWallet, createRemoteWalletSigner } from '../node/index.ts'
import { bytesToBase64, parseNostrAssociationUrl } from '../protocol/index.ts'
import { parseCliArgs } from './config.ts'
import { writeJsonEvent } from './output.ts'

export async function runRemoteWalletCli(args: string[]) {
  const config = parseCliArgs(args)
  const pairing = parseNostrAssociationUrl(config.pairingUrl)
  const signer = createRemoteWalletSigner({
    chain: config.chain,
    label: config.label,
    rpcUrl: config.rpcUrl,
    secretKey: config.secretKey,
  })

  writeJsonEvent('wallet-ready', {
    address: signer.account.address,
    label: signer.account.label,
    publicKeyBase64: signer.publicKeyBase64,
    ...(config.printSecret ? { secretKeyBase64: bytesToBase64(signer.secretKey) } : null),
  })

  await connectRemoteWallet({
    pairing,
    signer,
    timeoutMs: config.timeoutMs,
    writeEvent: writeJsonEvent,
  })
}
