import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isPlatformAdminContext, requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import {
 explainEdielRouteRuntime,
 getEdielRouteRuntimeByCommunicationRouteId,
 type EdielRouteRuntimeExplanation,
 type EdielRouteRuntimeRow,
} from '@/lib/ediel/config'
import { resolveCanonicalActorContext } from '@/lib/ediel/core/actorRegistry'
import EdielReceiverPresetPicker, {
 type EdielReceiverPreset,
} from '@/components/admin/ediel/EdielReceiverPresetPicker'
import {
 createEdielBootstrapRouteAction,
 quickFixEdielProfileBasicsAction,
 quickFixEdielRouteActivationAction,
 quickFixEdielTargetEmailAction,
 quickFixGridOwnerEdielIdAction,
 saveEdielCommunicationRouteAction,
 saveEdielRouteProfileAction,
} from '@/app/admin/ediel/routes/actions'

export const dynamic = 'force-dynamic'

type CommunicationRouteRow = {
 id: string
 company_id?: string | null
 route_name: string
 is_active: boolean
 route_scope: string
 route_type: string
 grid_owner_id: string | null
 target_system: string
 endpoint: string | null
 target_email: string | null
 supported_payload_version: string | null
 notes: string | null
 updated_at: string
}

type GridOwnerRow = {
 id: string
 name: string
 ediel_id: string | null
 owner_code: string | null
}

type RouteRuntimeViewRow = {
 route: CommunicationRouteRow
 gridOwner: GridOwnerRow | null
 runtime: EdielRouteRuntimeRow | null
 explanation: EdielRouteRuntimeExplanation | null
 ready: boolean
 issueCount: number
 errorCount: number
}

function isEdielCandidateRoute(route: CommunicationRouteRow): boolean {
 if (route.route_type === 'ediel_partner') return true
 if (route.target_system?.toLowerCase().includes('ediel')) return true
 if (route.target_email?.toLowerCase().includes('ediel')) return true
 return false
}

function formatDate(value: string | null | undefined) {
 if (!value) return '—'
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return value
 return date.toLocaleString('sv-SE')
}

function Pill({
 text,
 tone,
}: {
 text: string
 tone: 'emerald' | 'amber' | 'red' | 'slate'
}) {
 const toneClass =
 tone === 'emerald'
 ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
 : tone === 'amber'
 ? 'border-amber-200 bg-amber-50 text-amber-700'
 : tone === 'red'
 ? 'border-red-200 bg-red-50 text-red-700'
 : 'border-slate-200 bg-slate-50 text-slate-700'

 return (
 <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
 {text}
 </span>
 )
}

function Field({
 label,
 value,
}: {
 label: string
 value: string | number | null | undefined
}) {
 const display =
 value === null || value === undefined || String(value).trim().length === 0
 ? '—'
 : String(value)

 return (
 <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
 <div className="text-xs font-medium uppercase tracking-wide text-slate-700">
 {label}
 </div>
 <div className="mt-1 break-all text-sm text-slate-900">{display}</div>
 </div>
 )
}

function textInputClassName() {
 return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500'
}

function selectClassName() {
 return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900'
}

function boolTone(value: boolean): 'emerald' | 'red' {
 return value ? 'emerald' : 'red'
}

function issueTone(value: 'error' | 'warning'): 'red' | 'amber' {
 return value === 'error' ? 'red' : 'amber'
}

function sortRoutesForOps(rows: RouteRuntimeViewRow[]): RouteRuntimeViewRow[] {
 return [...rows].sort((a, b) => {
 if (a.ready !== b.ready) return a.ready ? 1 : -1
 if (a.errorCount !== b.errorCount) return b.errorCount - a.errorCount
 if (a.issueCount !== b.issueCount) return b.issueCount - a.issueCount
 return a.route.route_name.localeCompare(b.route.route_name, 'sv')
 })
}

