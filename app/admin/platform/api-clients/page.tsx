import Link from 'next/link'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import CreateApiClientForm from './CreateApiClientForm'
import {
  deleteIntegrationApiClientAction,
  setIntegrationApiClientStatusAction,
  updateIntegrationApiClientPermissionsAction,
} from './actions'
import {
  INTEGRATION_API_PERMISSION_GROUPS,
  permissionGroupLabelsForScopes,
} from '@/lib/integrations/apiClientScopes'
import {
  WEBSITE_INTEGRATION_BASE_URL,
  WEBSITE_INTEGRATION_OPENAPI_URL,
} from '@/lib/integrations/websiteIntegrationContract'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    companyId?: string
  }>
}

type CompanyOption = {
  id: string
  name: string
  status: string | null
  customer_portal_url: string | null
}

type LaunchBlocker = {
  code?: string
  component?: string
  message?: string
}

type ApiClientRow = {
  id: string
  company_id: string
  name: string
  status: string
  profile_key: string | null
  launch_ready: boolean | null
  launch_blockers: unknown
  key_prefix: string
  scopes: string[] | null
  permission_groups?: string[] | null
  allowed_origins: string[] | null
  allowed_ips: string[] | null
  rate_limit_per_minute: number | null
  last_used_at: string | null
  expires_at: string | null
  created_at: string
  metadata: Record<string, unknown> | null
  companies?: { name?: string | null } | null
}

type WebhookSubscriptionRow = {
  id: string
  api_client_id: string | null
  endpoint_url: string
  event_types: string[] | null
  status: string
  signing_secret_ref: string | null
  last_success_at: string | null
  last_failure_at: string | null
}

type ApiRequestRow = {
  id: string
  company_id: string | null
  api_client_id: string | null
  method: string
  route: string
  status_code: number | null
  duration_ms: number | null
  error_code: string | null
  created_at: string
}

const FRIENDLY_BLOCKERS: Record<string, string> = {
  canonical_readiness_required: 'Go-live-kontrollen måste köras innan klienten kan öppnas.',
  canonical_readiness_revalidation_required: 'Klienten måste revalideras genom go-live-flödet.',
  canonical_readiness_revalidation_pending: 'Konfigurationen har ändrats och måste revalideras.',
  provisioning_preflight_pending: 'Go-live-verifieringen behöver köras klart.',
  provisioning_retry_in_progress: 'Go-live-verifieringen behöver köras klart.',
  api_client_paused: 'API-klienten är pausad.',
  api_client_revoked: 'API-klienten är återkallad och ska ersättas med en ny live-klient.',
  tenant_not_active: 'Bolaget måste vara aktivt innan webbflödet kan sättas live.',
  external_tenant_reference_missing: 'Bolagets externa tenantreferens saknas.',
  api_client_not_active: 'API-klienten är inte aktiv i go-live-flödet.',
  allowed_origin_missing: 'Minst en tillåten HTTPS-webbdomän saknas.',
  website_scopes_missing: 'Behörigheter för webbflödet saknas.',
  customer_portal_scopes_missing: 'Behörigheter för Mina sidor saknas.',
  public_contracts_missing: 'Minst ett publicerat och teckningsbart avtal saknas.',
  legal_terms_missing: 'Publicerade allmänna villkor saknas.',
  privacy_policy_missing: 'Publicerad integritetspolicy saknas.',
  withdrawal_text_missing: 'Publicerad ångerrätt saknas.',
  power_of_attorney_text_missing: 'Publicerad fullmaktstext saknas.',
  price_terms_missing: 'Publicerade prisvillkor saknas.',
  verified_email_sender_missing: 'Verifierad avsändare för kundmail saknas.',
  required_email_templates_missing: 'Obligatoriska kundmailmallar saknas eller är inaktiva.',
  required_email_rules_missing: 'Obligatoriska regler för kundmail saknas eller är inaktiva.',
  automation_user_not_ready: 'Kundautomationens systemanvändare är inte redo.',
  automation_cron_not_ready: 'Kundautomationens cron-konfiguration är inte redo.',
  facility_mailbox_not_ready: 'Verifierad mailbox för anläggningsflödet saknas.',
  customer_portal_url_schema_missing: 'Databasen saknar stöd för canonical Mina sidor-URL.',
  customer_portal_url_missing: 'Bolagets Mina sidor-URL saknas.',
  tenant_website_readiness_schema_missing: 'Databasens readiness-vy saknas.',
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function statusTone(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'paused') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'revoked' || status === 'disabled' || status === 'expired') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-100 text-slate-700'
}

