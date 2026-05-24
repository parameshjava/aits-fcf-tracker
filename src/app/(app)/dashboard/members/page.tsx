import { getCurrentUser } from '@/lib/actions/auth'
import { getMemberDirectory } from '@/lib/actions/members'
import { MembersDirectoryTable } from '@/components/members-directory-table'
import { RefreshButton } from '@/components/ui/refresh-button'

export default async function MembersDirectoryPage() {
  const [members, user] = await Promise.all([getMemberDirectory(), getCurrentUser()])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Members directory</h1>
          <p className="text-xs text-gray-500">
            Tap a row to expand. You can manage <em>your own</em> phones and emails inside the
            expansion — admins can manage anyone. Login email (Google) is the auth identity and
            can&apos;t be edited here.
          </p>
        </div>
        <RefreshButton label="Refresh members directory" />
      </div>

      <MembersDirectoryTable
        members={members}
        currentUserEmail={user?.email ?? null}
        isAdmin={user?.profile?.role === 'admin'}
      />
    </div>
  )
}
