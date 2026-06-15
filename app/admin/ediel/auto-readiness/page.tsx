import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listActorSendReadiness, type ActorSendReadinessRow } from '@/lib/ediel/operations/actorAutoReadiness'
import { supabaseService } from '@/lib/supabase/service'
import { applyActorAutoSendReadinessAction, confirmSafeBlankSubaddressesAction, refreshActorCertificatesAction, runActorReadinessBackfillAction } from './actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Promise<{ role?: string; family?: string; status?: string; q?: string }>
}

type RunRow = {
  id: string
  run_type: string
  status: string
  started_at: string
  finished_at: string | null
  checked_actor_count: number | null
  checked_route_count: number | null
  checked_certificate_count: number | null
  auto_enabled_count: number | null
  auto_disabled_count: number | null
  failed_count: number | null
}

type CertRow = {
  id: string
  actor_id: string | null
  ediel_id: string | null
  environment: string
  purpose: string
  status: string
  fingerprint_sha256: string | null
  subject: string | null
  issuer: string | null
  valid_from: string | null
  valid_to: string | null
  last_checked_at: string | null
  next_check_at: string | null
}


type RoleReadinessRow = {
  role_group: string
  actor_count: number | null
  supplier_switch_ready_count: number | null
  excluded_from_electricity_scope_count: number | null
  manual_review_required_count: number | null
  missing_or_invalid_certificate_count: number | null
  missing_prodat_route_count: number | null
  unsafe_or_missing_subaddress_count: number | null
  missing_contact_path_count: number | null
  missing_ediel_id_count: number | null
  open_blocking_conflicts_count: number | null
}

type GridOwnerSupplierSwitchRow = {
  platform_market_actor_id: string
  actor_name: string | null
  ediel_id: string | null
  supplier_switch_readiness_status: string | null
  can_start_supplier_switch: boolean | null
  is_electricity_grid_owner_scope: boolean | null
  electricity_scope_status: string | null
  missing_or_invalid_certificate: boolean | null
  missing_prodat_route: boolean | null
  unsafe_or_missing_subaddress: boolean | null
  missing_contact_path: boolean | null
  missing_ediel_id: boolean | null
  manual_review_required: boolean | null
}

type ActorSummary = {
  actor_id: string
  actor_name: string | null
  ediel_id: string | null
  actor_roles: string[]
  routes: ActorSendReadinessRow[]
  electricityRoutes: ActorSendReadinessRow[]
  routeCount: number
  prodatCount: number
  utiltsCount: number
  autoSendEnabledCount: number
  readyCount: number
  missingRequiredCertificateCount: number
  hardBlockedCount: number
  status: 'ready' | 'partial' | 'missing_required_certificate' | 'blocked' | 'needs_review' | 'no_electricity_routes'
  primaryBlocker: string | null
  blockingReasons: string[]
  lastCheckedAt: string | null
  nextCheckAt: string | null
}

function asTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
    } catch {}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed.slice(1, -1).split(',').map((item) => item.replace(/^"|"$/g, '').trim()).filter(Boolean)
    }
    return [trimmed]
  }
  return []
}

function safeDateValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const textValue = String(value)
  const timestamp = Date.parse(textValue)
  return Number.isFinite(timestamp) ? textValue : null
}

function normalizeReadinessRow(row: ActorSendReadinessRow): ActorSendReadinessRow {
  return {
    ...row,
    actor_id: String(row.actor_id ?? `unknown-${row.route_id ?? 'route'}`),
    route_id: String(row.route_id ?? `${row.actor_id ?? 'unknown'}-${row.message_family ?? 'route'}-${row.communication_address ?? 'no-address'}`),
    actor_roles: asTextArray(row.actor_roles),
    blocking_reasons: asTextArray(row.blocking_reasons),
    warnings: asTextArray(row.warnings),
    last_checked_at: safeDateValue(row.last_checked_at),
    next_check_at: safeDateValue(row.next_check_at),
    certificate_valid_to: safeDateValue(row.certificate_valid_to),
  }
}

function normalizeCertificate(row: CertRow): CertRow {
  return {
    ...row,
    id: String(row.id ?? `${row.ediel_id ?? 'unknown'}-${row.environment ?? 'env'}-${row.purpose ?? 'purpose'}`),
    fingerprint_sha256: row.fingerprint_sha256 ? String(row.fingerprint_sha256) : null,
    valid_to: safeDateValue(row.valid_to),
    next_check_at: safeDateValue(row.next_check_at),
  }
}

