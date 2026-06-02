import { supabaseService } from '@/lib/supabase/service'
import { dateSatisfiesBusinessLead, earliestBusinessDate } from '@/lib/ediel/calendar/businessDayRules'

export type EdielDeadlineEvaluation = {
  ok: boolean
  actionType: string
  requestedDate: string | null
  earliestAllowedDate: string | null
  issues: string[]
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

async function getDeadlineRule(input: {
  actionType: string
  messageFamily: string
  businessCode?: string | null
}) {
  let query = supabaseService
    .from('ediel_business_deadline_rules')
    .select('*')
    .eq('market', 'electricity')
    .eq('message_family', input.messageFamily)
    .eq('action_type', input.actionType)
    .eq('is_active', true)
    .limit(1)

  if (input.businessCode) {
    query = query.or(`business_code.eq.${input.businessCode},business_code.is.null`)
  }

  const { data, error } = await query.maybeSingle()
  if (error) return null
  return data as { min_lead_business_days?: number | null; max_history_years?: number | null } | null
}

export async function evaluateEdielDeadline(input: {
  actionType: string
  messageFamily: string
  businessCode?: string | null
  requestedDate?: string | null
  historicalStartDate?: string | null
  historicalEndDate?: string | null
}): Promise<EdielDeadlineEvaluation> {
  const issues: string[] = []
  const rule = await getDeadlineRule(input)
  const minLeadBusinessDays = Number(rule?.min_lead_business_days ?? 0)
  const requestedDate = parseDate(input.requestedDate)
  const earliest = await earliestBusinessDate({
    fromDate: new Date(),
    minLeadBusinessDays,
  })

  if (requestedDate) {
    const leadOk = await dateSatisfiesBusinessLead({
      requestedDate,
      minLeadBusinessDays,
    })
    if (!leadOk) {
      issues.push(`Begärt datum måste vara tidigast ${dateOnly(earliest)} enligt marknadskalendern.`)
    }
  }

  if (input.actionType === 'request_historical_metering_access') {
    const start = parseDate(input.historicalStartDate)
    const end = parseDate(input.historicalEndDate)
    const yesterday = new Date()
    yesterday.setUTCHours(0, 0, 0, 0)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const oldest = new Date(yesterday)
    oldest.setUTCFullYear(oldest.getUTCFullYear() - Number(rule?.max_history_years ?? 3))

    if (!start || !end) issues.push('Historisk mätvärdesbegäran kräver start- och slutdatum.')
    if (start && end && end < start) issues.push('Historisk period har slutdatum före startdatum.')
    if (start && start < oldest) issues.push(`Historisk period får inte börja före ${dateOnly(oldest)}.`)
    if (start && start > yesterday) issues.push('Historisk period måste vara avslutad senast igår.')
    if (end && end > yesterday) issues.push('Historisk period måste sluta senast igår.')
  }

  return {
    ok: issues.length === 0,
    actionType: input.actionType,
    requestedDate: requestedDate ? dateOnly(requestedDate) : null,
    earliestAllowedDate: dateOnly(earliest),
    issues,
  }
}
