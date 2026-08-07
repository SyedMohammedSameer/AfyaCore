/**
 * Deterministic patient avatar colours.
 *
 * A roster where every avatar is the same teal is unscannable, staff recognise
 * a returning patient by shape and colour long before they read the name. The
 * colour is derived from the name so it is stable across devices and needs no
 * storage.
 *
 * The palette is hand-picked rather than generated from a hash-to-hue, which
 * reliably produces muddy yellows and eye-searing magentas at some inputs.
 * Every pair here is legible in daylight and none of them read as a clinical
 * status colour, red, amber and green are reserved for triage.
 */
const PALETTE = [
  { bg: 'bg-teal-100', fg: 'text-teal-800' },
  { bg: 'bg-sky-100', fg: 'text-sky-800' },
  { bg: 'bg-indigo-100', fg: 'text-indigo-800' },
  { bg: 'bg-violet-100', fg: 'text-violet-800' },
  { bg: 'bg-fuchsia-100', fg: 'text-fuchsia-800' },
  { bg: 'bg-rose-100', fg: 'text-rose-800' },
  { bg: 'bg-cyan-100', fg: 'text-cyan-800' },
  { bg: 'bg-blue-100', fg: 'text-blue-800' },
]

function hash(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function avatarColour(seed: string): { bg: string; fg: string } {
  return PALETTE[hash(seed) % PALETTE.length]!
}

/** Up to two initials, tolerating a missing given name. */
export function initials(familyName: string, givenName = ''): string {
  const a = familyName.trim()[0] ?? ''
  const b = givenName.trim()[0] ?? ''
  return `${a}${b}`.toUpperCase() || '?'
}
