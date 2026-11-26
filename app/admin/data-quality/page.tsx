import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { canOpenCustomerDetail } from '@/lib/admin/accessModel'
import { resolveCustomerCardLookup, type CustomerCardLookupScope } from '@/app/admin/customers/[id]/customer-lookup-outcome'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/validation/uuid'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { supabaseService } from '@/lib/supabase/service'
import { formatStatusLabel } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

type QualityIssueRow = {
  company_id: string | null
  entity_id: string
  customer_id: string | null
  entity_type: string
  issue_key: string
  severity: string
  message: string
}

type WebhookIssueRow = {
  id: string
  company_id: string
  event_type?: string
  status: string
  attempts?: number
  failure_reason?: string | null
  created_at: string
}

type EmailDomainRow = {
  id: string
  company_id: string
  domain: string
  status: string
  spf_status?: string
  dkim_status?: string
  dmarc_status?: string
  failure_reason?: string | null
}

async function readCustomerCardCompanies(scope: CustomerCardLookupScope, issues: QualityIssueRow[]) {
  const candidates = new Set(issues.flatMap(issue =>
    issue.company_id && issue.customer_id && isUuid(issue.customer_id) ? [issue.customer_id] : []))
  const qualified = new Map<string, string>()
  if (candidates.size === 0) return qualified

  try {
    const supabase = await createSupabaseServerClient()
    let query = supabase.from('customers').select('id,company_id,source').in('id', [...candidates])
    if (scope.companyId) query = query.eq('company_id', scope.companyId)
    const { data, error } = await query
    if (error) return qualified
    for (const customer of data ?? []) {
      const target = resolveCustomerCardLookup(scope, customer)
      if (target.kind === 'ok' && candidates.has(customer.id)) qualified.set(customer.id, target.companyId)
    }
  } catch {
    // The issue remains reviewable when the optional customer link cannot be verified.
  }
  return qualified
}

const PAGE_SIZE = 50
const FAILED_TRANSFERS = ['failed', 'dead_letter']
const VERIFIED_DOMAIN = 'verified'
type PageKey = 'customerPage' | 'deliveryPage' | 'domainPage'
type PageParams = Partial<Record<PageKey, string | string[]>>
type CountQuery = PromiseLike<{ count: number | null; error: unknown }>
type RowsQuery<T> = PromiseLike<{ data: T[] | null; error: unknown }>
type PageState = { total: number | null; page: number; lastPage: number }

async function exactCount(query: CountQuery): Promise<number | null> {
  try {
    const { count, error } = await query
    return !error && count !== null && Number.isSafeInteger(count) && count >= 0 ? count : null
  } catch {
    return null
  }
}

async function readPage<T>(
  requested: PageParams[PageKey], countQuery: CountQuery, load: (from: number, to: number) => RowsQuery<T>,
): Promise<PageState & { rows: T[] | null }> {
  const total = await exactCount(countQuery)
  const lastPage = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE))
  const requestedPage = typeof requested === 'string' && /^\d+$/.test(requested) ? Number(requested) : 1
  const page = Number.isSafeInteger(requestedPage) ? Math.min(Math.max(1, requestedPage), lastPage) : 1
  if (total === null) return { total, page, lastPage, rows: null }
  if (total === 0) return { total, page, lastPage, rows: [] }

  const from = (page - 1) * PAGE_SIZE
  const expected = Math.min(PAGE_SIZE, total - from)
  try {
    const { data, error } = await load(from, from + expected - 1)
    // A shorter response can follow a server cap or a change after the count.
    // Do not let the next page silently skip the missing range.
    return { total, page, lastPage, rows: !error && Array.isArray(data) && data.length === expected ? data : null }
  } catch {
    return { total, page, lastPage, rows: null }
  }
}

function PageControls({ state, label, href }: { state: PageState; label: string; href: (page: number) => string }) {
  if (state.total === null || state.total === 0) return null
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-700">
      <span>Sida {state.page} av {state.lastPage} · {state.total} rader</span>
      {state.page > 1 ? <Link prefetch={false} href={href(state.page - 1)} className="font-semibold underline">Föregående</Link> : null}
      {state.page < state.lastPage ? <Link prefetch={false} href={href(state.page + 1)} className="font-semibold underline">Nästa</Link> : null}
    </nav>
  )
}

function ReadUnavailable() {
  return <p role="alert" className="mt-4 text-sm font-semibold text-amber-800">Underlaget kunde inte läsas. Ladda om sidan och försök igen.</p>
}

