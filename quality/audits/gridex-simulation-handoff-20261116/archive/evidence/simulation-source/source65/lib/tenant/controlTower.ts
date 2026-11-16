/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseService } from '@/lib/supabase/service'
import { isMissingRelationError } from '@/lib/tenant/scope'

export type PlatformControlTowerAlert = {
  id: string
  title: string
  description: string
  severity: 'info' | 'warning' | 'danger'
  href: string
  count: number
  meta?: string | null
}

type CountFilter = {
  column: string
  value: string | string[] | null | boolean
  op?: 'eq' | 'in' | 'is' | 'neq'
}

type CompanyRow = {
  id: string
  name: string | null
  status: string | null
  org_number: string | null
  updated_at: string | null
}

function applyFilter(query: any, filter: CountFilter): any {
  if (filter.op === 'in') return query.in(filter.column, Array.isArray(filter.value) ? filter.value : [])
  if (filter.op === 'is') return query.is(filter.column, filter.value)
  if (filter.op === 'neq') return query.neq(filter.column, filter.value)
  return query.eq(filter.column, filter.value)
}

async function safeCount(table: string, filters: CountFilter[] = []): Promise<number> {
  try {
    let query: any = supabaseService.from(table).select('*', { count: 'exact', head: true })
    for (const filter of filters) query = applyFilter(query, filter)
    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  } catch (error) {
    if (isMissingRelationError(error) || (error as { code?: string } | null)?.code === '42703') return 0
    throw error
  }
}

async function safeRows<T>(
  table: string,
  select: string,
  filters: CountFilter[] = [],
  limit = 10,
  orderColumn = 'created_at'
): Promise<T[]> {
  try {
    let query: any = supabaseService.from(table).select(select).limit(limit)
    for (const filter of filters) query = applyFilter(query, filter)
    query = query.order(orderColumn, { ascending: false })
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as T[]
  } catch (error) {
    if (isMissingRelationError(error) || (error as { code?: string } | null)?.code === '42703') return []
    throw error
  }
}

function formatCompanyNames(rows: CompanyRow[]): string | null {
  if (rows.length === 0) return null
  return rows
    .slice(0, 4)
    .map((row) => row.name || row.org_number || row.id)
    .join(', ')
}

export async function listPlatformControlTowerAlerts(): Promise<PlatformControlTowerAlert[]> {
  const [
    pausedCompanies,
    missingActorCompanies,
    companiesWithoutRoutes,
    overdueAckCount,
    failedEdielCount,
    blockedBillingCount,
    unresolvedOutboundCount,
    tenantConflictCount,
    integrityReleaseGateCount,
    highAccessCount,
    pendingInvitationCount,
  ] = await Promise.all([
    safeRows<CompanyRow>(
      'companies',
      'id, name, org_number, status, updated_at',
      [{ column: 'status', op: 'in', value: ['paused', 'suspended', 'archived', 'pending_deletion'] }],
      8,
      'updated_at'
    ),
    listCompaniesMissingEdielActorProfile(),
    listCompaniesWithoutActiveRoutes(),
    safeCount('ediel_messages', [
      { column: 'direction', value: 'outbound' },
      { column: 'ack_due_at', op: 'neq', value: null },
      { column: 'status', op: 'in', value: ['queued', 'prepared', 'sent', 'received', 'validated'] },
    ]),
    safeCount('ediel_messages', [{ column: 'status', value: 'failed' }]),
    safeCount('billing_underlays', [
      { column: 'readiness_status', op: 'in', value: ['warning', 'blocked', 'requires_correction'] },
    ]),
    safeCount('outbound_requests', [
      { column: 'channel_type', value: 'unresolved' },
      { column: 'status', op: 'in', value: ['queued', 'prepared', 'sent', 'failed'] },
    ]),
    safeCount('customer_sync_events', [
      { column: 'match_status', op: 'in', value: ['unresolved', 'pending'] },
    ]),
    safeCount('tenant_integrity_latest_findings_v', [
      { column: 'enforcement_mode', value: 'release_gate' },
      { column: 'severity', op: 'in', value: ['critical', 'high'] },
    ]),
    countHighAccessUsers(),
    safeCount('company_invitations', [{ column: 'status', value: 'pending' }]),
  ])

  const alerts: PlatformControlTowerAlert[] = []

  if (pausedCompanies.length > 0) {
    alerts.push({
      id: 'paused-companies',
      title: 'Pausade eller stoppade bolag',
      description: 'Dessa tenants ska inte kunna skapa kunder, Ediel-utskick, switchar, mätvärden eller exporter.',
      severity: 'danger',
      href: '/admin/companies',
      count: pausedCompanies.length,
      meta: formatCompanyNames(pausedCompanies),
    })
  }

  if (missingActorCompanies.length > 0) {
    alerts.push({
      id: 'missing-ediel-profile',
      title: 'Bolag saknar aktiv Ediel-profil',
      description: 'Bolag utan aktiv actor settings kan inte skickas produktionsmässigt via Ediel.',
      severity: 'warning',
      href: '/admin/ediel/settings',
      count: missingActorCompanies.length,
      meta: formatCompanyNames(missingActorCompanies),
    })
  }

  if (companiesWithoutRoutes.length > 0) {
    alerts.push({
      id: 'missing-routes',
      title: 'Bolag saknar aktiv route setup',
      description: 'Kommunikationsvägar eller Ediel-route-profiler saknas för minst ett bolag.',
      severity: 'warning',
      href: '/admin/integrations/routes',
      count: companiesWithoutRoutes.length,
      meta: formatCompanyNames(companiesWithoutRoutes),
    })
  }

  if (overdueAckCount > 0) {
    alerts.push({
      id: 'overdue-acks',
      title: 'Försenade Ediel-kvittenser',
      description: 'Meddelanden har passerat ack-deadline och kräver uppföljning i Ediel Control Tower.',
      severity: 'danger',
      href: '/admin/ediel/control-tower',
      count: overdueAckCount,
    })
  }

  if (failedEdielCount > 0) {
    alerts.push({
      id: 'failed-ediel',
      title: 'Misslyckade Ediel-meddelanden',
      description: 'Kontrollera transport, routing, version och payload innan nya försök görs.',
      severity: 'danger',
      href: '/admin/ediel/messages?status=failed',
      count: failedEdielCount,
    })
  }

  if (blockedBillingCount > 0) {
    alerts.push({
      id: 'blocked-billing',
      title: 'Faktureringsunderlag kräver åtgärd',
      description: 'Exporter ska fortsätta för färdiga rader men flaggade underlag behöver rättas.',
      severity: 'warning',
      href: '/admin/billing?status=all',
      count: blockedBillingCount,
    })
  }

  if (unresolvedOutboundCount > 0) {
    alerts.push({
      id: 'unresolved-outbound',
      title: 'Outbound saknar route',
      description: 'Utskick är köade men saknar lösbar kanal/route. Åtgärda innan automation kör vidare.',
      severity: 'warning',
      href: '/admin/outbound/unresolved',
      count: unresolvedOutboundCount,
    })
  }

  if (tenantConflictCount > 0) {
    alerts.push({
      id: 'tenant-conflicts',
      title: 'Tenant-/matchningsproblem',
      description: 'Sync-händelser saknar tydlig koppling och ska lösas innan driftkedjan fortsätter.',
      severity: 'warning',
      href: '/admin/operations/sync',
      count: tenantConflictCount,
    })
  }

  if (integrityReleaseGateCount > 0) {
    alerts.push({
      id: 'tenant-integrity-release-gates',
      title: 'Tenant-integritet kräver åtgärd',
      description: 'Canonical tenant-auditen har kritiska eller höga release-gate-fynd. Kontrollera evidens innan berörda flöden ändras eller produktionssätts.',
      severity: 'danger',
      href: '/admin/system/tenant-integrity',
      count: integrityReleaseGateCount,
    })
  }

  if (highAccessCount > 0) {
    alerts.push({
      id: 'high-access-users',
      title: 'Användare med hög behörighet',
      description: 'Granska superadmin/admin/company_admin löpande och håll behörigheterna snäva.',
      severity: 'info',
      href: '/admin/users',
      count: highAccessCount,
    })
  }

  if (pendingInvitationCount > 0) {
    alerts.push({
      id: 'pending-invitations',
      title: 'Ej accepterade inbjudningar',
      description: 'Öppna inbjudningar bör följas upp eller återkallas om de inte längre är aktuella.',
      severity: 'info',
      href: '/admin/companies',
      count: pendingInvitationCount,
    })
  }

  return alerts
}