function valueList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function normalizeLaunchBlockers(value: unknown): LaunchBlocker[] {
  if (!Array.isArray(value)) return []
  const blockers: LaunchBlocker[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      blockers.push({ code: entry })
      continue
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    blockers.push({
      code: typeof row.code === 'string' ? row.code : undefined,
      component: typeof row.component === 'string' ? row.component : undefined,
      message: typeof row.message === 'string' ? row.message : undefined,
    })
  }
  return blockers
}

function blockerMessage(blocker: LaunchBlocker) {
  if (blocker.message?.trim()) return blocker.message.trim()
  if (blocker.code && FRIENDLY_BLOCKERS[blocker.code]) return FRIENDLY_BLOCKERS[blocker.code]
  return 'En readiness-kontroll blockerar live. Öppna go-live-flödet för att se och åtgärda orsaken.'
}

function blockerDestination(companyId: string, blocker: LaunchBlocker) {
  const code = blocker.code ?? ''
  const component = blocker.component ?? ''

  if (component === 'contracts' || /contract/.test(code)) {
    return { href: '/admin/contracts', label: 'Gå till avtal' }
  }
  if (component === 'legal' || /legal|privacy|withdrawal|power_of_attorney|price_terms/.test(code)) {
    return { href: '/admin/platform/legal-readiness', label: 'Gå till juridik' }
  }
  if (component === 'facility' || /facility/.test(code)) {
    return { href: '/admin/facility-requests', label: 'Gå till anläggningsflöde' }
  }
  if (component === 'database' || /schema/.test(code)) {
    return { href: '/admin/platform/security', label: 'Gå till plattformsstatus' }
  }
  if (component === 'api' || component === 'portal' || component === 'webhook' || /api_client|origin|scope|portal|webhook|readiness|provision/.test(code)) {
    return {
      href: `/admin/platform/api-clients?companyId=${encodeURIComponent(companyId)}#tenant-go-live`,
      label: 'Öppna go-live',
    }
  }
  return { href: `/admin/companies/${companyId}`, label: 'Öppna bolaget' }
}

function isTenantWebsiteClient(client: ApiClientRow) {
  if (client.profile_key === 'tenant_website') return true
  return valueList(client.scopes).some((scope) => scope.startsWith('customer_portal.') || scope === 'website_applications.write')
}

function goLiveHref(companyId: string) {
  return `/admin/platform/api-clients?companyId=${encodeURIComponent(companyId)}#tenant-go-live`
}

async function loadCompanies(): Promise<CompanyOption[]> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('id,name,status,customer_portal_url')
    .order('name', { ascending: true })
    .limit(500)

  if (error) throw error
  return (data ?? []) as CompanyOption[]
}

async function loadClients(): Promise<ApiClientRow[]> {
  const { data, error } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,name,status,profile_key,launch_ready,launch_blockers,key_prefix,scopes,permission_groups,allowed_origins,allowed_ips,rate_limit_per_minute,last_used_at,expires_at,created_at,metadata,companies(name)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return (data ?? []) as ApiClientRow[]
}

