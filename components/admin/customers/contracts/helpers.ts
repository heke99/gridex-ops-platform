//components/admin/customers/contracts/helpers.ts
import { getContractLifecycleSummary } from '@/lib/customer-contracts/lifecycle'
import type {
  ContractType,
  CustomerContractRow,
  GreenFeeMode,
  CustomerContractTerminationReason,
} from '@/lib/customer-contracts/types'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

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
      return 'Kund avslutar helt'
    case 'move_out':
      return 'Move out / utflytt'
    case 'manual_override':
      return 'Manuell override / felregistrering'
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

export type ContractUiRecommendation = {
  id: string
  title: string
  description: string
  href: string
  ctaLabel: string
  tone: 'neutral' | 'warning' | 'danger' | 'success'
}

export type ContractEditQuickAction = {
  id: string
  title: string
  description: string
  href: string
  label: string
  tone: 'neutral' | 'warning' | 'danger' | 'success'
}

export type ContractMiniGlossaryItem = {
  id: string
  term: string
  explanation: string
}

export type ContractOpsContext = {
  switchRequests: SupplierSwitchRequestRow[]
  outboundRequests: OutboundRequestRow[]
}

export function getContractSituation(contract: CustomerContractRow): {
  title: string
  description: string
  tone: 'neutral' | 'warning' | 'danger' | 'success'
} {
  const lifecycle = getLifecycleSummary(contract)

  if (contract.status === 'terminated') {
    return {
      title: 'Avtalet är avslutat',
      description:
        'Kontrollera att slutdatum, uppsägningsorsak och eventuell efterhantering är korrekt registrerade.',
      tone: 'danger',
    }
  }

  if (contract.status === 'cancelled') {
    return {
      title: 'Avtalet är avbrutet',
      description:
        'Det här avtalet fullföljdes inte. Säkerställ att orsaken är tydligt dokumenterad.',
      tone: 'danger',
    }
  }

  if (contract.status === 'expired') {
    return {
      title: 'Avtalet har gått ut',
      description:
        'Säkerställ om kunden ska ha nytt avtal, automatisk förlängning eller formellt avslut.',
      tone: 'warning',
    }
  }

  if (lifecycle.terminationPending) {
    return {
      title: 'Uppsägning är registrerad',
      description: 'Det finns en mottagen uppsägning som nu måste följas upp operativt.',
      tone: 'warning',
    }
  }

  if (contract.status === 'active') {
    return {
      title: 'Avtalet är aktivt',
      description:
        'Avtalet är i drift. Kontrollera slutlogik, förlängning och uppsägningsflaggor vid behov.',
      tone: 'success',
    }
  }

  if (contract.status === 'signed') {
    return {
      title: 'Avtalet är signerat',
      description:
        'Avtalet är signerat men bör följas upp så att rätt driftläge och avtalsperiod gäller.',
      tone: 'neutral',
    }
  }

  if (contract.status === 'pending_signature') {
    return {
      title: 'Avtalet väntar på signering',
      description: 'Det här avtalet är ännu inte färdigsignerat och bör följas upp.',
      tone: 'warning',
    }
  }

  return {
    title: 'Avtalet kräver handpåläggning',
    description: 'Granska status, datum och eventuella manuella avvikelser.',
    tone: 'neutral',
  }
}

