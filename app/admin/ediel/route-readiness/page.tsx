import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { isMissingSchemaError, routeReadinessLabel, routeReadinessNextStep, type RouteReadinessStatus } from '@/lib/launch/readiness'
import {
  bulkRouteReadinessByStatusAction,
  createRouteManualReviewAction,
  importSupplierContactsCsvAction,
  markContactOnlySupplierAction,
  markRouteNotRelevantAction,
  saveSupplierContactAction,
  verifyActorRouteForManualSendAction,
  materializeCompanyGridOwnerRouteAction,
  approveFirstProductionSendAction,
  bulkMaterializeOperationalRoutesAction,
} from './actions'

export const dynamic = 'force-dynamic'

type RouteReadinessRow = {
  actor_id: string
  actor_name: string | null
  legal_name: string | null
  org_number: string | null
  actor_status: string | null
  match_status: string | null
  visible_to_tenants: boolean | null
  actor_role: string | null
  message_family: string | null
  requirement_level: string | null
  route_id: string | null
  application_reference: string | null
  environment: string | null
  subaddress: string | null
  communication_type: string | null
  communication_address: string | null
  edi_charset: string | null
  edi_syntax: string | null
  party_id: string | null
  interchange_party_id: string | null
  requires_poa: boolean | null
  is_verified: boolean | null
  auto_send_allowed: boolean | null
  route_status: string | null
  route_source: string | null
  route_updated_at: string | null
  readiness_status: RouteReadinessStatus
  next_step: string | null
}

type ContactRow = {
  actor_id: string
  contact_type: string
  email: string | null
  phone: string | null
  is_verified: boolean
}

type CompanyRouteReadinessRow = {
  company_id: string
  grid_owner_id: string | null
  grid_owner_name: string | null
  grid_owner_ediel_id: string | null
  platform_actor_route_id: string | null
  message_family: string | null
  message_code: string | null
  environment: string | null
  operational_route_ready: boolean | null
  send_ready: boolean | null
  blocker_code: string | null
  readiness_message: string | null
  sender_settings_id: string | null
  production_send_lock_status: string | null
}

const ORDER: RouteReadinessStatus[] = [
  'critical_missing_route',
  'not_sendable',
  'needs_review',
  'recommended_missing_route',
  'optional_missing_route',
  'ready_verified_manual_send',
  'ready_auto_send_allowed',
  'not_required',
]

function statusTone(status: RouteReadinessStatus) {
  if (status === 'critical_missing_route' || status === 'not_sendable') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'needs_review' || status === 'recommended_missing_route') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (status === 'ready_auto_send_allowed') return 'border-purple-200 bg-purple-50 text-purple-800'
  if (status === 'ready_verified_manual_send') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function field(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || String(value).trim().length === 0) return '—'
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej'
  return String(value)
}

function summary(rows: RouteReadinessRow[]) {
  const counts = new Map<RouteReadinessStatus, number>()
  for (const row of rows) counts.set(row.readiness_status, (counts.get(row.readiness_status) ?? 0) + 1)
  return ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 }))
}

async function loadRouteReadiness() {
  const result = await supabaseService
    .from('gridex_route_readiness_v')
    .select('actor_id, actor_name, legal_name, org_number, actor_status, match_status, visible_to_tenants, actor_role, message_family, requirement_level, route_id, application_reference, environment, subaddress, communication_type, communication_address, edi_charset, edi_syntax, party_id, interchange_party_id, requires_poa, is_verified, auto_send_allowed, route_status, route_source, route_updated_at, readiness_status, next_step')
    .order('readiness_status', { ascending: true })
    .order('actor_name', { ascending: true })
    .limit(500)

  if (result.error) {
    if (isMissingSchemaError(result.error)) return { rows: [] as RouteReadinessRow[], error: 'Migrationen för route-readiness saknas eller är inte körd ännu.' }
    throw result.error
  }

  return { rows: (result.data ?? []) as RouteReadinessRow[], error: null as string | null }
}


