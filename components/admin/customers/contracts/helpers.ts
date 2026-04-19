import { getContractLifecycleSummary } from '@/lib/customer-contracts/lifecycle'
import type {
  ContractType,
  CustomerContractRow,
  GreenFeeMode,
  CustomerContractTerminationReason,
} from '@/lib/customer-contracts/types'

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value)
}

export function contractTypeLabel(value: ContractType | string): string {
  switch (value) {
    case 'fixed':
      return 'Fast'
    case 'variable_monthly':
      return 'Rörlig månad'
    case 'variable_hourly':
      return 'Rörlig tim'
    case 'portfolio':
      return 'Portfölj'
    default:
      return value
  }
}

export function greenFeeLabel(mode: GreenFeeMode, value: number | null | undefined): string {
  if (mode === 'sek_month') {
    return value === null || value === undefined
      ? 'Grön avgift: SEK/mån'
      : `Grön avgift: ${formatNumber(value)} SEK/mån`
  }

  if (mode === 'ore_per_kwh') {
    return value === null || value === undefined
      ? 'Grön avgift: öre/kWh'
      : `Grön avgift: ${formatNumber(value)} öre/kWh`
  }

  return 'Grön avgift: ingen'
}

export function statusTone(status: string): string {
  switch (status) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
    case 'signed':
      return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300'
    case 'pending_signature':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
    case 'terminated':
    case 'cancelled':
    case 'expired':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300'
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

export function statusLabel(status: CustomerContractRow['status']): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'pending_signature':
      return 'Väntar signering'
    case 'signed':
      return 'Signerat'
    case 'active':
      return 'Aktivt'
    case 'terminated':
      return 'Avslutat'
    case 'cancelled':
      return 'Avbrutet'
    case 'expired':
      return 'Utgånget'
    default:
      return status
  }
}

export function terminationReasonLabel(
  value: CustomerContractTerminationReason | null | undefined
): string {
  switch (value) {
    case 'switch_supplier':
      return 'Byte av leverantör'
    case 'stop_supply':
      return 'Ingen fortsatt leverans'
    case 'move_out':
      return 'Utflytt'
    case 'manual_override':
      return 'Manuell rättning'
    case 'other':
      return 'Övrigt'
    default:
      return '—'
  }
}

export function parseNumberOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseIntOrNull(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseContractType(value: FormDataEntryValue | null): ContractType {
  if (value === 'fixed') return 'fixed'
  if (value === 'variable_monthly') return 'variable_monthly'
  if (value === 'portfolio') return 'portfolio'
  return 'variable_hourly'
}

export function parseGreenFeeMode(value: FormDataEntryValue | null): GreenFeeMode {
  if (value === 'sek_month') return 'sek_month'
  if (value === 'ore_per_kwh') return 'ore_per_kwh'
  return 'none'
}

export function parseTerminationReason(
  value: FormDataEntryValue | null
): CustomerContractTerminationReason | null {
  if (value === 'switch_supplier') return 'switch_supplier'
  if (value === 'stop_supply') return 'stop_supply'
  if (value === 'move_out') return 'move_out'
  if (value === 'manual_override') return 'manual_override'
  if (value === 'other') return 'other'
  return null
}

export function parseStringOrNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function parseBoolean(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1'
}

export function getSiteLabel(
  siteId: string | null | undefined,
  siteLabelsById: Map<string, string>
): string {
  if (!siteId) return 'Ingen kopplad anläggning'
  return siteLabelsById.get(siteId) ?? siteId
}

export function getCurrentContract(contracts: CustomerContractRow[]): CustomerContractRow | null {
  return (
    contracts.find((contract) => contract.status === 'active') ??
    contracts.find((contract) => contract.status === 'signed') ??
    contracts.find((contract) => contract.status === 'pending_signature') ??
    contracts.find((contract) => contract.status === 'draft') ??
    contracts[0] ??
    null
  )
}

export function getLifecycleSummary(contract: CustomerContractRow) {
  return getContractLifecycleSummary({
    startsAt: contract.starts_at,
    endsAt: contract.ends_at,
    bindingMonths: contract.binding_months,
    noticeMonths: contract.notice_months,
    terminationNoticeDate: contract.termination_notice_date,
    terminationReason: contract.termination_reason,
    autoRenewEnabled: contract.auto_renew_enabled,
    autoRenewTermMonths: contract.auto_renew_term_months,
    status: contract.status,
  })
}