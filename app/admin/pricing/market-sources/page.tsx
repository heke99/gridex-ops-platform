import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { saveMarketSourcePolicyAction, testMarketSourceConnectionAction } from './actions'

export const dynamic = 'force-dynamic'

type Policy = {
  source_key: string
  source_name: string
  status: string
  enabled: boolean
  priority: number
  max_age_minutes: number
  allow_indicative_latest: boolean
  supported_resolutions: string[]
  price_areas: string[]
  forecast_policy: string
  portfolio_policy: string
  last_tested_at: string | null
  last_success_at: string | null
  last_error: string | null
}

export default async function MarketSourcesPage() {
  const admin = await requireAdminPageKeyAccess('pricing.engine')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null

  const [sourcesResult, policiesResult] = companyId
    ? await Promise.all([
        supabase.from('spot_price_sources').select('source_key,source_name,status').order('source_name'),
        supabase.from('company_market_price_sources').select('*').eq('company_id', companyId),
      ])
    : [{ data: [] }, { data: [] }]
  const policies = new Map<string, Record<string, unknown>>(
    ((policiesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.source_key), row]),
  )
  const rows: Policy[] = ((sourcesResult.data ?? []) as Array<Record<string, unknown>>).map((source) => {
    const policy: Record<string, unknown> = policies.get(String(source.source_key)) ?? {}
    return {
      source_key: String(source.source_key),
      source_name: String(source.source_name),
      status: String(source.status),
      enabled: Boolean(policy.enabled ?? false),
      priority: Number(policy.priority ?? 100),
      max_age_minutes: Number(policy.max_age_minutes ?? 180),
      allow_indicative_latest: Boolean(policy.allow_indicative_latest ?? false),
      supported_resolutions: Array.isArray(policy.supported_resolutions) ? policy.supported_resolutions.map(String) : ['monthly', 'hourly', 'quarterly'],
      price_areas: Array.isArray(policy.price_areas) ? policy.price_areas.map(String) : ['SE1', 'SE2', 'SE3', 'SE4'],
      forecast_policy: String(policy.forecast_policy ?? 'latest_available_indication'),
      portfolio_policy: String(policy.portfolio_policy ?? 'require_locked_period_price'),
      last_tested_at: policy.last_tested_at ? String(policy.last_tested_at) : null,
      last_success_at: policy.last_success_at ? String(policy.last_success_at) : null,
      last_error: policy.last_error ? String(policy.last_error) : null,
    }
  })

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Marknadsdatapolicy"
        subtitle="Tenantens källor, prioritet, färskhetskrav, upplösningar och fallback styr OPS canonical quote-motor. Inga providerhemligheter exponeras till externa klienter."
        userEmail={admin.email}
        workspaceName={scope?.companyName}
      />
      <main className="space-y-5 p-8">
        {!companyId ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Välj ett operativt bolag för att konfigurera marknadsdata.</div> : null}
        {rows.map((row) => (
          <section key={row.source_key} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{row.source_name}</h2>
                <p className="mt-1 text-sm text-slate-600">{row.source_key} · providerstatus {row.status}</p>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs font-semibold ${row.last_error ? 'bg-red-100 text-red-800' : row.last_success_at ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                {row.last_error ? 'Senaste test misslyckades' : row.last_success_at ? 'Anslutning verifierad' : 'Inte testad'}
              </div>
            </div>

            <form action={saveMarketSourcePolicyAction} className="mt-5 grid gap-4 lg:grid-cols-3">
              <input type="hidden" name="source_key" value={row.source_key} />
              <label className="rounded-2xl border p-4 text-sm"><input type="checkbox" name="enabled" defaultChecked={row.enabled} className="mr-2" />Aktiv källa</label>
              <label className="text-sm">Prioritet<input name="priority" type="number" min="0" defaultValue={row.priority} className="mt-1 h-11 w-full rounded-xl border px-3" /></label>
              <label className="text-sm">Max dataålder, minuter<input name="max_age_minutes" type="number" min="1" defaultValue={row.max_age_minutes} className="mt-1 h-11 w-full rounded-xl border px-3" /></label>
              <fieldset className="rounded-2xl border p-4 text-sm"><legend className="px-1 font-semibold">Elområden</legend>{['SE1','SE2','SE3','SE4'].map((area) => <label key={area} className="mr-4 inline-flex items-center gap-1"><input type="checkbox" name="price_areas" value={area} defaultChecked={row.price_areas.includes(area)} />{area}</label>)}</fieldset>
              <fieldset className="rounded-2xl border p-4 text-sm"><legend className="px-1 font-semibold">Upplösningar</legend>{['monthly','hourly','quarterly'].map((resolution) => <label key={resolution} className="mr-4 inline-flex items-center gap-1"><input type="checkbox" name="supported_resolutions" value={resolution} defaultChecked={row.supported_resolutions.includes(resolution)} />{resolution}</label>)}</fieldset>
              <label className="rounded-2xl border p-4 text-sm"><input type="checkbox" name="allow_indicative_latest" defaultChecked={row.allow_indicative_latest} className="mr-2" />Tillåt senaste indikativa data som fallback</label>
              <label className="text-sm">Forecast-policy<select name="forecast_policy" defaultValue={row.forecast_policy} className="mt-1 h-11 w-full rounded-xl border bg-white px-3"><option value="latest_available_indication">Senaste tillgängliga indikation</option><option value="require_forecast">Kräv forecast</option><option value="disabled">Ingen framtidsfallback</option></select></label>
              <label className="text-sm">Portfolio-policy<select name="portfolio_policy" defaultValue={row.portfolio_policy} className="mt-1 h-11 w-full rounded-xl border bg-white px-3"><option value="require_locked_period_price">Kräv låst periodpris</option><option value="indicative_until_locked">Indikativt tills periodpris låsts</option><option value="disabled">Portfolioquote avstängd</option></select></label>
              <div className="flex items-end"><button className="h-11 w-full rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white">Spara policy</button></div>
            </form>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4 text-xs text-slate-700">
              <div>Senast testad: {row.last_tested_at ?? '—'} · Senast lyckad: {row.last_success_at ?? '—'}{row.last_error ? ` · Fel: ${row.last_error}` : ''}</div>
              <form action={testMarketSourceConnectionAction}><input type="hidden" name="source_key" value={row.source_key} /><button className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold">Testa anslutning</button></form>
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
