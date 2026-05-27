// Mulberry32 — tiny, well-known seedable PRNG with good distribution for
// shuffling tasks. Not cryptographic, but we don't need that here.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic Fisher–Yates shuffle. The same `seed` always yields the same
 * output ordering for the same input. Does not mutate `input`.
 */
export function seededShuffle<T>(input: readonly T[], seed: number): T[] {
  const out = input.slice()
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
