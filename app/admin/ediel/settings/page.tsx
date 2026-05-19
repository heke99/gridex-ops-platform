import AdminHeader from '@/components/admin/AdminHeader'
import EdielRuleGroups, {
 type EdielRuleGroup,
 type EdielRuleListRow,
} from '@/components/admin/ediel/EdielRuleGroups'
import EdielRuleTemplateModals from '@/components/admin/ediel/EdielRuleTemplateModals'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import {
 saveEdielActorSettingsAction,
 saveEdielMessageRuleAction,
} from '@/app/admin/ediel/settings/actions'
import type {
 EdielActorSettingsRow,
 EdielMessageRuleRow,
} from '@/lib/ediel/types'
import {
 resolveInboundAcceptedVersionsRuntime,
 resolveOutboundMessageVersionRuntime,
} from '@/lib/ediel/config'

export const dynamic = 'force-dynamic'

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

function inputClassName() {
 return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500'
}

function selectClassName() {
 return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900'
}

function Input({
 name,
 defaultValue,
 placeholder,
 type = 'text',
}: {
 name: string
 defaultValue?: string | number | null
 placeholder?: string
 type?: string
}) {
 return (
 <input
 name={name}
 type={type}
 defaultValue={defaultValue ?? ''}
 placeholder={placeholder}
 className={inputClassName()}
 />
 )
}

function Select({
 name,
 defaultValue,
 children,
}: {
 name: string
 defaultValue?: string | number | null
 children: React.ReactNode
}) {
 return (
 <select
 name={name}
 defaultValue={defaultValue == null ? '' : String(defaultValue)}
 className={selectClassName()}
 >
 {children}
 </select>
 )
}

