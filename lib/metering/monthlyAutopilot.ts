import { supabaseService } from '@/lib/supabase/service'
import { createGridOwnerDataRequest } from '@/lib/cis/db-grid-owner'
import { ensureAndPrepareUtiltsFromDataRequest } from '@/lib/cis/edielAutomation'
import { createCustomerDataTask } from '@/lib/customers/dataTasks'
import { evaluateMeteringCompletenessForMonth } from '@/lib/metering/validation'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

export type MeteringAutopilotDecision = 'AUTO' | 'RETRY' | 'REVIEW' | 'STOP'

type MeteringPointRow = {
  id: string
  customer_id: string | null
  site_id: string | null
  customer_site_id: string | null
  grid_owner_id: string | null
  status: string | null
}

export type MeteringAutopilotResult = {
  companyId: string
  billingMonth: string
  checked: number
  complete: number
  requested: number
  review: number
  stopped: number
  decisions: Array<{
    meteringPointId: string
    customerId: string | null
    decision: MeteringAutopilotDecision
    issueCodes: string[]
    dataRequestId?: string | null
    error?: string | null
  }>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function listTenantMeteringPoints(companyId: string): Promise<MeteringPointRow[]> {
  const rows: MeteringPointRow[] = []
  for (let from = 0; ; from += 500) {
    const result = await supabaseService
      .from('metering_points')
      .select('id,customer_id,site_id,customer_site_id,grid_owner_id,status')
      .eq('company_id', companyId)
      .in('status', ['active', 'connected'])
      .order('id', { ascending: true })
      .range(from, from + 499)
    if (result.error) throw result.error
    const page = (result.data ?? []) as MeteringPointRow[]
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

export async function runMeteringMarketDataAutopilot(input: {
  companyId: string
  billingMonth: string
  actorUserId: string
}): Promise<MeteringAutopilotResult> {
  const bounds = stockholmMonthBounds(input.billingMonth)
  const points = await listTenantMeteringPoints(input.companyId)
  const decisions: MeteringAutopilotResult['decisions'] = []

  for (const point of points) {
    const customerId = text(point.customer_id)
    const siteId = text(point.customer_site_id) ?? text(point.site_id)
    const gridOwnerId = text(point.grid_owner_id)

    if (!customerId || !siteId || !gridOwnerId) {
      if (customerId) {
        await createCustomerDataTask({
          companyId: input.companyId,
          customerId,
          customerSiteId: siteId,
          meteringPointId: point.id,
          taskType: gridOwnerId ? 'missing_metering_point' : 'missing_grid_owner',
          priority: 'high',
          description: 'Mätvärdesautopiloten kan inte fortsätta eftersom tenant-, anläggnings- eller nätägarkopplingen är ofullständig.',
          actorUserId: input.actorUserId,
        })
      }
      decisions.push({ meteringPointId: point.id, customerId, decision: 'STOP', issueCodes: ['unsafe_metering_scope'] })
      continue
    }

    const completeness = await evaluateMeteringCompletenessForMonth({
      companyId: input.companyId,
      billingMonth: input.billingMonth,
      meteringPoints: [{ meteringPointId: point.id }],
      allowEstimatedValues: false,
    })
    const issueCodes = [...new Set(completeness.issues.map((issue) => issue.code))]
    const missing = issueCodes.some((code) => code === 'metering_values_missing' || code === 'metering_gap')
    const unsafeForBilling = issueCodes.some((code) => code === 'metering_overlap' || code === 'metering_estimated')

    if (!missing && !unsafeForBilling) {
      decisions.push({ meteringPointId: point.id, customerId, decision: 'AUTO', issueCodes })
      continue
    }

    if (missing) {
      const automationKey = `meter-values:${input.companyId}:${point.id}:${input.billingMonth}`
      try {
        const request = await createGridOwnerDataRequest({
          actorUserId: input.actorUserId,
          customerId,
          siteId,
          meteringPointId: point.id,
          gridOwnerId,
          requestScope: 'meter_values',
          requestedPeriodStart: bounds.start,
          requestedPeriodEnd: bounds.end,
          automationOrigin: 'metering_market_data_autopilot_v1',
          automationKey,
          notes: `Automatisk begäran om saknade validerade mätvärden för ${input.billingMonth}.`,
          requestPayload: { billing_month: input.billingMonth, issue_codes: issueCodes, time_zone: bounds.timeZone },
        })
        await ensureAndPrepareUtiltsFromDataRequest({
          actorUserId: input.actorUserId,
          dataRequestId: request.id,
          utiltsCode: 'E73',
          periodStart: bounds.start,
          periodEnd: bounds.end,
        })
        decisions.push({ meteringPointId: point.id, customerId, decision: 'RETRY', issueCodes, dataRequestId: request.id })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Okänt fel vid automatisk mätvärdesbegäran.'
        await createCustomerDataTask({
          companyId: input.companyId,
          customerId,
          customerSiteId: siteId,
          meteringPointId: point.id,
          taskType: 'contact_grid_owner',
          priority: 'high',
          description: `Automatisk begäran om saknade mätvärden kunde inte köas: ${message}`,
          actorUserId: input.actorUserId,
        })
        decisions.push({ meteringPointId: point.id, customerId, decision: 'REVIEW', issueCodes, error: message })
      }
      continue
    }

    await createCustomerDataTask({
      companyId: input.companyId,
      customerId,
      customerSiteId: siteId,
      meteringPointId: point.id,
      taskType: 'invoice_review_required',
      priority: 'high',
      description: `Mätvärden för ${input.billingMonth} kräver granskning innan fakturering: ${issueCodes.join(', ')}.`,
      actorUserId: input.actorUserId,
    })
    decisions.push({ meteringPointId: point.id, customerId, decision: 'REVIEW', issueCodes })
  }

  return {
    companyId: input.companyId,
    billingMonth: input.billingMonth,
    checked: decisions.length,
    complete: decisions.filter((row) => row.decision === 'AUTO').length,
    requested: decisions.filter((row) => row.decision === 'RETRY').length,
    review: decisions.filter((row) => row.decision === 'REVIEW').length,
    stopped: decisions.filter((row) => row.decision === 'STOP').length,
    decisions,
  }
}
