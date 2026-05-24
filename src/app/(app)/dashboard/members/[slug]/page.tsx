import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/actions/auth'
import { getMemberBySlug, type MemberContact } from '@/lib/actions/members'
import { MemberContactsList } from '@/components/member-contacts'
import { AddContactForm } from '@/components/add-contact-form'
import { ManageContactsList } from '@/components/manage-contacts-list'

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

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const member = await getMemberBySlug(decodeURIComponent(slug))
  if (!member) notFound()

  const user = await getCurrentUser()
  const isAdmin = user?.profile?.role === 'admin'
  // A non-admin member can edit their own row when their Google auth email
  // matches the canonical members.email. Everyone else stays in read-only.
  const isSelf =
    !!user?.email &&
    !!member.email &&
    user.email.trim().toLowerCase() === member.email.trim().toLowerCase()
  const canEdit = isAdmin || isSelf

  const phones: MemberContact[] = member.contacts.filter((c) => c.kind === 'phone')
  const emails: MemberContact[] = member.contacts.filter((c) => c.kind === 'email')

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/members"
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          ← Members directory
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-gray-900">{member.name}</h1>
          <span
            className={
              'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ' +
              (STATUS_PILL[member.status] ?? STATUS_PILL.active)
            }
          >
            {STATUS_LABEL[member.status] ?? member.status}
          </span>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400">Google login email</p>
            <p className="mt-0.5 text-xs text-gray-700">
              {member.email ?? <span className="text-gray-400">— not linked</span>}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400">Member since</p>
            <p className="mt-0.5 text-xs text-gray-700">
              {new Date(member.created_at).toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
              })}
            </p>
          </div>
          {member.notes && (
            <div className="sm:col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-400">Notes</p>
              <p className="mt-0.5 text-sm text-gray-700">{member.notes}</p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Phone numbers</h2>
            <p className="text-[11px] text-gray-500">
              {phones.length} on file. Tap a chip to dial.
            </p>
          </div>
        </div>
        {canEdit ? (
          <ManageContactsList contacts={phones} emptyLabel="No phone numbers yet." />
        ) : (
          <MemberContactsList contacts={phones} emptyLabel="No phone numbers yet." />
        )}
      </section>

      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Contact emails</h2>
            <p className="text-[11px] text-gray-500">
              {emails.length} on file. Tap a chip to compose. Distinct from the Google login email
              above.
            </p>
          </div>
        </div>
        {canEdit ? (
          <ManageContactsList contacts={emails} emptyLabel="No contact emails yet." />
        ) : (
          <MemberContactsList contacts={emails} emptyLabel="No contact emails yet." />
        )}
      </section>

      {canEdit && (
        <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Add contact</h2>
            <p className="text-[11px] text-gray-500">
              {isAdmin
                ? 'Mark one phone and one email as primary — those are surfaced on the directory list.'
                : 'You can edit your own contact details. Mark one phone and one email as primary.'}
            </p>
          </div>
          <AddContactForm memberId={member.id} />
        </section>
      )}
    </div>
  )
}