function actorMatchesRoleFilter(roles: string[] | null | undefined, filter: string) {
  const normalized = (roles ?? []).map((role) => String(role).toLowerCase())
  if (!filter || filter === 'all') return true
  if (filter === 'grid_owner') return normalized.some((role) => ['grid_owner', 'network_owner', 'netowner'].includes(role))
  if (filter === 'electricity_supplier') return normalized.some((role) => ['electricity_supplier', 'supplier', 'powersupplier'].includes(role))
  if (filter === 'energy_service_company') return normalized.some((role) => ['energy_service_company', 'esp', 'asp'].includes(role))
  if (filter === 'system_supplier') return normalized.some((role) => ['system_supplier', 'systemleverantor', 'systemleverantör'].includes(role))
  if (filter === 'balance_responsible_party') return normalized.some((role) => ['balance_responsible_party', 'balanceresponsible', 'balanceresponsibleparty', 'balanceresponsible', 'brp', 'bsp'].includes(role))
  if (filter === 'gas') return normalized.some((role) => ['gas_grid_owner', 'gas_owner', 'gas_network_owner', 'gas_distribution_system_operator', 'gasnat', 'gasnät'].includes(role))
  return normalized.includes(filter)
}

function field(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function statusLabel(value: string | null | undefined) {
  switch (value) {
    case 'ready': return 'Klar'
    case 'partial': return 'Delvis klar'
    case 'blocked': return 'Blockerad'
    case 'missing_required_certificate': return 'Saknar PRODAT-certifikat'
    case 'no_electricity_routes': return 'Saknar elroutes'
    case 'ready_for_auto_send': return 'Redo för auto-send'
    case 'missing_certificate': return 'Saknar certifikat'
    case 'missing_or_invalid_certificate': return 'Saknar/ogiltigt certifikat'
    case 'missing_prodat_route': return 'Saknar PRODAT-route'
    case 'unsafe_or_missing_subaddress': return 'Saknar/osäker subadress'
    case 'missing_contact_path': return 'Saknar kontaktväg'
    case 'missing_ediel_id': return 'Saknar Ediel-ID'
    case 'expired_certificate': return 'Certifikat utgånget'
    case 'certificate_expires_soon': return 'Certifikat går ut snart'
    case 'route_not_verified': return 'Route ej verifierad'
    case 'missing_smtp_address': return 'Saknar SMTP'
    case 'party_id_mismatch': return 'Ediel-ID mismatch'
    case 'needs_manual_review': return 'Behöver granskning'
    case 'needs_review': return 'Behöver granskning'
    case 'manual_review_required': return 'Manuell review'
    case 'excluded_from_electricity_scope': return 'Exkluderad från elhandel'
    case 'gas_grid_owner': return 'Gas / separat scope'
    case 'electricity_grid_owner': return 'Elnät'
    case 'electricity_supplier': return 'Elhandlare'
    case 'system_supplier': return 'Systemleverantör'
    case 'energy_service_company': return 'Energitjänst/ASP/ESP'
    case 'balance_responsible': return 'Balansansvarig'
    case 'other': return 'Övrigt'
    default: return field(value)
  }
}

function tone(value: string | null | undefined) {
  if (value === 'ready' || value === 'ready_for_auto_send') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (value === 'excluded_from_electricity_scope' || value === 'gas_grid_owner') return 'border-slate-200 bg-slate-50 text-slate-700'
  if (value === 'partial') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (value === 'missing_required_certificate' || value === 'missing_certificate' || value === 'expired_certificate') return 'border-red-200 bg-red-50 text-red-800'
  if (value === 'blocked') return 'border-red-300 bg-red-100 text-red-900'
  if (value === 'certificate_expires_soon' || value === 'route_not_verified' || value === 'needs_manual_review' || value === 'needs_review') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function isElectricityRoute(row: ActorSendReadinessRow) {
  const family = String(row.message_family ?? '').toUpperCase()
  const subaddress = String(row.subaddress ?? '').toUpperCase()
  return ['PRODAT', 'UTILTS'].includes(family) && subaddress !== 'GAS'
}

function routeMatchesFamilyFilter(row: ActorSendReadinessRow, familyFilter: string) {
  const family = String(row.message_family ?? '').toUpperCase()
  const subaddress = String(row.subaddress ?? '').toUpperCase()
  return familyFilter === 'all'
    || (familyFilter === 'electricity' && ['PRODAT', 'UTILTS'].includes(family) && subaddress !== 'GAS')
    || family === familyFilter.toUpperCase()
}

function summarizeActors(rows: ActorSendReadinessRow[]): ActorSummary[] {
  const byActor = new Map<string, ActorSendReadinessRow[]>()
  for (const row of rows) {
    const key = row.actor_id
    byActor.set(key, [...(byActor.get(key) ?? []), row])
  }

  return Array.from(byActor.entries()).map(([actor_id, routes]) => {
    const first = routes[0]
    const electricityRoutes = routes.filter(isElectricityRoute)
    const relevant = electricityRoutes.length > 0 ? electricityRoutes : routes
    const blockingReasons = Array.from(new Set(relevant.flatMap((route) => asTextArray(route.blocking_reasons)))).sort((a, b) => a.localeCompare(b, 'sv'))
    const hardBlockedReasons = new Set(['party_id_mismatch', 'interchange_party_id_mismatch', 'wrong_environment', 'missing_transport_channel', 'tenant_routing_not_verified', 'route_not_active', 'route_not_verified'])
    const hardBlockedCount = relevant.filter((route) => asTextArray(route.blocking_reasons).some((reason) => hardBlockedReasons.has(reason))).length
    const missingRequiredCertificateCount = relevant.filter((route) => route.requires_certificate === true && route.certificate_status !== 'valid').length
    const readyCount = relevant.filter((route) => route.readiness_status === 'ready_for_auto_send').length
    const autoSendEnabledCount = relevant.filter((route) => route.auto_send_allowed === true).length
    const routeCount = relevant.length
    const prodatCount = relevant.filter((route) => String(route.message_family ?? '').toUpperCase() === 'PRODAT').length
    const utiltsCount = relevant.filter((route) => String(route.message_family ?? '').toUpperCase() === 'UTILTS').length

    let status: ActorSummary['status'] = 'needs_review'
    let primaryBlocker: string | null = blockingReasons[0] ?? null
    if (electricityRoutes.length === 0) {
      status = 'no_electricity_routes'
      primaryBlocker = 'no_electricity_routes'
    } else if (hardBlockedCount > 0) {
      status = 'blocked'
      primaryBlocker = blockingReasons.find((reason) => hardBlockedReasons.has(reason)) ?? 'blocked'
    } else if (readyCount === routeCount && routeCount > 0) {
      status = 'ready'
      primaryBlocker = null
    } else if (readyCount > 0 && missingRequiredCertificateCount > 0) {
      status = 'partial'
      primaryBlocker = 'missing_required_certificate'
    } else if (missingRequiredCertificateCount > 0) {
      status = 'missing_required_certificate'
      primaryBlocker = 'missing_required_certificate'
    } else if (readyCount > 0) {
      status = 'partial'
      primaryBlocker = blockingReasons[0] ?? null
    }

    return {
      actor_id,
      actor_name: first?.actor_name ?? null,
      ediel_id: first?.ediel_id ?? null,
      actor_roles: asTextArray(first?.actor_roles),
      routes,
      electricityRoutes,
      routeCount,
      prodatCount,
      utiltsCount,
      autoSendEnabledCount,
      readyCount,
      missingRequiredCertificateCount,
      hardBlockedCount,
      status,
      primaryBlocker,
      blockingReasons,
      lastCheckedAt: relevant.map((row) => row.last_checked_at).filter(Boolean).sort().at(-1) ?? null,
      nextCheckAt: relevant.map((row) => row.next_check_at).filter(Boolean).sort()[0] ?? null,
    }
  })
}

function summarizeStatus(rows: ActorSummary[]) {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
}

async function loadRuns(): Promise<RunRow[]> {
  const result = await supabaseService
    .from('platform_actor_readiness_runs')
    .select('id,run_type,status,started_at,finished_at,checked_actor_count,checked_route_count,checked_certificate_count,auto_enabled_count,auto_disabled_count,failed_count')
    .order('started_at', { ascending: false })
    .limit(8)

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }
  return (result.data ?? []) as RunRow[]
}

async function loadRoleReadinessSummary(): Promise<RoleReadinessRow[]> {
  const result = await supabaseService
    .from('actor_readiness_by_role_v')
    .select('role_group,actor_count,supplier_switch_ready_count,excluded_from_electricity_scope_count,manual_review_required_count,missing_or_invalid_certificate_count,missing_prodat_route_count,unsafe_or_missing_subaddress_count,missing_contact_path_count,missing_ediel_id_count,open_blocking_conflicts_count')

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }
  return (result.data ?? []) as RoleReadinessRow[]
}

