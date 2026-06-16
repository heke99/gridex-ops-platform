import Link from 'next/link'
import { supabaseService } from '@/lib/supabase/service'
import { INTEGRATION_API_PERMISSION_GROUPS, permissionGroupLabelsForScopes } from '@/lib/integrations/apiClientScopes'
import { deleteTenantPublicContractOfferAction, saveTenantPublicContractOfferAction } from './tenant-platform-actions'
import { updateIntegrationApiClientPermissionsAction, setIntegrationApiClientStatusAction } from '@/app/admin/platform/api-clients/actions'

type PricePlan = {
  id: string
  name: string
  pricing_model: string | null
  status: string | null
}

type PricePlanVersion = {
  id: string
  price_plan_id: string
  version_label: string | null
  status: string | null
  valid_from: string | null
  valid_to: string | null
}


type InternalContractOffer = {
  id: string
  name: string
  status: string | null
  price_version: string | null
  terms_version: string | null
  contract_type: string | null
  is_active: boolean | null
  valid_from: string | null
  valid_to: string | null
  created_at: string
  updated_at: string
}

type PublicOffer = {
  id: string
  offer_code: string | null
  public_name: string
  public_description: string | null
  contract_type: string
  customer_type: string
  price_plan_id: string | null
  price_plan_version_id: string | null
  public_price_text: string | null
  terms_version: string | null
  terms_url: string | null
  legal_bundle_id?: string | null
  price_book_id?: string | null
  publication_status: string
  website_enabled: boolean
  website_cta_enabled: boolean
  is_public: boolean
  is_archived: boolean
  sort_order: number
  spot_weight_percent: number | null
  portfolio_weight_percent: number | null
  fixed_weight_percent: number | null
  readiness_issues: string[] | null
  readiness_status?: string | null
  readiness_blockers?: string[] | null
  created_at: string
  updated_at: string
}

type ApiClient = {
  id: string
  name: string
  status: string
  key_prefix: string
  scopes: string[] | null
  permission_groups?: string[] | null
  allowed_origins: string[] | null
  last_used_at: string | null
  created_at: string
}

type MailReadiness = {
  event_key: string | null
  template_key: string | null
  enabled: boolean | null
  template_name: string | null
  template_active: boolean | null
  can_send: boolean | null
  issues: string[] | null
}

type LegalBundle = {
  id: string
  name: string | null
  status: string | null
  updated_at: string | null
}

