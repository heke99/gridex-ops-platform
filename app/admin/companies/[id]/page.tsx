import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  getCompanyById,
  getCompanyGovernanceSummary,
  getCompanyStatusCopy,
  normalizeCompanyStatus,
  type GovernanceCompany,
} from '@/lib/tenant/governance'
import { getActorTestingSummary, getActorTestingStatusLabel, getProductionReadinessLabel } from '@/lib/ediel/actorTesting'
import { getCompanyActorConfiguration, type CompanyActorConfiguration, type EdielConfigRow } from '@/lib/ediel/companyActorConfiguration'
import {
  listTenantEmailTemplates,
  TENANT_EMAIL_TEMPLATE_DEFINITIONS,
  type TenantEmailTemplateRow,
} from '@/lib/tenant/emailTemplates'
import { saveCompanyBrpAction, saveCompanyEdielActorAction } from './ediel-actions'
import { saveTenantEmailTemplateAction } from './email-template-actions'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function rowText(row: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  if (!row) return null
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function rowBool(row: Record<string, unknown> | null | undefined, key: string): boolean {
  return row?.[key] === true
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="truncate text-sm font-semibold text-slate-600">{label}</p>
      <p className="mt-2 break-words text-3xl font-black text-slate-950">{value}</p>
      {hint ? <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{hint}</p> : null}
    </div>
  )
}

