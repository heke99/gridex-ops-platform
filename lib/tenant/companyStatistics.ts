import { supabaseService } from '@/lib/supabase/service'

export type CompanyStatisticsRangeKey =
  | 'current_month'
  | 'previous_month'
  | 'last_3_months'
  | 'last_12_months'
  | 'custom'

export type CompanyStatisticsRange = {
  key: CompanyStatisticsRangeKey
  label: string
  from: string
  to: string
}

export type CompanyBillingStatistic = {
  key: string
  label: string
  value: number
  description: string
  billingHint?: string
}

export type CompanyRoleStatistic = {
  role: string
  count: number
}

export type CompanyMonthlyVolume = {
  month: string
  customers: number
  edielMessages: number
  meteringValues: number
  authorizations: number
  billingUnderlays: number
  partnerExports: number
}

export type CompanyBillingStatistics = {
  range: CompanyStatisticsRange
  totals: CompanyBillingStatistic[]
  roleBreakdown: CompanyRoleStatistic[]
  monthlyVolumes: CompanyMonthlyVolume[]
}

type CountFilter = {
  column: string
  value: string | number | boolean | string[]
  op?: 'eq' | 'in' | 'neq'
}

type TableMetric = {
  key: string
  label: string
  table: string
  description: string
  billingHint?: string
  dateColumn?: string
  filters?: CountFilter[]
}

const MONTH_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: 'short',
})

const TABLE_METRICS: TableMetric[] = [
  {
    key: 'customers_total',
    label: 'Kunder',
    table: 'customers',
    description: 'Alla kunder som hör till bolaget.',
    billingHint: 'Kan användas för pris per kund.',
  },
  {
    key: 'customers_active',
    label: 'Aktiva kunder',
    table: 'customers',
    description: 'Kunder utan avslutad/inaktiv status där kolumnen finns.',
    billingHint: 'Kan användas för aktiv kundbas.',
    filters: [{ column: 'status', value: ['active', 'onboarding', 'current'], op: 'in' }],
  },
  {
    key: 'contracts_total',
    label: 'Avtal',
    table: 'customer_contracts',
    description: 'Avtal kopplade till bolaget.',
    billingHint: 'Kan användas för avtal/kontraktvolym.',
  },
  {
    key: 'sites_total',
    label: 'Anläggningar',
    table: 'customer_sites',
    description: 'Kundens anläggningar/uttagspunkter.',
    billingHint: 'Kan användas för pris per anläggning.',
  },
  {
    key: 'metering_points_total',
    label: 'Mätpunkter',
    table: 'metering_points',
    description: 'Fakturagrundande mätpunkter.',
    billingHint: 'Kan användas för pris per mätpunkt.',
  },
  {
    key: 'metering_values_imported',
    label: 'Importerade mätvärden',
    table: 'metering_values',
    description: 'Importerade eller mottagna mätvärdesrader.',
    billingHint: 'Kan användas för pris per mätvärdesimport.',
  },
  {
    key: 'metering_requests',
    label: 'Begärda mätvärden',
    table: 'grid_owner_data_requests',
    description: 'Begäran till nätägare eller motsvarande datainsamling.',
    billingHint: 'Kan användas för pris per begäran.',
  },
  {
    key: 'authorizations_sent',
    label: 'Fullmakter skickade',
    table: 'customer_authorization_documents',
    description: 'Fullmakts-/auktoriseringsdokument i perioden.',
    billingHint: 'Kan användas för pris per skickad fullmakt.',
    filters: [{ column: 'status', value: ['sent', 'signed', 'accepted', 'completed'], op: 'in' }],
  },
  {
    key: 'authorizations_signed',
    label: 'Fullmakter signerade',
    table: 'customer_authorization_documents',
    description: 'Signerade eller godkända fullmakter.',
    billingHint: 'Kan användas för signeringsvolym.',
    filters: [{ column: 'status', value: ['signed', 'accepted', 'completed'], op: 'in' }],
  },
  {
    key: 'onboarding_cases',
    label: 'Onboardingärenden',
    table: 'customer_operation_tasks',
    description: 'Operations- och onboardinguppgifter.',
  },
  {
    key: 'switches_total',
    label: 'Leverantörsbyten',
    table: 'supplier_switch_requests',
    description: 'Switchärenden i perioden.',
    billingHint: 'Kan användas för pris per switchflöde.',
  },
  {
    key: 'ediel_sent',
    label: 'Ediel skickade',
    table: 'ediel_messages',
    description: 'Utgående Ediel-meddelanden.',
    billingHint: 'Kan användas för pris per skickat meddelande.',
    filters: [{ column: 'direction', value: 'outbound' }],
  },
  {
    key: 'ediel_received',
    label: 'Ediel mottagna',
    table: 'ediel_messages',
    description: 'Inkommande Ediel-meddelanden.',
    billingHint: 'Kan användas för Ediel-volym.',
    filters: [{ column: 'direction', value: 'inbound' }],
  },
  {
    key: 'prodat_messages',
    label: 'PRODAT',
    table: 'ediel_messages',
    description: 'PRODAT-meddelanden.',
    filters: [{ column: 'message_family', value: 'PRODAT' }],
  },
  {
    key: 'utilts_messages',
    label: 'UTILTS',
    table: 'ediel_messages',
    description: 'UTILTS-meddelanden.',
    filters: [{ column: 'message_family', value: 'UTILTS' }],
  },
  {
    key: 'acks_total',
    label: 'APERAK/CONTRL',
    table: 'ediel_messages',
    description: 'Tekniska och applikationsmässiga kvittenser.',
    filters: [{ column: 'message_family', value: ['APERAK', 'CONTRL'], op: 'in' }],
  },
  {
    key: 'billing_underlays',
    label: 'Faktureringsunderlag',
    table: 'billing_underlays',
    description: 'Skapade faktureringsunderlag.',
    billingHint: 'Kan användas för pris per underlag.',
  },
  {
    key: 'partner_exports',
    label: 'Partnerexporter',
    table: 'partner_exports',
    description: 'Exporter/handoff till partner.',
    billingHint: 'Kan användas för pris per export.',
  },
  {
    key: 'blocked_exports',
    label: 'Blockerade exporter',
    table: 'billing_underlays',
    description: 'Underlag som inte är redo för export.',
    filters: [{ column: 'readiness_status', value: 'export_ready', op: 'neq' }],
  },
  {
    key: 'outbound_requests',
    label: 'Outbound/API-händelser',
    table: 'outbound_requests',
    description: 'Utgående requests eller exporthändelser.',
  },
]

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function coerceDate(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return isoDate(parsed)
}