function buildReceiverPresets(params: {
 routeRows: RouteRuntimeViewRow[]
 gridOwners: GridOwnerRow[]
}): EdielReceiverPreset[] {
 const byKey = new Map<string, EdielReceiverPreset>()
 const gridOwnerById = new Map(params.gridOwners.map((row) => [row.id, row]))

 for (const row of params.routeRows) {
 const receiverEdielId =
 row.runtime?.receiver_ediel_id ?? row.gridOwner?.ediel_id ?? null
 const receiverName =
 row.runtime?.receiver_name ?? row.gridOwner?.name ?? null
 const receiverSubAddress = row.runtime?.receiver_sub_address ?? null
 const targetEmail = row.route.target_email ?? null
 const gridOwnerId = row.route.grid_owner_id ?? null

 const key = [
 receiverEdielId ?? '',
 receiverName ?? '',
 receiverSubAddress ?? '',
 targetEmail ?? '',
 gridOwnerId ?? '',
 ].join('|')

 if (!receiverEdielId && !targetEmail && !gridOwnerId) continue
 if (byKey.has(key)) continue

 const gridOwner = gridOwnerId ? gridOwnerById.get(gridOwnerId) ?? null : null
 const labelParts = [
 receiverName ?? gridOwner?.name ?? 'Okänd mottagare',
 receiverEdielId ? `Ediel ${receiverEdielId}` : null,
 targetEmail ?? null,
 ].filter(Boolean)

 byKey.set(key, {
 key,
 label: labelParts.join(' · '),
 receiverEdielId,
 receiverName,
 receiverSubAddress,
 targetEmail,
 gridOwnerId,
 })
 }

 for (const row of params.gridOwners) {
 if (!row.ediel_id) continue

 const key = [`gridowner:${row.id}`]
 if (byKey.has(key.join('|'))) continue

 byKey.set(key.join('|'), {
 key: key.join('|'),
 label: `${row.name} · Ediel ${row.ediel_id}`,
 receiverEdielId: row.ediel_id,
 receiverName: row.name,
 receiverSubAddress: null,
 targetEmail: null,
 gridOwnerId: row.id,
 })
 }

 return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, 'sv'))
}

