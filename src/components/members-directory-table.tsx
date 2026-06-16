'use client'

import { useMemo, useState } from 'react'
import { ContactInline, MemberContactsList } from '@/components/member-contacts'
import { PrAccordion, PrAccordionTab } from '@/components/ui/pr/accordion'
import { TableExportMenu } from '@/components/table-export'
import type { Cell, ExportCriterion } from '@/lib/table-export'
import { ManageContactsList } from '@/components/manage-contacts-list'
import { AddContactForm } from '@/components/add-contact-form'
import { MemberBankAccountsManager } from '@/components/member-bank-accounts-manager'
import { BankAccountForm } from '@/components/bank-account-form'
import { PrDataTable, type PrColumn } from '@/components/ui/pr/data-table'
import { Avatar } from '@/components/ui/avatar'
import type {
  MemberBankAccount,
  MemberContact,
  MemberDirectoryRow,
} from '@/lib/actions/members'

// The directory is split into "Active" / "Inactive" accordion sections, so an
// on-row Status column would just restate the section it's already under — the
// status is only surfaced in the (flat, combined) CSV export below.
const STATUS_LABEL: Record<string, string> = {
  active:   'Active',
  inactive: 'Inactive',
  archived: 'Archived',
}

function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function maskAccountNumber(num: string): string {
  if (!num) return '—'
  if (num.length <= 4) return num
  return `••••${num.slice(-4)}`
}

/** Per-member primary/alternate contacts pre-computed so the table cells and
 *  the detail panel share one derivation. */
type MemberRowAug = MemberDirectoryRow & {
  _phones: MemberContact[]
  _emails: MemberContact[]
  _primaryPhone: MemberContact | undefined
  _primaryEmail: MemberContact | undefined
  _altPhones: MemberContact[]
  _altEmails: MemberContact[]
  _canEdit: boolean
  _status_label: string
  _primary_phone_value: string
  _primary_email_value: string
  /** Concatenated, lowercased blob the global search matches against. */
  _search_blob: string
}

function augment(
  members: MemberDirectoryRow[],
  normalizedUserEmail: string,
  isAdmin: boolean,
): MemberRowAug[] {
  return members.map((m) => {
    const phones = m.contacts.filter((c) => c.kind === 'phone')
    const emails = m.contacts.filter((c) => c.kind === 'email')
    const primaryPhone = phones.find((c) => c.is_primary) ?? phones[0]
    const primaryEmail = emails.find((c) => c.is_primary) ?? emails[0]
    const altPhones = phones.filter((c) => c.id !== primaryPhone?.id)
    const altEmails = emails.filter((c) => c.id !== primaryEmail?.id)
    const memberEmailLower = (m.email ?? '').trim().toLowerCase()
    const isSelf =
      !!normalizedUserEmail && !!memberEmailLower && normalizedUserEmail === memberEmailLower
    const statusLabel = STATUS_LABEL[m.status] ?? m.status
    const primaryPhoneValue = primaryPhone?.value ?? ''
    const primaryEmailValue = primaryEmail?.value ?? ''
    return {
      ...m,
      _phones: phones,
      _emails: emails,
      _primaryPhone: primaryPhone,
      _primaryEmail: primaryEmail,
      _altPhones: altPhones,
      _altEmails: altEmails,
      _canEdit: isAdmin || isSelf,
      _status_label: statusLabel,
      _primary_phone_value: primaryPhoneValue,
      _primary_email_value: primaryEmailValue,
      _search_blob: [
        m.name,
        statusLabel,
        primaryPhoneValue,
        primaryEmailValue,
        m.email ?? '',
        ...m.contacts.map((c) => c.value),
      ]
        .join(' ')
        .toLowerCase(),
    }
  })
}