export function resolveCompanyStatisticsRange(input: {
  range?: string | string[]
  from?: string | string[]
  to?: string | string[]
}): CompanyStatisticsRange {
  const rawRange = Array.isArray(input.range) ? input.range[0] : input.range
  const today = new Date()
  const thisMonth = startOfMonth(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())))

  if (rawRange === 'previous_month') {
    const from = addMonths(thisMonth, -1)
    const to = thisMonth
    return { key: 'previous_month', label: 'Förra månaden', from: isoDate(from), to: isoDate(to) }
  }

  if (rawRange === 'last_3_months') {
    const from = addMonths(thisMonth, -2)
    const to = addMonths(thisMonth, 1)
    return { key: 'last_3_months', label: 'Senaste 3 månaderna', from: isoDate(from), to: isoDate(to) }
  }

  if (rawRange === 'last_12_months') {
    const from = addMonths(thisMonth, -11)
    const to = addMonths(thisMonth, 1)
    return { key: 'last_12_months', label: 'Senaste 12 månaderna', from: isoDate(from), to: isoDate(to) }
  }

  if (rawRange === 'custom') {
    const fromRaw = Array.isArray(input.from) ? input.from[0] : input.from
    const toRaw = Array.isArray(input.to) ? input.to[0] : input.to
    const from = coerceDate(fromRaw) ?? isoDate(thisMonth)
    const to = coerceDate(toRaw) ?? isoDate(addMonths(thisMonth, 1))
    return { key: 'custom', label: 'Egen period', from, to }
  }

  return {
    key: 'current_month',
    label: 'Denna månad',
    from: isoDate(thisMonth),
    to: isoDate(addMonths(thisMonth, 1)),
  }
}

