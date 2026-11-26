import type { DeviationRow } from '@/lib/analytics/types'

export const OPEN_DEVIATIONS_REPORT = 'open_deviations'

const PAGE_SIZE = 50

export function deviationPage(rows: DeviationRow[], requestedPage?: string | string[] | null) {
  const value = Array.isArray(requestedPage) ? requestedPage[0] : requestedPage
  const requested = Number.parseInt(value ?? '1', 10) || 1
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, requested), lastPage)

  return { page, lastPage, displayed: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) }
}
