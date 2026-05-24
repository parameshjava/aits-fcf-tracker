'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  upsertReference,
  deleteReference,
  type ReferenceRow,
} from '@/lib/actions/reference'
import { formatRupees } from '@/lib/format'

const SEEDED_KEYS = new Set(['bank_balance', 'interest_per_lakh'])
const MONEY_KEY = /(_balance|_amount)$|^interest_per_lakh$/
const NEW_KEY = '__new__'

// Pinned locale → server and client render the same string (no hydration drift).
const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function renderValue(key: string, value: number) {
  return MONEY_KEY.test(key) ? formatRupees(value) : value.toLocaleString('en-IN')
}

function renderDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFormatter.format(d)
}

export function ReferenceTable({ rows }: { rows: ReferenceRow[] }) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const isAnythingOpen = editingKey !== null
  const isCreating = editingKey === NEW_KEY

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          All references
        </h2>
        <button
          type="button"
          onClick={() => setEditingKey(NEW_KEY)}
          disabled={isAnythingOpen}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Add reference
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2 whitespace-nowrap">Updated</th>
              <th className="px-3 py-2">Updated by</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white text-sm">
            {isCreating && (
              <EditableRow
                mode="create"
                initial={null}
                onDone={() => setEditingKey(null)}
                onCancel={() => setEditingKey(null)}
              />
            )}

            {rows.map((row) => {
              const isEditing = editingKey === row.key
              const seeded = SEEDED_KEYS.has(row.key)
              if (isEditing) {
                return (
                  <EditableRow
                    key={row.key}
                    mode="edit"
                    initial={row}
                    onDone={() => setEditingKey(null)}
                    onCancel={() => setEditingKey(null)}
                  />
                )
              }
              return (
                <DisplayRow
                  key={row.key}
                  row={row}
                  seeded={seeded}
                  disabled={isAnythingOpen}
                  onEdit={() => setEditingKey(row.key)}
                />
              )
            })}

            {rows.length === 0 && !isCreating && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-sm text-gray-500"
                >
                  No reference values yet. Click <strong>Add reference</strong> to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DisplayRow({
  row,
  seeded,
  disabled,
  onEdit,
}: {
  row: ReferenceRow
  seeded: boolean
  disabled: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  function confirmDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteReference(row.key)
      if (result.error) {
        setError(result.error)
        setConfirmOpen(false)
        return
      }
      setConfirmOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-3 py-2 font-mono text-xs text-gray-700">{row.key}</td>
        <td className="px-3 py-2 text-gray-900">{row.name}</td>
        <td className="px-3 py-2 text-gray-600">{row.description ?? '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-900">
          {renderValue(row.key, row.value)}
        </td>
        <td className="px-3 py-2 whitespace-nowrap text-gray-500">
          {renderDate(row.updated_at)}
        </td>
        <td className="px-3 py-2 text-gray-500">{row.updated_by_name ?? '—'}</td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            <Link
              href={`/admin/reference/${row.key}`}
              className={
                'rounded-md p-1.5 text-gray-500 hover:bg-amber-50 hover:text-amber-700 ' +
                (disabled || pending ? 'pointer-events-none opacity-40' : '')
              }
              aria-label={`Manage history for ${row.key}`}
              title="Manage history (time-windowed values)"
            >
              <HistoryIcon />
            </Link>
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled || pending}
              className="rounded-md p-1.5 text-gray-500 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Edit ${row.key}`}
              title="Edit"
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={disabled || pending || seeded}
              className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Delete ${row.key}`}
              title={seeded ? 'System reference — cannot delete' : 'Delete'}
            >
              <TrashIcon />
            </button>
          </div>
        </td>
      </tr>

      {confirmOpen && (
        <ConfirmModal
          title="Delete reference?"
          message={
            <>
              This will permanently remove{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">
                {row.key}
              </code>{' '}
              from the reference table. This action cannot be undone.
            </>
          }
          confirmLabel="Delete"
          pending={pending}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
      {error && (
        <tr>
          <td colSpan={7} className="bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </td>
        </tr>
      )}
    </>
  )
}

function EditableRow({
  mode,
  initial,
  onDone,
  onCancel,
}: {
  mode: 'create' | 'edit'
  initial: ReferenceRow | null
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [key, setKey] = useState(initial?.key ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [value, setValue] = useState(initial ? String(initial.value) : '')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    const fd = new FormData()
    fd.set('mode', mode)
    fd.set('key', key.trim())
    fd.set('name', name.trim())
    fd.set('description', description.trim())
    fd.set('value', value)
    setError(null)
    startTransition(async () => {
      const result = await upsertReference(fd)
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
      router.refresh()
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const inputCls =
    'w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <>
      <tr className="bg-blue-50/40">
        <td className="px-3 py-2 align-middle">
          {mode === 'create' ? (
            <input
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="snake_case_key"
              className={`${inputCls} font-mono text-xs`}
            />
          ) : (
            <span className="font-mono text-xs text-gray-700">{key}</span>
          )}
        </td>
        <td className="px-3 py-2 align-middle">
          <input
            autoFocus={mode === 'edit'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Display name"
            className={inputCls}
          />
        </td>
        <td className="px-3 py-2 align-middle">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Optional"
            className={inputCls}
          />
        </td>
        <td className="px-3 py-2 align-middle">
          <input
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="0"
            className={`${inputCls} text-right tabular-nums`}
          />
        </td>
        <td className="px-3 py-2 whitespace-nowrap align-middle text-xs text-gray-400">
          {mode === 'edit' ? renderDate(initial?.updated_at ?? null) : '—'}
        </td>
        <td className="px-3 py-2 align-middle text-xs text-gray-400">
          {mode === 'edit' ? initial?.updated_by_name ?? '—' : '—'}
        </td>
        <td className="px-3 py-2 align-middle">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </td>
        </tr>
      )}
    </>
  )
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string
  message: React.ReactNode
  confirmLabel: string
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onCancel()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onCancel, pending])

  return (
    <tr>
      <td colSpan={7} className="p-0">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={() => !pending && onCancel()}
            className="absolute inset-0 cursor-default bg-gray-900/40 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl ring-1 ring-black/5">
            <div className="flex gap-4 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <WarningIcon />
              </div>
              <div className="flex-1">
                <h3 id="confirm-modal-title" className="text-base font-semibold text-gray-900">
                  {title}
                </h3>
                <p className="mt-1 text-sm text-gray-600">{message}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-gray-100 bg-gray-50 px-5 py-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={onConfirm}
                disabled={pending}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? 'Deleting…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

function WarningIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
      />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
      />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.05 11a9 9 0 1 0 .55-4" />
      <polyline points="3 4 3 10 9 10" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.16-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.04-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
      />
    </svg>
  )
}