function isIgnorableSchemaError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', 'PGRST205'].includes(error.code ?? '')
}

async function safeCount(table: string, companyId: string, range: CompanyStatisticsRange, filters: CountFilter[] = []) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = supabaseService.from(table).select('id', { count: 'exact', head: true }) as any
    query = query.eq('company_id', companyId)
    query = query.gte('created_at', range.from).lt('created_at', range.to)

    for (const filter of filters) {
      if (filter.op === 'in' && Array.isArray(filter.value)) {
        query = query.in(filter.column, filter.value)
      } else if (filter.op === 'neq') {
        query = query.neq(filter.column, filter.value as string | number | boolean)
      } else {
        query = query.eq(filter.column, filter.value as string | number | boolean)
      }
    }

    const { count, error } = await query
    if (error) {
      if (isIgnorableSchemaError(error)) return 0
      return 0
    }

    return count ?? 0
  } catch {
    return 0
  }
}

async function countMonthly(table: string, companyId: string, from: Date, to: Date, filters: CountFilter[] = []) {
  return safeCount(table, companyId, { key: 'custom', label: 'Månad', from: isoDate(from), to: isoDate(to) }, filters)
}

async function getRoleBreakdown(companyId: string): Promise<CompanyRoleStatistic[]> {
  try {
    const { data, error } = await supabaseService
      .from('company_memberships')
      .select('membership_role,status')
      .eq('company_id', companyId)
      .eq('status', 'active')

    if (error) return []

    const counts = new Map<string, number>()
    for (const row of ((data ?? []) as Array<Record<string, unknown>>)) {
      const role = typeof row.membership_role === 'string' ? row.membership_role : 'member'
      counts.set(role, (counts.get(role) ?? 0) + 1)
    }

    return [...counts.entries()]
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => a.role.localeCompare(b.role, 'sv'))
  } catch {
    return []
  }
}

async function getMonthlyVolumes(companyId: string, range: CompanyStatisticsRange): Promise<CompanyMonthlyVolume[]> {
  const from = startOfMonth(new Date(`${range.from}T00:00:00.000Z`))
  const to = startOfMonth(new Date(`${range.to}T00:00:00.000Z`))
  const months: Date[] = []

  for (let cursor = from; cursor < to && months.length < 12; cursor = addMonths(cursor, 1)) {
    months.push(cursor)
  }

  const rows = await Promise.all(
    months.map(async (monthStart) => {
      const monthEnd = addMonths(monthStart, 1)
      const [customers, edielMessages, meteringValues, authorizations, billingUnderlays, partnerExports] = await Promise.all([
        countMonthly('customers', companyId, monthStart, monthEnd),
        countMonthly('ediel_messages', companyId, monthStart, monthEnd),
        countMonthly('metering_values', companyId, monthStart, monthEnd),
        countMonthly('customer_authorization_documents', companyId, monthStart, monthEnd),
        countMonthly('billing_underlays', companyId, monthStart, monthEnd),
        countMonthly('partner_exports', companyId, monthStart, monthEnd),
      ])

      return {
        month: MONTH_FORMATTER.format(monthStart),
        customers,
        edielMessages,
        meteringValues,
        authorizations,
        billingUnderlays,
        partnerExports,
      }
    })
  )

  return rows
}

export async function getCompanyBillingStatistics(
  companyId: string,
  range: CompanyStatisticsRange
): Promise<CompanyBillingStatistics> {
  const [totals, roleBreakdown, monthlyVolumes] = await Promise.all([
    Promise.all(
      TABLE_METRICS.map(async (metric) => ({
        key: metric.key,
        label: metric.label,
        value: await safeCount(metric.table, companyId, range, metric.filters ?? []),
        description: metric.description,
        billingHint: metric.billingHint,
      }))
    ),
    getRoleBreakdown(companyId),
    getMonthlyVolumes(companyId, range),
  ])

  return {
    range,
    totals,
    roleBreakdown,
    monthlyVolumes,
  }
}