export function MembersDirectoryTable({
  members,
  currentUserEmail,
  isAdmin,
}: {
  members: MemberDirectoryRow[]
  /** Auth email of the signed-in user (null if anonymous). Used to flag the
   *  current user's own row as editable. */
  currentUserEmail: string | null
  isAdmin: boolean
}) {
  // Shared expansion state across both sections — a member id is either open
  // or closed regardless of which section it sits in.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const normalizedUserEmail = (currentUserEmail ?? '').trim().toLowerCase()

  const augmented = useMemo(
    () => augment(members, normalizedUserEmail, isAdmin),
    [members, normalizedUserEmail, isAdmin],
  )

  // Each section's PrDataTable reports its current filtered+sorted rows and
  // its search query here, so the export reflects what's visible on screen
  // (consistent with the other migrated tables). `null` until the first
  // onValueChange fires → fall back to the section's full set.
  const [processedActive, setProcessedActive] = useState<MemberRowAug[] | null>(null)
  const [processedInactive, setProcessedInactive] = useState<MemberRowAug[] | null>(null)
  const [searchActive, setSearchActive] = useState('')
  const [searchInactive, setSearchInactive] = useState('')

  function toggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Active in one section; everything else (inactive + archived) in the other.
  const activeMembers = augmented.filter((m) => m.status === 'active')
  const inactiveMembers = augmented.filter((m) => m.status !== 'active')

  const exportColumns = ['Name', 'Status', 'Primary phone', 'Primary email', 'Login email', 'Member since']
  const toExportRow = (m: MemberRowAug): Cell[] => [
    m.name,
    m._status_label,
    m._primary_phone_value,
    m._primary_email_value,
    m.email ?? '',
    formatMemberSince(m.created_at),
  ]
  // Export = the combined filtered+sorted rows visible across both sections,
  // active first then inactive (preserving the on-screen section order).
  const visibleActive = processedActive ?? activeMembers
  const visibleInactive = processedInactive ?? inactiveMembers
  const exportRows: Cell[][] = [...visibleActive, ...visibleInactive].map(toExportRow)

  // Record each section's non-empty search term as an export criterion.
  const searchCriteria: ExportCriterion[] = [
    ...(searchActive.trim()
      ? [{ label: 'Search (active)', value: searchActive.trim() }]
      : []),
    ...(searchInactive.trim()
      ? [{ label: 'Search (inactive)', value: searchInactive.trim() }]
      : []),
  ]

  return (
    <div className="space-y-6">
      {members.length > 0 && (
        <div className="flex items-center justify-end">
          <TableExportMenu
            filename="members"
            title="Members directory"
            columns={exportColumns}
            rows={exportRows}
            criteria={searchCriteria}
          />
        </div>
      )}
      <MemberSection
        title="Active members"
        emptyLabel="No active members."
        members={activeMembers}
        defaultOpen
        expandedIds={expandedIds}
        toggle={toggle}
        onValueChange={setProcessedActive}
        onGlobalFilterChange={setSearchActive}
      />
      <MemberSection
        title="Inactive members"
        emptyLabel="No inactive members."
        members={inactiveMembers}
        defaultOpen={false}
        expandedIds={expandedIds}
        toggle={toggle}
        onValueChange={setProcessedInactive}
        onGlobalFilterChange={setSearchInactive}
      />
    </div>
  )
}