async function listCompaniesMissingEdielActorProfile(): Promise<CompanyRow[]> {
  try {
    const { data, error } = await supabaseService.rpc('gridex_companies_missing_ediel_profile')
    if (!error && Array.isArray(data)) return data as CompanyRow[]
  } catch {
    // Fallback below.
  }

  const companies = await safeRows<CompanyRow>('companies', 'id, name, org_number, status, updated_at', [], 200, 'updated_at')
  const actorProfiles = await safeRows<{ company_id: string | null }>('ediel_actor_settings', 'company_id', [{ column: 'is_active', value: true }], 1000, 'company_id')
  const activeCompanyIds = new Set(actorProfiles.map((row) => row.company_id).filter(Boolean) as string[])
  return companies.filter((company) => !['archived', 'deleted_test_only'].includes(String(company.status ?? '')) && !activeCompanyIds.has(company.id))
}

async function listCompaniesWithoutActiveRoutes(): Promise<CompanyRow[]> {
  try {
    const { data, error } = await supabaseService.rpc('gridex_companies_missing_route_setup')
    if (!error && Array.isArray(data)) return data as CompanyRow[]
  } catch {
    // Fallback below.
  }

  const companies = await safeRows<CompanyRow>('companies', 'id, name, org_number, status, updated_at', [], 200, 'updated_at')
  const routes = await safeRows<{ company_id: string | null }>('communication_routes', 'company_id', [{ column: 'is_active', value: true }], 1000, 'company_id')
  const routeProfiles = await safeRows<{ company_id: string | null }>('ediel_route_profiles', 'company_id', [{ column: 'is_enabled', value: true }], 1000, 'company_id')
  const activeCompanyIds = new Set([...routes, ...routeProfiles].map((row) => row.company_id).filter(Boolean) as string[])
  return companies.filter((company) => !['archived', 'deleted_test_only'].includes(String(company.status ?? '')) && !activeCompanyIds.has(company.id))
}

async function countHighAccessUsers(): Promise<number> {
  try {
    const { count, error } = await supabaseService
      .from('user_roles')
      .select('user_id, roles!inner(key)', { count: 'exact', head: true })
      .in('roles.key', ['super_admin', 'admin', 'company_admin', 'platform_admin'])

    if (error) throw error
    return count ?? 0
  } catch (error) {
    if (isMissingRelationError(error) || (error as { code?: string } | null)?.code === '42703') return 0
    throw error
  }
}
