export function formatJsonEvent(event: string, payload: Record<string, unknown> = {}) {
  return `${JSON.stringify(Object.assign({ event }, payload, { event }))}\n`
}

export function writeJsonEvent(event: string, payload: Record<string, unknown> = {}) {
  process.stdout.write(formatJsonEvent(event, payload))
}
