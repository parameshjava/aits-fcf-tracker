'use client'

import { DataTable, type DataTableValueArray } from 'primereact/datatable'
import { Column } from 'primereact/column'
import type { ReactNode } from 'react'

export type PrColumn<T> = {
  field: keyof T & string
  header: ReactNode
  body?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
}

type PrDataTableProps<T extends Record<string, unknown>> = {
  value: T[]
  columns: PrColumn<T>[]
  dataKey: keyof T & string
  /** stack into cards below this breakpoint; falls back to horizontal scroll if omitted */
  responsiveBreakpoint?: string
  emptyMessage?: string
  rowExpansion?: (row: T) => ReactNode
}

export function PrDataTable<T extends Record<string, unknown>>({
  value,
  columns,
  dataKey,
  responsiveBreakpoint = '960px',
  emptyMessage = 'No records',
  rowExpansion,
}: PrDataTableProps<T>) {
  return (
    <DataTable
      value={value as unknown as DataTableValueArray}
      dataKey={dataKey}
      // NOTE: `responsiveLayout` is marked @deprecated since PrimeReact 9.2.0
      // in datatable.d.ts, but it is still present and functional in 10.9.7
      // (not removed). Kept per the wrapper spec; if a future major drops it,
      // switch the stack-vs-scroll decision to `scrollable` + breakpoint CSS.
      responsiveLayout="stack"
      breakpoint={responsiveBreakpoint}
      emptyMessage={emptyMessage}
      rowExpansionTemplate={
        rowExpansion ? (row) => rowExpansion(row as unknown as T) : undefined
      }
      tableStyle={{ minWidth: '100%' }}
    >
      {columns.map((c) => (
        <Column
          key={c.field}
          field={c.field}
          header={c.header}
          sortable={c.sortable}
          align={c.align}
          body={c.body ? (row) => c.body!(row as unknown as T) : undefined}
        />
      ))}
    </DataTable>
  )
}