export default async function AdminEdielRoutesPage() {
 const context = await requirePlatformAdminAccess()
 const isPlatformAdmin = isPlatformAdminContext(context)
 const companyScope = await getOperationalCompanyScope(context.userId)

 const supabase = await createSupabaseServerClient()

 let routesQuery = supabase
 .from('communication_routes')
 .select(
 'id,company_id,route_name,is_active,route_scope,route_type,grid_owner_id,target_system,endpoint,target_email,supported_payload_version,notes,updated_at'
 )

 if (!isPlatformAdmin) {
 if (companyScope.companyId) {
 routesQuery = routesQuery.eq('company_id', companyScope.companyId)
 } else {
 routesQuery = routesQuery.eq('company_id', '00000000-0000-0000-0000-000000000000')
 }
 }

 const [routesResult, gridOwnersResult, testActor, prodActor] = await Promise.all([
 routesQuery
 .order('updated_at', { ascending: false }),
 supabase.from('grid_owners').select('id,name,ediel_id,owner_code').order('name'),
 resolveCanonicalActorContext('test', isPlatformAdmin ? null : companyScope.companyId).catch(() => null),
 resolveCanonicalActorContext('production', isPlatformAdmin ? null : companyScope.companyId).catch(() => null),
 ])

 if (routesResult.error) throw routesResult.error
 if (gridOwnersResult.error) throw gridOwnersResult.error

 const allRoutes = (routesResult.data ?? []) as CommunicationRouteRow[]
 const gridOwners = (gridOwnersResult.data ?? []) as GridOwnerRow[]
 const edielRoutes = allRoutes.filter(isEdielCandidateRoute)
 const gridOwnerById = new Map(gridOwners.map((row) => [row.id, row]))

 const runtimeRows: RouteRuntimeViewRow[] = await Promise.all(
 edielRoutes.map(async (route) => {
 const runtime = await getEdielRouteRuntimeByCommunicationRouteId(route.id)
 const gridOwner = route.grid_owner_id
 ? gridOwnerById.get(route.grid_owner_id) ?? null
 : null

 const explanation = runtime
 ? explainEdielRouteRuntime({
 runtime,
 gridOwnerEdielId: gridOwner?.ediel_id ?? null,
 })
 : null

 return {
 route,
 gridOwner,
 runtime,
 explanation,
 ready: explanation?.isReadyForOutbound ?? false,
 issueCount: explanation?.issues.length ?? 1,
 errorCount:
 explanation?.issues.filter((issue) => issue.severity === 'error').length ?? 1,
 }
 })
 )

 const sortedRoutes = sortRoutesForOps(runtimeRows)
 const receiverPresets = buildReceiverPresets({
 routeRows: sortedRoutes,
 gridOwners,
 })

 const readyCount = sortedRoutes.filter((row) => row.ready).length
 const blockedCount = sortedRoutes.length - readyCount
 const missingRuntimeCount = sortedRoutes.filter((row) => !row.runtime).length
 const missingReceiverCount = sortedRoutes.filter((row) => {
 const effectiveReceiver =
 row.explanation?.effectiveReceiverEdielId ??
 row.runtime?.receiver_ediel_id ??
 row.gridOwner?.ediel_id ??
 null
 return !effectiveReceiver?.trim()
 }).length
 const missingMailboxCount = sortedRoutes.filter(
 (row) => !row.runtime?.mailbox?.trim()
 ).length

 return (
 <div className="space-y-6">
 <AdminHeader
 title="Ediel-adressering & aktörsregister"
 subtitle={isPlatformAdmin ? 'Global route-governance och runtimekontroll för plattformen. Tenant-vyer visar bara bolagets egna routes.' : `Spara route-profiler för ${companyScope.companyName ?? 'ditt bolag'}: rätt Ediel-id, rätt motpart, rätt process och rätt kvittenspolicy.`}
 userEmail={context.email}
 workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
 workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
 />

 <section className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
 <div className="flex flex-wrap items-start justify-between gap-5">
 <div>
 <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Ediel Live setup</p>
 <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Aktör, motpart och route måste vara tydligt separerade</h2>
 <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
 Den här sidan ska användas för livekonfiguration: eget bolags Ediel-identitet, nätägares mottagning, leverantörers/BRP-uppgifter och route-profiler för PRODAT, UTILTS, APERAK och CONTRL. Godkännandemiljö får finnas för behöriga administratörer, men produktion får aldrig bygga på hårdkodade portalvärden.
 </p>
 </div>
 <div className="flex flex-wrap gap-2">
 <Pill text="PRODAT" tone="emerald" />
 <Pill text="UTILTS" tone="emerald" />
 <Pill text="APERAK / CONTRL" tone="emerald" />
 </div>
 </div>

 <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
 <div className="text-sm font-semibold text-slate-950">Eget bolag / tenant</div>
 <p className="mt-2 text-sm leading-6 text-slate-700">Bolagsnamn, organisationsnummer, Ediel-id, miljö, mailbox, Application Reference och roll ska komma från tenant-konfiguration.</p>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
<div className="text-sm font-semibold text-slate-950">Nätägare</div>
<p className="mt-2 text-sm leading-6 text-slate-700">Spara Ediel-id, nätområde, optional subaddress, processer och teknisk mottagning så Z03/Z09/UTILTS-flöden hamnar rätt.</p>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-sm font-semibold text-slate-950">Leverantörer och BRP</div>
 <p className="mt-2 text-sm leading-6 text-slate-700">Motparter och balansansvarig ska vara masterdata, inte fria textfält i generatorer.</p>
 </div>
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
 <div className="text-sm font-semibold text-amber-950">Preflight före aktivering</div>
<p className="mt-2 text-sm leading-6 text-amber-800">Route får inte vara aktiv om Ediel-id, mottagare, version, transport, ack-policy eller company/tenant-koppling saknas. Subadress krävs bara när routeprofilen uttryckligen säger det.</p>
 </div>
 </div>
 </section>

 <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
 <h2 className="text-lg font-semibold text-slate-950">Produktionsmodell i runtime</h2>
 <p className="mt-1 text-sm text-slate-700">
 Route profile styr transport, mottagare, version och kvittenspolicy. Aktörskortet styr bolagets Ediel-identitet per miljö. Lämna sender/application reference/mailbox tomt bara när aktiv aktörsprofil uttryckligen ska vara default.
 </p>
 <div className="mt-3 grid gap-3 md:grid-cols-3">
 <div className="rounded-xl border border-white/70 bg-white p-4">
 <div className="text-sm font-semibold text-slate-900">Aktiv test-identitet</div>
 <div className="mt-2 text-sm text-slate-700">
 {testActor
 ? `${testActor.senderEdielId} · ${testActor.senderName ?? 'utan namn'}`
 : 'Ingen aktiv test-identitet ännu'}
 </div>
 </div>
 <div className="rounded-xl border border-white/70 bg-white p-4">
 <div className="text-sm font-semibold text-slate-900">Aktiv produktionsidentitet</div>
 <div className="mt-2 text-sm text-slate-700">
 {prodActor
 ? `${prodActor.senderEdielId} · ${prodActor.senderName ?? 'utan namn'}`
 : 'Ingen aktiv produktionsidentitet ännu'}
 </div>
 </div>
 <div className="rounded-xl border border-white/70 bg-white p-4">
 <div className="text-sm font-semibold text-slate-900">Kända motparter</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{receiverPresets.length}</div>
 <div className="mt-1 text-xs text-slate-700">Byggs från routes, profiler och nätägare.</div>
 </div>
 </div>
 </section>

 <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-sm text-slate-700">Routes</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{sortedRoutes.length}</div>
 </div>
 <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
 <div className="text-sm text-emerald-700">Redo för live</div>
 <div className="mt-2 text-3xl font-semibold text-emerald-900">{readyCount}</div>
 </div>
 <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
 <div className="text-sm text-red-700">Blockerade</div>
 <div className="mt-2 text-3xl font-semibold text-red-900">{blockedCount}</div>
 </div>
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
 <div className="text-sm text-amber-700">Saknar profil</div>
 <div className="mt-2 text-3xl font-semibold text-amber-900">{missingRuntimeCount}</div>
 </div>
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
 <div className="text-sm text-amber-700">Saknar mottagare</div>
 <div className="mt-2 text-3xl font-semibold text-amber-900">{missingReceiverCount}</div>
 </div>
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
 <div className="text-sm text-amber-700">Saknar mailbox</div>
 <div className="mt-2 text-3xl font-semibold text-amber-900">{missingMailboxCount}</div>
 </div>
 </section>

 {sortedRoutes.length === 0 ? (
 <section data-receiver-scope className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
 <h2 className="text-lg font-semibold text-slate-950">Första Ediel-route saknas</h2>
 <p className="mt-1 text-sm text-slate-700">
 Skapa första live-routen här. Välj process, motpart och miljö. Systemet ska kunna härleda rätt avsändare, mottagare, mailbox, Application Reference, version och ack-policy innan route aktiveras.
 </p>

 <div className="mt-4">
 <EdielReceiverPresetPicker presets={receiverPresets} />
 </div>

 <form action={createEdielBootstrapRouteAction} className="mt-4 grid gap-4 lg:grid-cols-2">
 <div className="rounded-2xl border border-white/70 bg-white p-4">
 <div className="mb-3 text-sm font-semibold text-slate-900">Kommunikationsroute</div>
 <div className="grid gap-3 md:grid-cols-2">
 <input
 name="route_name"
 defaultValue="EDIEL mätvärden"
 className={textInputClassName()}
 placeholder="Route name"
 />
 <select
 name="route_scope"
 defaultValue="meter_values"
 className={selectClassName()}
 >
 <option value="meter_values">Mätvärden</option>
 <option value="customer_masterdata">Kund- och anläggningskontroll</option>
 <option value="supplier_switch">Leverantörsbyte</option>
 <option value="billing_underlay">Faktureringsunderlag</option>
 </select>
 <select
 name="environment"
 defaultValue="test"
 className={selectClassName()}
 >
 <option value="test">test</option>
 <option value="production">production</option>
 </select>
 <input
 name="target_system"
 defaultValue="ediel"
 className={textInputClassName()}
 placeholder="Mottagande system"
 />
 <input
 name="target_email"
 className={textInputClassName()}
 placeholder="Mottagande e-post"
 />
 <input
 name="endpoint"
 className={textInputClassName()}
 placeholder="Endpoint / URL"
 />
 <select
 name="grid_owner_id"
 defaultValue=""
 className={selectClassName()}
 >
 <option value="">Ingen specifik nätägare</option>
 {gridOwners.map((row) => (
 <option key={row.id} value={row.id}>
 {row.name}
 </option>
 ))}
 </select>
 <input
 name="supported_payload_version"
 className={textInputClassName()}
 placeholder="Stödd payload-version"
 />
 </div>
 </div>

 <div className="rounded-2xl border border-white/70 bg-white p-4">
 <div className="mb-3 text-sm font-semibold text-slate-900">Ediel route profile</div>
 <div className="grid gap-3 md:grid-cols-2">
 <input
 name="receiverEdielId"
 className={textInputClassName()}
 placeholder="Mottagare Ediel-id"
 />
 <input
 name="receiverName"
 className={textInputClassName()}
 placeholder="Mottagarens namn"
 />
 <input
 name="receiverSubAddress"
 className={textInputClassName()}
placeholder="Mottagarens subadress (optional)"
 />
<input
name="receiverMessageSubAddress"
className={textInputClassName()}
placeholder="Message-subadress, t.ex. PRODAT"
/>
 <input
 name="mailbox"
defaultValue="ediel@gridex.se"
 className={textInputClassName()}
 placeholder="Mailbox (tomt = aktörens standard)"
 />
 <input
 name="applicationReference"
 className={textInputClassName()}
 placeholder="Application Reference (tomt = aktörens standard)"
 />
 <input
 name="defaultMessageVersion"
 className={textInputClassName()}
 placeholder="Standardversion"
 />
 <select
 name="ackMode"
 defaultValue="default"
 className={selectClassName()}
 >
 <option value="default">default</option>
 <option value="none">none</option>
 <option value="contrl_only">contrl_only</option>
 <option value="contrl_and_aperak">contrl_and_aperak</option>
 </select>
 <select
 name="messageStandard"
 defaultValue="edifact"
 className={selectClassName()}
 >
 <option value="edifact">edifact</option>
 <option value="xml">xml</option>
 <option value="ai_list">ai_list</option>
 </select>
<label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
<input type="checkbox" name="subaddressRequired" value="true" className="h-4 w-4 rounded border-slate-300" />
Subadress krävs för denna route
</label>
 </div>

 <button className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
 Skapa första Ediel-route
 </button>
 </div>
 </form>
 </section>
 ) : null}

 <section className="space-y-5">
 {sortedRoutes.length === 0
 ? null
 : sortedRoutes.map(({ route, gridOwner, runtime, explanation }) => {
 const effectiveReceiver =
 explanation?.effectiveReceiverEdielId ??
 runtime?.receiver_ediel_id ??
 gridOwner?.ediel_id ??
 null

 return (
 <article
 key={route.id}
 data-receiver-scope
 className="rounded-2xl border border-slate-200 bg-white p-5"
 >
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">{route.route_name}</h2>
 <p className="mt-1 text-sm text-slate-700">
 {route.route_scope} · {route.route_type} · uppdaterad {formatDate(route.updated_at)}
 </p>
 </div>

 <div className="flex flex-wrap gap-2">
 <Pill text={route.is_active ? 'route aktiv' : 'route inaktiv'} tone={boolTone(route.is_active)} />
 <Pill
 text={runtime?.is_enabled ? 'profil aktiv' : 'profil saknas/av'}
 tone={runtime?.is_enabled ? 'emerald' : 'red'}
 />
 <Pill
 text={explanation?.isReadyForOutbound ? 'runtime redo' : 'runtime blockerad'}
 tone={explanation?.isReadyForOutbound ? 'emerald' : 'red'}
 />
 </div>
 </div>

 <div className="mt-4">
 <EdielReceiverPresetPicker
 presets={receiverPresets}
 title="Tidigare mottagare"
 description="Välj en tidigare sparad mottagare för att fylla i receiver-fälten för den här routen."
 />
 </div>

 <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-sm font-semibold text-slate-900">Route-preflight</div>
 <p className="mt-2 text-sm text-slate-700">
 {explanation?.summary ??
 'Ingen runtime-profil hittades för routen ännu. Det betyder att communication route finns, men Ediel-runtime kan inte förklara eller använda den fullt ut.'}
 </p>
 </div>

 <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
 <Field label="Nätägare" value={gridOwner?.name ?? null} />
 <Field label="Nätägarens Ediel-id" value={gridOwner?.ediel_id ?? null} />
 <Field label="Aktiv mottagare Ediel-id" value={effectiveReceiver} />
 <Field label="Mottagande e-post" value={route.target_email} />
 <Field label="Mailbox" value={runtime?.mailbox ?? null} />
 <Field label="Sender Ediel-id" value={runtime?.sender_ediel_id ?? null} />
 <Field label="Mottagare Ediel-id (profil)" value={runtime?.receiver_ediel_id ?? null} />
 <Field label="Application Reference" value={runtime?.application_reference ?? null} />
<Field label="Subadress krävs" value={runtime?.subaddress_required ? 'Ja' : 'Nej'} />
<Field label="Receiver subadress" value={runtime?.receiver_subaddress ?? runtime?.receiver_sub_address ?? null} />
<Field label="Receiver message-subadress" value={runtime?.receiver_message_subaddress ?? null} />
 <Field label="Ack-mode" value={runtime?.ack_mode ?? null} />
 <Field label="Meddelandestandard" value={runtime?.message_standard ?? null} />
 <Field label="Payload-format" value={runtime?.payload_format ?? null} />
 <Field label="Kryptering" value={runtime?.encryption_mode ?? null} />
<Field label="Signering" value={runtime?.signing_mode ?? null} />
<Field label="Certifikat" value={runtime?.certificate_id ?? null} />
 <Field label="Versionsstyrning" value={runtime?.default_message_version ?? null} />
 <Field label="Mottagande system" value={route.target_system} />
 <Field label="Endpoint" value={route.endpoint} />
 <Field label="Stödd payload-version" value={route.supported_payload_version} />
 </div>

 <div className="mt-4">
 <div className="mb-2 text-sm font-semibold text-slate-900">Preflight-problem</div>
 {explanation?.issues.length ? (
 <div className="space-y-2">
 {explanation.issues.map((issue) => (
 <div
 key={issue.key}
 className={`rounded-xl border px-3 py-3 ${
 issue.severity === 'error'
 ? 'border-red-200 bg-red-50'
 : 'border-amber-200 bg-amber-50'
 }`}
 >
 <div className="flex flex-wrap items-center gap-2">
 <Pill text={issue.severity} tone={issueTone(issue.severity)} />
 <div className="text-sm font-medium text-slate-900">{issue.label}</div>
 </div>
 <div className="mt-1 text-sm text-slate-700">{issue.resolution}</div>
 </div>
 ))}
 </div>
 ) : (
 <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
 Inga blockerande eller varnande preflight-problem just nu.
 </div>
 )}
 </div>

 <div className="mt-5 grid gap-5 xl:grid-cols-2">
 <form
 action={saveEdielCommunicationRouteAction}
 className="rounded-2xl border border-slate-200 p-4"
 >
 <input type="hidden" name="id" value={route.id} />
 <div className="mb-3 text-sm font-semibold text-slate-900">
 Kommunikationsroute
 </div>

 <div className="grid gap-3 md:grid-cols-2">
 <input name="route_name" defaultValue={route.route_name} className={textInputClassName()} />
 <select name="route_scope" defaultValue={route.route_scope} className={selectClassName()}>
 <option value="supplier_switch">Leverantörsbyte</option>
 <option value="customer_masterdata">Kund- och anläggningskontroll</option>
 <option value="meter_values">Mätvärden</option>
 <option value="billing_underlay">Faktureringsunderlag</option>
 </select>
 <select name="route_type" defaultValue={route.route_type} className={selectClassName()}>
 <option value="ediel_partner">ediel_partner</option>
 <option value="partner_api">partner_api</option>
 <option value="file_export">file_export</option>
 <option value="email_manual">email_manual</option>
 </select>
 <select name="grid_owner_id" defaultValue={route.grid_owner_id ?? ''} className={selectClassName()}>
 <option value="">—</option>
 {gridOwners.map((row) => (
 <option key={row.id} value={row.id}>
 {row.name}
 </option>
 ))}
 </select>
 <input name="target_system" defaultValue={route.target_system} className={textInputClassName()} />
 <input name="target_email" defaultValue={route.target_email ?? ''} className={textInputClassName()} />
 <input name="endpoint" defaultValue={route.endpoint ?? ''} className={textInputClassName()} />
 <input name="supported_payload_version" defaultValue={route.supported_payload_version ?? ''} className={textInputClassName()} />
 <input name="route_notes" defaultValue={route.notes ?? ''} className={`${textInputClassName()} md:col-span-2`} />
 </div>

 <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
 <input type="checkbox" name="is_active" value="true" defaultChecked={route.is_active} className="h-4 w-4 rounded border-slate-300" />
 Route aktiv
 </label>

 <div className="mt-4">
 <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
 Spara communication route
 </button>
 </div>
 </form>

 <form
 action={saveEdielRouteProfileAction}
 className="rounded-2xl border border-slate-200 p-4"
 >
 <input type="hidden" name="communicationRouteId" value={route.id} />
 <div className="mb-3 text-sm font-semibold text-slate-900">
 Ediel route profile
 </div>
 <p className="mb-3 text-xs text-slate-700">
Lämna sender/application reference/mailbox tomt endast om aktiv aktörsidentitet ska vara default i vald miljö. Subadress är optional och används inte för tenant-resolve om routen inte kräver den.
 </p>

 <div className="grid gap-3 md:grid-cols-2">
 <input name="senderEdielId" defaultValue={runtime?.sender_ediel_id ?? ''} placeholder="Sender Ediel-id" className={textInputClassName()} />
 <input name="receiverEdielId" defaultValue={runtime?.receiver_ediel_id ?? ''} placeholder="Mottagare Ediel-id" className={textInputClassName()} />
 <input name="senderName" defaultValue={runtime?.sender_name ?? ''} placeholder="Sender name" className={textInputClassName()} />
 <input name="receiverName" defaultValue={runtime?.receiver_name ?? ''} placeholder="Mottagarens namn" className={textInputClassName()} />
 <input name="senderSubAddress" defaultValue={runtime?.sender_sub_address ?? ''} placeholder="Sender subaddress" className={textInputClassName()} />
<input name="receiverSubAddress" defaultValue={runtime?.receiver_subaddress ?? runtime?.receiver_sub_address ?? ''} placeholder="Mottagarens subadress (optional)" className={textInputClassName()} />
<input name="receiverMessageSubAddress" defaultValue={runtime?.receiver_message_subaddress ?? ''} placeholder="Message-subadress, t.ex. PRODAT" className={textInputClassName()} />
 <input name="mailbox" defaultValue={runtime?.mailbox ?? ''} placeholder="Mailbox" className={textInputClassName()} />
 <input name="applicationReference" defaultValue={runtime?.application_reference ?? ''} placeholder="Application reference" className={textInputClassName()} />
 <input name="defaultMessageVersion" defaultValue={runtime?.default_message_version ?? ''} placeholder="Standardversion" className={textInputClassName()} />
 <select name="ackMode" defaultValue={runtime?.ack_mode ?? 'default'} className={selectClassName()}>
 <option value="default">default</option>
 <option value="none">none</option>
 <option value="contrl_only">contrl_only</option>
 <option value="contrl_and_aperak">contrl_and_aperak</option>
 </select>
 <select name="messageStandard" defaultValue={runtime?.message_standard ?? 'edifact'} className={selectClassName()}>
 <option value="edifact">edifact</option>
 <option value="xml">xml</option>
 <option value="ai_list">ai_list</option>
 </select>
 <select name="payloadFormat" defaultValue={runtime?.payload_format ?? 'edifact'} className={selectClassName()}>
 <option value="edifact">edifact</option>
 <option value="xml">xml</option>
 <option value="raw">raw</option>
 </select>
 <select name="encryptionMode" defaultValue={runtime?.encryption_mode ?? ''} className={selectClassName()}>
 <option value="">—</option>
 <option value="none">none</option>
 <option value="smime">smime</option>
 <option value="pgp">pgp</option>
 </select>
<select name="signingMode" defaultValue={runtime?.signing_mode ?? 'none'} className={selectClassName()}>
<option value="none">signering: none</option>
<option value="smime">signering: smime</option>
</select>
<input name="certificateId" defaultValue={runtime?.certificate_id ?? ''} placeholder="Certificate id" className={textInputClassName()} />
 <select name="environment" defaultValue={runtime?.environment ?? 'test'} className={selectClassName()}>
 <option value="test">test</option>
 <option value="production">production</option>
 </select>
 <select name="defaultTestFlag" defaultValue={runtime?.default_test_flag ?? 1} className={selectClassName()}>
 <option value="1">1</option>
 <option value="0">0</option>
 </select>
 <input name="defaultTimezone" type="number" defaultValue={runtime?.default_timezone ?? 1} className={textInputClassName()} />
 <input name="smtpHost" defaultValue={runtime?.smtp_host ?? ''} placeholder="SMTP host" className={textInputClassName()} />
 <input name="smtpPort" type="number" defaultValue={runtime?.smtp_port ?? ''} placeholder="SMTP port" className={textInputClassName()} />
 <input name="imapHost" defaultValue={runtime?.imap_host ?? ''} placeholder="IMAP host" className={textInputClassName()} />
 <input name="imapPort" type="number" defaultValue={runtime?.imap_port ?? ''} placeholder="IMAP port" className={textInputClassName()} />
 <input name="notes" defaultValue={runtime?.route_profile_notes ?? ''} placeholder="Notes" className={`${textInputClassName()} md:col-span-2`} />
 </div>

 <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
 <input type="checkbox" name="isEnabled" value="true" defaultChecked={runtime?.is_enabled ?? false} className="h-4 w-4 rounded border-slate-300" />
 Ediel-profil aktiv
 </label>
<label className="mt-3 ml-4 inline-flex items-center gap-2 text-sm text-slate-700">
<input type="checkbox" name="subaddressRequired" value="true" defaultChecked={runtime?.subaddress_required === true} className="h-4 w-4 rounded border-slate-300" />
Subadress krävs
</label>

 <div className="mt-4">
 <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
 Spara route profile
 </button>
 </div>
 </form>
 </div>

 <div className="mt-5 grid gap-4 xl:grid-cols-4">
 <form action={quickFixEdielTargetEmailAction} className="rounded-2xl border border-slate-200 p-4">
 <input type="hidden" name="routeId" value={route.id} />
 <div className="mb-2 text-sm font-semibold text-slate-900">Snabb komplettering: mottagaradress</div>
 <input
 name="targetEmail"
 defaultValue={route.target_email ?? ''}
 placeholder="target_email"
 className={textInputClassName()}
 />
 <button className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
 Spara email
 </button>
 </form>

 <form action={quickFixEdielProfileBasicsAction} className="rounded-2xl border border-slate-200 p-4">
 <input type="hidden" name="routeId" value={route.id} />
 <div className="mb-2 text-sm font-semibold text-slate-900">Snabb komplettering: profilbas</div>
 <input name="senderEdielId" defaultValue={runtime?.sender_ediel_id ?? ''} placeholder="senderEdielId" className={`${textInputClassName()} mb-2`} />
 <input name="receiverEdielId" defaultValue={runtime?.receiver_ediel_id ?? ''} placeholder="receiverEdielId" className={`${textInputClassName()} mb-2`} />
 <input name="mailbox" defaultValue={runtime?.mailbox ?? ''} placeholder="mailbox" className={textInputClassName()} />
 <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
 <input type="checkbox" name="enableEdiel" value="true" defaultChecked={runtime?.is_enabled ?? false} className="h-4 w-4 rounded border-slate-300" />
 Aktivera profil
 </label>
 <button className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
 Spara profilbas
 </button>
 </form>

 <form action={quickFixEdielRouteActivationAction} className="rounded-2xl border border-slate-200 p-4">
 <input type="hidden" name="routeId" value={route.id} />
 <div className="mb-2 text-sm font-semibold text-slate-900">Snabb komplettering: aktivering</div>
 <label className="mb-2 inline-flex items-center gap-2 text-sm text-slate-700">
 <input type="checkbox" name="activateRoute" value="true" defaultChecked={route.is_active} className="h-4 w-4 rounded border-slate-300" />
 Aktivera route
 </label>
 <label className="inline-flex items-center gap-2 text-sm text-slate-700">
 <input type="checkbox" name="enableEdiel" value="true" defaultChecked={runtime?.is_enabled ?? false} className="h-4 w-4 rounded border-slate-300" />
 Aktivera Ediel-profil
 </label>
 <button className="mt-3 block rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
 Kör aktivering
 </button>
 </form>

 <form action={quickFixGridOwnerEdielIdAction} className="rounded-2xl border border-slate-200 p-4">
 <input type="hidden" name="gridOwnerId" value={gridOwner?.id ?? ''} />
 <div className="mb-2 text-sm font-semibold text-slate-900">Snabb komplettering: nätägarens Ediel-id</div>
 <input
 name="edielId"
 defaultValue={gridOwner?.ediel_id ?? ''}
 placeholder="nätägarens Ediel-id"
 className={textInputClassName()}
 disabled={!gridOwner?.id}
 />
 <button
 className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
 disabled={!gridOwner?.id}
 >
 Spara Ediel-id
 </button>
 </form>
 </div>
 </article>
 )
 })}
 </section>
 </div>
 )
}