import type { MemberContact } from '@/lib/actions/members'
import { getCountryForPhone } from '@/lib/phone-countries'

/**
 * Display-only chips for a member's phones / emails. Each chip is a
 * tappable `tel:` / `mailto:` link with a leading icon and a tiny label /
 * "primary" pill. Reusable from the directory list, member-detail page, or
 * any panel that surfaces a member.
 */
export function MemberContactsList({
  contacts,
  emptyLabel = 'No contact info on file.',
  size = 'md',
}: {
  contacts: MemberContact[]
  emptyLabel?: string
  size?: 'sm' | 'md'
}) {
  if (contacts.length === 0) {
    return <p className="text-xs text-gray-400">{emptyLabel}</p>
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {contacts.map((c) => (
        <li key={c.id}>
          <ContactChip contact={c} size={size} />
        </li>
      ))}
    </ul>
  )
}

export function ContactChip({
  contact,
  size = 'md',
  hidePrimaryBadge = false,
}: {
  contact: MemberContact
  size?: 'sm' | 'md'
  /** Suppress the "PRIMARY" pill — use when the surrounding context (a
   *  "Primary phone" column header, etc.) already conveys that fact. */
  hidePrimaryBadge?: boolean
}) {
  const href =
    contact.kind === 'phone'
      ? `tel:${contact.value.replace(/\s+/g, '')}`
      : `mailto:${contact.value}`

  const isPhone = contact.kind === 'phone'
  const country = isPhone ? getCountryForPhone(contact.value) : null

  const sizeClasses =
    size === 'sm'
      ? 'gap-1 px-2 py-0.5 text-[11px]'
      : 'gap-1.5 px-2.5 py-1 text-xs'

  return (
    <a
      href={href}
      className={
        'inline-flex items-center rounded-full border transition-colors ' +
        sizeClasses +
        ' ' +
        (contact.is_primary
          ? isPhone
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            : 'border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50')
      }
      title={contact.label ? `${contact.label} · ${contact.value}` : contact.value}
    >
      <ContactIcon kind={contact.kind} />
      {country && (
        <span
          className="text-base leading-none"
          aria-label={country.name}
          title={country.name}
        >
          {country.flag}
        </span>
      )}
      <span className="font-medium tabular-nums">{contact.value}</span>
      {contact.label && contact.label.toLowerCase() !== 'primary' && (
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
          · {contact.label}
        </span>
      )}
      {contact.is_primary && !hidePrimaryBadge && (
        <span
          aria-label="primary"
          className="ml-0.5 rounded-full bg-white/70 px-1 text-[9px] font-semibold uppercase tracking-wider"
        >
          primary
        </span>
      )}
    </a>
  )
}

function ContactIcon({ kind }: { kind: 'phone' | 'email' }) {
  if (kind === 'phone') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-3.5 w-3.5"
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-10 5L2 7" />
    </svg>
  )
}
