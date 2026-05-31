import { AbstractStartedContainer, GenericContainer, Wait } from 'testcontainers'

const DEFAULT_IMAGE = 'scsibug/nostr-rs-relay:0.9.0'
const NOSTR_RELAY_PORT = 8080

export class NostrRelayContainer extends GenericContainer {
  constructor(image = DEFAULT_IMAGE) {
    super(image)
    this.withExposedPorts(NOSTR_RELAY_PORT).withStartupTimeout(60_000).withWaitStrategy(Wait.forListeningPorts())
  }

  override async start(): Promise<StartedNostrRelayContainer> {
    return new StartedNostrRelayContainer(await super.start())
  }
}

export class StartedNostrRelayContainer extends AbstractStartedContainer {
  get port(): number {
    return this.getMappedPort(NOSTR_RELAY_PORT)
  }

  get url(): string {
    return `ws://${this.getHost()}:${this.port}`
  }
}