function ActionLine({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: 'slate' | 'emerald' | 'amber' | 'red' }) {
  const styles: Record<typeof tone, string> = {
    slate: 'border-slate-200 bg-slate-50 text-slate-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-800',
  }
  return (
    <div className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${styles[tone]}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function statusBadge(company: GovernanceCompany) {
  const copy = getCompanyStatusCopy(company.status)
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${copy.tone}`}>{copy.label}</span>
}

type CompanyOperationalStats = {
  newCustomersThisMonth: number
  closedCustomersThisMonth: number
  openWithdrawals: number
  queuedEmails: number
  failedEmails: number
  sentEmailsThisMonth: number
}

function monthStartIso() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

async function safeCompanyCount(
  table: string,
  companyId: string,
  filters: Array<{ column: string; op?: 'eq' | 'in' | 'gte'; value: string | string[] | boolean }> = []
) {
  try {
    let query = supabaseService.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId)
    for (const filter of filters) {
      if (filter.op === 'in' && Array.isArray(filter.value)) query = query.in(filter.column, filter.value)
      else if (filter.op === 'gte') query = query.gte(filter.column, String(filter.value))
      else query = query.eq(filter.column, filter.value as string | boolean)
    }
    const { count, error } = await query
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

async function getCompanyOperationalStats(companyId: string): Promise<CompanyOperationalStats> {
  const from = monthStartIso()
  const [newCustomersThisMonth, closedCustomersThisMonth, openWithdrawals, queuedEmails, failedEmails, sentEmailsThisMonth] = await Promise.all([
    safeCompanyCount('customers', companyId, [{ column: 'created_at', op: 'gte', value: from }]),
    safeCompanyCount('customers', companyId, [
      { column: 'updated_at', op: 'gte', value: from },
      { column: 'status', op: 'in', value: ['terminated', 'moved', 'closed', 'inactive'] },
    ]),
    safeCompanyCount('customer_cases', companyId, [
      { column: 'case_type', value: 'withdrawal' },
      { column: 'status', op: 'in', value: ['open', 'action_required', 'billing_blocked', 'manual_follow_up'] },
    ]),
    safeCompanyCount('tenant_email_outbox', companyId, [{ column: 'status', value: 'queued' }]),
    safeCompanyCount('tenant_email_outbox', companyId, [{ column: 'status', value: 'failed' }]),
    safeCompanyCount('tenant_email_outbox', companyId, [
      { column: 'status', value: 'sent' },
      { column: 'sent_at', op: 'gte', value: from },
    ]),
  ])

  return { newCustomersThisMonth, closedCustomersThisMonth, openWithdrawals, queuedEmails, failedEmails, sentEmailsThisMonth }
}

function ActionBanner({ success, error }: { success?: string; error?: string }) {
  if (!success && !error) return null
  const tone = success ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
  return <section className={`rounded-3xl border p-5 text-sm font-semibold ${tone}`}>{success ?? error}</section>
}

function ReadinessPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
      {label}: {ok ? 'ja' : 'nej'}
    </span>
  )
}

function ConfigTable({ title, rows, columns }: { title: string; rows: EdielConfigRow[]; columns: Array<{ key: string; label: string }> }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">{title}</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
            <tr>{columns.map((column) => <th key={column.key} className="px-4 py-3">{column.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? <tr><td colSpan={columns.length} className="px-4 py-6 text-center text-slate-600">Inga rader hittades.</td></tr> : null}
            {rows.slice(0, 10).map((row) => (
              <tr key={row.id}>
                {columns.map((column) => <td key={column.key} className="px-4 py-3 text-slate-700">{String(row[column.key] ?? '–')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CompanyEdielConfiguration({ company, config }: { company: GovernanceCompany; config: CompanyActorConfiguration }) {
  const actor = config.actors[0] ?? null
  const brp = config.brpSettings.find((row) => rowBool(row, 'is_default')) ?? config.brpSettings[0] ?? null
  const sharedMailbox = config.mailboxes.find((row) => {
    const metadata = row.metadata
    return metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>).scope === 'platform_shared'
  })
  const readiness = {
    actor: Boolean(rowText(actor, 'ediel_id', 'actor_ediel_id')),
    brp: Boolean(rowText(brp, 'brp_ediel_id')),
    mailbox: Boolean(sharedMailbox),
    route: config.routeProfiles.some((row) => rowBool(row, 'is_active') || rowBool(row, 'is_enabled')),
    rules: config.messageRules.some((row) => rowBool(row, 'is_active')),
  }

  return (
    <section id="ediel-config" className="space-y-6">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900">Ediel SaaS-konfiguration</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">Shared mailbox, aktörsrouting och bolagets Ediel-identitet</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <ReadinessPill ok={readiness.actor} label="Ediel ID" />
          <ReadinessPill ok={readiness.brp} label="BRP" />
          <ReadinessPill ok={readiness.mailbox} label="Shared mailbox" />
          <ReadinessPill ok={readiness.route} label="Route profile" />
          <ReadinessPill ok={readiness.rules} label="Message rules" />
        </div>
        <nav className="mt-5 flex flex-wrap gap-2 text-sm font-black">
          {[
            ['#overview', 'Overview'],
            ['#ediel-actor', 'Ediel actor'],
            ['#brp', 'BRP / balancing'],
            ['#communication', 'Communication'],
            ['#route-profiles', 'Route profiles'],
            ['#message-rules', 'Message rules'],
            ['#system-tests', 'System tests'],
            ['#operational-health', 'Operational health'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-emerald-900 hover:bg-emerald-100">{label}</a>
          ))}
        </nav>
      </div>

      <section id="ediel-actor" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Ediel actor</h2>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">Plattformen sparar bolagets Ediel ID per miljö. Mailboxen är bara transportkanal.</p>
        <form action={saveCompanyEdielActorAction} className="mt-5 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="company_id" value={company.id} />
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Miljö</span><select name="environment" defaultValue={rowText(actor, 'environment') ?? 'test'} className="rounded-2xl border border-slate-300 px-4 py-3"><option value="test">test</option><option value="production">production</option></select></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Aktörsroll</span><select name="actor_role" defaultValue={rowText(actor, 'actor_role', 'role') ?? 'supplier'} className="rounded-2xl border border-slate-300 px-4 py-3"><option value="supplier">supplier</option><option value="grid_owner">grid_owner</option><option value="esco">esco</option><option value="brp">brp</option><option value="agent">agent</option><option value="other">other</option></select></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Ediel ID</span><input name="ediel_id" defaultValue={rowText(actor, 'ediel_id', 'actor_ediel_id') ?? ''} required className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Application reference</span><input name="application_reference" defaultValue={rowText(actor, 'application_reference', 'default_application_reference') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Sender subaddress</span><input name="sender_subaddress" defaultValue={rowText(actor, 'sender_subaddress', 'sender_sub_address') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Receiver subaddress</span><input name="receiver_subaddress" defaultValue={rowText(actor, 'receiver_subaddress', 'receiver_sub_address') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Giltig från</span><input type="date" name="valid_from" defaultValue={rowText(actor, 'valid_from') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Giltig till</span><input type="date" name="valid_to" defaultValue={rowText(actor, 'valid_to') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-800"><input type="checkbox" name="is_active" defaultChecked={actor ? rowBool(actor, 'is_active') : true} /> Aktiv</label>
          <div className="md:col-span-2"><button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Spara Ediel actor</button></div>
        </form>
      </section>

      <section id="brp" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">BRP / balancing</h2>
        <form action={saveCompanyBrpAction} className="mt-5 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="company_id" value={company.id} />
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Miljö</span><select name="environment" defaultValue={rowText(brp, 'environment') ?? 'test'} className="rounded-2xl border border-slate-300 px-4 py-3"><option value="test">test</option><option value="production">production</option></select></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">BRP Ediel ID</span><input name="brp_ediel_id" defaultValue={rowText(brp, 'brp_ediel_id') ?? ''} required className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">BRP-namn</span><input name="brp_name" defaultValue={rowText(brp, 'brp_name') ?? ''} required className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">BRP e-post</span><input name="brp_email" defaultValue={rowText(brp, 'brp_email') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">BRP telefon</span><input name="brp_phone" defaultValue={rowText(brp, 'brp_phone') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Kontaktperson</span><input name="contact_person" defaultValue={rowText(brp, 'contact_person') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Giltig från</span><input type="date" name="valid_from" defaultValue={rowText(brp, 'valid_from') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Giltig till</span><input type="date" name="valid_to" defaultValue={rowText(brp, 'valid_to') ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-800"><input type="checkbox" name="is_default" defaultChecked={brp ? rowBool(brp, 'is_default') : true} /> Standard-BRP</label>
          <div className="md:col-span-2"><button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Spara BRP</button></div>
        </form>
      </section>

      <section id="communication" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Shared mailboxes" value={config.mailboxes.length} hint="Transportkanaler; company_id får vara null för shared." />
        <StatCard label="Allowed counterparties" value={config.counterparties.length} />
        <StatCard label="Senaste inbound" value={formatDate(config.latestInboundAt)} />
        <StatCard label="Senaste outbound" value={formatDate(config.latestOutboundAt)} />
      </section>

      <div id="route-profiles"><ConfigTable title="Route profiles" rows={config.routeProfiles} columns={[{ key: 'environment', label: 'Miljö' }, { key: 'route_name', label: 'Route' }, { key: 'sender_ediel_id', label: 'Sender' }, { key: 'receiver_ediel_id', label: 'Receiver' }, { key: 'is_active', label: 'Aktiv' }]} /></div>
      <div id="message-rules"><ConfigTable title="Message rules" rows={config.messageRules} columns={[{ key: 'message_family', label: 'Familj' }, { key: 'message_code', label: 'Kod' }, { key: 'version_code', label: 'Version' }, { key: 'direction', label: 'Riktning' }, { key: 'is_active', label: 'Aktiv' }]} /></div>
      <div id="system-tests" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-black text-slate-950">System tests</h2><div className="mt-4 flex flex-wrap gap-2"><Link href={`/admin/platform/actor-testing/${company.id}`} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-50">Öppna aktörstester</Link><Link href="/admin/ediel/system-tests" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-50">Systemtestcenter</Link></div></div>
      <div id="operational-health" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-black text-slate-950">Operational health</h2><div className="mt-4 grid gap-3 md:grid-cols-3"><ActionLine label="Unresolved inbound" value={config.unresolvedInboundCount} tone={config.unresolvedInboundCount > 0 ? 'red' : 'emerald'} /><ActionLine label="Aktiva actors" value={config.actors.filter((row) => rowBool(row, 'is_active')).length} tone={readiness.actor ? 'emerald' : 'red'} /><ActionLine label="Aktiva routes" value={config.routeProfiles.filter((row) => rowBool(row, 'is_active') || rowBool(row, 'is_enabled')).length} tone={readiness.route ? 'emerald' : 'amber'} /></div></div>
    </section>
  )
}

function CompanyEmailTemplates({
  company,
  templates,
}: {
  company: GovernanceCompany
  templates: TenantEmailTemplateRow[]
}) {
  const byKey = new Map(templates.map((template) => [template.template_key, template]))

  return (
    <section id="email-templates" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">E-postmallar</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Tenant-anpassade kundutskick</h2>
          <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-700">
            Superadmin sätter bolagets mallar en gång. Kundflöden använder mallarna automatiskt när kund skapas, överflytt startar, ånger/flytt registreras eller annullering skickas.
          </p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
          {templates.filter((template) => template.is_active).length}/{TENANT_EMAIL_TEMPLATE_DEFINITIONS.length} aktiva
        </span>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {TENANT_EMAIL_TEMPLATE_DEFINITIONS.map((definition) => {
          const saved = byKey.get(definition.key)
          return (
            <form key={definition.key} action={saveTenantEmailTemplateAction} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <input type="hidden" name="company_id" value={company.id} />
              <input type="hidden" name="template_key" value={definition.key} />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-black text-slate-950">{definition.label}</h3>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{definition.description}</p>
                </div>
                <label className="flex items-center gap-2 text-xs font-black text-slate-700">
                  <input type="checkbox" name="is_active" defaultChecked={saved?.is_active ?? true} />
                  Aktiv
                </label>
              </div>
              <label className="mt-4 grid gap-1 text-sm">
                <span className="text-xs font-bold text-slate-700">Ämne</span>
                <input name="subject" defaultValue={saved?.subject ?? definition.defaultSubject} className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
              </label>
              <label className="mt-3 grid gap-1 text-sm">
                <span className="text-xs font-bold text-slate-700">Intro</span>
                <textarea name="intro" defaultValue={saved?.intro ?? definition.defaultIntro} rows={2} className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
              </label>
              <label className="mt-3 grid gap-1 text-sm">
                <span className="text-xs font-bold text-slate-700">HTML-brödtext</span>
                <textarea name="body" defaultValue={saved?.body ?? definition.defaultBody} rows={4} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" />
              </label>
              <p className="mt-3 text-xs font-semibold text-slate-600">
                Variabler: {'{{companyName}}'}, {'{{customerName}}'}, {'{{caseTitle}}'}, {'{{caseType}}'}, {'{{nextAction}}'}, {'{{portalUrl}}'}.
              </p>
              <button className="mt-4 rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
                Spara mall
              </button>
            </form>
          )
        })}
      </div>
    </section>
  )
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const admin = await requirePlatformAdminAccess()
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const actionSuccess = firstSearchValue(resolvedSearchParams.success)
  const actionError = firstSearchValue(resolvedSearchParams.error)
  const row = await getCompanyById(id)

  if (!row) {
    return (
      <div className="space-y-6 p-8">
        <Link href="/admin/companies" className="text-sm font-semibold text-emerald-800 hover:text-emerald-900">Tillbaka till bolag</Link>
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">Bolaget hittades inte.</div>
      </div>
    )
  }

  const [company, actorSummary, edielConfig, emailTemplates, operationalStats] = await Promise.all([
    getCompanyGovernanceSummary(row),
    getActorTestingSummary(row.id),
    getCompanyActorConfiguration(row.id),
    listTenantEmailTemplates(row.id),
    getCompanyOperationalStats(row.id),
  ])
  const status = normalizeCompanyStatus(company.status)
  const copy = getCompanyStatusCopy(status)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Bolagsöversikt · ${company.name}`}
        subtitle="Platform-only statistik för drift, volymer och framtida faktureringsunderlag."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <ActionBanner success={actionSuccess} error={actionError} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/companies" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Tillbaka till bolag
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(company)}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{company.org_number ?? 'Orgnummer saknas'}</span>
          </div>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <h2 className="break-words text-2xl font-black text-slate-950">{company.name}</h2>
              <p className="mt-2 break-all text-sm text-slate-600">Tenant ID: {company.id}</p>
              <p className="mt-4 max-w-4xl text-sm font-semibold leading-6 text-slate-700">{copy.description}</p>
              {company.status_reason ? <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">Senaste anledning: {company.status_reason}</p> : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <p><strong>Kontakt:</strong> {company.primary_contact_name ?? '–'}</p>
              <p><strong>E-post:</strong> {company.primary_contact_email ?? '–'}</p>
              <p><strong>Telefon:</strong> {company.phone ?? '–'}</p>
              <p><strong>Webb:</strong> {company.website ?? '–'}</p>
              <p><strong>Skapad:</strong> {formatDate(company.created_at)}</p>
            </div>
          </div>
        </section>

        {actorSummary ? (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Aktörstester</div>
              <h2 className="mt-2 text-xl font-black text-emerald-950">{getActorTestingStatusLabel(actorSummary.actorTestStatus)}</h2>
              <p className="mt-2 text-sm leading-6 text-emerald-800">PRODAT: {actorSummary.prodatPassed}/{actorSummary.prodatTotal} godkända · UTILTS: {actorSummary.utiltsPassed}/{actorSummary.utiltsTotal} godkända.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/admin/platform/actor-testing/${company.id}`} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Öppna tester</Link>
                <Link href={`/admin/platform/actor-testing/${company.id}/evidence`} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Bevispaket</Link>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Produktionssättning</div>
              <h2 className="mt-2 text-xl font-black text-slate-950">{getProductionReadinessLabel(actorSummary.productionReadiness)}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-700">BRP: {actorSummary.company.brp_status ?? '–'} · Routes: {actorSummary.hasProductionRoute ? 'Klara' : 'Saknas'} · Mailbox: {actorSummary.hasVerifiedMailbox ? 'Verifierad' : 'Saknas'}.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/admin/platform/go-live/${company.id}`} className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Öppna go-live checklista</Link>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Aktiva användare" value={company.activeUsers} />
          <StatCard label="Väntande invites" value={company.pendingInvites} />
          <StatCard label="Kunder" value={company.customers} />
          <StatCard label="Avtal" value={company.contracts} />
          <StatCard label="Ediel-meddelanden" value={company.edielMessages} />
          <StatCard label="Mätvärden" value={company.meteringValues} />
          <StatCard label="Faktureringsunderlag" value={company.billingUnderlays} />
          <StatCard label="Partnerexporter" value={company.partnerExports} />
          <StatCard label="Outbound requests" value={company.outboundRequests} />
          <StatCard label="Blockerade underlag" value={company.blockedBillingUnderlays} />
          <StatCard label="Senaste audit" value={formatDate(company.latestAuditAt)} />
          <StatCard label="Senaste Ediel" value={formatDate(company.latestEdielAt)} />
        </section>

        <section id="company-statistics" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Statistik</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Kunder, ärenden och utskick denna månad</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Nya kunder" value={operationalStats.newCustomersThisMonth} />
            <StatCard label="Lämnat/avslutade" value={operationalStats.closedCustomersThisMonth} />
            <StatCard label="Öppna ånger" value={operationalStats.openWithdrawals} />
            <StatCard label="E-post köad" value={operationalStats.queuedEmails} />
            <StatCard label="E-post misslyckad" value={operationalStats.failedEmails} />
            <StatCard label="E-post skickad" value={operationalStats.sentEmailsThisMonth} hint="Denna månad" />
          </div>
        </section>

        <CompanyEdielConfiguration company={company} config={edielConfig} />

        <CompanyEmailTemplates company={company} templates={emailTemplates} />

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-orange-200 bg-orange-50 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-orange-950">Blockerare</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-orange-800">
              {company.missingEdielProfile ? <li>Saknar aktiv Ediel-aktörsprofil.</li> : null}
              {company.blockedBillingUnderlays > 0 ? <li>{company.blockedBillingUnderlays} faktureringsunderlag är inte exportklara.</li> : null}
              {company.deleteBlockers.length > 0 ? <li>Hård radering blockeras av historik.</li> : null}
              {!company.missingEdielProfile && company.blockedBillingUnderlays === 0 && company.deleteBlockers.length === 0 ? <li>Inga kritiska blockerare.</li> : null}
            </ul>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Raderingskontroll</h2>
            {company.canHardDelete ? (
              <p className="mt-3 text-sm leading-6 text-slate-700">Bolaget saknar historiska kopplingar och kan raderas som test-/felregistrering.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                {company.deleteBlockers.map((blocker) => (
                  <li key={blocker.table}>{blocker.label}: <strong>{blocker.count}</strong></li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
