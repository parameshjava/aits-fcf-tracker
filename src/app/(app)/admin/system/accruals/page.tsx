import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/actions/auth'
import { recomputeLoanInterest } from '@/lib/actions/loan-interest'
import { recomputeDonationEligibility } from '@/lib/actions/eligibility'
import { formatRupees } from '@/lib/format'

// Operational tooling page — always dynamic. Each visit re-reads the latest
// accrual / eligibility timestamps and pending-interest totals. No `'use cache'`.

type CronRow = {
  jobname: string | null
  start_time: string | null
  status: string | null
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  })
}

export default async function AccrualsPage() {
  // Admin gate — must run BEFORE any data fetch.
  const user = await getCurrentUser()
  if (!user || user.profile?.role !== 'admin') redirect('/dashboard')

  const supabase = await createClient()

  // The cron query is in the `cron` schema, which PostgREST does NOT expose by
  // default via the publishable key. We attempt the read and degrade
  // gracefully if it fails (empty section + note). Granting `usage on schema
  // cron` and `select on cron.job_run_details` to `authenticated` would
  // enable it, but that's out of scope here.
  const [accrualsRes, periodsRes, cronRes, pendingRes] = await Promise.all([
    supabase
      .from('loan_interest_accruals')
      .select('recomputed_at')
      .order('recomputed_at', { ascending: false })
      .limit(1),
    supabase
      .from('donation_eligibility_periods')
      .select('recomputed_at')
      .order('recomputed_at', { ascending: false })
      .limit(1),
    supabase
      .schema('cron')
      .from('job_run_details')
      .select('jobname,start_time,status')
      .order('start_time', { ascending: false })
      .limit(10),
    supabase
      .from('loans_balances')
      .select('pending_interest')
      .eq('status', 'active'),
  ])

  const lastAccrualAt = accrualsRes.data?.[0]?.recomputed_at ?? null
  const lastPeriodAt = periodsRes.data?.[0]?.recomputed_at ?? null
  const cronJobs: CronRow[] = (cronRes.data as CronRow[] | null) ?? []
  const cronAvailable = !cronRes.error
  const totalPending = (pendingRes.data ?? []).reduce(
    (sum, r) => sum + Number(r.pending_interest ?? 0),
    0,
  )

  // Inline server actions — kept tiny; they re-call the underlying server
  // actions which already gate on admin role and run inside `runAction`.
  async function handleRecomputeLoanInterest() {
    'use server'
    await recomputeLoanInterest()
  }
  async function handleRecomputeDonationEligibility() {
    'use server'
    await recomputeDonationEligibility()
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">System / Accruals</h1>
        <p className="text-sm text-gray-500">
          Status of the monthly loan-interest accrual and donation eligibility
          jobs, plus manual re-run controls.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-5">
          <p className="text-sm text-gray-500">Last loan-interest accrual</p>
          <p className="mt-1 text-base font-medium text-gray-900">
            {formatTimestamp(lastAccrualAt)}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-5">
          <p className="text-sm text-gray-500">Last eligibility period</p>
          <p className="mt-1 text-base font-medium text-gray-900">
            {formatTimestamp(lastPeriodAt)}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-5">
          <p className="text-sm text-gray-500">Total pending interest</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatRupees(totalPending)}
          </p>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-5">
        <h3 className="mb-3 font-semibold text-gray-900">Manual re-run</h3>
        <p className="mb-4 text-sm text-gray-500">
          These are idempotent — re-running for the same period overwrites the
          previous row. Use after correcting historical data.
        </p>
        <div className="flex flex-wrap gap-3">
          <form action={handleRecomputeLoanInterest}>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              Re-run loan interest (last EOM)
            </button>
          </form>
          <form action={handleRecomputeDonationEligibility}>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              Re-run donation eligibility (full backfill)
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-5">
        <h3 className="mb-3 font-semibold text-gray-900">Recent cron runs</h3>
        {!cronAvailable ? (
          <p className="text-sm text-gray-500">
            Cron history requires database-level grants
            (<code className="rounded bg-gray-100 px-1 py-0.5 text-xs">
              grant usage on schema cron, select on cron.job_run_details to
              authenticated
            </code>
            ). Not configured by default.
          </p>
        ) : cronJobs.length === 0 ? (
          <p className="text-sm text-gray-400">No cron runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-2 pr-4">Job</th>
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {cronJobs.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2 pr-4 font-medium text-gray-900">
                      {r.jobname ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      {formatTimestamp(r.start_time)}
                    </td>
                    <td className="py-2">
                      <span
                        className={
                          r.status === 'succeeded'
                            ? 'inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
                            : r.status === 'failed'
                              ? 'inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800'
                              : 'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800'
                        }
                      >
                        {r.status ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
