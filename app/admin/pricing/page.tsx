import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import {
  evaluatePricingReadiness,
  listContractOffersForPricing,
  listPricingComponentRules,
} from '@/lib/billing/pricingEngine'
import { createPricingComponentRuleAction } from './actions'

export const dynamic = 'force-dynamic'

function componentTone(type: string) {
  if (type === 'fixed_monthly_fee') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['spot_markup', 'fixed_markup', 'variable_fee'].includes(type)) return 'border-sky-200 bg-sky-50 text-sky-800'
  if (['green_electricity_fee', 'el_certificate'].includes(type)) return 'border-lime-200 bg-lime-50 text-lime-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default async function PricingPage() {
  const admin = await requireAdminPageKeyAccess('pricing.engine')
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null
  const [offers, rules] = companyId
    ? await Promise.all([listContractOffersForPricing(companyId), listPricingComponentRules(companyId)])
    : [[], []]
  const readinessIssues = evaluatePricingReadiness({ offers, rules })
  const activeRules = rules.filter((rule) => rule.is_active)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Prismotor"
        subtitle="Styr fasta avgifter, påslag, elcertifikat, grön el och kund-/avtalsspecifika komponenter som ska användas i faktureringsunderlaget."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-700">Avtalsmallar</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{offers.length}</div>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-emerald-800">Aktiva komponenter</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{activeRules.length}</div>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-amber-900">Varningar</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{readinessIssues.filter((issue) => issue.severity === 'warning').length}</div>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-red-800">Blockerare</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{readinessIssues.filter((issue) => issue.severity === 'blocked').length}</div>
          </div>
        </section>

        {readinessIssues.length > 0 ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Prismotor readiness</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {readinessIssues.map((issue) => (
                <div key={issue.code} className="rounded-2xl border border-amber-200 bg-white p-4 text-sm text-amber-900">
                  <div className="font-semibold text-slate-950">{issue.severity === 'blocked' ? 'Blockerare' : 'Varning'}</div>
                  <div className="mt-1">{issue.label}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <form action={createPricingComponentRuleAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Ny komponent</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Lägg till avgift eller påslag</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Komponenter kan gälla alla avtal, en avtalsmall, kund, anläggning eller kampanj. Faktureringen ska validera komponenterna innan export.</p>
            <div className="mt-5 grid gap-4">
              <select name="contract_offer_id" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="">Gäller alla avtalsmallar</option>
                {offers.map((offer) => (
                  <option key={offer.id} value={offer.id}>{offer.name}</option>
                ))}
              </select>
              <input name="component_label" required placeholder="Namn, t.ex. Fast månadsavgift 49 kr" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <input name="component_code" required placeholder="Kod, t.ex. monthly_fee_49" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <select name="component_type" defaultValue="fixed_monthly_fee" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="fixed_monthly_fee">Fast månadsavgift</option>
                <option value="spot_markup">Spotpåslag</option>
                <option value="fixed_markup">Fast påslag</option>
                <option value="fixed_price">Fast pris</option>
                <option value="variable_fee">Rörlig avgift</option>
                <option value="green_electricity_fee">Grön el-avgift</option>
                <option value="el_certificate">Elcertifikat</option>
                <option value="custom_addon">Kundanpassad tilläggsavgift</option>
                <option value="campaign_discount">Kampanjrabatt</option>
                <option value="start_fee">Startavgift</option>
                <option value="admin_fee">Administrativ avgift</option>
                <option value="break_fee">Brytavgift</option>
              </select>
              <div className="grid gap-3 md:grid-cols-2">
                <input name="value_amount" placeholder="Värde" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
                <select name="calculation_unit" defaultValue="sek_month" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                  <option value="sek_month">kr/mån</option>
                  <option value="ore_per_kwh">öre/kWh</option>
                  <option value="percent_of_spot">% av spot</option>
                  <option value="sek_once">engångsbelopp</option>
                </select>
              </div>
              <select name="applies_to" defaultValue="contract" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="contract">Avtal</option>
                <option value="customer">Kund</option>
                <option value="site">Anläggning</option>
                <option value="campaign">Kampanj</option>
              </select>
              <div className="grid gap-3 md:grid-cols-2">
                <input name="valid_from" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
                <input name="valid_to" type="date" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              </div>
              <input name="priority" placeholder="Prioritet, t.ex. 100" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <textarea name="note" rows={3} placeholder="Intern notering" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Spara komponent</button>
            </div>
          </form>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">Aktiva prisregler</h2>
              <p className="mt-1 text-sm text-slate-700">Reglerna används som underlag för validering och framtida faktureringsberäkning.</p>
            </div>
            <div className="grid gap-4 p-6 lg:grid-cols-2">
              {rules.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-600 lg:col-span-2">Inga prismotorkomponenter finns ännu.</div>
              ) : rules.map((rule) => (
                <article key={rule.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${componentTone(rule.component_type)}`}>{rule.component_type}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${rule.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{rule.is_active ? 'Aktiv' : 'Inaktiv'}</span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-slate-950">{rule.component_label}</h3>
                  <div className="mt-2 grid gap-1 text-xs text-slate-600">
                    <div>Kod: <span className="font-medium text-slate-900">{rule.component_code}</span></div>
                    <div>Värde: <span className="font-medium text-slate-900">{rule.value_amount ?? '—'} {rule.calculation_unit}</span></div>
                    <div>Gäller: <span className="font-medium text-slate-900">{rule.applies_to}</span></div>
                    <div>Giltig: <span className="font-medium text-slate-900">{rule.valid_from ?? 'nu'} → {rule.valid_to ?? 'tills vidare'}</span></div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