async function loadGridOwnerSupplierSwitchReadiness(): Promise<GridOwnerSupplierSwitchRow[]> {
  const result = await supabaseService
    .from('grid_owner_supplier_switch_readiness_v')
    .select('platform_market_actor_id,actor_name,ediel_id,supplier_switch_readiness_status,can_start_supplier_switch,is_electricity_grid_owner_scope,electricity_scope_status,missing_or_invalid_certificate,missing_prodat_route,unsafe_or_missing_subaddress,missing_contact_path,missing_ediel_id,manual_review_required')
    .limit(1000)

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }
  return (result.data ?? []) as GridOwnerSupplierSwitchRow[]
}

async function loadCertificates(): Promise<CertRow[]> {
  const result = await supabaseService
    .from('platform_actor_certificates')
    .select('id,actor_id,ediel_id,environment,purpose,status,fingerprint_sha256,subject,issuer,valid_from,valid_to,last_checked_at,next_check_at')
    .order('next_check_at', { ascending: true, nullsFirst: true })
    .limit(40)

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }
  return ((result.data ?? []) as CertRow[]).map(normalizeCertificate)
}

export default async function EdielAutoReadinessPage({ searchParams }: PageProps) {
  await requirePlatformAdminAccess()
  const params = searchParams ? await searchParams : {}
  const roleFilter = params.role ?? 'all'
  const familyFilter = params.family ?? 'electricity'
  const statusFilter = params.status ?? 'all'
  const queryFilter = String(params.q ?? '').trim().toLowerCase()
  const loadErrors: string[] = []
  const [rawRows, runs, certificates, roleReadiness, gridOwnerReadiness] = await Promise.all([
    listActorSendReadiness(3000).catch((error) => {
      loadErrors.push(`Readiness kunde inte laddas: ${error instanceof Error ? error.message : String(error)}`)
      return [] as ActorSendReadinessRow[]
    }),
    loadRuns().catch((error) => {
      loadErrors.push(`Körningshistorik kunde inte laddas: ${error instanceof Error ? error.message : String(error)}`)
      return [] as RunRow[]
    }),
    loadCertificates().catch((error) => {
      loadErrors.push(`Certifikatkontroller kunde inte laddas: ${error instanceof Error ? error.message : String(error)}`)
      return [] as CertRow[]
    }),
    loadRoleReadinessSummary().catch((error) => {
      loadErrors.push(`Rollbaserad readiness kunde inte laddas: ${error instanceof Error ? error.message : String(error)}`)
      return [] as RoleReadinessRow[]
    }),
    loadGridOwnerSupplierSwitchReadiness().catch((error) => {
      loadErrors.push(`Nätägare-readiness kunde inte laddas: ${error instanceof Error ? error.message : String(error)}`)
      return [] as GridOwnerSupplierSwitchRow[]
    }),
  ])
  const rows = rawRows.map(normalizeReadinessRow)
  const filteredRows = rows.filter((row) => {
    const matchesFamily = routeMatchesFamilyFilter(row, familyFilter)
    const matchesRole = actorMatchesRoleFilter(row.actor_roles, roleFilter)
    const matchesQuery = !queryFilter || [row.actor_name, row.ediel_id, row.communication_address, row.message_family, row.subaddress, ...(row.actor_roles ?? [])]
      .filter(Boolean)
      .some((item) => String(item).toLowerCase().includes(queryFilter))
    return matchesFamily && matchesRole && matchesQuery
  })
  const actorSummaries = summarizeActors(filteredRows)
    .filter((summary) => statusFilter === 'all' || summary.status === statusFilter || summary.primaryBlocker === statusFilter)
    .sort((a, b) => {
      const statusOrder = ['blocked', 'missing_required_certificate', 'partial', 'needs_review', 'no_electricity_routes', 'ready']
      const byStatus = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
      if (byStatus !== 0) return byStatus
      return field(a.actor_name).localeCompare(field(b.actor_name), 'sv')
    })

  const electricityGridOwners = gridOwnerReadiness.filter((row) => row.is_electricity_grid_owner_scope === true)
  const excludedGridOwners = gridOwnerReadiness.filter((row) => row.electricity_scope_status === 'excluded_from_electricity_scope')
  const gridOwnerMetric = {
    total: electricityGridOwners.length,
    ready: electricityGridOwners.filter((row) => row.can_start_supplier_switch === true).length,
    missingCertificate: electricityGridOwners.filter((row) => row.missing_or_invalid_certificate === true).length,
    missingRoute: electricityGridOwners.filter((row) => row.missing_prodat_route === true).length,
    missingSubaddress: electricityGridOwners.filter((row) => row.unsafe_or_missing_subaddress === true).length,
    missingContact: electricityGridOwners.filter((row) => row.missing_contact_path === true).length,
    missingEdielId: electricityGridOwners.filter((row) => row.missing_ediel_id === true).length,
    manualReview: electricityGridOwners.filter((row) => row.manual_review_required === true).length,
    excluded: excludedGridOwners.length,
  }
  const roleSummaryByGroup = new Map(roleReadiness.map((row) => [row.role_group, row]))
  const separateRoleGroups = ['electricity_supplier', 'system_supplier', 'energy_service_company', 'balance_responsible', 'gas_grid_owner', 'other']

  return (
    <main className="space-y-6">
      <AdminHeader
        title="Aktörsberedskap och autosändning"
        subtitle="Rollbaserad readiness: leverantörsbyte räknar bara elnät, medan gas, systemleverantörer och övriga roller visas separat."
      />

      {loadErrors.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">Adminvyn laddades med varningar</div>
          <div className="mt-1">Sidan kraschar inte längre om certifikat-/readiness-data är ofullständig. Kontrollera dessa fel i serverloggen:</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {loadErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <div className="text-2xl font-semibold">{gridOwnerMetric.ready}/{gridOwnerMetric.total}</div>
          <div className="mt-1 text-sm font-medium">Nätägare redo för elhandel</div>
          <div className="mt-1 text-xs">Endast elnät i supplier-switch scope.</div>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
          <div className="text-2xl font-semibold">{gridOwnerMetric.missingCertificate}</div>
          <div className="mt-1 text-sm font-medium">Elnät saknar certifikat</div>
          <div className="mt-1 text-xs">O6.4A cert-refresh kör bara dessa säkra kandidater.</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="text-2xl font-semibold">{gridOwnerMetric.missingRoute}</div>
          <div className="mt-1 text-sm font-medium">PRODAT-route saknas</div>
          <div className="mt-1 text-xs">Manuell review. Ingen gissad route skapas.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-800">
          <div className="text-2xl font-semibold">{gridOwnerMetric.excluded}</div>
          <div className="mt-1 text-sm font-medium">Gas/test/system exkluderade</div>
          <div className="mt-1 text-xs">Blockerar inte elhandelns leverantörsbyte.</div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {separateRoleGroups.map((roleGroup) => {
          const row = roleSummaryByGroup.get(roleGroup)
          if (!row) return null
          return (
            <div key={roleGroup} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xl font-semibold text-slate-950">{field(row.actor_count)}</div>
              <div className="mt-1 text-sm font-medium text-slate-700">{statusLabel(roleGroup)}</div>
              <div className="mt-1 text-xs text-slate-500">Redo elflöde: {field(row.supplier_switch_ready_count)} · Exkluderade: {field(row.excluded_from_electricity_scope_count)}</div>
            </div>
          )
        })}
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {summarizeStatus(actorSummaries).map(([status, count]) => (
          <div key={status} className={`rounded-2xl border p-4 ${tone(status)}`}>
            <div className="text-2xl font-semibold">{count}</div>
            <div className="mt-1 text-sm font-medium">{statusLabel(status)}</div>
          </div>
        ))}
        {actorSummaries.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 md:col-span-4">
            Readiness-vyn saknas eller har inga rader. Kör migrationen och importera actor registry först.
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <form action={runActorReadinessBackfillAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Backfilla och verifiera</h2>
          <p className="mt-1 text-sm text-slate-600">Matchar XML-importerad aktörsdata, verifierar säkra PRODAT/UTILTS-routes och skapar certifikat-checkar.</p>
          <button className="mt-4 rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">Kör backfill nu</button>
        </form>
        <form action={refreshActorCertificatesAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Kontrollera certifikat</h2>
          <p className="mt-1 text-sm text-slate-600">Söker mottagarcertifikat bara för blockerade elnät i supplier-switch scope. Gas, systemleverantörer och övriga roller skannas inte här.</p>
          <button className="mt-4 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Kontrollera igen</button>
        </form>
        <form action={confirmSafeBlankSubaddressesAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Bekräfta tom subadress</h2>
          <p className="mt-1 text-sm text-slate-600">Markerar bara unika, verifierade PRODAT/UTILTS-routes där registret visar att subadress inte krävs. Ingen fake-subadress skapas.</p>
          <button className="mt-4 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Bekräfta säkra routes</button>
        </form>
        <form action={applyActorAutoSendReadinessAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Försök aktivera auto-send</h2>
          <p className="mt-1 text-sm text-slate-600">Aktiverar bara routes där readiness är grön. PRODAT kräver giltigt mottagarcertifikat.</p>
          <button className="mt-4 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">Aktivera där säkert</button>
        </form>
      </section>

      <form className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" action="/admin/ediel/auto-readiness">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-xs font-bold text-slate-700">Roll
            <select name="role" defaultValue={roleFilter} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs">
              <option value="all">Alla roller</option>
              <option value="grid_owner">Nätägare</option>
              <option value="electricity_supplier">Elleverantörer</option>
              <option value="energy_service_company">Energitjänsteföretag</option>
              <option value="balance_responsible_party">Balansansvariga</option>
              <option value="system_supplier">Systemleverantörer</option>
              <option value="gas">Gas / separat scope</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">Route-scope
            <select name="family" defaultValue={familyFilter} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs">
              <option value="electricity">Elhandel: PRODAT/UTILTS utan GAS</option>
              <option value="PRODAT">PRODAT</option>
              <option value="UTILTS">UTILTS</option>
              <option value="DELFOR">DELFOR</option>
              <option value="all">Alla route-typer</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">Readiness
            <select name="status" defaultValue={statusFilter} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs">
              <option value="all">Alla statusar</option>
              <option value="ready">Klar</option>
              <option value="partial">Delvis klar</option>
              <option value="missing_required_certificate">Saknar PRODAT-certifikat</option>
              <option value="blocked">Blockerad</option>
              <option value="needs_review">Behöver granskning</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">Sök
            <input name="q" defaultValue={params.q ?? ''} placeholder="Aktör, Ediel-ID, SMTP..." className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs" />
          </label>
          <div className="flex items-end gap-2">
            <button className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">Filtrera</button>
            <a href="/admin/ediel/auto-readiness" className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">Rensa</a>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Visar {actorSummaries.length} aktörer baserat på {filteredRows.length} route-rader. Leverantörsbyte räknar bara elnät; gas och övriga roller visas separat och blockerar inte elflödet.</p>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Aktörer</h2>
            <p className="text-sm text-slate-600">En rad per aktör. Öppna raden för PRODAT/UTILTS, certifikat och blockerande orsaker.</p>
          </div>
          <a href="/admin/ediel/routes" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Öppna routes</a>
        </div>
        <div className="space-y-3">
          {actorSummaries.map((actor) => (
            <details key={actor.actor_id} className="rounded-2xl border border-slate-200 bg-white p-4 open:bg-slate-50">
              <summary className="cursor-pointer list-none">
                <div className="grid gap-3 md:grid-cols-[1.7fr_1fr_1fr_1.2fr] md:items-center">
                  <div>
                    <div className="font-semibold text-slate-950">{field(actor.actor_name)}</div>
                    <div className="text-xs text-slate-500">Ediel-ID: {field(actor.ediel_id)} · Roller: {actor.actor_roles.join(', ') || '—'}</div>
                  </div>
                  <div className="text-xs text-slate-600">
                    <div>PRODAT: {actor.prodatCount}</div>
                    <div>UTILTS: {actor.utiltsCount}</div>
                    <div>Auto-send: {actor.autoSendEnabledCount}/{actor.routeCount}</div>
                  </div>
                  <div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${tone(actor.status)}`}>{statusLabel(actor.status)}</span>
                    {actor.primaryBlocker ? <div className="mt-1 text-xs text-slate-500">Hinder: {statusLabel(actor.primaryBlocker)}</div> : null}
                  </div>
                  <div className="text-xs text-slate-600">
                    <div>Redo routes: {actor.readyCount}/{actor.routeCount}</div>
                    <div>Saknar krävt certifikat: {actor.missingRequiredCertificateCount}</div>
                    <div>Hårda fel: {actor.hardBlockedCount}</div>
                  </div>
                </div>
              </summary>
              <div className="mt-4 overflow-x-auto border-t border-slate-200 pt-4">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-100 text-left uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Route</th>
                      <th className="px-3 py-2">Transport</th>
                      <th className="px-3 py-2">Auto-send</th>
                      <th className="px-3 py-2">Certifikat</th>
                      <th className="px-3 py-2">Saknas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {actor.routes.filter((row) => routeMatchesFamilyFilter(row, familyFilter)).map((row) => (
                      <tr key={row.route_id} className="align-top">
                        <td className="px-3 py-3">
                          <div className="font-medium text-slate-900">{field(row.message_family)} · {field(row.environment)}</div>
                          <div className="text-slate-500">Subadress: {field(row.subaddress)} · App ref: {field(row.application_reference)}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          <div>SMTP: {field(row.communication_address)}</div>
                          <div>Party: {field(row.party_id)} · UNB: {field(row.interchange_party_id)}</div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${tone(row.readiness_status)}`}>{statusLabel(row.readiness_status)}</span>
                          <div className="mt-1 text-slate-500">Tillåten: {row.auto_send_allowed ? 'Ja' : 'Nej'} · Verifierad: {row.route_verified ? 'Ja' : 'Nej'}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          <div>Krävs: {row.requires_certificate ? 'Ja' : 'Nej'}</div>
                          <div>Status: {field(row.certificate_status)}</div>
                          <div>Gäller till: {field(row.certificate_valid_to)}</div>
                          <div>Fingerprint: {row.certificate_fingerprint_sha256 ? `${String(row.certificate_fingerprint_sha256).slice(0, 16)}…` : '—'}</div>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {asTextArray(row.blocking_reasons).length === 0 && asTextArray(row.warnings).length === 0 ? 'Inga blockerande punkter' : null}
                          {asTextArray(row.blocking_reasons).map((reason) => (
                            <div key={reason} className="mb-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-red-800">{reason}</div>
                          ))}
                          {asTextArray(row.warnings).map((warning) => (
                            <div key={warning} className="mb-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">{warning}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Senaste körningar</h2>
          <div className="mt-3 space-y-2 text-sm">
            {runs.map((run) => (
              <div key={run.id} className="rounded-xl border border-slate-200 p-3">
                <div className="font-medium text-slate-950">{run.run_type} · {run.status}</div>
                <div className="text-xs text-slate-500">Start: {run.started_at} · Klar: {field(run.finished_at)}</div>
                <div className="mt-1 text-xs text-slate-600">Aktörer {field(run.checked_actor_count)} · Routes {field(run.checked_route_count)} · Certifikat {field(run.checked_certificate_count)} · Auto på {field(run.auto_enabled_count)} · Auto av {field(run.auto_disabled_count)}</div>
              </div>
            ))}
            {runs.length === 0 ? <div className="text-sm text-slate-500">Inga readiness-körningar ännu.</div> : null}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Certifikatkontroller</h2>
          <div className="mt-3 space-y-2 text-sm">
            {certificates.map((cert) => (
              <div key={cert.id} className="rounded-xl border border-slate-200 p-3">
                <div className="font-medium text-slate-950">Ediel-ID {field(cert.ediel_id)} · {cert.environment} · {cert.purpose}</div>
                <div className="text-xs text-slate-600">Status: {cert.status} · Gäller till: {field(cert.valid_to)}</div>
                <div className="text-xs text-slate-500">Nästa kontroll: {field(cert.next_check_at)} · Fingerprint: {cert.fingerprint_sha256 ? `${String(cert.fingerprint_sha256).slice(0, 18)}…` : '—'}</div>
              </div>
            ))}
            {certificates.length === 0 ? <div className="text-sm text-slate-500">Inga certifikatposter ännu. Kör backfill för att skapa saknade certifikatkontroller.</div> : null}
          </div>
        </div>
      </section>
    </main>
  )
}
