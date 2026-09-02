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
 *
 * Written as literal hex rather than Tailwind's default scales, because those
 * are tuned for a cool ground and go candy-bright against this app's paper
 * one: `bg-fuchsia-100` next to `#F7F5F0` looks like a sticker, not a record.
 * These are the same hues pulled down in saturation and warmed to sit on
 * paper.
 *
 * There are seven, not eight. The eighth slot kept wanting to be a rose or a
 * clay, and both of those are close enough to the triage red and amber to be
 * misread across a room, which is the one thing this palette must not do.
 */
const PALETTE = [
  { bg: 'bg-[#DCEBE3]', fg: 'text-[#1E5040]' }, // eucalyptus
  { bg: 'bg-[#D7E9EE]', fg: 'text-[#17505A]' }, // lagoon
  { bg: 'bg-[#DBE5F1]', fg: 'text-[#24486C]' }, // denim
  { bg: 'bg-[#E0E1F3]', fg: 'text-[#343A72]' }, // periwinkle
  { bg: 'bg-[#E7E0F1]', fg: 'text-[#453268]' }, // iris
  { bg: 'bg-[#EFDFEA]', fg: 'text-[#5E2B4E]' }, // plum
  { bg: 'bg-[#E5E3DE]', fg: 'text-[#4B4741]' }, // stone
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
