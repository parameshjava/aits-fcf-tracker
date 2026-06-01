// Client-side table export helpers — CSV (Excel) and PDF.
//
// CSV is hand-rolled (no dependency). PDF lazy-imports jspdf + jspdf-autotable
// only when the user actually exports, so the ~200KB library never lands in
// the initial bundle. Both run in the browser (they touch `document` / Blob),
// so only import these from client components.

export type Cell = string | number | null | undefined

/** A single applied filter / search term, surfaced atop the export. */
export type ExportCriterion = { label: string; value: string }

export type ExportData = {
  /** Base file name without extension, e.g. "contributions-2026". */
  filename: string
  /** Human title rendered at the top of the PDF (defaults to filename). */
  title?: string
  /** Column headers, left-to-right. */
  columns: string[]
  /** Row matrix aligned to `columns`. Numbers stay numeric so Excel can sum. */
  rows: Cell[][]
  /** Optional footer row (e.g. a totals line) appended to both formats. */
  footer?: Cell[]
  /** Applied filters / search shown above the data in both formats. */
  criteria?: ExportCriterion[]
}

function cellToCsv(value: Cell): string {
  if (value == null) return ''
  const s = String(value)
  // Escape if the field contains a comma, quote, or newline (RFC 4180).
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function exportToCsv({ filename, columns, rows, footer, criteria }: ExportData) {
  // Criteria go at the very top as `label,value` rows, then a blank line.
  const criteriaLines = (criteria ?? []).map((c) =>
    [cellToCsv(c.label), cellToCsv(c.value)].join(','),
  )
  const dataLines = [columns, ...rows, ...(footer ? [footer] : [])].map((row) =>
    row.map(cellToCsv).join(','),
  )
  const lines = criteriaLines.length > 0 ? [...criteriaLines, '', ...dataLines] : dataLines
  // Prepend a UTF-8 BOM so Excel renders ₹ / Unicode names correctly.
  const csv = '﻿' + lines.join('\r\n')
  triggerDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `${filename}.csv`,
  )
}

export async function exportToPdf({
  filename,
  title,
  columns,
  rows,
  footer,
  criteria,
}: ExportData) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  // Landscape for wide tables (>6 columns), portrait otherwise.
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' })

  const heading = title ?? filename
  doc.setFontSize(14)
  doc.setTextColor(17)
  doc.text(heading, 14, 16)
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(
    `Generated ${new Date().toLocaleString('en-IN')} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`,
    14,
    22,
  )

  // Applied-criteria block under the subtitle, one line per filter.
  let cursorY = 22
  for (const c of criteria ?? []) {
    cursorY += 5
    doc.text(`${c.label}: ${c.value}`, 14, cursorY)
  }

  autoTable(doc, {
    head: [columns],
    body: rows.map((r) => r.map((c) => (c == null ? '' : String(c)))),
    foot: footer ? [footer.map((c) => (c == null ? '' : String(c)))] : undefined,
    startY: cursorY + 5,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 }, // brand blue-600
    footStyles: { fillColor: [243, 244, 246], textColor: 17, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [249, 250, 251] },
  })

  doc.save(`${filename}.pdf`)
}
