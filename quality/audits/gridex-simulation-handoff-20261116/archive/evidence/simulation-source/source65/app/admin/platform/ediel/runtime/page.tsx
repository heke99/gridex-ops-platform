/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from 'react'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isMissingRelationError } from '@/lib/tenant/scope'
import type { EdielMessageStandard } from '@/lib/ediel/types'
import {
  resolveInboundAcceptedVersionsRuntime,
  resolveOutboundMessageVersionRuntime,
} from '@/lib/ediel/config'

export const dynamic = 'force-dynamic'

type RuleRow = {
 id: string
 message_family: string | null
 message_code: string | null
 message_standard: string | null
 version_code: string | null
 is_active: boolean | null
 direction: string | null
 valid_from: string | null
 valid_to: string | null
}

type CountFilter = {
 column: string
 value: string | string[] | boolean | null
 op?: 'eq' | 'in' | 'is' | 'neq'
}

type RuntimeGroup = {
 key: string
 family: string
 code: string
 standard: string
 activeRules: number
 ruleCount: number
 outboundSelected: string | null
 outboundCurrent: string | null
 outboundPrevious: string | null
 inboundAccepted: string[]
 inboundCurrent: string | null
 inboundPrevious: string | null
 hasAmbiguousActiveRules: boolean
}

function applyFilter(query: any, filter: CountFilter): any {
 if (filter.op === 'in') return query.in(filter.column, Array.isArray(filter.value) ? filter.value : [])
 if (filter.op === 'is') return query.is(filter.column, filter.value)
 if (filter.op === 'neq') return query.neq(filter.column, filter.value)
 return query.eq(filter.column, filter.value)
}

async function safeCount(
 supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
 table: string,
 filters: CountFilter[] = []
): Promise<number> {
 try {
 let query: any = supabase.from(table).select('*', { count: 'exact', head: true })
 for (const filter of filters) query = applyFilter(query, filter)
 const { count, error } = await query
 if (error) throw error
 return count ?? 0
 } catch (error) {
 if (isMissingRelationError(error) || (error as { code?: string } | null)?.code === '42703') return 0
 throw error
 }
}

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'emerald' | 'amber' | 'red' | 'slate' }) {
 const toneClass =
 tone === 'emerald'
 ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
 : tone === 'amber'
 ? 'border-amber-200 bg-amber-50 text-amber-800'
 : tone === 'red'
 ? 'border-red-200 bg-red-50 text-red-800'
 : 'border-slate-200 bg-slate-50 text-slate-700'

 return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>{children}</span>
}

function MetricCard({ label, value, description, tone = 'slate' }: { label: string; value: number; description: string; tone?: 'emerald' | 'amber' | 'red' | 'slate' }) {
 const toneClass =
 tone === 'emerald'
 ? 'border-emerald-200 bg-emerald-50'
 : tone === 'amber'
 ? 'border-amber-200 bg-amber-50'
 : tone === 'red'
 ? 'border-red-200 bg-red-50'
 : 'border-slate-200 bg-white'

 return (
 <div className={`rounded-3xl border p-5 shadow-sm ${toneClass}`}>
 <p className="text-sm font-semibold text-slate-700">{label}</p>
 <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
 <p className="mt-2 text-sm leading-6 text-slate-700">{description}</p>
 </div>
 )
}

function groupRules(rules: RuleRow[]) {
 const map = new Map<string, RuleRow[]>()
 for (const rule of rules) {
 const family = rule.message_family ?? 'UNKNOWN'
 const code = rule.message_code ?? 'UNKNOWN'
 const standard = rule.message_standard ?? 'edifact'
 const key = `${family}__${code}__${standard}`
 const current = map.get(key) ?? []
 current.push(rule)
 map.set(key, current)
 }
 return map
}

