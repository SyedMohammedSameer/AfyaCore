/**
 * Client-generated identifiers.
 *
 * IDs must be assigned offline and never collide when many facilities sync into
 * one server, so they are random UUIDs rather than server-issued sequences.
 * `crypto.randomUUID` needs a secure context, which a PWA always has, but the
 * fallback keeps `vite dev` over a LAN IP working.
 */
export function newId(): string {
  // `randomUUID` is typed as always present but is absent outside secure
  // contexts at runtime, so the guard is deliberately structural.
  const c: Crypto | undefined = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  const bytes = new Uint8Array(16)
  c!.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Short, human-speakable code shown on printed slips so staff can find a record. */
export function shortCode(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}
