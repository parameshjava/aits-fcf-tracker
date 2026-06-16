'use client'

import {
  DataTable,
  type DataTableValueArray,
  type DataTableFilterMeta,
  type DataTableExpandedRows,
  type DataTableRowToggleEvent,
} from 'primereact/datatable'
import { Column } from 'primereact/column'
import { FilterMatchMode } from 'primereact/api'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * A single column definition for {@link PrDataTable}. Mirrors the subset of
 * PrimeReact `<Column>` props the app needs, kept declarative so callers pass
 * data, not JSX. Designed to also cover members-directory + loans-list:
 *  - `body` → custom cell (pills, links, mono refs, PollModal, ExpandToggle)
 *  - `align: 'right'` → right-aligned numeric columns
 *  - `footer` → per-column totals row (e.g. "Total ₹X")
 *  - `filter`/`filterMatchMode`/`dataType` → per-column filter menus
 *  - `expander` → the expansion toggle column (row expansion needs one)
 */
export type PrColumn<T> = {
  /** Field key on the row. Drives default sort + global-filter inclusion. */
  field: keyof T & string
  header: ReactNode
  body?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  /** Sort against a different field (e.g. a numeric timestamp for a date). */
  sortField?: keyof T & string
  /** Enable a per-column filter (menu or row, per `filterDisplay`). */
  filter?: boolean
  /** Filter against a different field than `field`. */
  filterField?: string
  /** Match mode for this column's filter. Defaults by `dataType`. */
  filterMatchMode?: FilterMatchMode
  /** Hint that selects sensible default match modes + alignment. */
  dataType?: 'text' | 'numeric' | 'date'
  /** Custom filter UI (e.g. a Dropdown for a Type column). */
  filterElement?: PrColumnFilterElement
  /** Per-column footer cell — combine across columns for a totals row. */
  footer?: ReactNode
  /** Marks this as the expander toggle column for row expansion. */
  expander?: boolean
  style?: CSSProperties
  bodyClassName?: string
  headerClassName?: string
  /** Hide on stacked/mobile layout via PrimeReact's responsive class hook. */
  className?: string
}

/** Minimal shape of the options PrimeReact hands a custom filter element. */
export type PrColumnFilterElement = (options: {
  value: unknown
  filterApplyCallback: (value?: unknown, index?: number) => void
  filterCallback: (value?: unknown, index?: number) => void
  index: number
  field: string
}) => ReactNode

type PrDataTableProps<T extends Record<string, unknown>> = {
  value: T[]
  columns: PrColumn<T>[]
  dataKey: keyof T & string
  /** stack into cards below this breakpoint; falls back to horizontal scroll if omitted */
  responsiveBreakpoint?: string
  emptyMessage?: ReactNode
  /** Expanded-row template (the panel rendered under an expanded row). */
  rowExpansion?: (row: T) => ReactNode
  /** Controlled expansion state. Pair with `onRowToggle`. */
  expandedRows?: DataTableExpandedRows | T[]
  onRowToggle?: (rows: DataTableExpandedRows | T[]) => void
  /** Enables column filters: 'menu' (popover, default) or 'row' (inline). */
  filterDisplay?: 'menu' | 'row'
  /** Render a global search box in the toolbar over these fields. */
  globalFilterFields?: (keyof T & string)[]
  /** Placeholder for the global search input. */
  globalSearchPlaceholder?: string
  /** Extra toolbar content shown beside the search box (e.g. export menu). */
  header?: ReactNode
  /** Receives the current FILTERED+SORTED rows (for export / footers). */
  onValueChange?: (processedRows: T[]) => void
  /** Receives the live global-search text (for surfacing in exports). */
  onGlobalFilterChange?: (value: string) => void
  /** A pre-built PrimeReact footer column group (alternative to per-col footer). */
  footerColumnGroup?: ReactNode
  /** Opt into horizontal scrolling (wide tables) instead of card stacking. */
  scrollable?: boolean
  scrollHeight?: string
}

/** Pick a sensible default match mode when a column enables filtering. */
function defaultMatchMode(col: PrColumn<unknown>): FilterMatchMode {
  if (col.filterMatchMode) return col.filterMatchMode
  if (col.dataType === 'numeric') return FilterMatchMode.EQUALS
  if (col.dataType === 'date') return FilterMatchMode.DATE_IS
  return FilterMatchMode.CONTAINS
}

