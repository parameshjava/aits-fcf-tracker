'use client'

import { useTransition } from 'react'
import { deleteBankAccount } from '@/lib/actions/bank-accounts'
import { DeleteIconButton } from '@/components/ui/delete-icon-button'
import type { MemberBankAccount } from '@/lib/actions/members'

function maskAccountNumber(num: string): string {
  if (!num) return '—'
  if (num.length <= 4) return num
  return `••••${num.slice(-4)}`
}

/**
 * Read-with-remove list of a member's bank accounts. The add form is rendered
 * externally by the directory accordion's MemberDetailPanel (so the "+ Bank
 * Account" CTA can live up in the meta strip).
 */
export function MemberBankAccountsManager({
  accounts,
  canEdit,
}: {
  accounts: MemberBankAccount[]
  /** Hides the Remove column for read-only viewers. */
  canEdit: boolean
}) {
  const [pendingDelete, startDelete] = useTransition()

  function handleDelete(id: string) {
    if (!confirm('Remove this bank account?')) return
    startDelete(async () => {
      await deleteBankAccount(id)
    })
  }

  if (accounts.length === 0) {
    return <p className="text-xs text-gray-400">No bank accounts on file yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-[34rem] text-xs">
        <thead>
          <tr className="bg-gray-50/60 text-left text-[10px] uppercase tracking-wider text-gray-500">
            <th className="px-3 py-2">Bank</th>
            <th className="px-3 py-2">Account #</th>
            <th className="px-3 py-2">IFSC</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">UPI</th>
            {canEdit && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {accounts.map((b) => (
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
              {canEdit && (
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <DeleteIconButton
                    onClick={() => handleDelete(b.id)}
                    disabled={pendingDelete}
                    label={`Remove bank account at ${b.bank_name}`}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
