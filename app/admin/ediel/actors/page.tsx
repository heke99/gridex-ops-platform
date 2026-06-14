import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { importPlatformActorsAction, refreshExpisoftReceiverCertificateAction, resolvePlatformActorImportIssueAction, saveEdielPartyRegistryEntryAction, verifyPlatformActorForCustomerFlowAction } from '@/app/admin/ediel/actors/actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Promise<{ role?: string; status?: string; q?: string }>
}

function actorStatusLabel(value: string | null | undefined) {
  switch (String(value ?? '').toLowerCase()) {
    case 'active': return 'Aktiv'
    case 'verified': return 'Verifierad'
    case 'needs_review': return 'Kräver granskning'
    case 'needs_verification': return 'Kräver verifiering'
    case 'strong_suggestion': return 'Stark matchning'
    case 'draft': return 'Utkast'
    case 'inactive': return 'Inaktiv'
    case 'blocked': return 'Blockerad'
    case 'resolved': return 'Löst'
    case 'acknowledged': return 'Granskad'
    default: return value ?? '—'
  }
}

function actorRoleLabel(value: string | null | undefined) {
  switch (String(value ?? '').toLowerCase()) {
    case 'grid_owner':
    case 'network_owner':
    case 'netowner': return 'Nätägare'
    case 'electricity_supplier':
    case 'supplier':
    case 'powersupplier': return 'Elleverantör'
    case 'energy_service_company': return 'Energitjänsteföretag'
    case 'balance_responsible_party':
    case 'brp': return 'Balansansvarig'
    case 'ediel_portal': return 'Edielportalen'
    case 'test_counterparty': return 'Kontrollmotpart'
    case 'system_supplier': return 'Systemleverantör'
    case 'grid_owner_in_agt_context': return 'Nätägare i aktörstest'
    case 'other': return 'Annan roll'
    default: return value ?? '—'
  }
}


function roleFilterLabel(value: string) {
  switch (value) {
    case 'grid_owner': return 'Nätägare'
    case 'electricity_supplier': return 'Elleverantörer'
    case 'energy_service_company': return 'Energitjänsteföretag'
    case 'balance_responsible_party': return 'Balansansvariga'
    case 'system_supplier': return 'Systemleverantörer'
    default: return 'Alla roller'
  }
}

