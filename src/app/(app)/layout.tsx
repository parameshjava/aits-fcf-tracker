import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar, type SidebarUser } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/top-bar'
import { Toaster } from '@/components/ui/sonner'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const avatarUrl =
    (typeof metadata.avatar_url === 'string' && metadata.avatar_url) ||
    (typeof metadata.picture === 'string' && metadata.picture) ||
    null

  // Prefer profile.full_name (set by the handle_new_user trigger), then fall
  // back to whatever Google sent in user_metadata, then to the email username.
  const metaFullName =
    (typeof metadata.full_name === 'string' && metadata.full_name) ||
    (typeof metadata.name === 'string' && metadata.name) ||
    null

  const displayName = profile?.full_name || metaFullName || null

  const sidebarUser: SidebarUser = {
    email: user.email ?? '',
    fullName: displayName,
    isAdmin: profile?.role === 'admin',
  }

  return (
    <div className="min-h-screen bg-white lg:flex">
      <Sidebar user={sidebarUser} />
      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <TopBar
          fullName={displayName}
          email={user.email ?? ''}
          avatarUrl={avatarUrl}
        />
        <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
      {/* Sonner toast portal — every authenticated screen can call `toast.success(...)`
          / `toast.error(...)` from sonner. Positioned bottom-right by default. */}
      <Toaster richColors closeButton position="bottom-right" />
    </div>
  )
}
