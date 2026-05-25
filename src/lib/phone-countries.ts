/**
 * Shared country / dial-code data for the phone input *and* read-side chip.
 *
 * We store phones in `public.member_contacts.value` as a flat string like
 * "+91 9845584288" — no separate ISO country column — so the display layer
 * has to recover the country from the stored string. For most dial codes
 * the prefix is unambiguous; +1 is shared by US and Canada so we
 * disambiguate using the 3-digit area code via {@link CA_AREA_CODES}.
 */

export type Country = {
  code: string  // ISO 3166-1 alpha-2
  dial: string  // e.g. "+91"
  flag: string  // unicode flag emoji
  name: string
}

/** Order matters for the input dropdown but not for the lookup helper —
 *  `getCountryForPhone` sorts by dial-length internally. */
export const COUNTRIES: Country[] = [
  { code: 'IN', dial: '+91',  flag: '🇮🇳', name: 'India' },
  { code: 'US', dial: '+1',   flag: '🇺🇸', name: 'United States' },
  { code: 'GB', dial: '+44',  flag: '🇬🇧', name: 'United Kingdom' },
  { code: 'AE', dial: '+971', flag: '🇦🇪', name: 'United Arab Emirates' },
  { code: 'SG', dial: '+65',  flag: '🇸🇬', name: 'Singapore' },
  { code: 'AU', dial: '+61',  flag: '🇦🇺', name: 'Australia' },
  { code: 'CA', dial: '+1',   flag: '🇨🇦', name: 'Canada' },
  { code: 'DE', dial: '+49',  flag: '🇩🇪', name: 'Germany' },
]

/**
 * Canadian NANP area codes (overlay + non-overlay), used to split +1
 * numbers between US (🇺🇸) and CA (🇨🇦). Source: list of NANP area codes,
 * Canada subset. Update when a Canadian member with a new area code joins.
 */
const CA_AREA_CODES = new Set<string>([
  '204', '226', '236', '249', '250', '263', '289', '306', '343', '354',
  '365', '367', '368', '403', '416', '418', '428', '431', '437', '438',
  '450', '468', '474', '506', '514', '519', '548', '579', '581', '584',
  '587', '604', '613', '639', '647', '672', '683', '705', '709', '742',
  '753', '778', '780', '782', '807', '819', '825', '867', '873', '879',
  '902', '905',
])

/**
 * Look up the country for a stored phone string. Tries the longest matching
 * dial-code prefix first (so "+971" beats "+9") and disambiguates +1
 * numbers via the area code.
 *
 *   getCountryForPhone("+91 9845584288") → IN
 *   getCountryForPhone("+1 2484801790")  → US (Michigan area code)
 *   getCountryForPhone("+1 4379914275")  → CA (Toronto area code)
 *   getCountryForPhone("9999")           → null (no '+' prefix)
 */
export function getCountryForPhone(value: string | null | undefined): Country | null {
  if (!value) return null
  const v = value.trim()
  if (!v.startsWith('+')) return null

  const byDialLengthDesc = [...COUNTRIES].sort(
    (a, b) => b.dial.length - a.dial.length,
  )

  for (const c of byDialLengthDesc) {
    if (!v.startsWith(c.dial)) continue

    if (c.dial === '+1') {
      const digits = v.slice(c.dial.length).replace(/\D/g, '')
      const areaCode = digits.slice(0, 3)
      if (CA_AREA_CODES.has(areaCode)) {
        return COUNTRIES.find((x) => x.code === 'CA') ?? c
      }
      return COUNTRIES.find((x) => x.code === 'US') ?? c
    }

    return c
  }
  return null
}
