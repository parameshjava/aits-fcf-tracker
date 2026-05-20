export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

export type IfscDetails = {
  ifsc: string
  bank: string
  branch: string
  city: string
  state: string
  address: string
}

export type IfscLookupError = 'invalid' | 'not_found' | 'network'

export type IfscLookupResult =
  | { ok: true; details: IfscDetails }
  | { ok: false; error: IfscLookupError }

export async function lookupIfsc(
  code: string,
  signal?: AbortSignal,
): Promise<IfscLookupResult> {
  const normalized = code.trim().toUpperCase()
  if (!IFSC_REGEX.test(normalized)) {
    return { ok: false, error: 'invalid' }
  }
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${normalized}`, { signal })
    if (res.status === 404) return { ok: false, error: 'not_found' }
    if (!res.ok) return { ok: false, error: 'network' }
    const data = await res.json()
    return {
      ok: true,
      details: {
        ifsc: String(data.IFSC ?? normalized),
        bank: String(data.BANK ?? ''),
        branch: String(data.BRANCH ?? ''),
        city: String(data.CITY ?? ''),
        state: String(data.STATE ?? ''),
        address: String(data.ADDRESS ?? ''),
      },
    }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') {
      return { ok: false, error: 'network' }
    }
    return { ok: false, error: 'network' }
  }
}
