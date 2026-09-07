/**
 * A reader for the subset of R's serialization format the WHO tables use.
 *
 * The WHO Child Growth Standards are distributed by WHO's own R package, and
 * its reference tables live in an `.rda` — bzip2 around R's XDR serialization.
 * There is no plain-text release of the same numbers from a source with the
 * same provenance, and typing LMS coefficients out by hand is precisely the
 * thing that must not happen to a table a clinician will read a diagnosis off.
 * So the format gets a reader.
 *
 * Enough of it to walk a pairlist of data frames of doubles and strings.
 * Anything outside that throws by name rather than returning something
 * plausible, because a silent misparse here is numbers that look like a growth
 * standard and are not.
 */
export function readRds(buffer) {
  let at = 0
  const refs = []

  const int = () => {
    const v = buffer.readInt32BE(at)
    at += 4
    return v
  }
  const double = () => {
    const v = buffer.readDoubleBE(at)
    at += 8
    return v
  }

  // Header: "RDX2\n" "X\n" then three version ints.
  const magic = buffer.slice(0, 2).toString('latin1')
  if (magic === 'RD') at = buffer.indexOf('X\n') + 2
  const format = int()
  if (format !== 2 && format !== 3) throw new Error(`unsupported serialization version ${format}`)
  int() // writer version
  int() // minimum reader version
  if (format === 3) {
    const len = int()
    at += len // native encoding name
  }

  function readItem() {
    const flags = int()
    const type = flags & 0xff
    const hasAttr = (flags & (1 << 9)) !== 0
    const hasTag = (flags & (1 << 10)) !== 0

    switch (type) {
      case 254: // NILVALUE
        return null
      case 255: {
        // REFSXP: index packed into the flags, or a following int.
        const index = flags >> 8
        return refs[(index === 0 ? int() : index) - 1]
      }
      case 1: {
        // SYMSXP: a CHARSXP that gets a reference slot.
        const name = readItem()
        refs.push(name)
        return name
      }
      case 9: {
        // CHARSXP
        const len = int()
        if (len === -1) return null
        const s = buffer.slice(at, at + len).toString('utf8')
        at += len
        return s
      }
      case 13: {
        // INTSXP
        const n = int()
        const out = new Array(n)
        for (let i = 0; i < n; i++) out[i] = int()
        return withAttrs(out, hasAttr)
      }
      case 10: {
        // LGLSXP
        const n = int()
        const out = new Array(n)
        for (let i = 0; i < n; i++) out[i] = int()
        return withAttrs(out, hasAttr)
      }
      case 14: {
        // REALSXP
        const n = int()
        const out = new Array(n)
        for (let i = 0; i < n; i++) out[i] = double()
        return withAttrs(out, hasAttr)
      }
      case 16: {
        // STRSXP
        const n = int()
        const out = new Array(n)
        for (let i = 0; i < n; i++) out[i] = readItem()
        return withAttrs(out, hasAttr)
      }
      case 19: {
        // VECSXP: a generic list, which is what a data.frame is.
        const n = int()
        const out = new Array(n)
        for (let i = 0; i < n; i++) out[i] = readItem()
        return withAttrs(out, hasAttr)
      }
      case 2: {
        // LISTSXP: a pairlist, used for attributes.
        const tag = hasTag ? readItem() : null
        const value = readItem()
        const rest = readItem()
        return { pairlist: true, tag, value, rest }
      }
      default:
        throw new Error(`unhandled R type ${type} at byte ${at}`)
    }
  }

  /** Attach attributes (names, class, row.names) to a vector. */
  function withAttrs(value, hasAttr) {
    if (!hasAttr) return value
    const attrs = {}
    let node = readItem()
    while (node && node.pairlist) {
      if (node.tag) attrs[node.tag] = node.value
      node = node.rest
    }
    Object.defineProperty(value, '__attrs', { value: attrs, enumerable: false })
    return value
  }

  return readItem()
}

/** Turn a parsed VECSXP with a `names` attribute into a plain object. */
export function named(value) {
  const names = value?.__attrs?.names
  if (!names) return value
  const out = {}
  names.forEach((name, i) => {
    out[name] = value[i]
  })
  return out
}