function StatCard({ label, value, hint, tone = 'slate' }: { label: string; value: number | null; hint: string; tone?: 'slate' | 'amber' | 'red' | 'emerald' }) {
  const styles = {
    slate: 'border-slate-200 bg-white',
    amber: 'border-amber-200 bg-amber-50',
    red: 'border-red-200 bg-red-50',
    emerald: 'border-emerald-200 bg-emerald-50',
  }

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${styles[value === null ? 'slate' : tone]}`}>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value ?? 'Okänt'}</p>
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{value === null ? 'Antalet kunde inte läsas.' : hint}</p>
    </div>
  )
}

function IssueBadge({ severity }: { severity: string }) {
  const className = severity === 'critical'
    ? 'border-red-200 bg-red-50 text-red-800'
    : severity === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-700'

  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${className}`}>{({ critical: 'Kritisk', warning: 'Varning', info: 'Information' } as Record<string, string>)[severity] ?? 'Behöver granskas'}</span>
}

export default async function DataQualityPage({ searchParams }: { searchParams?: Promise<PageParams> } = {}) {
  const admin = await requireAdminPageKeyAccess('operations.integrity')
  const scope = await resolveAdminTenantReadScope(admin)
  const isPlatformAdmin = isPlatformAdminContext(admin)
  const canReadCustomers = isPlatformAdmin || canOpenCustomerDetail(admin.permissions)

  const params = await searchParams
  const companyFilter = scope.companyId ? { company_id: scope.companyId } : {}
  const qualityCount = () => supabaseService.from('customer_data_quality_open_issues')
    .select('entity_id', { count: 'exact', head: true }).match(companyFilter)
  const transferCount = supabaseService.from('webhook_deliveries')
    .select('id', { count: 'exact', head: true }).match(companyFilter).in('status', FAILED_TRANSFERS)
  const domainCount = supabaseService.from('tenant_email_domains')
    .select('id', { count: 'exact', head: true }).match(companyFilter).neq('status', VERIFIED_DOMAIN)

  const [criticalIssues, warningIssues, quality, transfers, domains] = await Promise.all([
    exactCount(qualityCount().eq('severity', 'critical')),
    exactCount(qualityCount().eq('severity', 'warning')),
    readPage<QualityIssueRow>(params?.customerPage, qualityCount(), (from, to) =>
      supabaseService.from('customer_data_quality_open_issues')
        .select('company_id, entity_id, customer_id, entity_type, issue_key, severity, message').match(companyFilter)
        .order('severity').order('company_id').order('entity_type').order('entity_id').order('issue_key').range(from, to)),
    readPage<WebhookIssueRow>(params?.deliveryPage, transferCount, async (from, to) => {
      const table = supabaseService.from('webhook_deliveries')
      const query = isPlatformAdmin
        ? table.select('id, company_id, event_type, status, attempts, failure_reason, created_at')
        : table.select('id, company_id, status, created_at')
      const { data, error } = await query.match(companyFilter).in('status', FAILED_TRANSFERS)
        .order('created_at', { ascending: false }).order('id').range(from, to)
      return { data, error }
    }),
    readPage<EmailDomainRow>(params?.domainPage, domainCount, async (from, to) => {
      const table = supabaseService.from('tenant_email_domains')
      const query = isPlatformAdmin
        ? table.select('id, company_id, domain, status, spf_status, dkim_status, dmarc_status, failure_reason')
        : table.select('id, company_id, domain, status')
      const { data, error } = await query.match(companyFilter).neq('status', VERIFIED_DOMAIN)
        .order('created_at', { ascending: false }).order('id').range(from, to)
      return { data, error }
    }),
  ])
  const qualityIssues = quality.rows ?? []
  const webhookIssues = transfers.rows ?? []
  const emailDomains = domains.rows ?? []

  const customerCardCompanies = canReadCustomers ? await readCustomerCardCompanies(scope, qualityIssues) : new Map<string, string>()

  const pages = { customerPage: quality.page, deliveryPage: transfers.page, domainPage: domains.page }
  const hrefFor = (key: PageKey, page: number, anchor: string) => {
    const query = new URLSearchParams()
    for (const [name, value] of Object.entries({ ...pages, [key]: page })) {
      if (value > 1) query.set(name, String(value))
    }
    return `/admin/data-quality${query.size ? `?${query}` : ''}#${anchor}`
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Datakvalitet"
        subtitle="Felaktiga kundfält, saknade fullmakter, misslyckade överföringar och e-postdomäner som behöver åtgärdas."
        userEmail={admin.email}
        workspaceName={scope.companyName}
        workspaceMode={scope.isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <main className="min-w-0 space-y-6 p-4 lg:p-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Kritiska kundfel" value={criticalIssues} hint="Personnummer, orgnummer eller data som blockerar automation." tone={criticalIssues ? 'red' : 'emerald'} />
          <StatCard label="Varningar" value={warningIssues} hint="Postnummer, e-post eller saknade underlag." tone={warningIssues ? 'amber' : 'emerald'} />
          <StatCard label="Misslyckade överföringar" value={transfers.total} hint="Misslyckade överföringar som behöver följas upp." tone={transfers.total ? 'red' : 'emerald'} />
          <StatCard label="E-postdomäner" value={domains.total} hint="Domäner som inte är verifierade för bolagets avsändare." tone={domains.total ? 'amber' : 'emerald'} />
        </section>

        <section id="kunddata" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-950">Kunddata</h2>
              <p className="mt-1 text-sm font-semibold text-slate-600">Öppna kunden och rätta fältet innan nästa automatiska steg.</p>
            </div>
            <Link href="/admin/operations/integrity" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">
              Kunddataintegritet
            </Link>
          </div>
          {quality.rows === null ? <ReadUnavailable /> : <div role="region" tabIndex={0} aria-label="Kunduppgifter som behöver kontrolleras" className="mt-5 overflow-x-auto rounded-2xl border border-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr><th className="px-4 py-3">Allvarlighetsgrad</th><th className="px-4 py-3">Problem</th><th className="px-4 py-3">Berörd uppgift</th><th className="px-4 py-3">Åtgärd</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {qualityIssues.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">Inga öppna kunddatafel hittades.</td></tr> : null}
                {qualityIssues.map((issue) => (
                  <tr key={`${issue.company_id}:${issue.entity_type}:${issue.entity_id}:${issue.issue_key}`}>
                    <td className="px-4 py-3"><IssueBadge severity={issue.severity} /></td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{issue.message}</td>
                    <td className="px-4 py-3 text-slate-600">{isPlatformAdmin ? `${issue.entity_type} · ${issue.issue_key}` : ({ customer: 'Kunduppgifter', customer_site: 'Anläggning', site: 'Anläggning', metering_point: 'Mätpunkt' } as Record<string, string>)[issue.entity_type] ?? 'Uppgifter att kontrollera'}</td>
                    <td className="px-4 py-3">
                      {issue.customer_id && issue.company_id && customerCardCompanies.get(issue.customer_id) === issue.company_id
                        ? <Link href={`/admin/customers/${encodeURIComponent(issue.customer_id)}`} className="font-black text-emerald-700 hover:text-emerald-900">Öppna kund</Link>
                        : 'Manuell kontroll'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
          <PageControls state={quality} label="Sidor med kunddatafel" href={(page) => hrefFor('customerPage', page, 'kunddata')} />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div id="overforingar" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">Misslyckade överföringar</h2>
            <div className="mt-4 space-y-3">
              {transfers.rows === null ? <ReadUnavailable /> : webhookIssues.length === 0 ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Inga misslyckade överföringar.</p> : null}
              {webhookIssues.map((issue) => (
                <div key={issue.id} className="rounded-2xl border border-red-100 bg-red-50 p-4">
                  <p className="font-black text-red-900">{isPlatformAdmin ? issue.event_type : 'Meddelande till ansluten tjänst'} · {formatStatusLabel(issue.status, 'Status saknas', 'Behöver granskas')}</p>
                  {isPlatformAdmin ? <p className="mt-1 text-sm font-semibold text-red-800">Försök: {issue.attempts}. {issue.failure_reason ?? 'Okänt fel.'}</p> : <p className="mt-1 text-sm text-red-800">Överföringen behöver följas upp av den som ansvarar för anslutningen. Inget nytt utskick görs här.</p>}
                </div>
              ))}
            </div>
            <PageControls state={transfers} label="Sidor med överföringar" href={(page) => hrefFor('deliveryPage', page, 'overforingar')} />
          </div>

          <div id="epostdomaner" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-950">E-postdomäner</h2>
            <div className="mt-4 space-y-3">
              {domains.rows === null ? <ReadUnavailable /> : emailDomains.length === 0 ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Inga overifierade domäner.</p> : null}
              {emailDomains.map((domain) => (
                <div key={domain.id} className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <p className="font-black text-amber-950">{domain.domain} · {formatStatusLabel(domain.status)}</p>
                  {isPlatformAdmin ? <p className="mt-1 text-sm font-semibold text-amber-900">SPF {domain.spf_status}, DKIM {domain.dkim_status}, DMARC {domain.dmarc_status}</p> : <p className="mt-1 text-sm text-amber-900">Avsändardomänen behöver verifieras. Kontakta den som ansvarar för era e-postinställningar.</p>}
                  {isPlatformAdmin && domain.failure_reason ? <p className="mt-1 text-sm text-amber-900">{domain.failure_reason}</p> : null}
                </div>
              ))}
            </div>
            <PageControls state={domains} label="Sidor med e-postdomäner" href={(page) => hrefFor('domainPage', page, 'epostdomaner')} />
          </div>
        </section>
      </main>
    </div>
  )
}