export function getContractUiRecommendations(
  contract: CustomerContractRow,
  customerId: string
): ContractUiRecommendation[] {
  const lifecycle = getLifecycleSummary(contract)
  const baseCustomerHref = `/admin/customers/${customerId}`

  const recommendations: ContractUiRecommendation[] = []

  if (
    contract.termination_notice_date &&
    !contract.termination_reason &&
    contract.status !== 'terminated' &&
    contract.status !== 'cancelled'
  ) {
    recommendations.push({
      id: 'missing-termination-reason',
      title: 'Komplettera uppsägningsorsak',
      description:
        'Uppsägning är mottagen men avtalet saknar tydlig orsak. Det gör efterföljande operationsarbete otydligt.',
      href: `${baseCustomerHref}#contracts`,
      ctaLabel: 'Öppna avtalet',
      tone: 'warning',
    })
  }

  if (contract.termination_reason === 'switch_supplier') {
    recommendations.push({
      id: 'switch-supplier',
      title: 'Följ upp leverantörsbyte',
      description:
        'Detta avtal är markerat som kund byter leverantör. Kontrollera att switchflödet finns och följs upp i operationsdelen.',
      href: `${baseCustomerHref}#switch-operations`,
      ctaLabel: 'Gå till leverantörsbyte',
      tone: 'warning',
    })
  }

  if (contract.termination_reason === 'move_out') {
    recommendations.push({
      id: 'move-out',
      title: 'Följ upp utflytt / övertag',
      description:
        'Avtalet är markerat som move out. Kontrollera om anläggningen ska avslutas, lämnas eller tas över i kundflödet.',
      href: `${baseCustomerHref}#switch-operations`,
      ctaLabel: 'Gå till operations',
      tone: 'warning',
    })
  }

  if (contract.termination_reason === 'stop_supply') {
    recommendations.push({
      id: 'stop-supply',
      title: 'Verifiera rent avslut',
      description:
        'Kunden avslutar helt. Säkerställ att slutdatum, fortsatt leverans och eventuell efterhantering är korrekt.',
      href: `${baseCustomerHref}#contracts`,
      ctaLabel: 'Granska avtalet',
      tone: 'danger',
    })
  }

  if (contract.termination_reason === 'manual_override') {
    recommendations.push({
      id: 'manual-override',
      title: 'Verifiera manuell rättning',
      description:
        'Avtalet bygger på manuell override eller felregistrering. Kontrollera att override reason verkligen förklarar avvikelsen.',
      href: `${baseCustomerHref}#contracts`,
      ctaLabel: 'Granska override',
      tone: 'neutral',
    })
  }

  if (
    ['terminated', 'cancelled'].includes(contract.status) &&
    !contract.termination_notice_date &&
    !contract.override_reason
  ) {
    recommendations.push({
      id: 'missing-termination-context',
      title: 'Saknar avslutskontext',
      description:
        'Avtalet är avslutat eller avbrutet men saknar tydlig uppsägningsdag eller override-förklaring.',
      href: `${baseCustomerHref}#contracts`,
      ctaLabel: 'Komplettera avtalet',
      tone: 'danger',
    })
  }

  if (
    contract.auto_renew_enabled &&
    !lifecycle.terminationPending &&
    lifecycle.nextRenewalDate
  ) {
    recommendations.push({
      id: 'auto-renew-active',
      title: 'Automatisk förlängning är aktiv',
      description: `Avtalet fortsätter enligt förlängningslogiken om ingen uppsägning registreras före ${formatDateOnly(
        lifecycle.nextRenewalDate
      )}.`,
      href: `${baseCustomerHref}#contracts`,
      ctaLabel: 'Granska förlängning',
      tone: 'success',
    })
  }

  return recommendations
}

export function getContractMiniGlossary(): ContractMiniGlossaryItem[] {
  return [
    {
      id: 'switch',
      term: 'Switch',
      explanation:
        'Betyder leverantörsbyte. Kunden lämnar nuvarande elleverantör och byter till en annan.',
    },
    {
      id: 'move-out',
      term: 'Move out',
      explanation:
        'Betyder utflytt. Kunden flyttar från adressen eller anläggningen och avtalet behöver följas upp därefter.',
    },
    {
      id: 'termination-notice',
      term: 'Uppsägning mottagen',
      explanation:
        'Datumet då kunden faktiskt meddelade att avtalet ska sägas upp eller avslutas.',
    },
    {
      id: 'auto-renew',
      term: 'Automatisk förlängning',
      explanation:
        'Avtalet fortsätter automatiskt enligt nästa period om kunden inte säger upp i tid.',
    },
    {
      id: 'override',
      term: 'Override',
      explanation:
        'En manuell rättning eller avvikelse från standardflödet, till exempel om något tidigare registrerats fel.',
    },
  ]
}

