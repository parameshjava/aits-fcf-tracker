// Indian-English (Lakh / Crore) number-to-words conversion. Used by the
// shared <AmountInput> helper text so admins can sanity-check long rupee
// figures while typing.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
]

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`
}

function threeDigitWords(n: number): string {
  if (n < 100) return twoDigitWords(n)
  const h = Math.floor(n / 100)
  const rest = n % 100
  return rest === 0 ? `${ONES[h]} Hundred` : `${ONES[h]} Hundred ${twoDigitWords(rest)}`
}

function integerWordsIndian(n: number): string {
  if (n === 0) return ''
  const crore = Math.floor(n / 10_000_000)
  const afterCrore = n % 10_000_000
  const lakh = Math.floor(afterCrore / 100_000)
  const afterLakh = afterCrore % 100_000
  const thousand = Math.floor(afterLakh / 1_000)
  const afterThousand = afterLakh % 1_000

  const parts: string[] = []
  if (crore > 0) parts.push(`${integerWordsIndian(crore)} Crore`)
  if (lakh > 0) parts.push(`${twoDigitWords(lakh)} Lakh`)
  if (thousand > 0) parts.push(`${twoDigitWords(thousand)} Thousand`)
  if (afterThousand > 0) parts.push(threeDigitWords(afterThousand))
  return parts.join(' ')
}

/**
 * Convert a rupee amount to Indian-English words.
 *   100000   → "One Lakh Rupees Only"
 *   125075.5 → "One Lakh Twenty Five Thousand Seventy Five Rupees and Fifty Paise Only"
 *   0        → "Zero Rupees Only"
 *
 * Non-finite / NaN inputs return an empty string (so callers can use it as
 * a live helper that simply disappears while the input is empty/invalid).
 */
export function numberToIndianWords(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return ''
  const value = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(value)) return ''
  if (value === 0) return 'Zero Rupees Only'

  const negative = value < 0
  const abs = Math.abs(value)
  const rupees = Math.floor(abs)
  const paise = Math.round((abs - rupees) * 100)

  const rupeeWords = rupees > 0 ? integerWordsIndian(rupees) : ''
  const paiseWords = paise > 0 ? twoDigitWords(paise) : ''

  let result: string
  if (rupeeWords && paiseWords) {
    result = `${rupeeWords} Rupees and ${paiseWords} Paise Only`
  } else if (rupeeWords) {
    result = `${rupeeWords} Rupees Only`
  } else {
    result = `${paiseWords} Paise Only`
  }

  return negative ? `Minus ${result}` : result
}
