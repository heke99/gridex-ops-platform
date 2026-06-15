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
import { CopyButton, CopyDnsRecordsButton } from '@/components/admin/email/CopyButtons'
import { getCompanyEmailSettings, getEffectiveSender, type CompanyEmailSettings } from '@/lib/email/companyEmailSettings'
import { getCompanyDnsRecords, type CompanyEmailDnsRecord } from '@/lib/email/dnsRecords'
import { getEmailEventRules, type EmailEventRule } from '@/lib/email/emailEvents'
import { DEFAULT_EMAIL_TEMPLATES, EMAIL_TEMPLATE_VARIABLES, getCompanyEmailTemplates, type CompanyEmailTemplate } from '@/lib/email/emailTemplates'
import { getCompanyCommunicationLogs, type CommunicationLog } from '@/lib/email/communicationLogs'
import TenantPlatformControls from './TenantPlatformControls'
import { computeTenantReadiness, listWebhookSubscriptions } from '@/lib/admin/websiteIntegrationOps'
import { getTenantWebsiteReadiness, listCompanyLegalTextVersions, REQUIRED_LEGAL_TEXT_TYPES, type LegalTextVersion, type TenantWebsiteReadiness } from '@/lib/opsMaster/readiness'
import { getTenantLegalDefaultStatus, legalTypeLabel, type TenantLegalDefaultStatus } from '@/lib/tenant/legalDefaults'
import { saveCompanyBrpAction, saveCompanyEdielActorAction } from './ediel-actions'
import {
  checkCompanyDomainVerificationAction,
  resetEmailTemplateAction,
  saveCompanyEmailSettingsAction,
  seedDefaultCompanyEmailAction,
  sendCompanyTestEmailAction,
  startCompanyDomainVerificationAction,
  updateEmailEventRuleAction,
  updateEmailTemplateAction,
} from './email-actions'
import { archiveLegalTextVersionAction, createLegalTextVersionAction, publishLegalTextVersionAction, seedDefaultLegalPackageAction } from './legal-actions'

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


type TenantIntakeTracking = {
  total_applications: number
  applications_this_month: number
  pending_applications: number
  completed_applications: number
  applications_requiring_action: number
  grid_owner_resolved: number
  last_application_updated_at: string | null
}

type TenantEventMailReadiness = {
  sender_email: string | null
  sender_name: string | null
  sender_verification_status: string | null
  sender_is_active: boolean | null
  fallback_allowed: boolean | null
  active_templates: number
  enabled_event_rules: number
  can_send_customer_mail: boolean
  blockers: string[] | null
}

async function getTenantIntakeTracking(companyId: string): Promise<TenantIntakeTracking | null> {
  try {
    const { data, error } = await supabaseService
      .from('tenant_customer_intake_tracking_v')
      .select('total_applications,applications_this_month,pending_applications,completed_applications,applications_requiring_action,grid_owner_resolved,last_application_updated_at')
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) return null
    return data as TenantIntakeTracking | null
  } catch {
    return null
  }
}

