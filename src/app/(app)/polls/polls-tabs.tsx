'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'

export type SerializedRow = {
  id: string
  question: string
  kind: 'single' | 'multi'
  visibility: 'sensitive' | 'public'
  is_closed: boolean
  has_voted: boolean
  voter_count: number
  deadline: string
}

type Tab = 'open' | 'closed' | 'mine'

export function PollsTabs({
  open,
  closed,
  mine,
  isAdmin,
}: {
  open: SerializedRow[]
  closed: SerializedRow[]
  mine: SerializedRow[]
  isAdmin: boolean
}) {
  const [tab, setTab] = useState<Tab>('open')
  const rows = tab === 'open' ? open : tab === 'closed' ? closed : mine

  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
      <div className="mb-4 border-b border-gray-200">
        <nav
          className="-mb-px flex gap-6 overflow-x-auto"
          aria-label="Polls tabs"
        >
          <TabButton active={tab === 'open'} onClick={() => setTab('open')}>
            Open <Count>{open.length}</Count>
          </TabButton>
          <TabButton active={tab === 'closed'} onClick={() => setTab('closed')}>
            Closed <Count>{closed.length}</Count>
          </TabButton>
          <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
            My votes <Count>{mine.length}</Count>
          </TabButton>
        </nav>
      </div>

      {rows.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="flex items-stretch justify-between gap-3">
                <Link
                  href={`/polls/${row.id}`}
                  className="flex flex-1 items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {row.question}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      <KindBadge kind={row.kind} />
                      <span className="mx-2">·</span>
                      <VisibilityBadge visibility={row.visibility} />
                      <span className="mx-2">·</span>
                      {row.deadline}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 whitespace-nowrap text-xs">
                    {row.is_closed ? (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">
                        {row.voter_count} votes
                      </span>
                    ) : row.has_voted ? (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-green-700">
                        Voted ✓
                      </span>
                    ) : (
                      <span className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-800">
                        Not voted
                      </span>
                    )}
                  </div>
                </Link>
                {isAdmin && !row.is_closed ? (
                  <Link
                    href={`/admin/polls/${row.id}`}
                    className="flex items-center border-l border-gray-100 px-3 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    aria-label={`Manage poll: ${row.question}`}
                  >
                    Manage
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={
        'whitespace-nowrap ' +
        (active
          ? 'border-b-2 border-blue-600 px-1 py-2 text-sm font-semibold text-blue-700'
          : 'border-b-2 border-transparent px-1 py-2 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700')
      }
    >
      {children}
    </button>
  )
}

function Count({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
      {children}
    </span>
  )
}

function KindBadge({ kind }: { kind: 'single' | 'multi' }) {
  return (
    <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
      {kind === 'single' ? 'Single' : 'Multi'}
    </span>
  )
}

function VisibilityBadge({ visibility }: { visibility: 'sensitive' | 'public' }) {
  return (
    <span
      className={
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ' +
        (visibility === 'public'
          ? 'bg-purple-50 text-purple-700'
          : 'bg-gray-100 text-gray-600')
      }
    >
      {visibility === 'public' ? 'Public' : 'Anonymous'}
    </span>
  )
}

function EmptyState({ tab }: { tab: Tab }) {
  const message =
    tab === 'open'
      ? 'No open polls right now.'
      : tab === 'closed'
        ? 'No closed polls yet.'
        : "You haven't voted in any polls yet."
  return (
    <div className="rounded-lg border border-dashed border-gray-200 px-6 py-12 text-center text-sm text-gray-500">
      {message}
    </div>
  )
}
