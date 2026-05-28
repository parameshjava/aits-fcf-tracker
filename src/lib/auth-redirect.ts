/**
 * Returns true if `next` is a safe internal redirect target.
 * Rejects protocol-relative URLs ("//evil.com"), absolute URLs,
 * javascript:/data: schemes, and anything not starting with a
 * single forward slash.
 */
export function isSafeNextPath(
  next: string | null | undefined,
): next is string {
  if (!next) return false
  if (!next.startsWith('/')) return false
  if (next.startsWith('//')) return false
  if (next.startsWith('/\\')) return false
  return true
}