function sortByNewestTimestamp<T extends { created_at?: string | null; updated_at?: string | null }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const aTs = new Date(a.updated_at ?? a.created_at ?? 0).getTime()
    const bTs = new Date(b.updated_at ?? b.created_at ?? 0).getTime()
    return bTs - aTs
  })
}

function getRelevantSwitchRequests(
  contract: CustomerContractRow,
  switchRequests: SupplierSwitchRequestRow[]
): SupplierSwitchRequestRow[] {
  const sameSite = switchRequests.filter((row) => row.site_id === contract.site_id)

  if (contract.termination_reason === 'switch_supplier') {
    return sortByNewestTimestamp(
      sameSite.filter((row) => row.request_type === 'switch')
    )
  }

  if (contract.termination_reason === 'move_out') {
    return sortByNewestTimestamp(
      sameSite.filter((row) => row.request_type === 'move_out_takeover')
    )
  }

  return sortByNewestTimestamp(sameSite)
}

function getRelevantOutboundRequests(
  relevantSwitchRequests: SupplierSwitchRequestRow[],
  outboundRequests: OutboundRequestRow[]
): OutboundRequestRow[] {
  const switchIds = new Set(relevantSwitchRequests.map((row) => row.id))

  return sortByNewestTimestamp(
    outboundRequests.filter(
      (row) =>
        row.request_type === 'supplier_switch' &&
        row.source_type === 'supplier_switch_request' &&
        row.source_id &&
        switchIds.has(row.source_id)
    )
  )
}

export function getContractOpsStatus(
  contract: CustomerContractRow,
  opsContext?: ContractOpsContext | null
): {
  relevantSwitchRequests: SupplierSwitchRequestRow[]
  relevantOutboundRequests: OutboundRequestRow[]
  switchSummary: string
  outboundSummary: string
} {
  if (!opsContext) {
    return {
      relevantSwitchRequests: [],
      relevantOutboundRequests: [],
      switchSummary: 'Ingen operationsdata laddad',
      outboundSummary: 'Ingen outbounddata laddad',
    }
  }

  const relevantSwitchRequests = getRelevantSwitchRequests(contract, opsContext.switchRequests)
  const relevantOutboundRequests = getRelevantOutboundRequests(
    relevantSwitchRequests,
    opsContext.outboundRequests
  )

  let switchSummary = 'Ingen switch hittad'
  if (relevantSwitchRequests.length > 0) {
    const latest = relevantSwitchRequests[0]
    switchSummary = `Switch finns (${latest.request_type} • ${latest.status})`
  }

  let outboundSummary = 'Ingen outbound hittad'
  if (relevantOutboundRequests.length > 0) {
    const latest = relevantOutboundRequests[0]
    outboundSummary = `Outbound finns (${latest.status} • ${latest.channel_type})`
  }

  return {
    relevantSwitchRequests,
    relevantOutboundRequests,
    switchSummary,
    outboundSummary,
  }
}