async function getTenantEventMailReadiness(companyId: string): Promise<TenantEventMailReadiness | null> {
  try {
    const { data, error } = await supabaseService
      .from('tenant_event_mail_readiness_v')
      .select('sender_email,sender_name,sender_verification_status,sender_is_active,fallback_allowed,active_templates,enabled_event_rules,can_send_customer_mail,blockers')
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) return null
    return data as TenantEventMailReadiness | null
  } catch {
    return null
  }
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
    safeCompanyCount('customer_operation_tasks', companyId, [
      { column: 'task_type', value: 'customer_withdrawal_followup' },
      { column: 'status', op: 'in', value: ['open', 'in_progress', 'blocked'] },
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


async function getCompanyApiClients(companyId: string): Promise<Array<{ id: string; name: string; status: string; scopes: string[] | null }>> {
  const { data, error } = await supabaseService
    .from('integration_api_clients')
    .select('id,name,status,scopes')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return []
  return (data ?? []) as Array<{ id: string; name: string; status: string; scopes: string[] | null }>
}

async function getCompanyBillingPartnerCount(companyId: string): Promise<number> {
  const { count, error } = await supabaseService
    .from('billing_partner_customers')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)

  if (error) return 0
  return count ?? 0
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


const LEGAL_TYPE_LABELS: Record<string, string> = {
  terms: 'Allmänna villkor',
  privacy_policy: 'Integritetspolicy',
  withdrawal: 'Ångerrätt',
  power_of_attorney: 'Fullmakt',
  price_terms: 'Prisvillkor',
}

const LEGAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  published: 'Publicerad',
  archived: 'Arkiverad',
}

function LegalStatusBadge({ status }: { status: string }) {
  const tone = status === 'published'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'archived'
      ? 'border-slate-200 bg-slate-50 text-slate-700'
      : 'border-amber-200 bg-amber-50 text-amber-900'
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${tone}`}>{LEGAL_STATUS_LABELS[status] ?? status}</span>
}

function CompanyLegalMasterSection({
  company,
  versions,
  websiteReadiness,
  defaultStatus,
}: {
  company: GovernanceCompany
  versions: LegalTextVersion[]
  websiteReadiness: TenantWebsiteReadiness | null
  defaultStatus: TenantLegalDefaultStatus
}) {
  const missingItems = websiteReadiness?.missing_items ?? []
  const publishedTypes = new Set(versions.filter((row) => row.status === 'published').map((row) => row.type))
  const missingLegalTypes = REQUIRED_LEGAL_TEXT_TYPES.filter((type) => !publishedTypes.has(type))

  return (
    <section id="legal-master" className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">OPS master</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Juridiska texter, fullmakt och hemside-readiness</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-700">
            Platform admin publicerar juridiska versioner per bolag. Publicerade versioner används av hemsidan, kundansökan, Mina sidor och kundkortets godkännanden. Gamla publicerade versioner ska inte ändras bakåt.
          </p>
        </div>
        <div className={`rounded-2xl border px-4 py-3 text-sm font-black ${missingItems.length === 0 && missingLegalTypes.length === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {missingItems.length === 0 && missingLegalTypes.length === 0 ? 'Hemsidan är juridiskt redo' : 'Hemsidan är inte juridiskt redo'}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-black text-emerald-950">Gridex standardjuridik ingår från start</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-emerald-900">
            Alla tenants ska ha Allmänna villkor, Integritetspolicy, Ångerrättsinformation, Prisvillkor och Fullmaktstext. Tenantens egna publicerade texter används först. Om tenant saknar egna texter används Gridex standardpaket så avtal inte fastnar i onödan. Endast platform admin får ändra eller publicera juridiska versioner.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
            {REQUIRED_LEGAL_TEXT_TYPES.map((type) => (
              <span key={type} className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-emerald-900">{legalTypeLabel(type)}</span>
            ))}
          </div>
          <p className="mt-3 text-xs font-bold text-emerald-800">
            Status: {defaultStatus.hasAllRequiredLegalTexts ? 'juridik komplett' : `saknar ${defaultStatus.missingTypes.map(legalTypeLabel).join(', ')}`}
            {defaultStatus.usingGridexDefaults ? ' · använder Gridex standardpaket' : ''}
            {defaultStatus.hasTenantOwnedPublishedTexts ? ' · har tenant-egna publicerade texter' : ''}
          </p>
        </div>
        <form action={seedDefaultLegalPackageAction} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <input type="hidden" name="company_id" value={company.id} />
          <p className="text-sm font-black text-slate-950">Standardpaket</p>
          <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">Koppla/återställ saknade standardtexter från Gridex utan att ändra befintliga tenant-egna publicerade versioner.</p>
          <button className="mt-4 w-full rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Koppla Gridex standardjuridik</button>
        </form>
      </div>

      {missingItems.length > 0 || missingLegalTypes.length > 0 ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-black text-amber-950">Åtgärder innan hemsidan ska visa/ta emot avtal</p>
          <ul className="mt-3 grid gap-2 text-sm font-semibold leading-6 text-amber-950">
            {missingItems.map((item) => <li key={item}>• {item}</li>)}
            {missingLegalTypes.map((type) => <li key={type}>• Publicera {LEGAL_TYPE_LABELS[type]}</li>)}
          </ul>
        </div>
      ) : null}

      <form action={createLegalTextVersionAction} className="grid gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-5 md:grid-cols-2">
        <input type="hidden" name="company_id" value={company.id} />
        <label className="grid gap-1 text-sm font-bold text-slate-800">
          Typ
          <select name="type" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required>
            {REQUIRED_LEGAL_TEXT_TYPES.map((type) => <option key={type} value={type}>{LEGAL_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-800">
          Version
          <input name="version" placeholder="Ex. 2026-06" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required />
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-800 md:col-span-2">
          Rubrik
          <input name="title" placeholder="Ex. Allmänna villkor för elavtal" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required />
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-800 md:col-span-2">
          Text
          <textarea name="body" rows={8} className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <input type="checkbox" name="publish_now" /> Publicera direkt
        </label>
        <div className="md:col-span-2">
          <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Skapa juridisk version</button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-3xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-500">
            <tr><th className="px-4 py-3">Typ</th><th className="px-4 py-3">Version</th><th className="px-4 py-3">Rubrik</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Publicerad</th><th className="px-4 py-3">Åtgärd</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {versions.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center font-semibold text-slate-600">Inga juridiska versioner finns ännu.</td></tr> : null}
            {versions.map((version) => (
              <tr key={version.id}>
                <td className="px-4 py-3 font-bold text-slate-900">{LEGAL_TYPE_LABELS[version.type] ?? version.type}</td>
                <td className="px-4 py-3 text-slate-700">{version.version}</td>
                <td className="px-4 py-3 text-slate-700">{version.title}</td>
                <td className="px-4 py-3"><LegalStatusBadge status={version.status} /></td>
                <td className="px-4 py-3 text-slate-700">{formatDate(version.published_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {version.status !== 'published' ? (
                      <form action={publishLegalTextVersionAction}>
                        <input type="hidden" name="company_id" value={company.id} />
                        <input type="hidden" name="id" value={version.id} />
                        <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-800 hover:bg-emerald-100">Publicera</button>
                      </form>
                    ) : null}
                    {version.status !== 'archived' ? (
                      <form action={archiveLegalTextVersionAction}>
                        <input type="hidden" name="company_id" value={company.id} />
                        <input type="hidden" name="id" value={version.id} />
                        <button className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100">Arkivera</button>
                      </form>
                    ) : null}
                  </div>
                </td>
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
        <h2 className="mt-2 text-2xl font-black text-slate-950">Live-profil: Ediel-identitet, produktion och route-readiness</h2>
        <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-emerald-900">Denna del ska hållas ren för produktion/live. Tester och certifiering ligger separat via knappen på bolagskortet så testdata inte blandas med live-routes.</p>
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

const VERIFICATION_STATUS_LABELS: Record<string, string> = {
  not_started: 'Ej startad',
  pending_dns: 'Väntar på DNS',
  verified: 'Verifierad',
  failed: 'Fel vid verifiering',
  disabled: 'Inaktiv',
}

const DNS_STATUS_LABELS: Record<string, string> = {
  pending: 'Väntar',
  verified: 'Verifierad',
  configured: 'Konfigurerad',
  failed: 'Fel',
}

function isReadyStatus(value: string | null | undefined) {
  return value === 'verified' || value === 'configured' || value === 'ready'
}

function readinessNotes(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

const IMPORTANT_EVENT_LABELS: Array<{ eventKey: string; label: string }> = [
  { eventKey: 'contract.application_received', label: 'Ansökan mottagen' },
  { eventKey: 'switch.started', label: 'Leverantörsbyte startat' },
  { eventKey: 'switch.confirmed', label: 'Leverantörsbyte bekräftat' },
  { eventKey: 'switch.action_required', label: 'Leverantörsbyte kräver åtgärd' },
  { eventKey: 'customer.welcome_active', label: 'Välkommen aktiv kund' },
]

const TEMPLATE_UI_KEYS = [
  'contract.application_received',
  'switch.started',
  'switch.confirmed',
  'switch.action_required',
  'customer.welcome_active',
]

function statusTone(status: string | null | undefined) {
  if (status === 'verified' || status === 'sent' || status === 'delivered') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'failed' || status === 'bounced' || status === 'complained') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'pending_dns' || status === 'queued') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function CompanyEmailSection({
  company,
  settings,
  dnsRecords,
  eventRules,
  templates,
  logs,
  effectiveSender,
}: {
  company: GovernanceCompany
  settings: CompanyEmailSettings | null
  dnsRecords: CompanyEmailDnsRecord[]
  eventRules: EmailEventRule[]
  templates: CompanyEmailTemplate[]
  logs: CommunicationLog[]
  effectiveSender: Awaited<ReturnType<typeof getEffectiveSender>>
}) {
  const rulesByEvent = new Map(eventRules.map((rule) => [rule.event_key, rule]))
  const templatesByKey = new Map(templates.map((template) => [template.template_key, template]))
  const latestDnsCheck = dnsRecords.map((record) => record.last_checked_at).filter(Boolean).sort().at(-1)
  const settingStatus = settings?.verification_status ?? 'not_started'
  const notes = readinessNotes(settings?.readiness_notes)

  return (
    <section id="email" className="space-y-5">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900">E-post</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">E-postinställningar för elbolag</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-emerald-900">
          Aktiv avsändare: {effectiveSender.from}. Reply-to: {effectiveSender.replyTo ?? 'saknas'}. Sender mode: {effectiveSender.mode === 'verified_domain' ? 'Verifierad domän' : 'Fallback via plattformens avsändare'}.
        </p>
        {effectiveSender.sendReady === false ? (
          <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
            {effectiveSender.blocker ?? 'Avsändaren är inte redo för utskick.'}
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 text-sm font-semibold md:grid-cols-4">
          <ActionLine label="From-email" value={settings?.sender_email ?? effectiveSender.senderEmail} tone={effectiveSender.mode === 'verified_domain' ? 'emerald' : 'amber'} />
          <ActionLine label="Domänstatus" value={VERIFICATION_STATUS_LABELS[settingStatus] ?? settingStatus} tone={settingStatus === 'verified' ? 'emerald' : 'amber'} />
          <ActionLine label="DKIM" value={settings?.dkim_status ?? 'ej kontrollerad'} tone={isReadyStatus(settings?.dkim_status) ? 'emerald' : 'slate'} />
          <ActionLine label="SPF/DMARC" value={`${settings?.spf_status ?? 'SPF saknas'} / ${settings?.dmarc_status ?? 'DMARC saknas'}`} tone={isReadyStatus(settings?.spf_status) && isReadyStatus(settings?.dmarc_status) ? 'emerald' : 'slate'} />
        </div>
        <nav className="mt-5 flex flex-wrap gap-2 text-sm font-black">
          {['Avsändare', 'Domänverifiering', 'DNS-poster', 'Testmail', 'Automatiska utskick', 'Mailmallar', 'Senaste utskick'].map((label) => (
            <a key={label} href={`#email-${label.toLowerCase().replaceAll(' ', '-')}`} className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-emerald-900 hover:bg-emerald-100">{label}</a>
          ))}
        </nav>
      </div>

      <section id="email-avsändare" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">1. Avsändare</h3>
        <form action={saveCompanyEmailSettingsAction} className="mt-5 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="company_id" value={company.id} />
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Avsändarnamn</span><input name="sender_name" defaultValue={settings?.sender_name ?? company.name} required className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Avsändarmail</span><input name="sender_email" type="email" defaultValue={settings?.sender_email ?? ''} placeholder="kontakt@bolag.se" className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Reply-to</span><input name="reply_to_email" type="email" defaultValue={settings?.reply_to_email ?? ''} placeholder="kontakt@bolag.se" className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1"><span className="text-xs font-bold text-slate-700">Kontaktmail för kundkommunikation</span><input name="support_email" type="email" defaultValue={settings?.support_email ?? company.primary_contact_email ?? ''} className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <label className="grid gap-1 md:col-span-2"><span className="text-xs font-bold text-slate-700">Domän</span><input name="domain" defaultValue={settings?.domain ?? ''} placeholder="bolag.se" className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
          <div className="md:col-span-2"><button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Spara</button></div>
        </form>
      </section>

      <section id="email-domänverifiering" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">2. Domänverifiering</h3>
        <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-700 md:grid-cols-3">
          <ActionLine label="Provider" value="Resend" />
          <div className={`rounded-2xl border px-4 py-3 ${statusTone(settingStatus)}`}>Status: {VERIFICATION_STATUS_LABELS[settingStatus] ?? settingStatus}</div>
          <ActionLine label="Senast kontrollerad" value={formatDate(settings?.last_verification_checked_at ?? latestDnsCheck)} />
        </div>
        <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
          {settingStatus === 'verified'
            ? 'Domänen är verifierad för sändning. Juridiskt viktiga utskick skickas från bolagets egen avsändare.'
            : 'Domänen är inte verifierad för sändning ännu. Juridiska och kritiska kundmail blockeras tills bolagets domän är verifierad. Icke-kritiska testutskick kan använda plattformens fallback-avsändare om den är konfigurerad och tillåten.'}
        </p>
        {notes.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
            <p className="font-black">Verifieringsnoteringar</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        ) : null}
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
          Kundmail för elhandel hanteras här: ansökan mottagen, leverantörsbyte och välkomstmail. Kundsupport ligger utanför Ops scope och hanteras av elbolaget i egna kanaler.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <form action={startCompanyDomainVerificationAction}><input type="hidden" name="company_id" value={company.id} /><button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Starta verifiering</button></form>
          <form action={checkCompanyDomainVerificationAction}><input type="hidden" name="company_id" value={company.id} /><button className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50">Kontrollera DNS</button></form>
          <form action={seedDefaultCompanyEmailAction}><input type="hidden" name="company_id" value={company.id} /><button className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50">Skapa standardmallar</button></form>
        </div>
      </section>

      <section id="email-dns-poster" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-black text-slate-950">3. DNS-poster</h3>
          <CopyDnsRecordsButton records={dnsRecords.map((record) => ({ type: record.record_type, name: record.name, value: record.value, priority: record.priority }))} />
        </div>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600"><tr><th className="px-4 py-3">Typ</th><th className="px-4 py-3">Namn</th><th className="px-4 py-3">Värde</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Kopiera</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {dnsRecords.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">Inga DNS-poster ännu.</td></tr> : null}
              {dnsRecords.map((record) => (
                <tr key={record.id}><td className="px-4 py-3 font-black text-slate-800">{record.record_type}</td><td className="px-4 py-3 text-slate-700">{record.name}</td><td className="max-w-xl break-all px-4 py-3 font-mono text-xs text-slate-700">{record.value}</td><td className="px-4 py-3">{DNS_STATUS_LABELS[record.status] ?? record.status}</td><td className="px-4 py-3"><CopyButton value={`${record.record_type}\t${record.name}\t${record.value}`} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="email-testmail" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">4. Testmail</h3>
        {effectiveSender.mode === 'fallback' ? <p className="mt-2 text-sm font-semibold text-amber-900">Testmail skickas via plattformens fallback-avsändare eftersom bolagets domän inte är verifierad.</p> : null}
        <form action={sendCompanyTestEmailAction} className="mt-4 flex flex-wrap gap-3">
          <input type="hidden" name="company_id" value={company.id} />
          <input name="to" type="email" required placeholder="namn@exempel.se" className="min-w-72 rounded-2xl border border-slate-300 px-4 py-3" />
          <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Skicka testmail</button>
        </form>
      </section>

      <section id="email-automatiska-utskick" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">5. Automatiska utskick</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {IMPORTANT_EVENT_LABELS.map((item) => {
            const rule = rulesByEvent.get(item.eventKey)
            return (
              <form key={item.eventKey} action={updateEmailEventRuleAction} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <input type="hidden" name="company_id" value={company.id} />
                <input type="hidden" name="event_key" value={item.eventKey} />
                <label className="flex items-center gap-3 text-sm font-black text-slate-800"><input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />{item.label}</label>
                <button className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100">Spara</button>
              </form>
            )
          })}
        </div>
      </section>

      <section id="email-mailmallar" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">6. Mailmallar</h3>
        <p className="mt-2 text-xs font-semibold text-slate-600">Variabler: {EMAIL_TEMPLATE_VARIABLES.map((key) => `{{${key}}}`).join(', ')}</p>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {TEMPLATE_UI_KEYS.map((key) => {
            const fallback = DEFAULT_EMAIL_TEMPLATES.find((template) => template.template_key === key)!
            const template = templatesByKey.get(key)
            return (
              <details key={key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer font-black text-slate-950">{template?.name ?? fallback.name}</summary>
                <form action={updateEmailTemplateAction} className="mt-4 grid gap-3">
                  <input type="hidden" name="company_id" value={company.id} />
                  <input type="hidden" name="template_key" value={key} />
                  <label className="grid gap-1 text-sm"><span className="text-xs font-bold text-slate-700">Ämne</span><input name="subject" defaultValue={template?.subject ?? fallback.subject} className="rounded-2xl border border-slate-300 bg-white px-4 py-3" /></label>
                  <label className="grid gap-1 text-sm"><span className="text-xs font-bold text-slate-700">HTML/text body</span><textarea name="body_html" rows={5} defaultValue={template?.body_html ?? fallback.body_html} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 font-mono text-xs" /></label>
                  <textarea name="body_text" rows={2} defaultValue={template?.body_text ?? fallback.body_text} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-xs" />
                  <label className="flex items-center gap-2 text-xs font-black text-slate-700"><input type="checkbox" name="is_active" defaultChecked={template?.is_active ?? true} />Aktiv</label>
                  <div className="flex flex-wrap gap-2"><button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white">Redigera</button><span className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700">Förhandsgranska</span></div>
                </form>
                <form action={resetEmailTemplateAction} className="mt-2">
                  <input type="hidden" name="company_id" value={company.id} />
                  <input type="hidden" name="template_key" value={key} />
                  <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100">Återställ standardmall</button>
                </form>
              </details>
            )
          })}
        </div>
      </section>

      <section id="email-senaste-utskick" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">7. Senaste utskick</h3>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600"><tr><th className="px-4 py-3">Datum</th><th className="px-4 py-3">Kund</th><th className="px-4 py-3">Typ</th><th className="px-4 py-3">Mottagare</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Felorsak</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-600">Inga utskick loggade ännu.</td></tr> : null}
              {logs.map((log) => <tr key={log.id}><td className="px-4 py-3">{formatDate(log.created_at)}</td><td className="px-4 py-3">{log.customer_number ?? log.customer_id ?? '–'}</td><td className="px-4 py-3">{log.event_key ?? log.template_key ?? '–'}</td><td className="px-4 py-3">{log.recipient_email}</td><td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-black ${statusTone(log.status)}`}>{log.status}</span></td><td className="max-w-sm px-4 py-3 text-xs text-red-700">{log.error_message ?? '–'}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-600">Visa all kommunikation</p>
      </section>
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

  const [
    company,
    actorSummary,
    edielConfig,
    operationalStats,
    companyEmailSettings,
    companyDnsRecords,
    companyEmailEventRules,
    companyEmailTemplates,
    companyCommunicationLogs,
    effectiveSender,
    companyApiClients,
    companyWebhookSubscriptions,
    billingPartnerCount,
    legalTextVersions,
    tenantWebsiteReadiness,
    tenantLegalDefaultStatus,
    tenantIntakeTracking,
    tenantEventMailReadiness,
  ] = await Promise.all([
    getCompanyGovernanceSummary(row),
    getActorTestingSummary(row.id),
    getCompanyActorConfiguration(row.id),
    getCompanyOperationalStats(row.id),
    getCompanyEmailSettings(row.id),
    getCompanyDnsRecords(row.id),
    getEmailEventRules(row.id),
    getCompanyEmailTemplates(row.id),
    getCompanyCommunicationLogs(row.id, { limit: 12 }),
    getEffectiveSender(row.id),
    getCompanyApiClients(row.id),
    listWebhookSubscriptions({ companyId: row.id, limit: 50 }),
    getCompanyBillingPartnerCount(row.id),
    listCompanyLegalTextVersions(row.id),
    getTenantWebsiteReadiness(row.id),
    getTenantLegalDefaultStatus(row.id),
    getTenantIntakeTracking(row.id),
    getTenantEventMailReadiness(row.id),
  ])
  const status = normalizeCompanyStatus(company.status)
  const copy = getCompanyStatusCopy(status)
  const tenantReadiness = computeTenantReadiness({
    apiClients: companyApiClients,
    webhooks: companyWebhookSubscriptions,
    emailSettings: companyEmailSettings,
    dnsRecords: companyDnsRecords,
    templates: companyEmailTemplates,
    eventRules: companyEmailEventRules,
    effectiveSender,
    billingPartnerCount,
  })

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
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/companies" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Tillbaka till bolag
            </Link>
            <Link href={`/admin/platform/companies/${company.id}/testing`} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800 hover:bg-emerald-100">
              Tester & certifiering
            </Link>
            <Link href={`/admin/platform/go-live/${company.id}`} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">
              Go-live
            </Link>
          </div>
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
                <Link href={`/admin/platform/companies/${company.id}/testing`} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Tester & certifiering</Link>
                <Link href={`/admin/platform/actor-testing/${company.id}`} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Aktörstester</Link>
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
          <h2 className="mt-2 text-xl font-black text-slate-950">Kunder, driftuppgifter och utskick denna månad</h2>
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

        <TenantPlatformControls companyId={company.id} companyName={company.name} />

        <section id="tenant-intake-tracking" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Kundintag</p>
              <h2 className="mt-2 text-xl font-black text-slate-950">Ansökningar, automatisk pipeline och tenant-spårning</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">Kedjan ska vara spårbar per tenant: ansökan → kund → avtal/prisversion → juridik/fullmakt → nätägare → Ediel-readiness → mail. Mismatch ska bli åtgärd, inte krasch eller felaktigt EDIFACT.</p>
            </div>
            <Link href={`/admin/external-contract-intakes?company_id=${company.id}`} className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-black text-white">Öppna ansökningar</Link>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Totalt" value={tenantIntakeTracking?.total_applications ?? 0} />
            <StatCard label="Denna månad" value={tenantIntakeTracking?.applications_this_month ?? 0} />
            <StatCard label="Pågående" value={tenantIntakeTracking?.pending_applications ?? 0} />
            <StatCard label="Klara" value={tenantIntakeTracking?.completed_applications ?? 0} />
            <StatCard label="Kräver åtgärd" value={tenantIntakeTracking?.applications_requiring_action ?? 0} />
            <StatCard label="Nätägare löst" value={tenantIntakeTracking?.grid_owner_resolved ?? 0} />
          </div>
          <p className="mt-4 text-xs font-bold text-slate-600">Senast uppdaterad: {formatDate(tenantIntakeTracking?.last_application_updated_at)}</p>
        </section>

        <section id="tenant-event-mail-readiness" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Eventmail</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Automatiska mail från tenantens registrerade avsändare</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">Systemet ska bara skicka kundmail när avsändare, domän/fallback, mall, eventregel, kund och avtalssnapshot är redo. Annars skapas adminåtgärd och utskicket stoppas.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ReadinessPill ok={tenantEventMailReadiness?.can_send_customer_mail ?? false} label="Kan skicka kundmail" />
            <ReadinessPill ok={(tenantEventMailReadiness?.active_templates ?? 0) > 0} label="Aktiva mallar" />
            <ReadinessPill ok={(tenantEventMailReadiness?.enabled_event_rules ?? 0) > 0} label="Eventregler" />
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            <p>Avsändare: {tenantEventMailReadiness?.sender_name ?? company.name} &lt;{tenantEventMailReadiness?.sender_email ?? 'saknas'}&gt;</p>
            <p>Status: {tenantEventMailReadiness?.sender_verification_status ?? 'saknas'} · fallback {tenantEventMailReadiness?.fallback_allowed ? 'tillåten' : 'ej tillåten'}</p>
            {(tenantEventMailReadiness?.blockers ?? []).length > 0 ? <p className="mt-2 text-red-700">Blockerare: {(tenantEventMailReadiness?.blockers ?? []).join(', ')}</p> : <p className="mt-2 text-emerald-800">Mail-readiness ser klar ut.</p>}
          </div>
        </section>


        <CompanyLegalMasterSection company={company} versions={legalTextVersions} websiteReadiness={tenantWebsiteReadiness} defaultStatus={tenantLegalDefaultStatus} />

        <section id="tenant-website-readiness" className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Website readiness</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Redo för hemsidekunder, webhooks och juridiska mail</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-900">
            Kontrollera att bolagets API-client, webhook, avsändardomän, mailmallar och billing-mapping är redo innan extern hemsida kopplas på.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ReadinessPill ok={tenantReadiness.websiteApi} label="Website API" />
            <ReadinessPill ok={tenantReadiness.apiClient} label="API-client" />
            <ReadinessPill ok={tenantReadiness.webhook} label="Webhook" />
            <ReadinessPill ok={tenantReadiness.emailSender} label="Email sender" />
            <ReadinessPill ok={tenantReadiness.domainVerification} label="Domänverifiering" />
            <ReadinessPill ok={tenantReadiness.templates} label="Mallar" />
            <ReadinessPill ok={tenantReadiness.billingMapping} label="Capway/billing" />
          </div>
          {tenantReadiness.notes.length > 0 ? (
            <ul className="mt-4 grid gap-2 text-sm font-semibold text-emerald-950 md:grid-cols-2">
              {tenantReadiness.notes.map((note) => <li key={note} className="rounded-2xl border border-emerald-200 bg-white/70 px-4 py-3">{note}</li>)}
            </ul>
          ) : (
            <p className="mt-4 rounded-2xl border border-emerald-200 bg-white/70 px-4 py-3 text-sm font-semibold text-emerald-900">Bolaget ser redo ut för website onboarding.</p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/admin/platform/api-clients" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-black text-emerald-800 hover:bg-emerald-100">API-clients och webhooks</Link>
            <Link href="/admin/website-applications" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-black text-emerald-800 hover:bg-emerald-100">Website applications</Link>
            <Link href="/admin/webhooks/deliveries" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2 text-sm font-black text-emerald-800 hover:bg-emerald-100">Webhook-loggar</Link>
          </div>
        </section>

        <CompanyEmailSection
          company={company}
          settings={companyEmailSettings}
          dnsRecords={companyDnsRecords}
          eventRules={companyEmailEventRules}
          templates={companyEmailTemplates}
          logs={companyCommunicationLogs}
          effectiveSender={effectiveSender}
        />

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
