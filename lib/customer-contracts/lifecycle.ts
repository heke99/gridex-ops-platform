import type { CustomerContractRow, CustomerContractTerminationReason } from './types'

type ContractLifecycleInput = {
  startsAt?: string | null
  endsAt?: string | null
  bindingMonths?: number | null
  noticeMonths?: number | null
  terminationNoticeDate?: string | null
  terminationReason?: CustomerContractTerminationReason | null
  autoRenewEnabled?: boolean | null
  autoRenewTermMonths?: number | null
  status?: CustomerContractRow['status'] | null
}

export type ContractLifecycleSummary = {
  startsAt: string | null
  explicitEndsAt: string | null
  boundUntil: string | null
  noticeEffectiveEndDate: string | null
  effectiveEndDate: string | null
  terminationPending: boolean
  terminationAllowedNow: boolean
  bindingActive: boolean
  autoRenewEnabled: boolean
  autoRenewTermMonths: number | null
  autoRenewCandidate: boolean
  currentTermStart: string | null
  currentTermEnd: string | null
  nextRenewalDate: string | null
  terminationReason: CustomerContractTerminationReason | null
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const datePart = trimmed.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null
  return datePart
}

function parseUtcDate(value: string | null | undefined): Date | null {
  const normalized = normalizeDate(value)
  if (!normalized) return null

  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatUtcDate(date: Date | null): string | null {
  if (!date) return null
  return date.toISOString().slice(0, 10)
}

function clampDay(year: number, monthIndex: number, day: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate() < day
    ? new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
    : day
}

function addMonths(dateValue: string | null | undefined, months: number | null | undefined): string | null {
  const base = parseUtcDate(dateValue)
  if (!base) return null
  const safeMonths = typeof months === 'number' && Number.isFinite(months) ? months : 0
  if (safeMonths <= 0) return formatUtcDate(base)

  const year = base.getUTCFullYear()
  const monthIndex = base.getUTCMonth()
  const day = base.getUTCDate()
  const targetMonthIndex = monthIndex + safeMonths
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12
  const nextDay = clampDay(targetYear, normalizedMonthIndex, day)

  return formatUtcDate(new Date(Date.UTC(targetYear, normalizedMonthIndex, nextDay)))
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function getRenewalTermMonths(input: ContractLifecycleInput): number | null {
  const autoRenewTermMonths =
    typeof input.autoRenewTermMonths === 'number' && Number.isFinite(input.autoRenewTermMonths)
      ? input.autoRenewTermMonths
      : null

  if (autoRenewTermMonths && autoRenewTermMonths > 0) {
    return autoRenewTermMonths
  }

  const bindingMonths =
    typeof input.bindingMonths === 'number' && Number.isFinite(input.bindingMonths)
      ? input.bindingMonths
      : null

  if (bindingMonths && bindingMonths > 0) {
    return bindingMonths
  }

  return null
}

function getRollingTermWindow(
  startsAt: string | null,
  renewalTermMonths: number | null,
  referenceDate: string
): { currentTermStart: string | null; currentTermEnd: string | null; nextRenewalDate: string | null } {
  if (!startsAt || !renewalTermMonths || renewalTermMonths <= 0) {
    return {
      currentTermStart: startsAt,
      currentTermEnd: startsAt,
      nextRenewalDate: null,
    }
  }

  let currentTermStart = startsAt
  let currentTermEnd = addMonths(currentTermStart, renewalTermMonths)

  while (currentTermEnd && referenceDate >= currentTermEnd) {
    currentTermStart = currentTermEnd
    currentTermEnd = addMonths(currentTermStart, renewalTermMonths)
  }

  return {
    currentTermStart,
    currentTermEnd,
    nextRenewalDate: currentTermEnd,
  }
}

export function deriveContractEndsAt(input: ContractLifecycleInput): string | null {
  const explicitEndsAt = normalizeDate(input.endsAt)
  if (explicitEndsAt) return explicitEndsAt

  const startsAt = normalizeDate(input.startsAt)
  const terminationNoticeDate = normalizeDate(input.terminationNoticeDate)

  const boundUntil = startsAt
    ? addMonths(startsAt, input.bindingMonths ?? 0)
    : null

  const noticeEffectiveEndDate = terminationNoticeDate
    ? addMonths(terminationNoticeDate, input.noticeMonths ?? 0)
    : null

  return maxDate(boundUntil, noticeEffectiveEndDate)
}

export function getContractLifecycleSummary(
  input: ContractLifecycleInput,
  referenceDate = todayIso()
): ContractLifecycleSummary {
  const startsAt = normalizeDate(input.startsAt)
  const explicitEndsAt = normalizeDate(input.endsAt)
  const terminationNoticeDate = normalizeDate(input.terminationNoticeDate)
  const boundUntil = startsAt ? addMonths(startsAt, input.bindingMonths ?? 0) : null
  const noticeEffectiveEndDate = terminationNoticeDate
    ? addMonths(terminationNoticeDate, input.noticeMonths ?? 0)
    : null
  const effectiveEndDate = explicitEndsAt ?? maxDate(boundUntil, noticeEffectiveEndDate)
  const bindingActive = Boolean(boundUntil && boundUntil > referenceDate)
  const autoRenewEnabled = Boolean(input.autoRenewEnabled)
  const autoRenewTermMonths = getRenewalTermMonths(input)
  const autoRenewCandidate =
    autoRenewEnabled &&
    !terminationNoticeDate &&
    Boolean(startsAt && autoRenewTermMonths && autoRenewTermMonths > 0) &&
    !['cancelled', 'terminated', 'expired'].includes(input.status ?? '')

  const rollingWindow = autoRenewCandidate
    ? getRollingTermWindow(startsAt, autoRenewTermMonths, referenceDate)
    : {
        currentTermStart: startsAt,
        currentTermEnd: effectiveEndDate,
        nextRenewalDate: null,
      }

  const terminationPending = Boolean(
    terminationNoticeDate && input.status !== 'terminated' && input.status !== 'cancelled'
  )

  return {
    startsAt,
    explicitEndsAt,
    boundUntil,
    noticeEffectiveEndDate,
    effectiveEndDate,
    terminationPending,
    terminationAllowedNow: !bindingActive,
    bindingActive,
    autoRenewEnabled,
    autoRenewTermMonths,
    autoRenewCandidate,
    currentTermStart: rollingWindow.currentTermStart,
    currentTermEnd: rollingWindow.currentTermEnd,
    nextRenewalDate: rollingWindow.nextRenewalDate,
    terminationReason: input.terminationReason ?? null,
  }
}