function MemberSection({
  title,
  emptyLabel,
  members,
  defaultOpen = false,
  expandedIds,
  toggle,
  onValueChange,
  onGlobalFilterChange,
}: {
  title: string
  emptyLabel: string
  members: MemberRowAug[]
  defaultOpen?: boolean
  expandedIds: Set<string>
  toggle: (id: string) => void
  onValueChange: (rows: MemberRowAug[]) => void
  onGlobalFilterChange: (query: string) => void
}) {
  // Project the shared id Set into PrimeReact's controlled expansion object,
  // scoped to this section's rows.
  const expandedRows = useMemo(() => {
    const obj: Record<string, boolean> = {}
    for (const m of members) if (expandedIds.has(m.id)) obj[m.id] = true
    return obj
  }, [members, expandedIds])

  const columns: PrColumn<MemberRowAug>[] = [
    {
      field: 'name',
      header: 'Name',
      sortable: true,
      filter: true,
      filterPlaceholder: 'Search by name',
      bodyClassName: 'whitespace-nowrap',
      body: (m) => (
        <span className="flex items-center gap-2">
          <Avatar src={m.avatar_url} name={m.name} size={28} />
          <span className="font-medium text-gray-900">{m.name}</span>
        </span>
      ),
    },
    {
      field: '_primary_phone_value',
      header: 'Primary phone',
      filter: true,
      filterPlaceholder: 'Search by phone',
      body: (m) =>
        m._primaryPhone ? (
          <ContactInline contact={m._primaryPhone} />
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      field: '_primary_email_value',
      header: 'Primary email',
      filter: true,
      filterPlaceholder: 'Search by email',
      body: (m) =>
        m._primaryEmail ? (
          <ContactInline contact={m._primaryEmail} />
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      field: 'id',
      header: '',
      expander: true,
      style: { width: '3.5rem' },
    },
  ]

  return (
    <PrAccordion defaultActiveIndex={defaultOpen ? [0] : []}>
      <PrAccordionTab
        header={title}
        badge={members.length}
      >
      <div className="-mx-5 -mb-4">
        <PrDataTable<MemberRowAug>
          value={members}
          columns={columns}
          dataKey="id"
          emptyMessage={emptyLabel}
          // Menu-mode filters: a funnel icon per filterable column header opens
          // a small filter popover. The inline per-column search row is dropped
          // as redundant with the global keyword box above the table.
          filterDisplay="menu"
          globalFilterFields={members.length > 0 ? ['_search_blob'] : undefined}
          globalSearchPlaceholder="Search by name, phone, email…"
          onValueChange={onValueChange}
          onGlobalFilterChange={onGlobalFilterChange}
          expandedRows={expandedRows}
          onRowToggle={(rows) => {
            // Diff the incoming expansion object against the shared Set so the
            // single toggled id flips in/out — preserves cross-section state.
            const nextIds = new Set(
              Object.keys(rows as Record<string, boolean>),
            )
            const sectionIds = new Set(members.map((m) => m.id))
            for (const id of sectionIds) {
              const wasOpen = expandedIds.has(id)
              const nowOpen = nextIds.has(id)
              if (wasOpen !== nowOpen) toggle(id)
            }
          }}
          rowExpansion={(m) => (
            <MemberDetailPanel
              memberId={m.id}
              memberName={m.name}
              createdAt={m.created_at}
              loginEmail={m.email}
              notes={m.notes}
              canEdit={m._canEdit}
              phones={m._phones}
              emails={m._emails}
              altPhones={m._altPhones}
              altEmails={m._altEmails}
              bankAccounts={m.bank_accounts}
            />
          )}
        />
      </div>
      </PrAccordionTab>
    </PrAccordion>
  )
}

function MemberDetailPanel({
  memberId,
  memberName,
  createdAt,
  loginEmail,
  notes,
  canEdit,
  phones,
  emails,
  altPhones,
  altEmails,
  bankAccounts,
}: {
  memberId: string
  memberName: string
  createdAt: string
  loginEmail: string | null
  notes: string | null
  canEdit: boolean
  /** Full phone list, primary first. Used when canEdit so the row can be
   *  re-prioritised or removed. */
  phones: MemberContact[]
  emails: MemberContact[]
  altPhones: MemberContact[]
  altEmails: MemberContact[]
  bankAccounts: MemberBankAccount[]
}) {
  // Per-row form toggles. Both CTAs live in the top meta strip; clicking
  // either reveals the form right below it so the user doesn't have to scroll.
  const [showContactForm, setShowContactForm] = useState(false)
  const [showBankForm, setShowBankForm] = useState(false)

  return (
    <div className="space-y-4 p-4">
      {/* Meta strip — meta cards on the left, "+ Contact" / "+ Bank Account"
          CTAs on the right (only when canEdit). */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <Field label="Member since" value={formatMemberSince(createdAt)} />
          <Field
            label="Google login email"
            value={loginEmail ?? <span className="text-gray-400">— not linked</span>}
          />
          {notes && <Field label="Notes" value={notes} />}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <PanelCta onClick={() => setShowContactForm((v) => !v)} active={showContactForm}>
              Contact
            </PanelCta>
            <PanelCta onClick={() => setShowBankForm((v) => !v)} active={showBankForm}>
              Bank Account
            </PanelCta>
          </div>
        )}
      </div>

      {/* Inline forms (revealed by the CTAs above) */}
      {canEdit && showContactForm && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 p-3">
          <div className="mb-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Add another phone or email
            </h4>
            <p className="text-[11px] text-gray-400">
              Mark one phone and one email as primary — those are surfaced on the row.
            </p>
          </div>
          <AddContactForm
            memberId={memberId}
            onSubmitted={() => setShowContactForm(false)}
            onCancel={() => setShowContactForm(false)}
          />
        </div>
      )}
      {canEdit && showBankForm && (
        <BankAccountForm
          lockedMember={{ id: memberId, name: memberName }}
          onSubmitted={() => setShowBankForm(false)}
          onCancel={() => setShowBankForm(false)}
        />
      )}

      {/* Phones + emails: full editable list when canEdit, just alternates
          when read-only (since primary is already on the row). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PanelCard
          title={canEdit ? 'Phones' : 'Alternate phones'}
          count={canEdit ? phones.length : altPhones.length}
          empty={canEdit ? 'No phone numbers yet.' : 'No alternate phones.'}
        >
          {canEdit ? (
            phones.length > 0 && <ManageContactsList contacts={phones} emptyLabel="" />
          ) : (
            altPhones.length > 0 && <MemberContactsList contacts={altPhones} size="sm" />
          )}
        </PanelCard>
        <PanelCard
          title={canEdit ? 'Emails' : 'Alternate emails'}
          count={canEdit ? emails.length : altEmails.length}
          empty={canEdit ? 'No emails yet.' : 'No alternate emails.'}
        >
          {canEdit ? (
            emails.length > 0 && <ManageContactsList contacts={emails} emptyLabel="" />
          ) : (
            altEmails.length > 0 && <MemberContactsList contacts={altEmails} size="sm" />
          )}
        </PanelCard>
      </div>

      {/* Bank accounts — hidden entirely when there are none on file.
          Editors can always add via the top "+ Bank Account" CTA, so the
          empty state would just be visual noise here. */}
      {bankAccounts.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Bank accounts
            </h4>
            <span className="text-[10px] text-gray-400">{bankAccounts.length}</span>
          </div>
          {canEdit ? (
            <MemberBankAccountsManager accounts={bankAccounts} canEdit />
          ) : (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-[34rem] text-xs">
              <thead>
                <tr className="bg-gray-50/60 text-left text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2">Bank</th>
                  <th className="px-3 py-2">Account #</th>
                  <th className="px-3 py-2">IFSC</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">UPI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bankAccounts.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {b.bank_name}
                      {b.is_primary && (
                        <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                          primary
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-700">
                      {maskAccountNumber(b.account_number)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-600">
                      {b.ifsc_code}
                    </td>
                    <td className="px-3 py-2 capitalize text-gray-600">{b.account_type}</td>
                    <td className="px-3 py-2 text-gray-600">{b.upi_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </div>
  )
}

function PanelCta({
  onClick,
  active,
  children,
}: {
  onClick: () => void
  active: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ' +
        (active
          ? 'bg-blue-700 text-white hover:bg-blue-800'
          : 'bg-blue-600 text-white hover:bg-blue-700')
      }
    >
      <span aria-hidden="true" className="text-sm leading-none">
        {active ? '×' : '+'}
      </span>
      {children}
    </button>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-xs text-gray-700">{value}</p>
    </div>
  )
}

function PanelCard({
  title,
  count,
  empty,
  children,
}: {
  title: string
  count: number
  empty: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {title}
        </h4>
        <span className="text-[10px] text-gray-400">{count}</span>
      </div>
      {count === 0 ? (
        <p className="text-xs text-gray-400">{empty}</p>
      ) : (
        children
      )}
    </div>
  )
}
