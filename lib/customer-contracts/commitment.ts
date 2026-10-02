/**
 * Contract commitment: is a contract still binding, and does it carry a notice period?
 *
 * Used when a change of contract party (e.g. a new personal number) would move the contract to
 * another person. A contract that is binding or has a notice period may only be taken over when
 * the new party explicitly accepts it together with its terms.
 *
 * Rules (dates in Europe/Stockholm calendar days, ISO yyyy-mm-dd):
 * - Only contracts that bind the customer count: pending_signature, signed, active.
 * - Binding end = start + binding_months when binding_months > 0 (start = actual, confirmed,
 *   planned or expected start; a binding contract that has not started yet is binding).
 *   A fixed-term contract (any type that is not variable/spot) with ends_at in the future is
 *   binding until ends_at.
 * - Notice period: notice_months > 0, or a registered termination whose end date has not passed.
 */

export type CommitmentContract = {
  id: string
  status: string | null
  contract_type?: string | null
  binding_months?: number | null
  notice_months?: number | null
  ends_at?: string | null
  termination_notice_date?: string | null
  actual_start_at?: string | null
  confirmed_start_at?: string | null
  starts_at?: string | null
  expected_start_at?: string | null
}

export type ContractCommitment = {
  contractId: string
  binding: boolean
  bindingEndsOn: string | null
  noticeMonths: number | null
  terminationPending: boolean
  requiresTakeover: boolean
}

const COMMITTING_STATUSES = new Set(['pending_signature', 'signed', 'active'])
const VARIABLE_TYPES = /^(variable|spot)/

function isoDay(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match ? match[1] : null
}

/** Adds whole calendar months; clamps to the last day of the target month (31 Jan + 1 → 28/29 Feb). */
export function addMonthsIso(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const targetMonthIndex = month - 1 + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  const clamped = Math.min(date, lastDay)
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`
}

export function todayInStockholm(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function contractCommitment(contract: CommitmentContract, today = todayInStockholm()): ContractCommitment {
  const committing = COMMITTING_STATUSES.has(String(contract.status ?? ''))
  const start = isoDay(contract.actual_start_at) ?? isoDay(contract.confirmed_start_at) ?? isoDay(contract.starts_at) ?? isoDay(contract.expected_start_at)
  const bindingMonths = Number(contract.binding_months ?? 0)
  const endsOn = isoDay(contract.ends_at)

  let bindingEndsOn: string | null = null
  if (bindingMonths > 0) bindingEndsOn = start ? addMonthsIso(start, bindingMonths) : null
  const fixedTerm = !VARIABLE_TYPES.test(String(contract.contract_type ?? '').toLowerCase()) && endsOn !== null
  if (fixedTerm && (bindingEndsOn === null || endsOn! > bindingEndsOn)) bindingEndsOn = endsOn

  const binding = committing && (
    (bindingMonths > 0 && (start === null || (bindingEndsOn !== null && bindingEndsOn > today)))
    || (fixedTerm && endsOn! > today)
  )
  const noticeMonths = Number(contract.notice_months ?? 0) > 0 ? Number(contract.notice_months) : null
  const terminationPending = committing && isoDay(contract.termination_notice_date) !== null && (endsOn === null || endsOn > today)

  return {
    contractId: contract.id,
    binding,
    bindingEndsOn: binding ? bindingEndsOn : null,
    noticeMonths: committing ? noticeMonths : null,
    terminationPending,
    requiresTakeover: committing && (binding || noticeMonths !== null || terminationPending),
  }
}
