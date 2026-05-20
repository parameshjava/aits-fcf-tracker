'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export function YearPicker({ years, value }: { years: number[]; value: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return (
    <label className="flex items-center gap-2 text-sm text-gray-600">
      Year
      <select
        value={value}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString())
          params.set('year', e.target.value)
          router.push(`${pathname}?${params.toString()}`)
        }}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm font-medium text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  )
}