type CompanyRouteFilters = {
  query: string | null
  environment: string | null
  messageFamily: string | null
  messageCode: string | null
  blockerCode: string | null
}

async function loadCompanyRouteReadiness(filters: CompanyRouteFilters) {
  let query = supabaseService
    .from('gridex_company_route_readiness_v')
    .select('company_id, grid_owner_id, grid_owner_name, grid_owner_ediel_id, platform_actor_route_id, message_family, message_code, environment, operational_route_ready, send_ready, blocker_code, readiness_message, sender_settings_id, production_send_lock_status')
    .or('operational_route_ready.eq.false,send_ready.eq.false')

  if (filters.environment) query = query.eq('environment', filters.environment)
  if (filters.messageFamily) query = query.eq('message_family', filters.messageFamily)
  if (filters.messageCode) query = query.eq('message_code', filters.messageCode)
  if (filters.blockerCode) query = query.eq('blocker_code', filters.blockerCode)
  if (filters.query) {
    const escaped = filters.query.replace(/[%,]/g, ' ').trim()
    query = query.or(`grid_owner_name.ilike.%${escaped}%,grid_owner_ediel_id.ilike.%${escaped}%`)
  }

  const result = await query
    .order('environment', { ascending: true })
    .order('grid_owner_name', { ascending: true })
    .limit(500)

  if (result.error) {
    if (isMissingSchemaError(result.error)) return [] as CompanyRouteReadinessRow[]
    throw result.error
  }
  return (result.data ?? []) as CompanyRouteReadinessRow[]
}

