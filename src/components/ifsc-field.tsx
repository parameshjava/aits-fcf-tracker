'use client'

import { useEffect, useRef, useState } from 'react'
import { IFSC_REGEX, lookupIfsc, type IfscDetails } from '@/lib/ifsc'

type Status = 'idle' | 'loading' | 'ok' | 'not_found' | 'network'

type Props = {
  name: string
  defaultValue?: string
  required?: boolean
  onAutofill: (bank: string, branch: string) => void
}

export function IfscField({ name, defaultValue, required, onAutofill }: Props) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [status, setStatus] = useState<Status>('idle')
  const [details, setDetails] = useState<IfscDetails | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const lastLookedUpRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const runLookup = async (raw: string) => {
    const code = raw.trim().toUpperCase()
    if (!IFSC_REGEX.test(code)) {
      setStatus('idle')
      setDetails(null)
      setConfirmed(false)
      return
    }
    if (code === lastLookedUpRef.current) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setDetails(null)
    setConfirmed(false)

    const result = await lookupIfsc(code, controller.signal)

    if (controller.signal.aborted) return
    lastLookedUpRef.current = code

    if (result.ok) {
      setDetails(result.details)
      setStatus('ok')
    } else if (result.error === 'not_found') {
      setStatus('not_found')
    } else if (result.error === 'network') {
      setStatus('network')
    } else {
      setStatus('idle')
    }
  }

  return (
    <div className="space-y-2">
      <input
        name={name}
        type="text"
        required={required}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          if (confirmed) setConfirmed(false)
        }}
        onBlur={(e) => void runLookup(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void runLookup((e.target as HTMLInputElement).value)
          }
        }}
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {status === 'loading' && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          <span className="inline-block animate-pulse">⟳</span> Looking up{' '}
          <span className="font-mono">{value.trim().toUpperCase()}</span>…
        </div>
      )}

      {status === 'ok' && details && !confirmed && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="font-semibold text-gray-900">{details.bank || '—'}</p>
          <p className="text-gray-700">{details.branch || '—'}</p>
          <p className="text-xs text-gray-500">
            {[details.city, details.state].filter(Boolean).join(', ') || '—'}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                onAutofill(details.bank, details.branch)
                setConfirmed(true)
              }}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              Use this
            </button>
            <span className="text-xs text-gray-500">
              not the right bank? edit the IFSC above
            </span>
          </div>
        </div>
      )}

      {status === 'ok' && details && confirmed && (
        <p className="text-xs text-green-700">
          ✓ {details.bank}
          {details.branch ? ` · ${details.branch}` : ''}
        </p>
      )}

      {status === 'not_found' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ IFSC not recognized. Double-check the code, or fill bank name and branch
          manually below.
        </div>
      )}

      {status === 'network' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ Couldn&apos;t reach the IFSC lookup service. Fill bank name and branch
          manually below.
        </div>
      )}
    </div>
  )
}
