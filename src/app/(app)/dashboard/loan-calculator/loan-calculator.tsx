'use client'

import { useMemo, useState } from 'react'
import { buildSchedule, computeEmiAmount } from '@/lib/emi-math'
import { formatRupees, todayISO } from '@/lib/format'

const FIELD =
  'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export function LoanCalculator({
  interestRatePct,
  maxTermMonths,
  maxWaiverMonths,
  medicalWaiverDefault,
}: {
  interestRatePct: number
  maxTermMonths: number
  maxWaiverMonths: number
  medicalWaiverDefault: number
}) {
  const [principal, setPrincipal] = useState('100000')
  const [termMonths, setTermMonths] = useState('18')
  const [loanType, setLoanType] = useState<'personal' | 'medical'>('personal')
  const [waiverMonths, setWaiverMonths] = useState('0')
  const [startDate, setStartDate] = useState(todayISO())

  // Switching loan type pre-fills the typical waiver (medical) / 0 (personal).
  function onLoanTypeChange(next: 'personal' | 'medical') {
    setLoanType(next)
    setWaiverMonths(next === 'medical' ? String(medicalWaiverDefault) : '0')
  }

  const p = Number(principal)
  const n = Number(termMonths)
  const w = Number(waiverMonths)

  const result = useMemo(() => {
    if (!(p > 0) || !Number.isInteger(n) || n < 1 || n > maxTermMonths || !startDate) {
      return null
    }
    const waiver = Number.isInteger(w) && w >= 0 ? Math.min(w, maxWaiverMonths) : 0
    try {
      const emi = computeEmiAmount(p, interestRatePct, n)
      const rows = buildSchedule({
        principal: p,
        annualRatePct: interestRatePct,
        termMonths: n,
        startDate,
        waiverMonths: waiver,
      })
      const totalInterest = rows.reduce((s, r) => s + r.interestDue, 0)
      return { emi, rows, totalInterest, totalPayable: p + totalInterest }
    } catch {
      return null
    }
  }, [p, n, w, startDate, interestRatePct, maxTermMonths, maxWaiverMonths])

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="calc_principal" className="block text-sm font-medium text-gray-700">
              Loan amount
            </label>
            <input
              id="calc_principal"
              type="number"
              min="1"
              step="0.01"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              placeholder="e.g. 100000"
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="calc_term" className="block text-sm font-medium text-gray-700">
              Term (months)
              <span className="ml-1 text-xs font-normal text-gray-400">(1 to {maxTermMonths})</span>
            </label>
            <input
              id="calc_term"
              type="number"
              min="1"
              max={maxTermMonths}
              value={termMonths}
              onChange={(e) => setTermMonths(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700">Loan type</span>
            <div className="mt-1 flex gap-4 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="calc_loan_type"
                  checked={loanType === 'personal'}
                  onChange={() => onLoanTypeChange('personal')}
                  className="h-4 w-4 text-blue-600"
                />
                Personal
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="calc_loan_type"
                  checked={loanType === 'medical'}
                  onChange={() => onLoanTypeChange('medical')}
                  className="h-4 w-4 text-blue-600"
                />
                Medical
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="calc_waiver" className="block text-sm font-medium text-gray-700">
              Interest waiver
              <span className="ml-1 text-xs font-normal text-gray-400">(months, 0 to {maxWaiverMonths})</span>
            </label>
            <input
              id="calc_waiver"
              type="number"
              min="0"
              max={maxWaiverMonths}
              value={waiverMonths}
              onChange={(e) => setWaiverMonths(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="calc_start" className="block text-sm font-medium text-gray-700">
              Start date
            </label>
            <input
              id="calc_start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700">Interest rate</span>
            <input
              type="text"
              readOnly
              value={`${interestRatePct.toLocaleString('en-IN')}% per annum`}
              className="mt-1 block w-full cursor-not-allowed rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 shadow-sm"
            />
          </div>
        </div>
      </section>

      {result ? (
        <section className="rounded-2xl border border-gray-200/80 bg-white p-5">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label="Monthly EMI" value={formatRupees(result.emi)} emphasis />
            <Stat label="Total interest" value={formatRupees(result.totalInterest)} />
            <Stat label="Total payable" value={formatRupees(result.totalPayable)} />
            <Stat label="Installments" value={String(result.rows.length)} />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[6%]" />
                <col className="w-[22%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="text-left text-[11px] uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="whitespace-nowrap py-2 pr-3 text-right">#</th>
                  <th className="whitespace-nowrap py-2 pr-6">Due date</th>
                  <th className="whitespace-nowrap py-2 pr-4 text-right">EMI</th>
                  <th className="whitespace-nowrap py-2 pr-4 text-right">Principal</th>
                  <th className="whitespace-nowrap py-2 pr-4 text-right">Interest</th>
                  <th className="whitespace-nowrap py-2 pr-4 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.installmentNo} className="border-t border-gray-100">
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-gray-500">{r.installmentNo}</td>
                    <td className="whitespace-nowrap py-2 pr-6 text-gray-700">
                      {formatDate(r.dueDate)}
                      {r.isStub && (
                        <span
                          title="Pro-rated for the first month"
                          aria-label="Pro-rated for the first month"
                          className="ml-1.5 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-amber-100 text-[10px] font-semibold text-amber-700"
                        >
                          i
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-900">{formatRupees(r.emiAmount)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">{formatRupees(r.principalDue)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">{formatRupees(r.interestDue)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right text-gray-700">{formatRupees(r.closingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-gray-400">
            Reducing-balance EMI at {interestRatePct}% per annum. EMIs are due on the 10th of each
            month. A mid-month start adds a smaller, <strong>pro-rated first installment</strong> that
            covers only the partial first month. This is an estimate; the actual schedule is generated
            when the loan is recorded.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          Enter a loan amount and a valid term (1–{maxTermMonths} months) to see the EMI schedule.
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
      <p className={'mt-1 ' + (emphasis ? 'text-lg font-semibold text-gray-900' : 'text-base font-semibold text-gray-900')}>
        {value}
      </p>
    </div>
  )
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}