export function PrDataTable<T extends Record<string, unknown>>({
  value,
  columns,
  dataKey,
  responsiveBreakpoint = '960px',
  emptyMessage = 'No records',
  rowExpansion,
  expandedRows,
  onRowToggle,
  filterDisplay = 'menu',
  globalFilterFields,
  globalSearchPlaceholder = 'Search…',
  header,
  onValueChange,
  onGlobalFilterChange,
  footerColumnGroup,
  scrollable,
  scrollHeight,
}: PrDataTableProps<T>) {
  const hasGlobal = !!globalFilterFields && globalFilterFields.length > 0
  const hasColumnFilters = columns.some((c) => c.filter)

  // Seed the filter model from the columns once, plus a `global` entry when a
  // global search is enabled. Managed internally — callers stay declarative.
  const initialFilters = useMemo<DataTableFilterMeta>(() => {
    const f: DataTableFilterMeta = {}
    if (hasGlobal) {
      f.global = { value: null, matchMode: FilterMatchMode.CONTAINS }
    }
    for (const c of columns) {
      if (!c.filter) continue
      const key = c.filterField ?? c.field
      f[key] = {
        value: null,
        matchMode: defaultMatchMode(c as PrColumn<unknown>),
      }
    }
    return f
    // columns identity is stable per render of the caller; re-seed if it changes.
  }, [columns, hasGlobal])

  const [filters, setFilters] = useState<DataTableFilterMeta>(initialFilters)
  const [globalValue, setGlobalValue] = useState('')

  function onGlobalChange(next: string) {
    setGlobalValue(next)
    setFilters((prev) => ({
      ...prev,
      global: { value: next, matchMode: FilterMatchMode.CONTAINS },
    }))
    onGlobalFilterChange?.(next)
  }

  const showToolbar = hasGlobal || !!header
  const toolbar = showToolbar ? (
    <div className="flex items-center justify-between gap-3">
      {hasGlobal ? (
        <IconField iconPosition="left" className="flex-1 max-w-sm">
          <InputIcon className="pi pi-search" />
          <InputText
            value={globalValue}
            onChange={(e) => onGlobalChange(e.target.value)}
            placeholder={globalSearchPlaceholder}
            className="w-full"
          />
        </IconField>
      ) : (
        <span />
      )}
      {header}
    </div>
  ) : undefined

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
      emptyMessage={emptyMessage as never}
      header={toolbar}
      // Filtering -----------------------------------------------------------
      filterDisplay={hasColumnFilters || hasGlobal ? filterDisplay : undefined}
      filters={hasColumnFilters || hasGlobal ? filters : undefined}
      onFilter={(e) => setFilters(e.filters)}
      globalFilterFields={
        hasGlobal ? (globalFilterFields as string[]) : undefined
      }
      // Surface the processed (filtered + sorted) rows to the caller.
      onValueChange={
        onValueChange
          ? (rows) => onValueChange(rows as unknown as T[])
          : undefined
      }
      // Row expansion -------------------------------------------------------
      expandedRows={expandedRows as DataTableExpandedRows | undefined}
      onRowToggle={
        onRowToggle
          ? (e: DataTableRowToggleEvent) =>
              onRowToggle(e.data as DataTableExpandedRows | T[])
          : undefined
      }
      rowExpansionTemplate={
        rowExpansion ? (row) => rowExpansion(row as unknown as T) : undefined
      }
      footerColumnGroup={footerColumnGroup as never}
      scrollable={scrollable}
      scrollHeight={scrollHeight}
      // Compact density — Lara's default cell/header padding is large; `small`
      // plus the `.p-datatable-sm` overrides in globals.css restore the prior
      // tight, scannable rows + small uppercase headers this app used.
      size="small"
      tableStyle={{ minWidth: '100%' }}
    >
      {columns.map((c) => (
        <Column
          key={c.expander ? '__expander__' : c.field}
          field={c.field}
          header={c.header}
          sortable={c.sortable}
          sortField={c.sortField}
          align={c.align}
          body={c.body ? (row) => c.body!(row as unknown as T) : undefined}
          filter={c.filter}
          filterField={c.filterField}
          dataType={c.dataType}
          filterMatchMode={c.filter ? defaultMatchMode(c as PrColumn<unknown>) : undefined}
          filterElement={
            c.filterElement
              ? (opts) =>
                  c.filterElement!({
                    value: opts.value,
                    filterApplyCallback: opts.filterApplyCallback,
                    filterCallback: opts.filterCallback,
                    index: opts.index,
                    field: opts.field,
                  })
              : undefined
          }
          showFilterMatchModes={c.filterElement ? false : undefined}
          footer={c.footer as never}
          expander={c.expander}
          style={c.style}
          bodyClassName={c.bodyClassName}
          headerClassName={c.headerClassName}
          className={c.className}
        />
      ))}
    </DataTable>
  )
}
