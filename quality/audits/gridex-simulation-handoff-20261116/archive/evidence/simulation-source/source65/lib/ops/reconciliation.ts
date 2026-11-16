import { supabaseService } from '@/lib/supabase/service'

// Production consistency checks (spec §42). Read-only reconciliation used by
// /admin/system-health. Every check is tenant-scoped when companyId is given
// and tolerant of missing schema so it can run on partially migrated databases.

export type ReconciliationSeverity = 'critical' | 'warning' | 'info'

export type ReconciliationCheckResult = {
  key: string
  label: string
  description: string
  severity: ReconciliationSeverity
  count: number
  sampleIds: string[]
  error?: string | null
}

const SAMPLE_LIMIT = 5
const SCAN_LIMIT = 5000

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function missingSchema(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(maybe && (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(maybe.code ?? '') || /does not exist|schema cache/i.test(maybe.message ?? '')))
}

const ACTIVE_CONTRACT_STATUSES = ['active', 'signed']
const OPEN_SWITCH_STATUSES = ['draft', 'ready', 'queued', 'sending', 'sent', 'pending', 'in_progress', 'awaiting_response']

type CheckContext = { companyId: string | null }

async function checkContractsWithoutCustomerOrSite(context: CheckContext): Promise<ReconciliationCheckResult[]> {
  const base = {
    key: 'contracts_missing_links',
    label: 'Aktiva avtal utan kund eller anläggning',
    description: 'Aktiva/signerade avtal måste vara kopplade till både kund och anläggning för att kunna faktureras och bytas.',
    severity: 'critical' as const,
  }
  try {
    let query = supabaseService
      .from('customer_contracts')
      .select('id,customer_id,customer_site_id,site_id')
      .in('status', ACTIVE_CONTRACT_STATUSES)
      .limit(SCAN_LIMIT)
    if (context.companyId) query = query.eq('company_id', context.companyId)
    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    const broken = rows.filter((row) => !stringValue(row.customer_id) || (!stringValue(row.customer_site_id) && !stringValue(row.site_id)))
    return [{
      ...base,
      count: broken.length,
      sampleIds: broken.slice(0, SAMPLE_LIMIT).map((row) => String(row.id)),
    }]
  } catch (error) {
    if (missingSchema(error)) return [{ ...base, count: 0, sampleIds: [], error: 'schema_missing' }]
    return [{ ...base, count: 0, sampleIds: [], error: error instanceof Error ? error.message : 'unknown' }]
  }
}