export function getContractEditQuickActions(
  contract: CustomerContractRow,
  customerId: string,
  opsContext?: ContractOpsContext | null
): ContractEditQuickAction[] {
  const actions: ContractEditQuickAction[] = []
  const baseCustomerHref = `/admin/customers/${customerId}`
  const lifecycle = getLifecycleSummary(contract)
  const ops = getContractOpsStatus(contract, opsContext)

  if (
    contract.termination_notice_date &&
    !contract.termination_reason &&
    contract.status !== 'terminated' &&
    contract.status !== 'cancelled'
  ) {
    actions.push({
      id: 'missing-termination-reason',
      title: 'Komplettera uppsägningsorsak',
      description:
        'Uppsägning är registrerad men orsak saknas fortfarande. Spara avtalet efter att du fyllt i rätt orsak.',
      href: `${baseCustomerHref}#contracts`,
      label: 'Stanna i avtalsdelen',
      tone: 'warning',
    })
  }

  if (contract.termination_reason === 'switch_supplier') {
    if (ops.relevantSwitchRequests.length === 0) {
      actions.push({
        id: 'switch-missing',
        title: 'Switch saknas',
        description:
          'Avtalet är markerat som leverantörsbyte men inget switchärende hittades ännu för anläggningen.',
        href: `${baseCustomerHref}#switch-operations`,
        label: 'Skapa / granska switch',
        tone: 'danger',
      })
    } else if (ops.relevantOutboundRequests.length === 0) {
      const latestSwitch = ops.relevantSwitchRequests[0]
      actions.push({
        id: 'switch-exists-no-outbound',
        title: 'Switch finns men outbound saknas',
        description: `Switchärende finns redan (${latestSwitch.status}) men inget outbound hittades ännu.`,
        href: `${baseCustomerHref}#switch-operations`,
        label: 'Följ upp switch',
        tone: 'warning',
      })
    } else {
      const latestOutbound = ops.relevantOutboundRequests[0]
      const tone =
        latestOutbound.status === 'failed'
          ? 'danger'
          : latestOutbound.status === 'acknowledged'
            ? 'success'
            : 'warning'

      actions.push({
        id: 'switch-with-outbound',
        title:
          latestOutbound.status === 'failed'
            ? 'Switch outbound har fallerat'
            : latestOutbound.status === 'acknowledged'
              ? 'Switch outbound är kvitterad'
              : 'Switch outbound pågår',
        description: `Senaste outbound är ${latestOutbound.status} via ${latestOutbound.channel_type}.`,
        href: `${baseCustomerHref}#switch-operations`,
        label: 'Öppna switchstatus',
        tone,
      })
    }
  }

  if (contract.termination_reason === 'move_out') {
    if (ops.relevantSwitchRequests.length === 0) {
      actions.push({
        id: 'move-out-missing',
        title: 'Utflytt markerad men inget ärende hittat',
        description:
          'Avtalet är markerat som move out men inget relevant switch-/operationsärende hittades ännu.',
        href: `${baseCustomerHref}#switch-operations`,
        label: 'Öppna operations',
        tone: 'danger',
      })
    } else {
      const latestSwitch = ops.relevantSwitchRequests[0]
      actions.push({
        id: 'move-out-exists',
        title: 'Utflyttsärende finns redan',
        description: `Relevant ärende finns redan (${latestSwitch.request_type} • ${latestSwitch.status}).`,
        href: `${baseCustomerHref}#switch-operations`,
        label: 'Följ upp utflytt',
        tone: latestSwitch.status === 'failed' ? 'danger' : 'warning',
      })
    }
  }

  if (contract.termination_reason === 'stop_supply') {
    actions.push({
      id: 'stop-supply',
      title: 'Verifiera rent avslut',
      description:
        'Kunden avslutar helt. Säkerställ att slutdatum, uppsägningstid och eventuell efterhantering är korrekt.',
      href: `${baseCustomerHref}#contracts`,
      label: 'Granska avslut',
      tone: 'danger',
    })
  }

  if (contract.termination_reason === 'manual_override') {
    actions.push({
      id: 'manual-override',
      title: 'Verifiera override',
      description:
        'Det här avtalet bygger på manuell override eller felregistrering. Säkerställ att override-texten förklarar avvikelsen.',
      href: `${baseCustomerHref}#contracts`,
      label: 'Granska override',
      tone: 'neutral',
    })
  }

  if (
    ['terminated', 'cancelled'].includes(contract.status) &&
    !contract.termination_notice_date &&
    !contract.override_reason
  ) {
    actions.push({
      id: 'missing-termination-context',
      title: 'Komplettera avslutskontext',
      description:
        'Avtalet är avslutat eller avbrutet men saknar fortfarande tydlig avslutsförklaring.',
      href: `${baseCustomerHref}#contracts`,
      label: 'Komplettera avtalet',
      tone: 'danger',
    })
  }

  if (
    contract.auto_renew_enabled &&
    !lifecycle.terminationPending &&
    lifecycle.nextRenewalDate
  ) {
    actions.push({
      id: 'auto-renew-active',
      title: 'Aktiv auto-förlängning',
      description:
        'Avtalet förlängs automatiskt om ingen uppsägning registreras. Kontrollera att förlängningslogiken fortfarande är rätt.',
      href: `${baseCustomerHref}#contracts`,
      label: 'Granska förlängning',
      tone: 'success',
    })
  }

  return actions
}