export default async function PlatformEdielRuntimePage() {
 const admin = await requirePlatformAdminAccess()
 const supabase = await createSupabaseServerClient()

 const { data, error } = await supabase
 .from('ediel_message_rules')
 .select('id,message_family,message_code,message_standard,version_code,is_active,direction,valid_from,valid_to')
 .order('message_family', { ascending: true })
 .order('message_code', { ascending: true })
 .order('valid_from', { ascending: false, nullsFirst: false })

 if (error) throw error
 const rules = (data ?? []) as RuleRow[]
 const grouped = groupRules(rules)

 const runtimeGroups: RuntimeGroup[] = await Promise.all(
 [...grouped.entries()].map(async ([key, groupRows]) => {
 const first = groupRows[0]
 const family = first.message_family ?? 'UNKNOWN'
 const code = first.message_code ?? 'UNKNOWN'
 const standard = (first.message_standard === 'xml' || first.message_standard === 'ai_list' ? first.message_standard : 'edifact') as EdielMessageStandard
 const [outbound, inbound] = await Promise.all([
 resolveOutboundMessageVersionRuntime({ family, code, standard }).catch(() => ({
 selectedVersion: null,
 currentVersion: null,
 previousVersion: null,
 })),
 resolveInboundAcceptedVersionsRuntime({ family, code, standard }).catch(() => ({
 acceptedVersions: [],
 currentVersion: null,
 previousVersion: null,
 })),
 ])
 const activeRules = groupRows.filter((row) => row.is_active).length
 return {
 key,
 family,
 code,
 standard,
 activeRules,
 ruleCount: groupRows.length,
 outboundSelected: outbound.selectedVersion,
 outboundCurrent: outbound.currentVersion,
 outboundPrevious: outbound.previousVersion,
 inboundAccepted: inbound.acceptedVersions,
 inboundCurrent: inbound.currentVersion,
 inboundPrevious: inbound.previousVersion,
 hasAmbiguousActiveRules: activeRules > 1,
 }
 })
 )

 const [companies, companiesMissingActor, activeRoutes, enabledRouteProfiles, failedMessages, pendingAcks] = await Promise.all([
 safeCount(supabase, 'companies', [{ column: 'status', op: 'neq', value: 'deleted_test_only' }]),
 safeCount(supabase, 'companies', [{ column: 'ediel_id', op: 'is', value: null }]),
 safeCount(supabase, 'communication_routes', [{ column: 'is_active', value: true }]),
 safeCount(supabase, 'ediel_route_profiles', [{ column: 'is_enabled', value: true }]),
 safeCount(supabase, 'ediel_messages', [{ column: 'status', value: 'failed' }]),
 safeCount(supabase, 'ediel_messages', [{ column: 'status', op: 'in', value: ['queued', 'prepared', 'sent', 'validated'] }]),
 ])

 const ambiguous = runtimeGroups.filter((row) => row.hasAmbiguousActiveRules).length
 const missingSelected = runtimeGroups.filter((row) => !row.outboundSelected).length

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Ediel runtimekontroll"
 subtitle="Platform-only vy för Ediel-versioner, route-hälsa, tenantprofiler och kvittensrisker. Vanliga bolag ser endast sin egen Ediel-yta."
 userEmail={admin.email}
 workspaceName="Gridex Platform"
 workspaceMode="platform"
 />

 <div className="space-y-6 p-6 xl:p-8">
 <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-5">
 <div>
 <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-800">Runtime governance</p>
 <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Samma beslut som används i liveflöden</h2>
 <p className="mt-2 max-w-5xl text-sm font-semibold leading-6 text-slate-700">
 Den här sidan ska göra det tydligt vilken version runtime väljer outbound, vilka inbound-versioner som accepteras, och om tenants saknar aktörsprofil eller route innan produktion startas.
 </p>
 </div>
 <div className="flex flex-wrap gap-2">
 <Badge tone="emerald">PRODAT</Badge>
 <Badge tone="emerald">UTILTS</Badge>
 <Badge tone="emerald">CONTRL / APERAK</Badge>
 </div>
 </div>
 </section>

 <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
 <MetricCard label="Bolag" value={companies} description="Tenants som finns på plattformen." tone="emerald" />
 <MetricCard label="Saknar Ediel-id" value={companiesMissingActor} description="Bolag där liveflöden ska blockeras." tone={companiesMissingActor > 0 ? 'amber' : 'emerald'} />
 <MetricCard label="Aktiva routes" value={activeRoutes} description="Kommunikationsrutter markerade som aktiva." />
 <MetricCard label="Route-profiler" value={enabledRouteProfiles} description="Ediel route profiles som är påslagna." />
 <MetricCard label="Ediel-fel" value={failedMessages} description="Meddelanden i felstatus." tone={failedMessages > 0 ? 'red' : 'emerald'} />
 <MetricCard label="Pågående ACK" value={pendingAcks} description="Köade/skickade meddelanden som behöver följas." tone={pendingAcks > 0 ? 'amber' : 'emerald'} />
 </section>

 <section className="grid gap-4 md:grid-cols-3">
 <MetricCard label="Regelgrupper" value={runtimeGroups.length} description="Unika family/code/standard-grupper." />
 <MetricCard label="Ambigua aktiva regler" value={ambiguous} description="Fler än en aktiv regel i samma grupp ska granskas." tone={ambiguous > 0 ? 'amber' : 'emerald'} />
 <MetricCard label="Saknar vald outbound" value={missingSelected} description="Runtime kunde inte välja outbound-version." tone={missingSelected > 0 ? 'red' : 'emerald'} />
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
 <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Versioner i runtime</h2>
 <p className="mt-1 text-sm text-slate-700">Visar outbound selected/current/previous och inbound accepted per message family och kod.</p>
 </div>
 <Link href="/admin/platform/ediel/rules" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
 Öppna globala regler
 </Link>
 </div>
 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
 <tr>
 <th className="px-4 py-3">Family</th>
 <th className="px-4 py-3">Kod</th>
 <th className="px-4 py-3">Standard</th>
 <th className="px-4 py-3">Outbound</th>
 <th className="px-4 py-3">Inbound accepterade</th>
 <th className="px-4 py-3">Regler</th>
 <th className="px-4 py-3">Status</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-100">
 {runtimeGroups.length === 0 ? (
 <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-700">Inga Ediel-regler finns att visa.</td></tr>
 ) : runtimeGroups.map((row) => (
 <tr key={row.key} className="hover:bg-slate-50">
 <td className="px-4 py-3 font-semibold text-slate-950">{row.family}</td>
 <td className="px-4 py-3 text-slate-700">{row.code}</td>
 <td className="px-4 py-3 text-slate-700">{row.standard}</td>
 <td className="px-4 py-3 text-slate-700">
 <div className="font-semibold text-slate-950">{row.outboundSelected ?? 'Saknas'}</div>
 <div className="text-xs text-slate-500">current {row.outboundCurrent ?? '–'} · previous {row.outboundPrevious ?? '–'}</div>
 </td>
 <td className="px-4 py-3 text-slate-700">{row.inboundAccepted.length > 0 ? row.inboundAccepted.join(', ') : 'Saknas'}</td>
 <td className="px-4 py-3 text-slate-700">{row.activeRules}/{row.ruleCount} aktiva</td>
 <td className="px-4 py-3">
 {row.hasAmbiguousActiveRules ? <Badge tone="amber">Granska</Badge> : row.outboundSelected ? <Badge tone="emerald">Klar</Badge> : <Badge tone="red">Blockerad</Badge>}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </section>
 </div>
 </div>
 )
}