async function checkActiveContractsMissingPriceAreaOrSnapshot(context: CheckContext): Promise<ReconciliationCheckResult[]> {
  const priceAreaBase = {
    key: 'active_contracts_missing_price_area',
    label: 'Aktiva avtal utan elområde',
    description: 'Anläggningen för ett aktivt avtal saknar SE1–SE4 elområde. Spot-/portföljprissättning kommer att blockeras.',
    severity: 'critical' as const,
  }
  const snapshotBase = {
    key: 'active_contracts_missing_price_snapshot',
    label: 'Aktiva avtal utan prissnapshot',
    description: 'Aktiva avtal utan contract_price_snapshots faller tillbaka på avtalsfält vid prisberäkning. Kontrollera att prisvillkoren är snapshotade.',
    severity: 'warning' as const,
  }
  try {
    let query = supabaseService
      .from('customer_contracts')
      .select('id,customer_site_id,site_id')
      .in('status', ACTIVE_CONTRACT_STATUSES)
      .limit(SCAN_LIMIT)
    if (context.companyId) query = query.eq('company_id', context.companyId)
    const { data, error } = await query
    if (error) throw error
    const contracts = (data ?? []) as Record<string, unknown>[]

    const siteIds = Array.from(new Set(contracts
      .map((row) => stringValue(row.customer_site_id) ?? stringValue(row.site_id))
      .filter((value): value is string => Boolean(value))))

    const priceAreaBySite = new Map<string, string | null>()
    for (let i = 0; i < siteIds.length; i += 500) {
      const batch = siteIds.slice(i, i + 500)
      const { data: sites, error: siteError } = await supabaseService
        .from('customer_sites')
        .select('id,price_area_code')
        .in('id', batch)
      if (siteError) {
        if (missingSchema(siteError)) break
        throw siteError
      }
      for (const site of (sites ?? []) as Record<string, unknown>[]) {
        priceAreaBySite.set(String(site.id), stringValue(site.price_area_code))
      }
    }

    const missingPriceArea = contracts.filter((row) => {
      const siteId = stringValue(row.customer_site_id) ?? stringValue(row.site_id)
      if (!siteId) return false
      return !priceAreaBySite.get(siteId)
    })

    const contractIds = contracts.map((row) => String(row.id))
    const contractsWithSnapshot = new Set<string>()
    for (let i = 0; i < contractIds.length; i += 500) {
      const batch = contractIds.slice(i, i + 500)
      const { data: snapshots, error: snapshotError } = await supabaseService
        .from('contract_price_snapshots')
        .select('contract_id')
        .in('contract_id', batch)
      if (snapshotError) {
        if (missingSchema(snapshotError)) break
        throw snapshotError
      }
      for (const snapshot of (snapshots ?? []) as Record<string, unknown>[]) {
        const contractId = stringValue(snapshot.contract_id)
        if (contractId) contractsWithSnapshot.add(contractId)
      }
    }
    const missingSnapshot = contracts.filter((row) => !contractsWithSnapshot.has(String(row.id)))

    return [
      {
        ...priceAreaBase,
        count: missingPriceArea.length,
        sampleIds: missingPriceArea.slice(0, SAMPLE_LIMIT).map((row) => String(row.id)),
      },
      {
        ...snapshotBase,
        count: missingSnapshot.length,
        sampleIds: missingSnapshot.slice(0, SAMPLE_LIMIT).map((row) => String(row.id)),
      },
    ]
  } catch (error) {
    const message = missingSchema(error) ? 'schema_missing' : error instanceof Error ? error.message : 'unknown'
    return [
      { ...priceAreaBase, count: 0, sampleIds: [], error: message },
      { ...snapshotBase, count: 0, sampleIds: [], error: message },
    ]
  }
}

async function checkOpenSwitchesMissingPrerequisites(context: CheckContext): Promise<ReconciliationCheckResult[]> {
  const base = {
    key: 'open_switches_missing_prerequisites',
    label: 'Öppna leverantörsbyten utan mätpunkt eller nätägare',
    description: 'Ett pågående leverantörsbyte saknar mätpunkt eller nätägare på anläggningen. Bytet kan inte skickas via EDIEL.',
    severity: 'critical' as const,
  }
  try {
    let query = supabaseService
      .from('supplier_switch_requests')
      .select('id,customer_site_id,site_id')
      .in('status', OPEN_SWITCH_STATUSES)
      .limit(SCAN_LIMIT)
    if (context.companyId) query = query.eq('company_id', context.companyId)
    const { data, error } = await query
    if (error) throw error
    const switches = (data ?? []) as Record<string, unknown>[]

    const siteIds = Array.from(new Set(switches
      .map((row) => stringValue(row.customer_site_id) ?? stringValue(row.site_id))
      .filter((value): value is string => Boolean(value))))

    const gridOwnerBySite = new Map<string, string | null>()
    const sitesWithMeteringPoint = new Set<string>()
    for (let i = 0; i < siteIds.length; i += 500) {
      const batch = siteIds.slice(i, i + 500)
      const [sites, meteringPoints] = await Promise.all([
        supabaseService.from('customer_sites').select('id,grid_owner_id').in('id', batch),
        supabaseService.from('metering_points').select('site_id').in('site_id', batch),
      ])
      if (sites.error) {
        if (missingSchema(sites.error)) break
        throw sites.error
      }
      for (const site of (sites.data ?? []) as Record<string, unknown>[]) {
        gridOwnerBySite.set(String(site.id), stringValue(site.grid_owner_id))
      }
      if (!meteringPoints.error) {
        for (const point of (meteringPoints.data ?? []) as Record<string, unknown>[]) {
          const siteId = stringValue(point.site_id)
          if (siteId) sitesWithMeteringPoint.add(siteId)
        }
      }
    }

    const broken = switches.filter((row) => {
      const siteId = stringValue(row.customer_site_id) ?? stringValue(row.site_id)
      if (!siteId) return true
      return !gridOwnerBySite.get(siteId) || !sitesWithMeteringPoint.has(siteId)
    })

    return [{
      ...base,
      count: broken.length,
      sampleIds: broken.slice(0, SAMPLE_LIMIT).map((row) => String(row.id)),
    }]
  } catch (error) {
    if (missingSchema(error)) return [{ ...base, count: 0, sampleIds: [], error: 'schema_missing' }]
    return [{ ...base, count: 0, sampleIds: [], error: error instanceof Error ? error.message : 'unknown' }]
  }
}