type PriceBook = {
  id: string
  name: string | null
  status: string | null
  valid_from: string | null
  valid_to: string | null
  updated_at: string | null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function valueList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function statusLabel(status: string) {
  switch (status) {
    case 'published': return 'Publicerat'
    case 'review': return 'Redo för granskning'
    case 'unpublished': return 'Avpublicerat'
    case 'archived': return 'Arkiverat'
    case 'expired': return 'Utgånget'
    default: return 'Utkast'
  }
}

function contractTypeLabel(value: string) {
  switch (value) {
    case 'spot': return 'Rörligt spotpris'
    case 'variable_monthly': return 'Rörlig månad'
    case 'variable_hourly': return 'Rörlig tim'
    case 'fixed': return 'Fast'
    case 'portfolio': return 'Portfölj'
    case 'mixed': return 'Mix'
    default: return value
  }
}

function badge(tone: 'green' | 'amber' | 'red' | 'slate', label: string) {
  const cls = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone]
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${cls}`}>{label}</span>
}

async function safeRows<T>(table: string, companyId: string, select: string, order = 'created_at'): Promise<T[]> {
  try {
    const { data, error } = await supabaseService
      .from(table)
      .select(select)
      .eq('company_id', companyId)
      .order(order, { ascending: order === 'sort_order' })
      .limit(200)
    if (error) return []
    return (data ?? []) as T[]
  } catch {
    return []
  }
}

export default async function TenantPlatformControls({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [offers, internalContracts, pricePlans, priceVersions, legalBundles, priceBooks, apiClients, mailReadiness] = await Promise.all([
    safeRows<PublicOffer>('public_contract_offers', companyId, 'id,offer_code,public_name,public_description,contract_type,customer_type,price_plan_id,price_plan_version_id,legal_bundle_id,price_book_id,public_price_text,terms_version,terms_url,publication_status,website_enabled,website_cta_enabled,is_public,is_archived,sort_order,spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,readiness_issues,readiness_status,readiness_blockers,created_at,updated_at', 'sort_order'),
    safeRows<InternalContractOffer>('contract_offers', companyId, 'id,name,status,price_version,terms_version,contract_type,is_active,valid_from,valid_to,created_at,updated_at', 'updated_at'),
    safeRows<PricePlan>('price_plans', companyId, 'id,name,pricing_model,status', 'name'),
    safeRows<PricePlanVersion>('price_plan_versions', companyId, 'id,price_plan_id,version_label,status,valid_from,valid_to', 'valid_from'),
    safeRows<LegalBundle>('legal_bundles', companyId, 'id,name,status,updated_at', 'updated_at'),
    safeRows<PriceBook>('price_books', companyId, 'id,name,status,valid_from,valid_to,updated_at', 'updated_at'),
    safeRows<ApiClient>('integration_api_clients', companyId, 'id,name,status,key_prefix,scopes,permission_groups,allowed_origins,last_used_at,created_at', 'created_at'),
    safeRows<MailReadiness>('gridex_tenant_email_dispatch_readiness_v', companyId, 'event_key,template_key,enabled,template_name,template_active,can_send,issues', 'event_key'),
  ])

  const activeOffers = offers.filter((offer) => offer.publication_status === 'published' && offer.website_enabled && !offer.is_archived)
  const internalActiveContracts = internalContracts.filter((contract) => contract.status === 'active' && contract.is_active !== false)
  const activeApiClients = apiClients.filter((client) => client.status === 'active')
  const mailProblems = mailReadiness.filter((row) => row.can_send === false && row.enabled !== false)

  return (
    <section id="tenant-platform-controls" className="space-y-6">
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Bolagets hemsida, avtal och API</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">Avtal, priser, API och automatiska utskick för {companyName}</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-900">
          Den här delen ska användas av platform admin. Interna avtal används för manuell kundhantering i OPS utan API. Hemsideavtal publiceras separat och kräver API-klient när de ska visas på webb eller Mina sidor.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-emerald-200 bg-white p-4"><p className="text-xs font-bold text-emerald-900">Interna aktiva avtal</p><p className="mt-1 text-2xl font-black text-slate-950">{internalActiveContracts.length}</p></div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4"><p className="text-xs font-bold text-emerald-900">Publicerade hemsideavtal</p><p className="mt-1 text-2xl font-black text-slate-950">{activeOffers.length}</p></div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4"><p className="text-xs font-bold text-emerald-900">Aktiva API-klienter</p><p className="mt-1 text-2xl font-black text-slate-950">{activeApiClients.length}</p></div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4"><p className="text-xs font-bold text-emerald-900">Mail att åtgärda</p><p className="mt-1 text-2xl font-black text-slate-950">{mailProblems.length}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
          <a href="#tenant-internal-contracts" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800">Interna avtal</a>
          <a href="#tenant-avtal" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800">Hemsideavtal</a>
          <a href="#tenant-api" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800">API</a>
          <a href="#tenant-mail" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800">Automatiska utskick</a>
          <Link href={`/admin/pricing/price-plans`} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-emerald-800">Priser/prisversioner</Link>
        </div>
      </div>


      <section id="tenant-internal-contracts" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">Interna avtal för kundhantering</h3>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Dessa avtal används när admin lägger in kund manuellt i OPS. De kräver prisversion, juridik och tenant-koppling, men de ska inte blockeras av hemside-API, allowed origins eller publicering på webb.
            </p>
          </div>
          <Link href="/admin/contracts" className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-black text-slate-800 hover:bg-slate-100">Hantera interna avtal</Link>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {internalContracts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Inga interna avtal finns ännu.</div> : null}
          {internalContracts.map((contract) => (
            <article key={contract.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-black text-slate-950">{contract.name}</h4>
                  <p className="mt-1 text-sm text-slate-600">{contractTypeLabel(contract.contract_type ?? 'spot')} · prisversion {contract.price_version ?? 'saknas'} · villkor {contract.terms_version ?? 'saknas'}</p>
                </div>
                {badge(contract.status === 'active' && contract.is_active !== false ? 'green' : contract.status === 'draft' ? 'amber' : 'slate', contract.status === 'active' && contract.is_active !== false ? 'Internt aktivt' : contract.status ?? 'Utkast')}
              </div>
              <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">Giltighet: {contract.valid_from ?? 'start saknas'} – {contract.valid_to ?? 'tills vidare'} · senast ändrad {formatDate(contract.updated_at)}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="tenant-avtal" className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Skapa hemsideavtal för {companyName}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">Publicering blockeras om prisplan, prisversion, villkor, publik pristext eller korrekt mixfördelning saknas. Om juridiskt paket eller prislista saknas försöker systemet skapa dem från publicerade juridiska texter och vald prisversion.</p>
          <div className="mt-3 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-semibold text-slate-700">
            <div>Juridiska paket: <strong>{legalBundles.length}</strong> · Prislistor: <strong>{priceBooks.length}</strong></div>
            <div>För att publicera krävs publicerade juridiska texter för villkor, integritet, ångerrätt, fullmakt och prisvillkor samt en publicerbar prisversion.</div>
          </div>
          <form action={saveTenantPublicContractOfferAction} className="mt-5 grid gap-3">
            <input type="hidden" name="company_id" value={companyId} />
            <input name="offer_code" placeholder="Avtalskod, t.ex. GRIDEX-MIX-70-30-2026" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            <input name="public_name" required placeholder="Publikt avtalsnamn" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            <textarea name="public_description" rows={2} placeholder="Kort beskrivning på hemsidan" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            <textarea name="public_price_text" rows={2} placeholder="Kundvänlig pristext, t.ex. Spotpris + 4 öre/kWh, månadsavgift 59 kr" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            <div className="grid gap-3 md:grid-cols-2">
              <select name="contract_type" defaultValue="spot" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="spot">Rörligt spotpris</option>
                <option value="variable_monthly">Rörlig månad</option>
                <option value="variable_hourly">Rörlig tim</option>
                <option value="fixed">Fast</option>
                <option value="portfolio">Portfölj</option>
                <option value="mixed">Mix rörligt/portfölj</option>
              </select>
              <select name="customer_type" defaultValue="both" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="both">Privat och företag</option>
                <option value="private">Privat</option>
                <option value="business">Företag</option>
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <select name="price_plan_id" required className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="">Välj prisplan</option>
                {pricePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.pricing_model ?? 'modell saknas'} · {plan.status ?? 'status saknas'}</option>)}
              </select>
              <select name="price_plan_version_id" required className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="">Välj prisversion</option>
                {priceVersions.map((version) => {
                  const plan = pricePlans.find((item) => item.id === version.price_plan_id)
                  return <option key={version.id} value={version.id}>{plan?.name ?? 'Prisplan'} · {version.version_label ?? version.id.slice(0, 8)} · {version.status ?? 'status saknas'}</option>
                })}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input name="spot_weight_percent" defaultValue="100" placeholder="% rörligt" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <input name="portfolio_weight_percent" defaultValue="0" placeholder="% portfölj" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <input name="fixed_weight_percent" defaultValue="0" placeholder="% fast" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input name="monthly_fee_sek" placeholder="Månadsavgift kr" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <input name="invoice_fee_sek" placeholder="Fakturaavgift kr" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <input name="spot_markup_ore_per_kwh" placeholder="Påslag öre/kWh" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input name="terms_version" required placeholder="Villkorsversion" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <input name="terms_url" placeholder="Villkorslänk" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <select name="legal_bundle_id" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="">Auto: skapa/använd juridiskt paket</option>
                {legalBundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name ?? bundle.id.slice(0, 8)} · {bundle.status ?? 'status saknas'}</option>)}
              </select>
              <select name="price_book_id" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="">Auto: skapa/använd prislista</option>
                {priceBooks.map((book) => <option key={book.id} value={book.id}>{book.name ?? book.id.slice(0, 8)} · {book.status ?? 'status saknas'} · {book.valid_from ?? 'utan startdatum'}</option>)}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <input name="binding_months" placeholder="Bindning mån" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <input name="notice_months" placeholder="Uppsägning mån" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <input type="date" name="valid_from" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <input type="date" name="valid_to" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <select name="publication_status" defaultValue="draft" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="draft">Utkast</option>
                <option value="review">Redo för granskning</option>
                <option value="published">Publicera</option>
                <option value="unpublished">Avpublicerat</option>
                <option value="archived">Arkiverat</option>
              </select>
              <input name="sort_order" defaultValue="100" placeholder="Sortering" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            </div>
            <label className="flex gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700"><input type="checkbox" name="website_enabled" defaultChecked />Visa på hemsidan</label>
            <label className="flex gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700"><input type="checkbox" name="website_cta_enabled" defaultChecked />Teckna-knapp aktiv</label>
            <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800">Spara avtal</button>
          </form>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-black text-slate-950">Hemsidans publicerade avtal</h3>
          <div className="mt-4 grid gap-3">
            {offers.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Inga hemsideavtal skapade ännu.</div> : null}
            {offers.map((offer) => {
              const issues = valueList(offer.readiness_issues)
              const blockers = valueList(offer.readiness_blockers)
              return (
                <article key={offer.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-black text-slate-950">{offer.public_name}</h4>
                      <p className="mt-1 text-sm text-slate-600">{offer.offer_code ?? 'Avtalskod saknas'} · {contractTypeLabel(offer.contract_type)} · {offer.customer_type}</p>
                      <p className="mt-2 text-sm font-semibold text-slate-700">{offer.public_price_text ?? 'Publik pristext saknas'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {badge(offer.is_public ? 'green' : offer.publication_status === 'draft' ? 'amber' : offer.publication_status === 'archived' ? 'slate' : 'red', statusLabel(offer.publication_status))}
                      {offer.website_enabled ? badge('green', 'Syns på hemsida') : badge('slate', 'Dold från hemsida')}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-3">
                    <div>Rörligt: {offer.spot_weight_percent ?? 0}%</div>
                    <div>Portfölj: {offer.portfolio_weight_percent ?? 0}%</div>
                    <div>Fast: {offer.fixed_weight_percent ?? 0}%</div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-2">
                    <div>Juridiskt paket: {offer.legal_bundle_id ? 'kopplat' : 'auto/ej kopplat'}</div>
                    <div>Prislista: {offer.price_book_id ? 'kopplad' : 'auto/ej kopplad'}</div>
                  </div>
                  {offer.readiness_status ? <div className="mt-3 text-xs font-bold text-slate-600">Readiness: {offer.readiness_status}</div> : null}
                  {issues.length > 0 ? <ul className="mt-3 list-disc rounded-2xl border border-amber-200 bg-amber-50 p-4 pl-8 text-xs font-semibold text-amber-900">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
                  {blockers.length > 0 ? <ul className="mt-3 list-disc rounded-2xl border border-red-200 bg-red-50 p-4 pl-8 text-xs font-semibold text-red-900">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                    <strong className="text-slate-800">Radera säkert:</strong> oanvända avtal kan tas bort. Avtal som redan används i signerad historik arkiveras i stället, så snapshots och kundhistorik inte förstörs.
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-black text-slate-700">Ändra status / publicering</summary>
                    <form action={saveTenantPublicContractOfferAction} className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="id" value={offer.id} />
                      <input type="hidden" name="offer_code" value={offer.offer_code ?? ''} />
                      <input type="hidden" name="public_name" value={offer.public_name} />
                      <input type="hidden" name="public_description" value={offer.public_description ?? ''} />
                      <input type="hidden" name="public_price_text" value={offer.public_price_text ?? ''} />
                      <input type="hidden" name="contract_type" value={offer.contract_type} />
                      <input type="hidden" name="customer_type" value={offer.customer_type} />
                      <input type="hidden" name="price_plan_id" value={offer.price_plan_id ?? ''} />
                      <input type="hidden" name="price_plan_version_id" value={offer.price_plan_version_id ?? ''} />
                      <input type="hidden" name="legal_bundle_id" value={offer.legal_bundle_id ?? ''} />
                      <input type="hidden" name="price_book_id" value={offer.price_book_id ?? ''} />
                      <input type="hidden" name="spot_weight_percent" value={String(offer.spot_weight_percent ?? 100)} />
                      <input type="hidden" name="portfolio_weight_percent" value={String(offer.portfolio_weight_percent ?? 0)} />
                      <input type="hidden" name="fixed_weight_percent" value={String(offer.fixed_weight_percent ?? 0)} />
                      <input type="hidden" name="terms_version" value={offer.terms_version ?? ''} />
                      <input type="hidden" name="terms_url" value={offer.terms_url ?? ''} />
                      <input type="hidden" name="sort_order" value={String(offer.sort_order ?? 100)} />
                      <select name="publication_status" defaultValue={offer.publication_status} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
                        <option value="draft">Utkast</option>
                        <option value="review">Redo för granskning</option>
                        <option value="published">Publicera</option>
                        <option value="unpublished">Avpublicera</option>
                        <option value="archived">Arkivera</option>
                      </select>
                      <label className="flex gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" name="website_enabled" defaultChecked={offer.website_enabled} />Visa på hemsidan</label>
                      <label className="flex gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" name="website_cta_enabled" defaultChecked={offer.website_cta_enabled} />Teckna-knapp aktiv</label>
                      <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800">Spara status</button>
                    </form>
                  </details>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <form action={deleteTenantPublicContractOfferAction}>
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="id" value={offer.id} />
                      <input type="hidden" name="delete_mode" value="archive" />
                      <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Arkivera avtal</button>
                    </form>
                    <form action={deleteTenantPublicContractOfferAction}>
                      <input type="hidden" name="company_id" value={companyId} />
                      <input type="hidden" name="id" value={offer.id} />
                      <input type="hidden" name="delete_mode" value="safe_delete" />
                      <button className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-800 hover:bg-red-100">Ta bort om oanvänt</button>
                    </form>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section id="tenant-api" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">API-klienter och behörigheter</h3>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">API skapas och hanteras via UI. Behörigheter visas i vanliga ord; tekniska scopes ligger bakom “Visa tekniska detaljer”.</p>
          </div>
          <Link href="/admin/platform/api-clients" className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-black text-white">Lägg till API-klient</Link>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {apiClients.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Ingen API-klient finns för bolaget ännu.</div> : null}
          {apiClients.map((client) => {
            const origins = valueList(client.allowed_origins)
            const scopes = valueList(client.scopes)
            return (
              <article key={client.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h4 className="font-black text-slate-950">{client.name}</h4><p className="mt-1 text-xs text-slate-500">prefix {client.key_prefix} · senast använd {formatDate(client.last_used_at)}</p></div>
                  {badge(client.status === 'active' ? 'green' : client.status === 'paused' ? 'amber' : 'red', client.status)}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">{permissionGroupLabelsForScopes(scopes).map((label) => <span key={label} className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-xs font-bold text-emerald-800">{label}</span>)}</div>
                <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer font-black">Visa tekniska detaljer</summary><p className="mt-2 font-mono">{scopes.join(', ') || 'Saknar scopes'}</p><p className="mt-1">Origins: {origins.join(', ') || 'Server-to-server'}</p></details>
                <details className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                  <summary className="cursor-pointer text-xs font-black text-slate-700">Ändra behörigheter för denna klient</summary>
                  <form action={updateIntegrationApiClientPermissionsAction} className="mt-3 grid gap-3">
                    <input type="hidden" name="clientId" value={client.id} />
                    {INTEGRATION_API_PERMISSION_GROUPS.map((group) => <label key={group.groupKey} className="flex gap-2 text-xs"><input type="checkbox" name="permissionGroups" value={group.groupKey} defaultChecked={group.scopes.some((scope) => scopes.includes(scope))} /><span><strong>{group.label}</strong><br />{group.description}</span></label>)}
                    <textarea name="allowedOrigins" rows={3} defaultValue={origins.join('\n')} className="rounded-xl border border-slate-200 px-3 py-2 text-xs" />
                    <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800">Spara API-behörigheter</button>
                  </form>
                </details>
                {client.status === 'active' ? <form action={setIntegrationApiClientStatusAction} className="mt-3"><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="status" value="paused" /><button className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">Pausa klient</button></form> : null}
              </article>
            )
          })}
        </div>
      </section>

      <section id="tenant-mail" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-950">Automatiska utskick och mallkontroll</h3>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">Systemet ska bara skicka mail när rätt bolag, avsändare, kund, avtal, prisversion, mall och kommunikationslogg finns. Supportmallar ingår inte i Ops.</p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600"><tr><th className="px-4 py-3">Händelse</th><th className="px-4 py-3">Mall</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Åtgärd</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {mailReadiness.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">Inga automatiska utskick är konfigurerade ännu.</td></tr> : null}
              {mailReadiness.map((row) => {
                const issues = valueList(row.issues)
                return <tr key={`${row.event_key}-${row.template_key}`}><td className="px-4 py-3 font-semibold text-slate-800">{row.event_key ?? 'Händelse saknas'}</td><td className="px-4 py-3 text-slate-700">{row.template_name ?? row.template_key ?? 'Mall saknas'}</td><td className="px-4 py-3">{row.can_send ? badge('green', 'Kan skickas') : badge(row.enabled === false ? 'slate' : 'red', row.enabled === false ? 'Avstängt' : 'Stoppas')}</td><td className="px-4 py-3 text-xs text-slate-600">{issues.join(', ') || 'Klar'}</td></tr>
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