async function loadContacts(actorIds: string[]) {
  if (actorIds.length === 0) return [] as ContactRow[]
  const result = await supabaseService
    .from('platform_actor_contacts')
    .select('actor_id,contact_type,email,phone,is_verified')
    .in('actor_id', actorIds)
    .limit(1000)
  if (result.error) {
    if (isMissingSchemaError(result.error)) return [] as ContactRow[]
    throw result.error
  }
  return (result.data ?? []) as ContactRow[]
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function renderCompanyRouteCard(row: CompanyRouteReadinessRow) {
  const isProduction = row.environment === 'production'
  const isTest = row.environment === 'test'
  const operationalReady = row.operational_route_ready === true
  const materializeLabel = isProduction
    ? 'Materialisera production-route'
    : isTest
      ? 'Materialisera test-route'
      : 'Materialisera route'
  // Approval is only valid for a production row whose operational route exists
  // and whose production lock is still locked. Never shown for test rows.
  const showApproval = isProduction && operationalReady && row.production_send_lock_status === 'locked'
  const canMaterialize = !operationalReady && Boolean(row.grid_owner_id && row.platform_actor_route_id)

  return (
    <div key={`${row.company_id}-${row.grid_owner_id}-${row.platform_actor_route_id}-${row.message_family}-${row.message_code}-${row.environment}`} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <div className="font-medium text-slate-950">{field(row.grid_owner_name)} · {field(row.message_family)}/{field(row.message_code)} · {field(row.environment)}</div>
      <div className="mt-1 text-xs text-slate-600">Ediel-ID {field(row.grid_owner_ediel_id)} · blocker {field(row.blocker_code)} · operativ route {field(operationalReady)} · production lock {field(row.production_send_lock_status)}</div>
      <div className="mt-1 text-xs text-slate-600">{row.readiness_message ?? 'Operativ route eller send-readiness saknas.'}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {canMaterialize ? (
          <form action={materializeCompanyGridOwnerRouteAction}>
            <input type="hidden" name="companyId" value={row.company_id} />
            <input type="hidden" name="gridOwnerId" value={row.grid_owner_id ?? ''} />
            <input type="hidden" name="platformActorRouteId" value={row.platform_actor_route_id ?? ''} />
            <input type="hidden" name="messageFamily" value={row.message_family ?? 'PRODAT'} />
            <input type="hidden" name="messageCode" value={row.message_code ?? ''} />
            <input type="hidden" name="environment" value={row.environment ?? ''} />
            <button className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800">{materializeLabel}</button>
          </form>
        ) : null}
        {showApproval ? (
          <form action={approveFirstProductionSendAction}>
            <input type="hidden" name="companyId" value={row.company_id} />
            <input type="hidden" name="actorSettingId" value={row.sender_settings_id ?? ''} />
            <input type="hidden" name="reason" value="Godkänd från route-readiness efter verifierad production readiness." />
            <button className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100">Godkänn första production-send</button>
          </form>
        ) : null}
      </div>
    </div>
  )
}

const STATUS_BANNERS: Record<string, string> = {
  materialized: 'Operativ route materialiserades.',
  production_approved: 'Första produktionssändningen godkändes.',
  platform_route_missing: 'Verifierad global route saknas för nätägaren.',
  grid_owner_missing: 'Nätägaren saknas i masterdata.',
  grid_owner_actor_mismatch: 'Nätägaren är inte kopplad till routens marknadsaktör.',
  platform_route_not_verified: 'Den globala routen är inte verifierad/aktiv ännu.',
  platform_route_environment_mismatch: 'Routens miljö matchar inte vald miljö.',
  sender_settings_missing: 'Avsändarinställning saknas för bolag/miljö.',
  ambiguous_sender_settings: 'Flera avsändarinställningar matchar – välj entydig.',
  route_materialization_postcheck_failed: 'Raderna skrevs men readiness bekräftades inte. Kontrollera route-profil.',
  route_materialization_failed: 'Route kunde inte materialiseras. Se audit-logg för teknisk orsak.',
  operational_route_missing: 'Operativ route måste materialiseras innan produktion godkänns.',
  invalid_environment: 'Ogiltig miljö angavs.',
  missing_required_identifiers: 'Bolag, nätägare och aktörsroute krävs.',
  missing_company: 'Bolag saknas.',
  production_approval_failed: 'Produktionsgodkännandet kunde inte sparas.',
  communication_route_insert_failed: 'Communication route kunde inte skapas. Kontrollera route-typ, scope och bolagsdata.',
  communication_route_update_failed: 'Communication route kunde inte uppdateras. Kontrollera befintlig route och constraints.',
  ediel_route_profile_insert_failed: 'Ediel route profile kunde inte skapas. Kontrollera avsändarinställningar och profil-schema.',
  ediel_route_profile_update_failed: 'Ediel route profile kunde inte uppdateras. Kontrollera befintlig profil och constraints.',
  company_market_party_route_insert_failed: 'Bolagets operativa route kunde inte skapas. Kontrollera unik route-identitet (bolag/miljö/meddelandekod).',
  company_market_party_route_update_failed: 'Bolagets operativa route kunde inte uppdateras. Kontrollera befintlig route och constraints.',
  schema_mismatch: 'Databasens schema matchar inte route-materialiseringen. Kör senaste migrationerna.',
  duplicate_route_conflict: 'En aktiv operativ route finns redan för samma identitet. Inaktivera dubbletten innan ny materialisering.',
  sender_settings_ambiguous: 'Flera avsändarinställningar matchar – välj en entydig innan materialisering.',
  bulk_dry_run_completed: 'Bulk dry-run slutförd. Se audit-logg för kandidater och detaljer.',
  bulk_no_candidates_dry_run: 'Bulk dry-run hittade inga saknade operativa routes.',
  bulk_no_candidates_apply: 'Bulk apply hittade inga saknade operativa routes att materialisera.',
  bulk_materialized_and_repaired: 'Saknade operativa routes materialiserades och relaterade null-route-rader reparerades.',
  bulk_partially_materialized: 'Bulk materialisering kördes delvis. Vissa rader blockerades – se audit-logg.',
  bulk_materialization_failed: 'Bulk materialisering kunde inte köras. Se audit-logg för teknisk orsak.',
  bulk_materialization_blocked: 'Bulk materialisering blockerades av readiness-krav.',
  platform_route_missing_or_not_verified: 'Global route saknas, är inte verifierad eller saknar kommunikationsadress.',
  ediel_identity_missing: 'Avsändar- eller mottagande Ediel-ID saknas.',
}

// Admin-safe next action per reason code. Raw SQL/constraint detail stays in
// the audit log; the UI only shows a controlled, actionable hint.
const NEXT_ACTIONS: Record<string, string> = {
  communication_route_insert_failed: 'Kontrollera att route-typ är ediel_partner och att scope/bolag är giltiga, försök sedan igen.',
  communication_route_update_failed: 'Granska den befintliga communication route och försök igen.',
  ediel_route_profile_insert_failed: 'Säkerställ aktiva avsändarinställningar för bolag/miljö/meddelandefamilj och försök igen.',
  ediel_route_profile_update_failed: 'Granska den befintliga route-profilen och försök igen.',
  company_market_party_route_insert_failed: 'Inaktivera eventuell dubblett-route och försök igen.',
  company_market_party_route_update_failed: 'Granska den befintliga operativa routen och försök igen.',
  schema_mismatch: 'Kör senaste Supabase-migrationerna och försök igen.',
  duplicate_route_conflict: 'Inaktivera den befintliga aktiva routen med samma identitet och försök igen.',
  route_materialization_postcheck_failed: 'Kontrollera route-profil och constraints, försök sedan materialisera igen.',
  sender_settings_missing: 'Lägg in en aktiv Ediel-aktör för rätt bolag, roll och miljö.',
  sender_settings_ambiguous: 'Inaktivera dubbletter eller välj en entydig avsändarinställning.',
  platform_route_not_verified: 'Verifiera aktörsregistrets route innan operativ materialisering.',
  platform_route_environment_mismatch: 'Välj en global route i samma miljö som kundflödet.',
  grid_owner_actor_mismatch: 'Koppla nätägaren till samma verifierade marknadsaktör som routen.',
  operational_route_missing: 'Materialisera den operativa routen innan du godkänner produktion.',
  bulk_partially_materialized: 'Öppna audit-loggen för sample/radresultat och kör ny dry-run efter åtgärd.',
  bulk_materialization_failed: 'Kontrollera RPC/migration och kör dry-run igen.',
  bulk_materialization_blocked: 'Åtgärda första blocker-koden från audit-loggen och kör dry-run igen.',
  platform_route_missing_or_not_verified: 'Verifiera global route och kommunikationsadress innan bulk körs igen.',
  ediel_identity_missing: 'Komplettera avsändar-/mottagar-Ediel-ID innan bulk körs igen.',
}

export default async function EdielRouteReadinessPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePlatformAdminAccess()
  const searchParams = (await props.searchParams) ?? {}
  const filters: CompanyRouteFilters = {
    query: firstParam(searchParams.q),
    environment: firstParam(searchParams.env),
    messageFamily: firstParam(searchParams.family),
    messageCode: firstParam(searchParams.mcode),
    blockerCode: firstParam(searchParams.blocker),
  }
  const statusKind = firstParam(searchParams.status)
  const bannerCode = firstParam(searchParams.code)
  const banner = statusKind
    ? {
        kind: statusKind,
        code: bannerCode,
        message: STATUS_BANNERS[bannerCode ?? ''] ?? (statusKind === 'ok' ? 'Åtgärden lyckades.' : 'Åtgärden kunde inte slutföras.'),
        nextAction: statusKind === 'error' ? (NEXT_ACTIONS[bannerCode ?? ''] ?? null) : null,
      }
    : null

  const { rows, error } = await loadRouteReadiness()
  const companyRouteRows = await loadCompanyRouteReadiness(filters)
  const testCompanyRows = companyRouteRows.filter((row) => row.environment === 'test')
  const productionCompanyRows = companyRouteRows.filter((row) => row.environment === 'production')
  const otherCompanyRows = companyRouteRows.filter((row) => row.environment !== 'test' && row.environment !== 'production')
  const contacts = await loadContacts([...new Set(rows.map((row) => row.actor_id))])
  const contactsByActor = new Map<string, ContactRow[]>()
  for (const contact of contacts) {
    const list = contactsByActor.get(contact.actor_id) ?? []
    list.push(contact)
    contactsByActor.set(contact.actor_id, list)
  }

  const sortedRows = [...rows].sort((a, b) => {
    const byStatus = ORDER.indexOf(a.readiness_status) - ORDER.indexOf(b.readiness_status)
    if (byStatus !== 0) return byStatus
    return field(a.actor_name).localeCompare(field(b.actor_name), 'sv')
  })

  return (
    <main className="space-y-6">
      <AdminHeader
        title="Route-readiness"
        subtitle="Verifiera actor registry, saknade routes och manuella kontaktvägar innan elbolag får skicka i produktion. Bulk-verifiering slår aldrig på autosändning."
      />

      {error ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error}
        </section>
      ) : null}


      {banner ? (
        <section className={`rounded-2xl border p-4 text-sm ${banner.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <div className="font-medium">{banner.message}</div>
          {banner.kind === 'error' && banner.code ? (
            <div className="mt-1 text-xs opacity-80">Orsakskod: {banner.code}</div>
          ) : null}
          {banner.nextAction ? (
            <div className="mt-1 text-xs">Nästa steg: {banner.nextAction}</div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Så fungerar tenant route-readiness</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li>Global nätägare verifierad i aktörsregistret är <strong>inte</strong> samma sak som att bolagets operativa route är klar.</li>
          <li>Route-materialisering skapar bolagets operativa route – det är <strong>inte</strong> ett produktionsgodkännande.</li>
          <li>Produktionsgodkännande blir möjligt <strong>först efter</strong> att en operativ produktions-route finns.</li>
          <li>Test och produktion är separata banor. En testroute kan aldrig användas i produktion och tvärtom.</li>
        </ul>
      </section>



      <section className="rounded-2xl border border-purple-200 bg-purple-50 p-4 shadow-sm">
        <h2 className="text-base font-semibold text-purple-950">Bulk-materialisera saknade operativa routes</h2>
        <p className="mt-1 text-sm text-purple-900">
          Kör först dry-run. Apply skapar bara bolagets operativa routes för verifierade kandidater och reparerar relaterade null-route-rader. Den skickar aldrig SMTP och godkänner aldrig produktion.
        </p>
        <form action={bulkMaterializeOperationalRoutesAction} className="mt-4 grid gap-3 md:grid-cols-5">
          <input
            name="companyId"
            required
            defaultValue={[...new Set(companyRouteRows.map((row) => row.company_id))].length === 1 ? companyRouteRows[0]?.company_id ?? '' : ''}
            placeholder="company_id"
            className="rounded-xl border border-purple-200 px-3 py-2 text-sm md:col-span-2"
          />
          <select name="environment" defaultValue={filters.environment ?? 'production'} className="rounded-xl border border-purple-200 px-3 py-2 text-sm">
            <option value="">Alla miljöer</option>
            <option value="production">Produktion</option>
            <option value="test">Test</option>
          </select>
          <select name="messageFamily" defaultValue={filters.messageFamily ?? 'PRODAT'} className="rounded-xl border border-purple-200 px-3 py-2 text-sm">
            <option value="">Alla familjer</option>
            <option value="PRODAT">PRODAT</option>
            <option value="UTILTS">UTILTS</option>
          </select>
          <select name="mode" defaultValue="dry-run" className="rounded-xl border border-purple-200 px-3 py-2 text-sm">
            <option value="dry-run">Dry-run</option>
            <option value="apply">Apply + repair</option>
          </select>
          <button className="rounded-xl bg-purple-950 px-3 py-2 text-sm font-medium text-white hover:bg-purple-900 md:col-span-1">Kör bulk</button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Sök bolags-routes</h2>
        <form className="mt-3 grid gap-2 md:grid-cols-6">
          <input name="q" defaultValue={filters.query ?? ''} placeholder="Nätägare eller Ediel-ID (t.ex. 25600)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
          <select name="env" defaultValue={filters.environment ?? ''} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Alla miljöer</option>
            <option value="test">Test</option>
            <option value="production">Produktion</option>
          </select>
          <select name="family" defaultValue={filters.messageFamily ?? ''} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Alla familjer</option>
            <option value="PRODAT">PRODAT</option>
            <option value="UTILTS">UTILTS</option>
          </select>
          <input name="mcode" defaultValue={filters.messageCode ?? ''} placeholder="Message code (Z01)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="blocker" defaultValue={filters.blockerCode ?? ''} placeholder="Blocker code" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 md:col-span-1">Sök</button>
          <a href="/admin/ediel/route-readiness" className="rounded-xl border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50 md:col-span-1">Rensa</a>
        </form>
      </section>

      {productionCompanyRows.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-base font-semibold text-amber-950">Produktions-routes som kräver åtgärd</h2>
          <p className="mt-1 text-sm text-amber-900">Materialisera operativ produktions-route innan kundautomation försöker finalisera Z01. Produktionsgodkännande visas först när operativ route finns och låset är aktivt.</p>
          <div className="mt-4 grid gap-3">
            {productionCompanyRows.map((row) => renderCompanyRouteCard(row))}
          </div>
        </section>
      ) : null}

      {testCompanyRows.length > 0 ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <h2 className="text-base font-semibold text-sky-950">Test-routes som kräver åtgärd</h2>
          <p className="mt-1 text-sm text-sky-900">Testbanan är helt separat från produktion. Produktionsgodkännande visas aldrig för testrader.</p>
          <div className="mt-4 grid gap-3">
            {testCompanyRows.map((row) => renderCompanyRouteCard(row))}
          </div>
        </section>
      ) : null}

      {otherCompanyRows.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Routes utan tydlig miljö</h2>
          <div className="mt-4 grid gap-3">
            {otherCompanyRows.map((row) => renderCompanyRouteCard(row))}
          </div>
        </section>
      ) : null}

      {companyRouteRows.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Inga bolags-routes matchar nuvarande filter.
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        {summary(sortedRows).map((item) => (
          <div key={item.status} className={`rounded-2xl border p-4 ${statusTone(item.status)}`}>
            <div className="text-2xl font-semibold">{item.count}</div>
            <div className="mt-1 text-sm font-medium">{routeReadinessLabel(item.status)}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <form action={bulkRouteReadinessByStatusAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Bulkhantera route-readiness</h2>
          <p className="mt-1 text-sm text-slate-600">Kör samma åtgärd på upp till 500 rader med vald status. Bulk-verifiering sätter aldrig autosändning till på.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <select name="readinessStatus" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              {ORDER.map((status) => <option key={status} value={status}>{routeReadinessLabel(status)}</option>)}
            </select>
            <select name="bulkAction" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="create_review">Skapa manual review</option>
              <option value="verify_manual_send">Verifiera route för manuell sändning</option>
              <option value="mark_not_relevant">Markera ej relevant</option>
              <option value="contact_only_supplier">Markera suppliers contact-only</option>
            </select>
            <button className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">Kör bulkåtgärd</button>
          </div>
        </form>

        <form action={importSupplierContactsCsvAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Importera supplier contacts CSV</h2>
          <p className="mt-1 text-sm text-slate-600">Kolumner: actor_name, org_number, ediel_id, actor_role, contact_type, contact_email, contact_phone, contact_name, channel, source, is_verified, notes. Verifierad data skrivs inte över utan import issue.</p>
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
            <input name="contactsCsv" type="file" accept=".csv,text/csv" className="text-sm text-slate-700" />
            <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Importera kontakter</button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Saknade och verifierade routes</h2>
            <p className="text-sm text-slate-600">Nätägare kräver PRODAT för kritiska marknadsflöden. UTILTS är rekommenderad för mätvärden. Suppliers kan vara contact-only.</p>
          </div>
          <div className="flex flex-wrap gap-2"><a href="/api/admin/ediel/route-readiness/export" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Exportera route CSV</a><a href="/api/admin/ediel/supplier-contacts/export" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Exportera kontakter CSV</a></div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Aktör</th>
                <th className="px-3 py-3">Roll</th>
                <th className="px-3 py-3">Familj</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Route</th>
                <th className="px-3 py-3">Kontakt</th>
                <th className="px-3 py-3">Åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row) => {
                const actorContacts = contactsByActor.get(row.actor_id) ?? []
                const needsContact = ['optional_missing_route', 'not_required'].includes(row.readiness_status)
                return (
                  <tr key={`${row.actor_id}-${row.actor_role}-${row.message_family}-${row.route_id ?? 'missing'}`} className="align-top">
                    <td className="px-3 py-4">
                      <div className="font-medium text-slate-950">{field(row.actor_name)}</div>
                      <div className="text-xs text-slate-500">Org: {field(row.org_number)} · Match: {field(row.match_status)}</div>
                    </td>
                    <td className="px-3 py-4 text-slate-700">{field(row.actor_role)}</td>
                    <td className="px-3 py-4 text-slate-700">{field(row.message_family)}</td>
                    <td className="px-3 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row.readiness_status)}`}>{routeReadinessLabel(row.readiness_status)}</span>
                      <div className="mt-2 max-w-xs text-xs text-slate-600">{row.next_step ?? routeReadinessNextStep(row.readiness_status)}</div>
                    </td>
                    <td className="px-3 py-4 text-xs text-slate-700">
                      <div>Status: {field(row.route_status)}</div>
                      <div>Adress: {field(row.communication_address)}</div>
                      <div>Subadress: {field(row.subaddress)}</div>
                      <div>Verifierad: {field(row.is_verified)} · Auto: {field(row.auto_send_allowed)}</div>
                    </td>
                    <td className="px-3 py-4 text-xs text-slate-700">
                      {actorContacts.length === 0 ? <div>—</div> : actorContacts.map((contact) => (
                        <div key={`${contact.contact_type}-${contact.email}-${contact.phone}`} className="mb-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                          {contact.contact_type}: {contact.email ?? contact.phone} {contact.is_verified ? '✓' : ''}
                        </div>
                      ))}
                      {needsContact ? (
                        <form action={saveSupplierContactAction} className="mt-2 grid min-w-64 gap-2">
                          <input type="hidden" name="actorId" value={row.actor_id} />
                          <select name="contactType" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                            <option value="general">Allmän</option>
                            <option value="switching">Leverantörsbyte</option>
                            <option value="moving">Flytt</option>
                            <option value="customer_service">Kundservice</option>
                            <option value="policy">Policy/bundenhet</option>
                            <option value="poa">Fullmakt</option>
                            <option value="billing">Fakturering</option>
                          </select>
                          <input name="email" placeholder="kontakt@bolag.se" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <button className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white">Spara kontakt</button>
                        </form>
                      ) : null}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col gap-2">
                        {row.route_id ? (
                          <form action={verifyActorRouteForManualSendAction}>
                            <input type="hidden" name="actorId" value={row.actor_id} />
                            <input type="hidden" name="routeId" value={row.route_id} />
                            <button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700">Verifiera manuellt</button>
                          </form>
                        ) : null}
                        <form action={createRouteManualReviewAction}>
                          <input type="hidden" name="actorId" value={row.actor_id} />
                          <input type="hidden" name="actorRole" value={row.actor_role ?? ''} />
                          <input type="hidden" name="messageFamily" value={row.message_family ?? ''} />
                          <button className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-50">Skapa review</button>
                        </form>
                        <form action={markRouteNotRelevantAction}>
                          <input type="hidden" name="actorId" value={row.actor_id} />
                          <input type="hidden" name="actorRole" value={row.actor_role ?? ''} />
                          <input type="hidden" name="messageFamily" value={row.message_family ?? ''} />
                          <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Ej relevant</button>
                        </form>
                        {['electricity_supplier', 'supplier'].includes(String(row.actor_role)) ? (
                          <form action={markContactOnlySupplierAction}>
                            <input type="hidden" name="actorId" value={row.actor_id} />
                            <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Contact-only</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {sortedRows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">Ingen route-readiness data hittades.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