async function loadWebhooks(): Promise<WebhookSubscriptionRow[]> {
  const { data, error } = await supabaseService
    .from('webhook_subscriptions')
    .select('id,api_client_id,endpoint_url,event_types,status,signing_secret_ref,last_success_at,last_failure_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return []
  return (data ?? []) as WebhookSubscriptionRow[]
}

async function loadRecentRequests(): Promise<ApiRequestRow[]> {
  const { data, error } = await supabaseService
    .from('integration_api_requests')
    .select('id,company_id,api_client_id,method,route,status_code,duration_ms,error_code,created_at')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return []
  return (data ?? []) as ApiRequestRow[]
}

export default async function PlatformApiClientsPage({ searchParams }: PageProps) {
  await requirePlatformAdminAccess()
  const params = await searchParams
  const [companies, clients, webhooks, requests] = await Promise.all([
    loadCompanies(),
    loadClients(),
    loadWebhooks(),
    loadRecentRequests(),
  ])

  const selectedCompany = companies.find((company) => company.id === params.companyId)
  const defaultCompanyId = selectedCompany?.id
  const selectedTenantClient = defaultCompanyId
    ? clients.find((client) => client.company_id === defaultCompanyId && isTenantWebsiteClient(client) && client.status !== 'revoked')
    : undefined
  const selectedOrigins = selectedTenantClient
    ? (valueList(selectedTenantClient.allowed_origins).length
        ? valueList(selectedTenantClient.allowed_origins)
        : valueList(selectedTenantClient.metadata?.allowed_origins))
    : []
  const defaultCustomerPortalUrl = selectedCompany?.customer_portal_url ?? ''
  const defaultAllowedOrigins = selectedOrigins.join('\n')

  const webhooksByClient = new Map<string, WebhookSubscriptionRow[]>()
  for (const webhook of webhooks) {
    if (!webhook.api_client_id) continue
    webhooksByClient.set(webhook.api_client_id, [
      ...(webhooksByClient.get(webhook.api_client_id) ?? []),
      webhook,
    ])
  }

  const tenantClients = clients.filter(isTenantWebsiteClient)
  const liveTenantClients = tenantClients.filter((client) => client.status === 'active' && client.launch_ready === true).length
  const blockedTenantClients = tenantClients.filter((client) => !(client.status === 'active' && client.launch_ready === true)).length
  const activeWebhooks = webhooks.filter((webhook) => webhook.status === 'active').length

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="rounded-[36px] border border-emerald-100 bg-white p-8 shadow-sm shadow-emerald-950/5">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Platform · Go-live</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Hemsida och Mina sidor</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Ett bolag sätts live från ett enda flöde. Om något saknas visas blockeraren i klartext med länk till rätt område. Du ska inte behöva aktivera klienter, readiness eller capabilities med separata knappar.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/developers/customer-portal-api" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
              API-dokumentation
            </Link>
            <Link href="/admin/platform/security" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Security guardrails
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
            <p className="text-sm font-medium text-emerald-900">Live</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{liveTenantClients}</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-sm font-medium text-amber-900">Behöver åtgärd</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{blockedTenantClients}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-medium text-slate-700">Aktiva webhooks</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{activeWebhooks}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-medium text-slate-700">Senaste API-anrop</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{requests.length}</p>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <CreateApiClientForm
          key={defaultCompanyId ?? 'new-tenant'}
          companies={companies}
          defaultCompanyId={defaultCompanyId}
          defaultCustomerPortalUrl={defaultCustomerPortalUrl}
          defaultAllowedOrigins={defaultAllowedOrigins}
        />

        <aside className="space-y-5">
          <div className="rounded-[32px] border border-emerald-200 bg-emerald-50 p-6 text-sm leading-6 text-emerald-950">
            <h2 className="text-lg font-semibold text-slate-950">Så fungerar knappen</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>OPS hittar eller skapar rätt primär tenantklient.</li>
              <li>Konfiguration, smoke-test och samtliga readiness-regler körs.</li>
              <li>Finns blockerare öppnas ingen trafik och du får länk till det som saknas.</li>
              <li>När allt är grönt sätts <strong>launch_ready</strong> automatiskt och bolaget är live.</li>
            </ol>
          </div>

          <details className="rounded-[32px] border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-700">
            <summary className="cursor-pointer text-lg font-semibold text-slate-950">Teknisk integrationsinfo</summary>
            <p className="mt-3">API-token ska ligga i servermiljön, aldrig i browsern. Tenantens produktion behöver bara <strong>GRIDEX_API_KEY</strong>.</p>
            <code className="mt-4 block rounded-2xl bg-slate-950 p-4 text-xs text-emerald-100">
              GRIDEX_API_KEY={'<token>'}{'\n'}Authorization: Bearer {'<GRIDEX_API_KEY>'}{'\n'}Base URL: {WEBSITE_INTEGRATION_BASE_URL}
            </code>
            <p className="mt-3 break-all text-xs text-slate-500">{WEBSITE_INTEGRATION_OPENAPI_URL}</p>
          </details>
        </aside>
      </div>

      <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Bolagens integrationsstatus</h2>
          <p className="mt-1 text-sm text-slate-600">Tenanthemsidor hanteras via go-live-flödet ovan. Tekniska säkerhetsåtgärder finns kvar men ligger sekundärt.</p>
        </div>

        <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Bolag / klient</th>
                <th className="px-4 py-3">Behörigheter</th>
                <th className="px-4 py-3">Status & blockerare</th>
                <th className="px-4 py-3">Senast använd</th>
                <th className="px-4 py-3">Åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {clients.map((client) => {
                const metadata = client.metadata ?? {}
                const origins = valueList(client.allowed_origins).length ? valueList(client.allowed_origins) : valueList(metadata.allowed_origins)
                const clientWebhooks = webhooksByClient.get(client.id) ?? []
                const tenantWebsite = isTenantWebsiteClient(client)
                const live = tenantWebsite && client.status === 'active' && client.launch_ready === true
                const launchBlockers = normalizeLaunchBlockers(client.launch_blockers)

                return (
                  <tr key={client.id}>
                    <td className="px-4 py-4 align-top">
                      <div className="font-semibold text-slate-950">{client.companies?.name ?? client.company_id}</div>
                      <div className="mt-1 text-sm text-slate-700">{client.name}</div>
                      <div className="mt-1 text-xs text-slate-500">prefix {client.key_prefix} · skapad {formatDate(client.created_at)}</div>
                      {tenantWebsite ? <span className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">Hemsida · Mina sidor</span> : null}
                    </td>

                    <td className="px-4 py-4 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {permissionGroupLabelsForScopes(valueList(client.scopes)).map((label) => (
                          <span key={label} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">{label}</span>
                        ))}
                        {valueList(client.scopes).length === 0 ? <span className="text-xs text-red-700">Saknar behörigheter</span> : null}
                      </div>

                      <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-700">Avancerat</summary>
                        <div className="mt-3 space-y-3">
                          <div className="text-xs text-slate-500">
                            {origins.length ? origins.map((origin) => <div key={origin}>{origin}</div>) : <div>Inga origins</div>}
                            {clientWebhooks.map((webhook) => <div key={webhook.id}>Webhook: {webhook.endpoint_url}</div>)}
                          </div>
                          <form action={updateIntegrationApiClientPermissionsAction} className="grid gap-3">
                            <input type="hidden" name="clientId" value={client.id} />
                            {INTEGRATION_API_PERMISSION_GROUPS.map((group) => {
                              const active = group.scopes.some((scope) => valueList(client.scopes).includes(scope))
                              return (
                                <label key={group.groupKey} className="flex gap-2 text-xs text-slate-700">
                                  <input type="checkbox" name="permissionGroups" value={group.groupKey} defaultChecked={active} />
                                  <span><strong>{group.label}</strong><br /><span className="text-slate-500">{group.description}</span></span>
                                </label>
                              )
                            })}
                            <textarea name="allowedOrigins" rows={3} defaultValue={origins.join('\n')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs" />
                            <button className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800">Spara avancerat</button>
                          </form>
                        </div>
                      </details>
                    </td>

                    <td className="px-4 py-4 align-top">
                      {tenantWebsite ? (
                        <div className="space-y-3">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${live ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : client.status === 'revoked' || client.status === 'expired' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                            {live ? 'Live' : client.status === 'revoked' ? 'Återkallad' : client.status === 'expired' ? 'Utgången' : 'Inte live'}
                          </span>

                          {!live ? (
                            <div className="grid gap-2">
                              {(launchBlockers.length ? launchBlockers : [{ message: 'Kör go-live-flödet för att verifiera vad som återstår.' }]).slice(0, 4).map((blocker, index) => {
                                const destination = blockerDestination(client.company_id, blocker)
                                return (
                                  <div key={`${blocker.code ?? 'blocker'}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                                    <div>{blockerMessage(blocker)}</div>
                                    <Link href={destination.href} className="mt-1 inline-block font-semibold underline underline-offset-2">{destination.label} →</Link>
                                  </div>
                                )
                              })}
                              {launchBlockers.length > 4 ? <div className="text-xs text-slate-500">+ {launchBlockers.length - 4} ytterligare blockerare visas efter ny go-live-kontroll.</div> : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(client.status)}`}>{client.status}</span>
                      )}
                    </td>

                    <td className="px-4 py-4 align-top text-slate-700">{formatDate(client.last_used_at)}</td>

                    <td className="px-4 py-4 align-top">
                      {tenantWebsite ? (
                        <div className="grid gap-2">
                          {live ? (
                            <form action={setIntegrationApiClientStatusAction}>
                              <input type="hidden" name="clientId" value={client.id} />
                              <input type="hidden" name="status" value="paused" />
                              <button className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Pausa</button>
                            </form>
                          ) : (
                            <Link href={goLiveHref(client.company_id)} className="rounded-xl bg-emerald-700 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-emerald-800">
                              {client.status === 'revoked' || client.status === 'expired' ? 'Skapa ny live-klient' : 'Sätt live / revalidera'}
                            </Link>
                          )}

                          <details className="rounded-xl border border-slate-200 bg-white p-2">
                            <summary className="cursor-pointer text-center text-xs font-semibold text-slate-600">Säkerhetsåtgärder</summary>
                            <div className="mt-2 grid gap-2">
                              {client.status !== 'revoked' ? (
                                <form action={setIntegrationApiClientStatusAction}>
                                  <input type="hidden" name="clientId" value={client.id} />
                                  <input type="hidden" name="status" value="revoked" />
                                  <input type="hidden" name="reason" value="Återkallad från superadmin UI" />
                                  <button className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">Återkalla nyckel</button>
                                </form>
                              ) : null}
                              {client.status === 'revoked' || client.status === 'expired' ? (
                                <form action={deleteIntegrationApiClientAction}>
                                  <input type="hidden" name="clientId" value={client.id} />
                                  <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Radera gammal nyckel</button>
                                </form>
                              ) : null}
                            </div>
                          </details>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {client.status === 'active' ? (
                            <form action={setIntegrationApiClientStatusAction}>
                              <input type="hidden" name="clientId" value={client.id} />
                              <input type="hidden" name="status" value="paused" />
                              <button className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Pausa</button>
                            </form>
                          ) : client.status === 'paused' ? (
                            <form action={setIntegrationApiClientStatusAction}>
                              <input type="hidden" name="clientId" value={client.id} />
                              <input type="hidden" name="status" value="active" />
                              <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">Aktivera</button>
                            </form>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}

              {clients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">Inga API-klienter finns ännu.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <details className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-xl font-semibold tracking-tight text-slate-950">Senaste API-anrop</summary>
        <div className="mt-5 space-y-3">
          {requests.map((request) => (
            <div key={request.id} className="grid gap-3 rounded-2xl border border-slate-200 p-4 text-sm md:grid-cols-[120px_minmax(0,1fr)_120px_120px]">
              <div className="font-semibold text-slate-900">{request.method}</div>
              <div className="truncate font-mono text-xs text-slate-600">{request.route}</div>
              <div className="text-slate-700">{request.status_code ?? '—'}</div>
              <div className="text-slate-500">{formatDate(request.created_at)}</div>
              {request.error_code ? <div className="text-xs text-red-700 md:col-span-4">{request.error_code}</div> : null}
            </div>
          ))}
          {requests.length === 0 ? <div className="text-sm text-slate-500">Inga API-anrop loggade ännu.</div> : null}
        </div>
      </details>
    </main>
  )
}
