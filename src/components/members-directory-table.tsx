'use client'

import { Fragment, useState } from 'react'
import { ContactChip, MemberContactsList } from '@/components/member-contacts'
import { CopyButton } from '@/components/copy-button'
import { Accordion } from '@/components/ui/accordion'
import { ExpandToggle } from '@/components/ui/expand-toggle'
import { TableExportMenu } from '@/components/table-export'
import type { Cell } from '@/lib/table-export'
import { ManageContactsList } from '@/components/manage-contacts-list'
import { AddContactForm } from '@/components/add-contact-form'
import { MemberBankAccountsManager } from '@/components/member-bank-accounts-manager'
import { BankAccountForm } from '@/components/bank-account-form'
import type {
  MemberBankAccount,
  MemberContact,
  MemberDirectoryRow,
} from '@/lib/actions/members'

const STATUS_PILL: Record<string, string> = {
  active:   'bg-emerald-50 text-emerald-700 ring-emerald-200',
  inactive: 'bg-gray-50 text-gray-600 ring-gray-200',
  archived: 'bg-rose-50 text-rose-700 ring-rose-200',
}
const STATUS_LABEL: Record<string, string> = {
  active:   'Active',
  inactive: 'Inactive',
  archived: 'Archived',
}

const COLSPAN = 5

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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const normalizedUserEmail = (currentUserEmail ?? '').trim().toLowerCase()

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exportColumns = ['Name', 'Status', 'Primary phone', 'Primary email', 'Login email', 'Member since']
  const exportRows: Cell[][] = members.map((m) => {
    const phones = m.contacts.filter((c) => c.kind === 'phone')
    const emails = m.contacts.filter((c) => c.kind === 'email')
    const primaryPhone = phones.find((c) => c.is_primary) ?? phones[0]
    const primaryEmail = emails.find((c) => c.is_primary) ?? emails[0]
    return [
      m.name,
      STATUS_LABEL[m.status] ?? m.status,
      primaryPhone?.value ?? '',
      primaryEmail?.value ?? '',
      m.email ?? '',
      formatMemberSince(m.created_at),
    ]
  })

  // Active in one section; everything else (inactive + archived) in the other.
  const activeMembers = members.filter((m) => m.status === 'active')
  const inactiveMembers = members.filter((m) => m.status !== 'active')

  return (
    <div className="space-y-6">
      {members.length > 0 && (
        <div className="flex items-center justify-end">
          <TableExportMenu
            filename="members"
            title="Members directory"
            columns={exportColumns}
            rows={exportRows}
          />
        </div>
      )}
      <MemberSection
        title="Active members"
        emptyLabel="No active members."
        members={activeMembers}
        defaultOpen
        expanded={expanded}
        toggle={toggle}
        normalizedUserEmail={normalizedUserEmail}
        isAdmin={isAdmin}
      />
      <MemberSection
        title="Inactive members"
        emptyLabel="No inactive members."
        members={inactiveMembers}
        defaultOpen={false}
        expanded={expanded}
        toggle={toggle}
        normalizedUserEmail={normalizedUserEmail}
        isAdmin={isAdmin}
      />
    </div>
  )
}

function MemberSection({
  title,
  emptyLabel,
  members,
  defaultOpen = false,
  expanded,
  toggle,
  normalizedUserEmail,
  isAdmin,
}: {
  title: string
  emptyLabel: string
  members: MemberDirectoryRow[]
  defaultOpen?: boolean
  expanded: Set<string>
  toggle: (id: string) => void
  normalizedUserEmail: string
  isAdmin: boolean
}) {
  return (
    <Accordion
      title={title}
      subtitle={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
      defaultOpen={defaultOpen}
    >
      <div className="-mx-5 -mb-4 overflow-x-auto lg:overflow-x-visible">
          <table className="sticky-thead min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Name</th>
                <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</th>
                <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Primary phone</th>
                <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Primary email</th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.length === 0 ? (
                <tr>
                  <td colSpan={COLSPAN} className="px-4 py-10 text-center text-sm text-gray-400">
                    {emptyLabel}
                  </td>
                </tr>
              ) : (
                members.map((m) => {
                  const isOpen = expanded.has(m.id)
                  const phones = m.contacts.filter((c) => c.kind === 'phone')
                  const emails = m.contacts.filter((c) => c.kind === 'email')
                  const primaryPhone = phones.find((c) => c.is_primary) ?? phones[0]
                  const primaryEmail = emails.find((c) => c.is_primary) ?? emails[0]
                  const altPhones = phones.filter((c) => c.id !== primaryPhone?.id)
                  const altEmails = emails.filter((c) => c.id !== primaryEmail?.id)
                  const memberEmailLower = (m.email ?? '').trim().toLowerCase()
                  const isSelf =
                    !!normalizedUserEmail &&
                    !!memberEmailLower &&
                    normalizedUserEmail === memberEmailLower
                  const canEdit = isAdmin || isSelf
                  return (
                    <Fragment key={m.id}>
                      <tr
                        className={
                          'transition-colors ' +
                          (isOpen
                            ? 'bg-blue-50/40 ring-1 ring-inset ring-blue-100'
                            : 'hover:bg-gray-50')
                        }
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                          {m.name}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ' +
                              (STATUS_PILL[m.status] ?? STATUS_PILL.active)
                            }
                          >
                            {STATUS_LABEL[m.status] ?? m.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {primaryPhone ? (
                            <span className="inline-flex items-center gap-1">
                              <ContactChip contact={primaryPhone} size="sm" hidePrimaryBadge />
                              <CopyButton value={primaryPhone.value} label="Phone" />
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {primaryEmail ? (
                            <span className="inline-flex items-center gap-1">
                              <ContactChip contact={primaryEmail} size="sm" hidePrimaryBadge />
                              <CopyButton value={primaryEmail.value} label="Email" />
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <ExpandToggle
                            isOpen={isOpen}
                            onClick={() => toggle(m.id)}
                            controlsId={`member-detail-${m.id}`}
                            labelOpen={`Hide details for ${m.name}`}
                            labelClosed={`Show details for ${m.name}`}
                          />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr
                          id={`member-detail-${m.id}`}
                          className="border-l-2 border-l-blue-500 bg-gradient-to-b from-blue-50/50 to-white"
                        >
                          <td colSpan={COLSPAN} className="p-0">
                            <MemberDetailPanel
                              memberId={m.id}
                              memberName={m.name}
                              createdAt={m.created_at}
                              loginEmail={m.email}
                              notes={m.notes}
                              canEdit={canEdit}
                              phones={phones}
                              emails={emails}
                              altPhones={altPhones}
                              altEmails={altEmails}
                              bankAccounts={m.bank_accounts}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
      </div>
    </Accordion>
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
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="min-w-full text-xs">
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