async function checkInvoiceRunTotals(context: CheckContext): Promise<ReconciliationCheckResult[]> {
  const base = {
    key: 'invoice_run_totals_mismatch',
    label: 'Exportkörningar där postsumman inte stämmer',
    description: 'Summan av fakturaexportposternas belopp avviker från exportkörningens registrerade omfattning. Kontrollera innan bokföring.',
    severity: 'critical' as const,
  }
  try {
    let runQuery = supabaseService
      .from('invoice_export_runs')
      .select('id,total_items,sent_items,failed_items')
      .order('created_at', { ascending: false })
      .limit(50)
    if (context.companyId) runQuery = runQuery.eq('company_id', context.companyId)
    const { data: runs, error: runError } = await runQuery
    if (runError) throw runError

    const mismatched: string[] = []
    for (const run of (runs ?? []) as Record<string, unknown>[]) {
      const runId = String(run.id)
      let itemQuery = supabaseService
        .from('invoice_export_items')
        .select('id,status')
        .eq('export_run_id', runId)
        .limit(SCAN_LIMIT)
      if (context.companyId) itemQuery = itemQuery.eq('company_id', context.companyId)
      const { data: items, error: itemError } = await itemQuery
      if (itemError) throw itemError
      const rows = (items ?? []) as Record<string, unknown>[]
      const sent = rows.filter((row) => ['sent', 'credited'].includes(String(row.status))).length
      const recordedSent = numberValue(run.sent_items)
      if (rows.length > 0 && sent !== recordedSent) mismatched.push(runId)
    }

    return [{
      ...base,
      count: mismatched.length,
      sampleIds: mismatched.slice(0, SAMPLE_LIMIT),
    }]
  } catch (error) {
    if (missingSchema(error)) return [{ ...base, count: 0, sampleIds: [], error: 'schema_missing' }]
    return [{ ...base, count: 0, sampleIds: [], error: error instanceof Error ? error.message : 'unknown' }]
  }
}

async function checkSentItemsWithoutProviderGuid(context: CheckContext): Promise<ReconciliationCheckResult[]> {
  const base = {
    key: 'sent_items_missing_provider_guid',
    label: 'Skickade fakturor utan leverantörs-id',
    description: 'Fakturaexportposter med status sent saknar provider_invoice_guid. Leverantörens kvittens kan inte matchas.',
    severity: 'critical' as const,
  }
  try {
    let query = supabaseService
      .from('invoice_export_items')
      .select('id')
      .eq('status', 'sent')
      .is('provider_invoice_guid', null)
      .limit(SCAN_LIMIT)
    if (context.companyId) query = query.eq('company_id', context.companyId)
    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    return [{
      ...base,
      count: rows.length,
      sampleIds: rows.slice(0, SAMPLE_LIMIT).map((row) => String(row.id)),
    }]
  } catch (error) {
    if (missingSchema(error)) return [{ ...base, count: 0, sampleIds: [], error: 'schema_missing' }]
    return [{ ...base, count: 0, sampleIds: [], error: error instanceof Error ? error.message : 'unknown' }]
  }
}

