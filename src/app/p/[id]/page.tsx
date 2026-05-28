// Public preview route for poll share links.
//
// Lives OUTSIDE the (app) auth wall so link-preview crawlers (WhatsApp,
// Slack, iMessage) can fetch the page and read the OG meta tags. The body
// only renders the poll question + description for unauthenticated viewers
// — vote counts, options, voter identities all stay gated behind the
// canonical /polls/[id] route. Authenticated users hitting this URL are
// server-redirected straight to /polls/[id].
//
// Security notes:
//   - We use createAdminClient to read the poll because public visitors
//     have no session. We only ever select { question, description } —
//     no vote data, no options, no internal IDs beyond the poll's own UUID.
//   - robots: noindex prevents search engines from caching the preview.
//     Link-preview crawlers ignore robots meta but won't archive either.
//   - 404 returns are opaque (notFound()) so we don't distinguish
//     "poll exists but is closed" vs "poll doesn't exist". UUIDs are
//     unguessable, so this is belt-and-suspenders.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MarkdownView } from '@/components/markdown-view'

function stripMarkdown(md: string | null): string {
  if (!md) return ''
  return md
    .replace(/```[\s\S]*?```/g, ' ')           // fenced code blocks
    .replace(/`([^`]+)`/g, '$1')                // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')   // images → alt text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')    // links → text
    .replace(/^\s*\|.*\|.*$/gm, ' ')            // table rows
    .replace(/[*_~#>|-]+/g, ' ')                // common markers
    .replace(/\s+/g, ' ')                       // collapse whitespace
    .trim()
}

async function loadPreviewPoll(id: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('polls')
    .select('question, description')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as { question: string; description: string | null }
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params
  const poll = await loadPreviewPoll(id)

  if (!poll) {
    return {
      title: 'Poll',
      robots: { index: false, follow: false },
    }
  }

  const title = poll.question
  const description = stripMarkdown(poll.description).slice(0, 200) || 'Open the FCF Tracker poll to vote.'

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/p/${id}`,
      siteName: 'FCF Tracker',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  }
}

export default async function PublicPollPreviewPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Authed visitors → straight to the real poll page.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    redirect(`/polls/${id}`)
  }

  const poll = await loadPreviewPoll(id)
  if (!poll) notFound()

  const signInHref = `/auth/login?next=${encodeURIComponent(`/polls/${id}`)}`

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-stretch justify-center gap-6 px-6 py-12">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
          FCF Tracker · Poll
        </p>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">
          {poll.question}
        </h1>
      </header>

      {poll.description ? (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <MarkdownView source={poll.description} />
        </div>
      ) : null}

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 text-center">
        <p className="text-sm text-blue-900">
          Sign in with your member account to view options and vote.
        </p>
        <Link
          href={signInHref}
          className="mt-3 inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Sign in to vote →
        </Link>
      </div>

      <p className="text-center text-xs text-gray-400">
        Voting is restricted to AITS Friends Cooperative Fund members.
      </p>
    </main>
  )
}