function Checkbox({
 name,
 defaultChecked,
 label,
}: {
 name: string
 defaultChecked?: boolean
 label: string
}) {
 return (
 <label className="inline-flex items-center gap-2 text-sm text-slate-700">
 <input
 type="checkbox"
 name={name}
 value="true"
 defaultChecked={defaultChecked}
 className="h-4 w-4 rounded border-slate-300"
 />
 <span>{label}</span>
 </label>
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

function sortRuleRows(rows: EdielMessageRuleRow[]) {
 return [...rows].sort((a, b) => {
 const aFrom = a.valid_from ?? ''
 const bFrom = b.valid_from ?? ''
 if (aFrom !== bFrom) return bFrom.localeCompare(aFrom)
 return String(b.version_code).localeCompare(String(a.version_code))
 })
}

function pickCurrentRule(
 rows: EdielRuleListRow[],
 runtimeCurrentVersion: string | null
): EdielRuleListRow | null {
 if (runtimeCurrentVersion) {
 const exact = rows.find((row) => row.version_code === runtimeCurrentVersion)
 if (exact) return exact
 }

 return rows.find((row) => row.is_active) ?? rows[0] ?? null
}

function pickPreviousRule(
 rows: EdielRuleListRow[],
 currentRule: EdielRuleListRow | null,
 runtimePreviousVersion: string | null
): EdielRuleListRow | null {
 if (runtimePreviousVersion) {
 const exact = rows.find(
 (row) =>
 row.version_code === runtimePreviousVersion &&
 row.id !== currentRule?.id
 )
 if (exact) return exact
 }

 return (
 rows.find(
 (row) =>
 row.id !== currentRule?.id &&
 row.is_active
 ) ?? rows.find((row) => row.id !== currentRule?.id) ?? null
 )
}

export default async function AdminEdielSettingsPage() {
 const context = await requireAnyPermissionServer(['communication.read'])
 const companyScope = await getOperationalCompanyScope(context.userId)

 const supabase = await createSupabaseServerClient()

 let actorSettingsQuery = supabase
 .from('ediel_actor_settings')
 .select('*')

 if (companyScope.companyId) {
 actorSettingsQuery = actorSettingsQuery.or(`company_id.is.null,company_id.eq.${companyScope.companyId}`)
 }

 const [actorSettingsResult, messageRulesResult] = await Promise.all([
 actorSettingsQuery
 .order('environment', { ascending: true })
 .order('updated_at', { ascending: false }),
 supabase
 .from('ediel_message_rules')
 .select('*')
 .order('message_family', { ascending: true })
 .order('message_code', { ascending: true })
 .order('valid_from', { ascending: false, nullsFirst: false }),
 ])

 if (actorSettingsResult.error) throw actorSettingsResult.error
 if (messageRulesResult.error) throw messageRulesResult.error

 const actorSettings = (actorSettingsResult.data ?? []) as EdielActorSettingsRow[]
 const messageRules = (messageRulesResult.data ?? []) as EdielMessageRuleRow[]

 const activeTestActor = actorSettings.find(
 (row) => row.environment === 'test' && row.is_active
 )
 const activeProdActor = actorSettings.find(
 (row) => row.environment === 'production' && row.is_active
 )

 const activeRuleCount = messageRules.filter((row) => row.is_active).length
 const negativeSupportCount = messageRules.filter(
 (row) => row.supports_negative_response
 ).length

 const groupMap = new Map<string, EdielMessageRuleRow[]>()
 for (const row of messageRules) {
 const key = `${row.message_family}__${row.message_code}__${row.message_standard}`
 if (!groupMap.has(key)) groupMap.set(key, [])
 groupMap.get(key)!.push(row)
 }

 const groupedRules = [...groupMap.entries()].map(([key, rows]) => ({
 key,
 rows: sortRuleRows(rows),
 }))

 const runtimeSnapshots = await Promise.all(
 groupedRules.map(async (group) => {
 const first = group.rows[0]
 const outbound = await resolveOutboundMessageVersionRuntime({
 family: first.message_family,
 code: first.message_code,
 standard: first.message_standard,
 })
 const inbound = await resolveInboundAcceptedVersionsRuntime({
 family: first.message_family,
 code: first.message_code,
 standard: first.message_standard,
 })

 return {
 key: group.key,
 family: first.message_family,
 code: first.message_code,
 standard: first.message_standard,
 outbound,
 inbound,
 activeCount: group.rows.filter((row) => row.is_active).length,
 }
 })
 )

 const runtimeSnapshotByKey = new Map(runtimeSnapshots.map((row) => [row.key, row]))

 const ruleGroups: EdielRuleGroup[] = groupedRules.map((group) => {
 const first = group.rows[0]
 const snapshot = runtimeSnapshotByKey.get(group.key)

 const rows: EdielRuleListRow[] = group.rows.map((row) => ({
 ...row,
 statusTag: 'history',
 runtimeCurrentVersion: snapshot?.outbound.currentVersion ?? null,
 runtimePreviousVersion: snapshot?.inbound.previousVersion ?? null,
 acceptedVersions: snapshot?.inbound.acceptedVersions ?? [],
 }))

 const currentRule = pickCurrentRule(
 rows,
 snapshot?.outbound.currentVersion ?? null
 )

 const previousRule = pickPreviousRule(
 rows,
 currentRule,
 snapshot?.inbound.previousVersion ?? null
 )

 const taggedRows = rows.map((row) => ({
 ...row,
 statusTag:
 row.id === currentRule?.id
 ? ('current' as const)
 : row.id === previousRule?.id
 ? ('previous' as const)
 : ('history' as const),
 }))

 return {
 key: group.key,
 family: first.message_family,
 code: first.message_code,
 standard: first.message_standard,
 rows: taggedRows,
 currentRule:
 taggedRows.find((row) => row.id === currentRule?.id) ?? null,
 previousRule:
 taggedRows.find((row) => row.id === previousRule?.id) ?? null,
 historyRules: taggedRows.filter(
 (row) => row.id !== currentRule?.id && row.id !== previousRule?.id
 ),
 }
 })

 const ambiguousRuntimeCount = runtimeSnapshots.filter((row) => row.activeCount > 1).length
 const previousValidCount = runtimeSnapshots.filter(
 (row) => row.inbound.previousVersion
 ).length

 const hasProdatRule = messageRules.some((row) => row.message_family === 'PRODAT')

 return (
 <div className="space-y-6">
 <AdminHeader
 title="Ediel-inställningar"
 subtitle={`Aktörsprofiler och meddelanderegler för ${companyScope.companyName ?? 'valt bolag'}. Aktiva profiler sparas tenant-scopat så samma Ediel-id används i routes, liveflöde och testmiljö.`}
 userEmail={context.email}
 />

 <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-sm text-slate-700">Aktiv test-aktör</div>
 <div className="mt-2 text-lg font-semibold text-slate-900">
 {activeTestActor?.actor_ediel_id ?? 'Saknas'}
 </div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-sm text-slate-700">Aktiv prod-aktör</div>
 <div className="mt-2 text-lg font-semibold text-slate-900">
 {activeProdActor?.actor_ediel_id ?? 'Saknas'}
 </div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <div className="text-sm text-slate-700">Aktiva regler</div>
 <div className="mt-2 text-3xl font-semibold text-slate-950">{activeRuleCount}</div>
 </div>
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
 <div className="text-sm text-amber-700">Regler med negativ respons</div>
 <div className="mt-2 text-3xl font-semibold text-amber-900">{negativeSupportCount}</div>
 </div>
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
 <div className="text-sm text-amber-700">Runtime-ambiguiteter</div>
 <div className="mt-2 text-3xl font-semibold text-amber-900">{ambiguousRuntimeCount}</div>
 </div>
 <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
 <div className="text-sm text-emerald-700">Previous-valid aktivt</div>
 <div className="mt-2 text-3xl font-semibold text-emerald-900">{previousValidCount}</div>
 </div>
 </section>

 <EdielRuleTemplateModals hasProdatRule={hasProdatRule} />

 <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
 <h2 className="text-lg font-semibold text-slate-950">Så läser du versionerna</h2>
 <p className="mt-1 text-sm text-slate-700">
 “Version” är den Ediel-anvisningsversion som regeln kommer använda i runtime.
 “Giltig från” är datumet då just den versionen ska börja användas. Outbound current
 ska vara den version som gäller nu, medan inbound också kan acceptera närmast
 föregående giltiga version under övergångsperioden.
 </p>
 </section>

 <section className="rounded-2xl border border-slate-200 bg-white p-6">
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-900">Aktörskort</h2>
 <p className="mt-1 text-sm text-slate-700">
 Ett aktivt aktörskort per miljö. När du markerar en rad som aktiv stängs övriga av i samma miljö.
 </p>
 </div>

 <div className="space-y-6">
 {actorSettings.map((row) => (
 <form
 key={row.id}
 action={saveEdielActorSettingsAction}
 className="rounded-2xl border border-slate-200 p-4"
 >
 <input type="hidden" name="id" value={row.id} />

 <div className="mb-4 flex flex-wrap items-center gap-2">
 <Pill text={row.environment} tone={row.environment === 'production' ? 'red' : 'emerald'} />
 <Pill text={row.is_active ? 'Aktiv' : 'Inaktiv'} tone={row.is_active ? 'emerald' : 'slate'} />
 <span className="text-xs text-slate-700">
 Uppdaterad {formatDate(row.updated_at)}
 </span>
 </div>

 <div className="grid gap-3 md:grid-cols-3">
 <Input name="actor_name" defaultValue={row.actor_name} placeholder="Actor name" />
 <Input name="actor_ediel_id" defaultValue={row.actor_ediel_id} placeholder="Actor Ediel ID" />
 <Input name="actor_role" defaultValue={row.actor_role} placeholder="Actor role" />
 <Select name="environment" defaultValue={row.environment}>
 <option value="test">test</option>
 <option value="production">production</option>
 </Select>
 <Input name="sender_name" defaultValue={row.sender_name} placeholder="Sender name" />
 <Input name="sender_sub_address" defaultValue={row.sender_sub_address} placeholder="Sender sub address" />
 <Input name="default_application_reference" defaultValue={row.default_application_reference} placeholder="Application reference" />
 <Input name="default_timezone" defaultValue={row.default_timezone} placeholder="Timezone" type="number" />
 <Input name="default_charset" defaultValue={row.default_charset} placeholder="Charset" />
 <Select name="default_test_flag" defaultValue={row.default_test_flag}>
 <option value="1">1</option>
 <option value="0">0</option>
 </Select>
 <Input name="smtp_from_email" defaultValue={row.smtp_from_email} placeholder="SMTP from email" />
 <Input name="smtp_reply_to_email" defaultValue={row.smtp_reply_to_email} placeholder="SMTP reply-to" />
 <Input name="mailbox" defaultValue={row.mailbox} placeholder="Mailbox" />
 <Input name="notes" defaultValue={row.notes} placeholder="Notes" />
 </div>

 <div className="mt-4 flex flex-wrap items-center gap-4">
 <Checkbox name="is_active" defaultChecked={row.is_active} label="Aktiv för miljön" />
 <button
 type="submit"
 className="rounded-xl bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900"
 >
 Spara aktörskort
 </button>
 </div>
 </form>
 ))}

 <form
 action={saveEdielActorSettingsAction}
 className="rounded-2xl border border-dashed border-slate-300 p-4"
 >
 <div className="mb-4">
 <h3 className="text-sm font-semibold text-slate-900">Skapa nytt aktörskort</h3>
 </div>

 <div className="grid gap-3 md:grid-cols-3">
 <Input name="actor_name" placeholder="Actor name" />
 <Input name="actor_ediel_id" placeholder="Actor Ediel ID" />
 <Input name="actor_role" placeholder="Actor role" />
 <Select name="environment" defaultValue="test">
 <option value="test">test</option>
 <option value="production">production</option>
 </Select>
 <Input name="sender_name" placeholder="Sender name" />
 <Input name="sender_sub_address" placeholder="Sender sub address" />
 <Input name="default_application_reference" placeholder="Application reference" />
 <Input name="default_timezone" type="number" defaultValue={1} />
 <Input name="default_charset" defaultValue="UNOC" />
 <Select name="default_test_flag" defaultValue={1}>
 <option value="1">1</option>
 <option value="0">0</option>
 </Select>
 <Input name="smtp_from_email" placeholder="SMTP from email" />
 <Input name="smtp_reply_to_email" placeholder="SMTP reply-to" />
 <Input name="mailbox" placeholder="Mailbox" />
 <Input name="notes" placeholder="Notes" />
 </div>

 <div className="mt-4 flex flex-wrap items-center gap-4">
 <Checkbox name="is_active" defaultChecked={false} label="Aktiv för miljön" />
 <button
 type="submit"
 className="rounded-xl bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900"
 >
 Skapa aktörskort
 </button>
 </div>
 </form>
 </div>
 </section>

 <section className="rounded-2xl border border-slate-200 bg-white p-6">
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-900">Runtime-upplösning per family/code</h2>
 <p className="mt-1 text-sm text-slate-700">
 Det här blocket visar samma registrymotor som används i runtime: outbound selected version, current, previous och inbound accepted versions.
 </p>
 </div>

 <div className="grid gap-4 xl:grid-cols-2">
 {runtimeSnapshots.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">
 Inga runtime snapshots kunde byggas.
 </div>
 ) : (
 runtimeSnapshots.slice(0, 24).map((row) => (
 <div key={row.key} className="rounded-2xl border border-slate-200 p-4">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="text-sm font-semibold text-slate-950">
 {row.family} {row.code}
 </div>
 <div className="flex flex-wrap gap-2">
 <Pill text={row.standard} tone="emerald" />
 <Pill text={`aktiva regler ${row.activeCount}`} tone={row.activeCount > 1 ? 'amber' : 'emerald'} />
 </div>
 </div>

 <div className="mt-3 grid gap-3 md:grid-cols-2">
 <Field label="Outbound selected" value={row.outbound.selectedVersion} />
 <Field label="Outbound current" value={row.outbound.currentVersion} />
 <Field label="Outbound previous" value={row.outbound.previousVersion} />
 <Field label="Inbound current" value={row.inbound.currentVersion} />
 <Field label="Inbound previous" value={row.inbound.previousVersion} />
 <Field label="Accepted versions" value={row.inbound.acceptedVersions.join(', ')} />
 </div>
 </div>
 ))
 )}
 </div>
 </section>

 <EdielRuleGroups groups={ruleGroups} />

 <section className="rounded-2xl border border-slate-200 bg-white p-6">
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-900">Skapa ny message rule manuellt</h2>
 <p className="mt-1 text-sm text-slate-700">
 Använd detta när du behöver finjustera eller lägga till en enskild rule utanför mallarna.
 </p>
 </div>

 <form
 action={saveEdielMessageRuleAction}
 className="rounded-2xl border border-dashed border-slate-300 p-4"
 >
 <div className="grid gap-3 md:grid-cols-3">
 <Input name="message_family" placeholder="PRODAT / UTILTS / APERAK ..." />
 <Input name="message_code" placeholder="Z03 / E66 / CONTRL ..." />
 <Select name="message_standard" defaultValue="edifact">
 <option value="edifact">edifact</option>
 <option value="xml">xml</option>
 <option value="ai_list">ai_list</option>
 </Select>
 <Input name="version_code" placeholder="E5SE5A / Ver20140401 ..." />
 <Select name="direction" defaultValue="both">
 <option value="both">both</option>
 <option value="inbound">inbound</option>
 <option value="outbound">outbound</option>
 </Select>
 <Input name="valid_from" type="date" />
 <Input name="valid_to" type="date" />
 <Input name="notes" placeholder="Notes" />
 </div>

 <div className="mt-4 flex flex-wrap items-center gap-4">
 <Checkbox name="requires_contrl" defaultChecked={false} label="requires_contrl" />
 <Checkbox name="requires_aperak" defaultChecked={false} label="requires_aperak" />
 <Checkbox name="supports_negative_response" defaultChecked={false} label="supports_negative_response" />
 <Checkbox name="is_active" defaultChecked={true} label="Aktiv regel" />

 <button
 type="submit"
 className="rounded-xl bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900"
 >
 Skapa regel
 </button>
 </div>
 </form>
 </section>
 </div>
 )
}