async function checkDuplicateBillingPerContractPeriod(context: CheckContext): Promise<ReconciliationCheckResult[]> {
  const base = {
    key: 'duplicate_billing_per_contract_period',
    label: 'Dubbla fakturaunderlag per avtal och period',
    description: 'Flera fakturaunderlag för samma avtal och period riskerar dubbelfakturering. Underlag utan avtal grupperas per mätpunkt.',
    severity: 'critical' as const,
  }
  try {
    let query = supabaseService
      .from('billing_underlays')
      .select('id,contract_id,metering_point_id,underlay_year,underlay_month')
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT)
    if (context.companyId) query = query.eq('company_id', context.companyId)
    const { data, error } = await query
    if (error) throw error
    const groups = new Map<string, string[]>()
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const anchor = stringValue(row.contract_id) ?? `mp:${stringValue(row.metering_point_id) ?? 'unknown'}`
      const key = `${anchor}:${numberValue(row.underlay_year)}-${numberValue(row.underlay_month)}`
      const ids = groups.get(key) ?? []
      ids.push(String(row.id))
      groups.set(key, ids)
    }
    const duplicates = Array.from(groups.values()).filter((ids) => ids.length > 1)
    return [{
      ...base,
      count: duplicates.length,
      sampleIds: duplicates.slice(0, SAMPLE_LIMIT).map((ids) => ids[0]),
    }]
  } catch (error) {
    if (missingSchema(error)) return [{ ...base, count: 0, sampleIds: [], error: 'schema_missing' }]
    return [{ ...base, count: 0, sampleIds: [], error: error instanceof Error ? error.message : 'unknown' }]
  }
}

async function checkRetryQueueHealth(context: CheckContext): Promise<ReconciliationCheckResult[]> {
  const base = {
    key: 'invoice_export_retry_backlog',
    label: 'Fakturaexporter som väntar på återförsök',
    description: 'Poster i failed_retryable med förfallen next_retry_at. Kontrollera att retry-cronen körs.',
    severity: 'warning' as const,
  }
  try {
    let query = supabaseService
      .from('invoice_export_items')
      .select('id')
      .eq('status', 'failed_retryable')
      .lte('next_retry_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .limit(SCAN_LIMIT)
    if (context.companyId) query = query.eq('company_id', context.companyId)
    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as Record<string, unknown>[]
    return [{
      ...base,
      count: rows.length,
      sampleIds: rows.slice(0, SAMPLE_LIMIT).map((row) => String(row.id)),
    }]
  } catch (error) {
    if (missingSchema(error)) return [{ ...base, count: 0, sampleIds: [], error: 'schema_missing' }]
    return [{ ...base, count: 0, sampleIds: [], error: error instanceof Error ? error.message : 'unknown' }]
  }
}

export async function runProductionConsistencyChecks(input: {
  companyId: string | null
}): Promise<{ checks: ReconciliationCheckResult[]; criticalCount: number; warningCount: number }> {
  const context: CheckContext = { companyId: input.companyId }
  const results = (await Promise.all([
    checkContractsWithoutCustomerOrSite(context),
    checkActiveContractsMissingPriceAreaOrSnapshot(context),
    checkOpenSwitchesMissingPrerequisites(context),
    checkInvoiceRunTotals(context),
    checkSentItemsWithoutProviderGuid(context),
    checkDuplicateBillingPerContractPeriod(context),
    checkRetryQueueHealth(context),
  ])).flat()

  return {
    checks: results,
    criticalCount: results.filter((row) => row.severity === 'critical' && row.count > 0).length,
    warningCount: results.filter((row) => row.severity === 'warning' && row.count > 0).length,
  }
}