function actorMatchesRoleFilter(roles: string[], filter: string) {
  if (!filter || filter === 'all') return true
  if (filter === 'electricity_supplier') return roles.some((role) => ['electricity_supplier', 'supplier', 'powersupplier'].includes(String(role).toLowerCase()))
  if (filter === 'grid_owner') return roles.some((role) => ['grid_owner', 'network_owner', 'netowner'].includes(String(role).toLowerCase()))
  if (filter === 'balance_responsible_party') return roles.some((role) => ['balance_responsible_party', 'brp'].includes(String(role).toLowerCase()))
  return roles.some((role) => String(role).toLowerCase() === filter)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function previewValue(metadata: unknown, key: string): number | string {
  if (!isRecord(metadata) || !isRecord(metadata.preview)) return '—'
  const value = metadata.preview[key]
  return typeof value === 'number' || typeof value === 'string' ? value : '—'
}

function importModeLabel(metadata: unknown, status: string | null | undefined) {
  if (isRecord(metadata) && metadata.mode === 'preview') return 'Förhandsgranskning klar'
  if (isRecord(metadata) && metadata.mode === 'apply') return status === 'completed' ? 'Importerad' : 'Importerad med granskning'
  return actorStatusLabel(status)
}

function routeStatusLabel(value: string | null | undefined, verified?: boolean | null) {
  if (verified) return 'Verifierad'
  switch (String(value ?? '').toLowerCase()) {
    case 'active': return 'Aktiv'
    case 'verified': return 'Verifierad'
    case 'needs_review': return 'Kräver granskning'
    case 'needs_verification': return 'Kräver verifiering'
    case 'inactive': return 'Inaktiv'
    case 'required_encrypted': return 'Kryptering krävs'
    case 'encrypted': return 'Krypterad'
    case 'unencrypted': return 'Okrypterad'
    default: return value ?? '—'
  }
}

export default async function EdielActorsPage({ searchParams }: PageProps) {
  const context = await requirePlatformAdminAccess()
  const params = searchParams ? await searchParams : {}
  const roleFilter = params.role ?? 'all'
  const statusFilter = params.status ?? 'all'
  const queryFilter = String(params.q ?? '').trim().toLowerCase()
  const [actorsResult, partiesResult, addressesResult, marketActorsResult, actorRolesResult, actorRoutesResult, importIssuesResult, semanticsResult, importRunsResult] = await Promise.all([
    supabaseService
    .from('ediel_actor_settings')
    .select('id, company_id, ediel_id, actor_ediel_id, actor_role, role, sub_role, environment, is_active, status, updated_at')
    .order('updated_at', { ascending: false })
      .limit(100),
    supabaseService
      .from('ediel_parties')
      .select('id, name, ediel_id, roles, status, visible_to_customer_flow, source, updated_at')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabaseService
      .from('ediel_party_addresses')
      .select('id, party_id, ediel_id, qualifier, subaddress, business_code, environment, message_family, smtp_address, receiver_certificate_id, transport_security_mode, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200),
    supabaseService
      .from('platform_market_actors')
      .select('id,name,org_number,status,source,updated_at')
      .order('updated_at', { ascending: false })
      .limit(500),
    supabaseService
      .from('platform_actor_roles')
      .select('actor_id,actor_role,is_active'),
    supabaseService
      .from('platform_actor_routes')
      .select('id,actor_id,message_family,subaddress,communication_address,environment,is_verified,status')
      .limit(300),
    supabaseService
      .from('platform_actor_import_issues')
      .select('id,actor_id,issue_type,severity,status,message,created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseService
      .from('ediel_message_semantics')
      .select('message_family,message_code,subtype,business_process,request_type,is_active')
      .eq('is_active', true)
      .limit(100),
    supabaseService
      .from('platform_actor_import_runs')
      .select('id,source,import_type,status,records_seen,records_upserted,records_failed,metadata,started_at,completed_at')
      .order('started_at', { ascending: false })
      .limit(6),
  ])
  const actors = actorsResult.data ?? []
  const parties = partiesResult.error ? [] : partiesResult.data ?? []
  const addresses = addressesResult.error ? [] : addressesResult.data ?? []
  const marketActors = marketActorsResult.error ? [] : marketActorsResult.data ?? []
  const actorRoles = actorRolesResult.error ? [] : actorRolesResult.data ?? []
  const actorRoutes = actorRoutesResult.error ? [] : actorRoutesResult.data ?? []
  const importIssues = importIssuesResult.error ? [] : importIssuesResult.data ?? []
  const messageRegler = semanticsResult.error ? [] : semanticsResult.data ?? []
  const importRuns = importRunsResult.error ? [] : importRunsResult.data ?? []
  const addressesByParty = new Map<string, typeof addresses>()
  for (const address of addresses) {
    const existing = addressesByParty.get(address.party_id) ?? []
    existing.push(address)
    addressesByParty.set(address.party_id, existing)
  }
  const rolesByActor = new Map<string, string[]>()
  for (const role of actorRoles) {
    const actorId = String(role.actor_id ?? '')
    if (!actorId) continue
    const existing = rolesByActor.get(actorId) ?? []
    existing.push(String(role.actor_role ?? 'other'))
    rolesByActor.set(actorId, existing)
  }
  const routesByActor = new Map<string, typeof actorRoutes>()
  for (const route of actorRoutes) {
    const actorId = String(route.actor_id ?? '')
    if (!actorId) continue
    const existing = routesByActor.get(actorId) ?? []
    existing.push(route)
    routesByActor.set(actorId, existing)
  }

  const filteredMarketActors = marketActors.filter((actor) => {
    const roles = rolesByActor.get(actor.id) ?? []
    const routeCount = routesByActor.get(actor.id)?.length ?? 0
    const matchesRole = actorMatchesRoleFilter(roles, roleFilter)
    const matchesStatus = statusFilter === 'all' || String(actor.status ?? '').toLowerCase() === statusFilter
    const matchesQuery = !queryFilter || [actor.name, actor.org_number, actor.source, String(routeCount)]
      .filter(Boolean)
      .some((item) => String(item).toLowerCase().includes(queryFilter))
    return matchesRole && matchesStatus && matchesQuery
  })

  const verifiedGridOwners = parties.filter((party) => Array.isArray(party.roles) && party.roles.includes('grid_owner') && party.status === 'verified').length
  const verifiedSuppliers = parties.filter((party) => Array.isArray(party.roles) && (party.roles.includes('electricity_supplier') || party.roles.includes('supplier')) && party.status === 'verified').length
  const missingCertificates = addresses.filter((address) => String(address.message_family ?? '').toUpperCase() === 'PRODAT' && !address.receiver_certificate_id).length
  const hiddenOrTestParties = parties.filter((party) => !party.visible_to_customer_flow || (Array.isArray(party.roles) && (party.roles.includes('ediel_portal') || party.roles.includes('test_counterparty')))).length
  const registryGridOwners = new Set(actorRoles.filter((role) => ['netowner', 'grid_owner', 'network_owner'].includes(String(role.actor_role ?? '').toLowerCase())).map((role) => role.actor_id)).size
  const registrySuppliers = new Set(actorRoles.filter((role) => ['powersupplier', 'electricity_supplier', 'supplier'].includes(String(role.actor_role ?? '').toLowerCase())).map((role) => role.actor_id)).size
  const verifiedRegistryRoutes = actorRoutes.filter((route) => route.is_verified || route.status === 'verified' || route.status === 'active').length
  const openImportIssues = importIssues.filter((issue) => issue.status !== 'resolved').length

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Ediel-aktörsregister" subtitle="Superadmin-register för nätägare, elleverantörer, Ediel-ID, subadresser, SMTP och transportskydd." userEmail={context.email} workspaceName="Plattform" workspaceMode="platform" />
      <main className="space-y-8 p-8">

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Verifierade nätägare</p>
            <div className="mt-2 text-3xl font-black text-emerald-950">{verifiedGridOwners}</div>
            <p className="mt-2 text-xs leading-5 text-emerald-900">Globala nätägare som kan visas i kund-/anläggningsflöden.</p>
          </div>
          <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Verifierade elleverantörer</p>
            <div className="mt-2 text-3xl font-black text-blue-950">{verifiedSuppliers}</div>
            <p className="mt-2 text-xs leading-5 text-blue-900">Globala motparter och leverantörer som kan användas i marknadsflöden.</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Saknar mottagarcertifikat</p>
            <div className="mt-2 text-3xl font-black text-amber-950">{missingCertificates}</div>
            <p className="mt-2 text-xs leading-5 text-amber-900">PRODAT-adresser utan kopplat mottagarcertifikat ska inte markeras som sändningsklara.</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">Dolda portalparter</p>
            <div className="mt-2 text-3xl font-black text-slate-950">{hiddenOrTestParties}</div>
            <p className="mt-2 text-xs leading-5 text-slate-700">Edielportalen och kontrollmotparter ska inte visas i normala kundflöden.</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Companies.xml och marknadsregister</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Aktörsregister, routes och meddelanderegler</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                Denna vy visar det globala registret som används av adressmatchning, route-resolver och kundintaget. Bolagsadmin ska bara kunna välja verifierade aktörer. Superadmin importerar och godkänner Ediel-ID, subadresser, PRODAT-/UTILTS-routes och osäkra matchningar.
              </p>
            </div>
            <form action={importPlatformActorsAction} encType="multipart/form-data" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-700">
              <div className="font-black text-slate-950">Importera aktörsdata</div>
              <p className="mt-1">Ladda upp companies.xml eller kompletterande CSV. Importen lägger nya och ändrade aktörer i granskning. Automatisk sändning är alltid av tills superadmin verifierar aktör och route.</p>
              <div className="mt-3 grid gap-2">
                <input type="file" name="actorImportFile" accept=".xml,.csv,text/xml,text/csv" required className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs" />
                <select name="format" defaultValue="auto" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                  <option value="auto">Auto</option>
                  <option value="xml">companies.xml</option>
                  <option value="csv">CSV</option>
                </select>
                <input type="hidden" name="source" value="actor_registry_ui" />
                <button name="importMode" value="preview" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50">Förhandsgranska diff</button>
                <input name="confirmApply" placeholder="Skriv IMPORTERA för att godkänna" className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs" />
                <button name="importMode" value="apply" className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">Godkänn och importera</button>
              </div>
              <p className="mt-2 text-[11px] text-slate-600">Förhandsgranskning uppdaterar inte masterdata. Godkänd import uppdaterar bara säkra fält; verifieringsstatus, auto-sändning och certifikat skyddas och kräver separat verifiering.</p>
            </form>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-600">Aktörer</p><div className="mt-2 text-2xl font-black text-slate-950">{filteredMarketActors.length}</div><p className="mt-1 text-[11px] text-slate-500">av {marketActors.length} totalt</p></div>
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Nätägare</p><div className="mt-2 text-2xl font-black text-emerald-950">{registryGridOwners}</div></div>
            <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Elleverantörer</p><div className="mt-2 text-2xl font-black text-blue-950">{registrySuppliers}</div></div>
            <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Verifierade routes</p><div className="mt-2 text-2xl font-black text-sky-950">{verifiedRegistryRoutes}</div></div>
            <div className="rounded-3xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Regler</p><div className="mt-2 text-2xl font-black text-violet-950">{messageRegler.length}</div></div>
            <div className="rounded-3xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">Granskningspunkter</p><div className="mt-2 text-2xl font-black text-red-950">{openImportIssues}</div></div>
          </div>
          {importRuns.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <p className="font-black text-sky-950">Senaste importkörningar och förhandsgranskningar</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {importRuns.map((run) => (
                  <div key={run.id} className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs text-sky-950">
                    <div className="font-black">{importModeLabel(run.metadata, run.status)}</div>
                    <div className="mt-1 font-mono text-sky-700">{run.source} · {run.import_type}</div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                      <span>Rader: {run.records_seen}</span>
                      <span>Uppdaterade: {run.records_upserted}</span>
                      <span>Nya: {previewValue(run.metadata, 'newActors')}</span>
                      <span>Konflikter: {previewValue(run.metadata, 'conflicts')}</span>
                      <span>Nätägare: {previewValue(run.metadata, 'gridOwners')}</span>
                      <span>Routes: {previewValue(run.metadata, 'routesSeen')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {importIssues.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-black text-amber-950">Senaste granskningspunkter från import</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {importIssues.slice(0, 6).map((issue) => (
                  <div key={issue.id} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-amber-950">
                    <div className="font-black">{issue.issue_type} · {issue.actor_id ?? 'okänd aktör'}</div>
                    <div>{issue.message}</div>
                    <form action={resolvePlatformActorImportIssueAction} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="issueId" value={issue.id} />
                      <button name="status" value="acknowledged" className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 font-semibold text-amber-900">Markera granskad</button>
                      <button name="status" value="resolved" className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 font-semibold text-emerald-900">Lös</button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">Importdiff och verifiering</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Godkänn aktörer innan de syns i kundintag</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">Nätägare och elleverantörer från import blir inte automatiskt valbara i kundintaget. Superadmin måste verifiera aktören. Routes kan verifieras, men automatisk sändning förblir av tills separat route-readiness är grön.</p>
            </div>
          </div>
          <form className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-4" action="/admin/ediel/actors">
            <label className="text-xs font-bold text-slate-700">Roll
              <select name="role" defaultValue={roleFilter} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                <option value="all">Alla roller</option>
                <option value="grid_owner">Nätägare</option>
                <option value="electricity_supplier">Elleverantörer</option>
                <option value="energy_service_company">Energitjänsteföretag</option>
                <option value="balance_responsible_party">Balansansvariga</option>
                <option value="system_supplier">Systemleverantörer</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-700">Status
              <select name="status" defaultValue={statusFilter} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs">
                <option value="all">Alla statusar</option>
                <option value="active">Aktiv</option>
                <option value="needs_review">Kräver granskning</option>
                <option value="blocked">Blockerad</option>
                <option value="inactive">Inaktiv</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-700 md:col-span-1">Sök
              <input name="q" defaultValue={params.q ?? ''} placeholder="Namn, org.nr, källa..." className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs" />
            </label>
            <div className="flex items-end gap-2">
              <button className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">Filtrera</button>
              <a href="/admin/ediel/actors" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">Rensa</a>
            </div>
            <div className="md:col-span-4 text-xs text-slate-600">Visar {filteredMarketActors.length} aktörer · filter: {roleFilterLabel(roleFilter)}</div>
          </form>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredMarketActors.slice(0, 48).map((actor) => {
              const roles = rolesByActor.get(actor.id) ?? []
              const routes = routesByActor.get(actor.id) ?? []
              const canBeCustomerActor = roles.some((role) => ['grid_owner', 'electricity_supplier'].includes(role))
              return (
                <div key={actor.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">{actor.name}</div>
                      <div className="mt-1 text-xs text-slate-600">{actor.org_number ?? 'org.nr saknas'} · {actor.source ?? 'källa saknas'}</div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-black ${actor.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{actorStatusLabel(actor.status)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1 text-xs">
                    {roles.length ? roles.map((role) => <span key={role} className="rounded-full bg-white px-2 py-1 font-semibold text-slate-700">{actorRoleLabel(role)}</span>) : <span className="text-slate-500">Roll saknas</span>}
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-700">
                    {routes.slice(0, 3).map((route) => (
                      <div key={route.id} className="rounded-xl border border-slate-200 bg-white px-2 py-1">
                        {route.message_family} · {route.environment} · {route.subaddress ?? 'ingen subadress'} · {routeStatusLabel(route.status, route.is_verified)}
                      </div>
                    ))}
                    {routes.length === 0 ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">Route saknas</div> : null}
                  </div>
                  <form action={verifyPlatformActorForCustomerFlowAction} className="mt-4">
                    <input type="hidden" name="actorId" value={actor.id} />
                    <button disabled={!canBeCustomerActor} className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                      Verifiera för kundflöde
                    </button>
                  </form>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Produktionsflöde</p>
              <h1 className="mt-2 text-2xl font-black text-slate-950">Registrera nätägare och elleverantörer</h1>
              <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
                Superadmin registrerar marknadsparter globalt. Plattformen söker publika mottagarcertifikat i Expisoft via SMTP-adressen och sparar certifikatet globalt så alla bolag kan återanvända samma verifierade part. Vanliga bolagsadmin ska bara välja verifierade aktörer, inte skapa egna Ediel-routes eller certifikat.
              </p>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-900">
              <div className="font-black text-blue-950">Certifikatprincip</div>
              <div>Expisoft = publika mottagarcertifikat för outbound PRODAT.</div>
              <div>Privat PFX = bolagets inkommande dekryptering.</div>
              <div>Mailboxen avgör aldrig bolag; CMS + UNB + Ediel-ID gör det.</div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <form action={saveEdielPartyRegistryEntryAction} className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <input type="hidden" name="partyType" value="grid_owner" />
              <input type="hidden" name="roles" value="grid_owner" />
              <input type="hidden" name="status" value="verified" />
              <input type="hidden" name="source" value="manual_verified" />
              <input type="hidden" name="messageFamily" value="PRODAT" />
              <input type="hidden" name="environment" value="production" />
              <input type="hidden" name="transportSecurityMode" value="required_encrypted" />
              <input type="hidden" name="certificateRequired" value="true" />
              <input type="hidden" name="lookupCertificateOnSave" value="true" />
              <input type="hidden" name="visibleToCustomerFlow" value="true" />
              <input type="hidden" name="requiresSubaddress" value="true" />
              <div className="text-sm font-black text-emerald-950">Lägg till nätägare</div>
              <p className="mt-2 text-xs leading-5 text-emerald-900">För riktiga nätägare: fyll Ediel-ID, PRODAT-subadress och SMTP. Vid sparning hämtas Expisoft-certifikat automatiskt om inget certifikat redan är valt.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input name="name" placeholder="Namn, t.ex. TVLAB" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" required />
                <input name="organizationNumber" placeholder="Org.nr, valfritt" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" />
                <input name="edielId" placeholder="Ediel ID, t.ex. 11900" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" required />
                <input name="qualifier" defaultValue="ZZ" placeholder="Kvalificerare" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" />
                <input name="subaddress" placeholder="PRODAT-subadress, t.ex. PRODAT-SE" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" required />
                <input name="smtpAddress" placeholder="SMTP, t.ex. 11900@tvlab.se" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm" required />
                <textarea name="notes" rows={3} placeholder="Verifieringskälla, kontaktperson eller Ediel-registeranteckning" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm md:col-span-2" />
              </div>
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-white p-3 text-xs leading-5 text-emerald-900">
                Efter sparning: status verified, synlig i kundflöde, PRODAT kräver kryptering och Expisoft-certifikatet kopplas globalt om lookup lyckas.
              </div>
              <button className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Spara nätägare och sök certifikat</button>
            </form>

            <form action={saveEdielPartyRegistryEntryAction} className="rounded-3xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
              <input type="hidden" name="partyType" value="electricity_supplier" />
              <input type="hidden" name="roles" value="electricity_supplier" />
              <input type="hidden" name="roles" value="supplier" />
              <input type="hidden" name="status" value="verified" />
              <input type="hidden" name="source" value="manual_verified" />
              <input type="hidden" name="messageFamily" value="PRODAT" />
              <input type="hidden" name="environment" value="production" />
              <input type="hidden" name="transportSecurityMode" value="required_encrypted" />
              <input type="hidden" name="certificateRequired" value="true" />
              <input type="hidden" name="lookupCertificateOnSave" value="true" />
              <input type="hidden" name="visibleToCustomerFlow" value="true" />
              <input type="hidden" name="requiresSubaddress" value="true" />
              <div className="text-sm font-black text-blue-950">Lägg till elleverantör</div>
              <p className="mt-2 text-xs leading-5 text-blue-900">För externa elleverantörer eller marknadsmotparter. Elhandelsbolag ska dessutom ha eget bolagskort med Ediel-ID, route-profiler och privat PFX för inkommande krypterad trafik.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input name="name" placeholder="Namn" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" required />
                <input name="organizationNumber" placeholder="Org.nr, valfritt" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" />
                <input name="edielId" placeholder="Ediel ID" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" required />
                <input name="qualifier" defaultValue="ZZ" placeholder="Kvalificerare" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" />
                <input name="subaddress" placeholder="PRODAT-subadress" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" required />
                <input name="smtpAddress" placeholder="SMTP-adress" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm" required />
                <textarea name="notes" rows={3} placeholder="Roll: extern leverantör, tidigare leverantör, ny leverantör, testpart etc." className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm md:col-span-2" />
              </div>
              <div className="mt-4 rounded-2xl border border-blue-200 bg-white p-3 text-xs leading-5 text-blue-900">
                Sparas som global motpart. Publikt certifikat återanvänds av alla bolag, men varje bolag skickar fortsatt med sin egen Ediel-identitet.
              </div>
              <button className="mt-4 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white">Spara elleverantör och sök certifikat</button>
            </form>
          </div>
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-black text-slate-950">Skapa eller uppdatera Ediel-aktör</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            Riktiga nätägare kan markeras synliga i kundflödet. Edielportalen och kontrollmotparter ska inte vara synliga vid normal kundskapning. PRODAT-rader med tom affärskod gäller hela familjen och kan ersättas av en exakt Z13-/Z14-rad.
          </p>
          <form action={saveEdielPartyRegistryEntryAction} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input name="name" placeholder="Namn" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="organizationNumber" placeholder="Org.nr (valfritt)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="edielId" placeholder="Ediel ID, t.ex. 11900" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="status" defaultValue="needs_verification" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="verified">Verifierad</option>
              <option value="needs_verification">Kräver verifiering</option>
              <option value="draft">Utkast</option>
              <option value="inactive">Inaktiv</option>
              <option value="blocked">Blockerad</option>
            </select>
            <select name="source" defaultValue="grid_owner_confirmation" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="grid_owner_confirmation">Nätägare bekräftad</option>
              <option value="manual_verified">Manuellt verifierad</option>
              <option value="ediel_registry">Ediel-registret</option>
              <option value="ediel_catalog">Ediel-katalog</option>
              <option value="manual">Manuell</option>
              <option value="import">Import</option>
            </select>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input type="checkbox" name="visibleToCustomerFlow" value="true" />
              Synlig som nätägare i kundflöde
            </label>
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 p-3 text-xs">
              {['grid_owner', 'electricity_supplier', 'energy_service_company', 'brp', 'ediel_portal', 'test_counterparty', 'grid_owner_in_agt_context', 'system_supplier', 'other'].map((role) => (
                <label key={role} className="inline-flex items-center gap-1">
                  <input type="checkbox" name="roles" value={role} />
                  {actorRoleLabel(role)}
                </label>
              ))}
            </div>
            <input name="messageFamily" defaultValue="PRODAT" placeholder="Meddelandefamilj" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="businessCode" placeholder="Affärskod, tomt/* = familjeroute" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="environment" defaultValue="test" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="test">test</option>
              <option value="production">production</option>
              <option value="agt">agt</option>
            </select>
            <input name="qualifier" defaultValue="ZZ" placeholder="Kvalificerare" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="subaddress" placeholder="PRODAT subadress, t.ex. PRODAT-SE" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <input name="smtpAddress" placeholder="SMTP, t.ex. 11900@tvlab.se" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="transportSecurityMode" defaultValue="required_encrypted" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="required_encrypted">Kryptering krävs</option>
              <option value="encrypted">Krypterad</option>
              <option value="unencrypted">Okrypterad</option>
              <option value="needs_verification">Kräver verifiering</option>
            </select>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input type="checkbox" name="requiresSubaddress" value="true" />
              Subadress krävs
            </label>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <input type="checkbox" name="certificateRequired" value="true" defaultChecked />
              Mottagarcertifikat krävs
            </label>
            <input name="receiverCertificateId" placeholder="Mottagarcertifikatets ID" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <select name="addressStatus" defaultValue="needs_verification" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="active">Aktiv</option>
              <option value="needs_verification">Kräver verifiering</option>
              <option value="inactive">Inaktiv</option>
              <option value="expired">Utgången</option>
            </select>
            <input name="lastVerifiedAt" type="datetime-local" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <textarea name="notes" rows={3} placeholder="Anteckningar / verifieringskälla" className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2 xl:col-span-4" />
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Spara Ediel-part</button>
          </form>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {parties.map((party) => (
          <section key={party.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">{actorStatusLabel(party.status)}</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">{party.name}</h2>
            <div className="mt-1 font-mono text-sm text-slate-700">{party.ediel_id}</div>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="font-bold text-slate-500">Roller</dt><dd>{Array.isArray(party.roles) ? party.roles.map((role) => actorRoleLabel(String(role))).join(', ') || '—' : actorRoleLabel(String(party.roles ?? ''))}</dd></div>
              <div><dt className="font-bold text-slate-500">Kundflöde</dt><dd>{party.visible_to_customer_flow ? 'synlig' : 'dold'}</dd></div>
              <div><dt className="font-bold text-slate-500">Källa</dt><dd>{party.source === 'manual_verified' ? 'Manuellt verifierad' : party.source ?? '—'}</dd></div>
            </dl>
            <div className="mt-4 space-y-2">
              {(addressesByParty.get(party.id) ?? []).map((address) => (
                <div key={address.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="font-mono font-bold text-slate-950">
                    {address.ediel_id}:{address.qualifier}{address.subaddress ? `:${address.subaddress}` : ''}
                  </div>
                  <div className="mt-1 text-slate-700">{address.environment} · {address.message_family} {address.business_code ?? '*'} · {address.smtp_address}</div>
                  <div className="mt-1 font-semibold text-slate-800">{routeStatusLabel(address.transport_security_mode)} · certifikat {address.receiver_certificate_id ?? 'saknas'}</div>
                  <form action={refreshExpisoftReceiverCertificateAction} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="partyId" value={party.id} />
                    <input type="hidden" name="edielId" value={address.ediel_id} />
                    <input type="hidden" name="subaddress" value={address.subaddress ?? ''} />
                    <input type="hidden" name="smtpEmail" value={address.smtp_address} />
                    <input type="hidden" name="forceRefresh" value="true" />
                    <button className="rounded-lg border border-emerald-300 bg-white px-3 py-1 font-semibold text-emerald-800">
                      Hämta mottagarcertifikat från Expisoft
                    </button>
                    <span className="font-mono text-slate-600">mail={address.smtp_address}</span>
                  </form>
                  <div className="mt-2 break-all text-slate-600">
                    ldap://sodir01.expisoft.se:389/c=se?userCertificate?sub?mail={address.smtp_address}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {actors.map((row) => (
          <section key={row.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">{row.environment ?? 'miljö saknas'}</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">{row.ediel_id ?? row.actor_ediel_id ?? 'Ediel-id saknas'}</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div><dt className="font-bold text-slate-500">Bolag</dt><dd>{row.company_id ?? 'Plattform'}</dd></div>
              <div><dt className="font-bold text-slate-500">Roll</dt><dd>{actorRoleLabel(row.actor_role ?? row.role)} / {actorRoleLabel(row.sub_role)}</dd></div>
              <div><dt className="font-bold text-slate-500">Status</dt><dd>{actorStatusLabel(row.status ?? (row.is_active ? 'active' : 'inactive'))}</dd></div>
            </dl>
          </section>
        ))}
        </section>
      </main>
    </div>
  )
}
