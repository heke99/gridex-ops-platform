import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerCaseStatusLabel,
  customerCaseTypeLabel,
  listCustomerCases,
} from '@/lib/customer-cases/db'
import { createCustomerCaseAction, updateCustomerCaseStatusAction } from './actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    status?: string
    type?: string
    q?: string
    customer?: string
  }>
}

const emptyState = { ok: false, message: '' }

async function createCaseFormAction(formData: FormData) {
  'use server'
  await createCustomerCaseAction(emptyState, formData)
}

async function updateCaseFormAction(formData: FormData) {
  'use server'
  await updateCustomerCaseStatusAction(emptyState, formData)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function toneForStatus(status: string | null | undefined) {
  if (status === 'resolved' || status === 'closed') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'billing_blocked' || status === 'manual_follow_up' || status === 'action_required') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'awaiting_external_response') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function toneForScenario(scenario: string | null | undefined) {
  if (scenario === 'before_prodat_sent') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (scenario === 'after_prodat_before_start') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (scenario === 'cannot_stop_switch') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function scenarioLabel(scenario: string | null | undefined) {
  if (scenario === 'before_prodat_sent') return 'Före PRODAT'
  if (scenario === 'after_prodat_before_start') return 'Annullering krävs'
  if (scenario === 'cannot_stop_switch') return 'Kan ej stoppas automatiskt'
  if (scenario === 'not_withdrawal') return 'Ej ånger'
  return 'Ej bedömd'
}

async function listCustomerOptions(companyId: string | null) {
  let query = supabaseService
    .from('customers')
    .select('id, company_id, full_name, first_name, last_name, company_name, email, customer_number')
    .order('created_at', { ascending: false })
    .limit(150)

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((row) => {
    const personName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
    const name = row.full_name ?? (personName || row.company_name || row.email || 'Kund')
    return { id: String(row.id), label: `${name}${row.customer_number ? ` · ${row.customer_number}` : ''}` }
  })
}

export default async function CustomerCasesPage({ searchParams }: PageProps) {
  const context = await requireAdminPageKeyAccess('customer.cases')
  const scope = await resolveAdminTenantReadScope(context)
  const params = await searchParams
  const status = params.status ?? 'all'
  const type = params.type ?? 'all'
  const query = params.q ?? ''
  const selectedCustomer = params.customer ?? null

  const [cases, customerOptions] = await Promise.all([
    listCustomerCases({
      companyId: scope.companyId,
      customerId: selectedCustomer,
      status,
      type,
      query,
      limit: 250,
    }),
    listCustomerOptions(scope.companyId),
  ])

  const openCount = cases.filter((row) => !['resolved', 'closed', 'cancelled'].includes(row.status)).length
  const withdrawalCount = cases.filter((row) => row.case_type === 'withdrawal').length
  const billingBlockedCount = cases.filter((row) => row.billing_blocked).length
  const cancellationRequiredCount = cases.filter((row) => row.cancellation_required).length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Kundärenden"
        subtitle={scope.isPlatformAdmin ? 'Global vy för ånger, nekade kunder och avbrutna flöden.' : `Ånger, nekade kunder och blockerare för ${scope.companyName ?? 'ditt bolag'}.`}
        userEmail={context.email}
        workspaceName={scope.isPlatformAdmin ? 'Gridex Platform' : scope.companyName}
        workspaceMode={scope.isPlatformAdmin ? 'platform' : 'tenant'}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Öppna ärenden</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{openCount}</p>
            <p className="mt-2 text-sm text-slate-700">Kräver uppföljning eller beslut.</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-amber-800">Ångerärenden</p>
            <p className="mt-2 text-3xl font-semibold text-amber-950">{withdrawalCount}</p>
            <p className="mt-2 text-sm text-amber-900">Räknar ångerfrist och stoppläge.</p>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-red-800">Fakturering blockerad</p>
            <p className="mt-2 text-3xl font-semibold text-red-950">{billingBlockedCount}</p>
            <p className="mt-2 text-sm text-red-900">Får inte exporteras utan kontroll.</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Annullering krävs</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{cancellationRequiredCount}</p>
            <p className="mt-2 text-sm text-slate-700">Kopplas till Ediel-utkast och kvittenser.</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Skapa kundärende</h2>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Använd detta för ånger, nekad kund, avbruten onboarding, felaktiga uppgifter, saknad fullmakt eller tekniska blockerare. Kunden eller avtalet raderas inte; systemet stoppar rätt flöden och behåller historiken.
              </p>
            </div>
          </div>

          <form action={createCaseFormAction} className="mt-5 grid gap-4 xl:grid-cols-4">
            <label className="grid gap-2 text-sm xl:col-span-2">
              <span className="font-medium text-slate-700">Kund</span>
              <select name="customer_id" defaultValue={selectedCustomer ?? ''} required className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <option value="">Välj kund</option>
                {customerOptions.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.label}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Typ</span>
              <select name="case_type" defaultValue="withdrawal" className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <option value="withdrawal">Ånger</option>
                <option value="rejected_customer">Nekad kund</option>
                <option value="onboarding_aborted">Avbruten onboarding</option>
                <option value="supplier_switch_aborted">Avbrutet leverantörsbyte</option>
                <option value="sales_misunderstanding">Missförstått säljare</option>
                <option value="dual_invoice_concern">Kunden vill inte ha två fakturor</option>
                <option value="binding_period_too_long">För lång bindningstid</option>
                <option value="incorrect_identity">Fel personuppgifter</option>
                <option value="incorrect_site_data">Fel anläggningsuppgifter</option>
                <option value="missing_authorization">Saknad fullmakt</option>
                <option value="credit_risk">Kredit-/riskorsak</option>
                <option value="technical_blocker">Teknisk blockerare</option>
                <option value="other">Annan orsak</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Prioritet</span>
              <select name="priority" defaultValue="normal" className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <option value="low">Låg</option>
                <option value="normal">Normal</option>
                <option value="high">Hög</option>
                <option value="urgent">Akut</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm xl:col-span-2">
              <span className="font-medium text-slate-700">Rubrik</span>
              <input name="title" placeholder="Ex. Kunden ångrar avtal innan leveransstart" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Avtal skapat/signat</span>
              <input name="agreement_created_at" type="datetime-local" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Ångerinfo skickad</span>
              <input name="withdrawal_information_sent_at" type="datetime-local" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Ånger mottagen</span>
              <input name="withdrawal_requested_at" type="datetime-local" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Leveransstart</span>
              <input name="delivery_start_at" type="datetime-local" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-700">Avtalskanal</span>
              <select name="agreement_channel" defaultValue="phone" className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
                <option value="phone">Telefon</option>
                <option value="web">Webb</option>
                <option value="email">E-post</option>
                <option value="field_sales">Fältförsäljning</option>
                <option value="office">Kontor</option>
                <option value="other">Annat</option>
              </select>
            </label>

            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <input name="is_distance_agreement" type="checkbox" defaultChecked className="h-4 w-4" />
              <span className="font-medium text-slate-700">Distansavtal / ångerfrist ska räknas</span>
            </label>

            <label className="grid gap-2 text-sm xl:col-span-4">
              <span className="font-medium text-slate-700">Beskrivning och beslut</span>
              <textarea name="description" rows={3} placeholder="Beskriv vad kunden sagt, orsak, säljarens uppgifter och vad som behöver stoppas." className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
            </label>

            <label className="grid gap-2 text-sm xl:col-span-3">
              <span className="font-medium text-slate-700">Nästa steg</span>
              <input name="next_action" placeholder="Ex. Kontakta kund, invänta APERAK, kontrollera brytkostnad" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
            </label>

            <div className="flex items-end">
              <button className="w-full rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
                Skapa ärende
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Ärendelista</h2>
            <p className="mt-1 text-sm text-slate-700">Filter visar aktuellt scope. Tenant-användare ser bara sina egna bolagsärenden.</p>
            <form className="mt-4 grid gap-3 lg:grid-cols-[1fr_180px_220px_140px]">
              <input name="q" defaultValue={query} placeholder="Sök rubrik, beskrivning eller orsak" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
              <select name="status" defaultValue={status} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="all">Alla statusar</option>
                <option value="open">Öppen</option>
                <option value="action_required">Kräver åtgärd</option>
                <option value="awaiting_external_response">Väntar externt svar</option>
                <option value="billing_blocked">Fakturering blockerad</option>
                <option value="manual_follow_up">Manuell uppföljning</option>
                <option value="resolved">Löst</option>
                <option value="closed">Stängd</option>
              </select>
              <select name="type" defaultValue={type} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
                <option value="all">Alla typer</option>
                <option value="withdrawal">Ånger</option>
                <option value="rejected_customer">Nekad kund</option>
                <option value="onboarding_aborted">Avbruten onboarding</option>
                <option value="supplier_switch_aborted">Avbrutet leverantörsbyte</option>
                <option value="technical_blocker">Teknisk blockerare</option>
                <option value="other">Annan orsak</option>
              </select>
              <button className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold hover:bg-slate-50">Filtrera</button>
            </form>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Ärende</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Kund</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Status</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Ånger/annullering</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Nästa steg</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-700">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {cases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-700">
                      Inga kundärenden hittades för filtret. Skapa ett ärende ovan när en kund ångrar sig, nekas eller när onboarding måste stoppas utan att historiken raderas.
                    </td>
                  </tr>
                ) : cases.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-950">{row.title}</div>
                      <div className="mt-1 text-xs text-slate-700">{customerCaseTypeLabel(row.case_type)} · {formatDate(row.created_at)}</div>
                      {row.description ? <div className="mt-2 max-w-md text-sm text-slate-700">{row.description}</div> : null}
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/admin/customers/${row.customer_id}#cases`} className="font-semibold text-emerald-800 hover:underline">
                        {row.customer_name ?? row.customer_email ?? row.customer_id}
                      </Link>
                      <div className="mt-1 text-xs text-slate-700">{row.customer_number ?? row.customer_email ?? '—'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${toneForStatus(row.status)}`}>
                        {customerCaseStatusLabel(row.status)}
                      </span>
                      {row.billing_blocked ? <div className="mt-2 text-xs font-semibold text-red-700">Fakturering blockerad</div> : null}
                      {row.break_fee_flagged ? <div className="mt-1 text-xs font-semibold text-amber-700">Brytkostnad kräver kontroll</div> : null}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${toneForScenario(row.withdrawal_scenario)}`}>
                        {scenarioLabel(row.withdrawal_scenario)}
                      </span>
                      <div className="mt-2 text-xs text-slate-700">Sista ångerdag: {formatDate(row.withdrawal_deadline_at)}</div>
                      <div className="mt-1 text-xs text-slate-700">Annullering: {row.cancellation_status}</div>
                      {row.cancellation_ediel_message_id ? (
                        <Link href={`/admin/ediel/messages/${row.cancellation_ediel_message_id}`} className="mt-1 block text-xs font-semibold text-emerald-800 hover:underline">
                          Öppna annulleringsutkast
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 text-slate-700">
                      {row.next_action ?? 'Följ upp ärendet och dokumentera beslut.'}
                    </td>
                    <td className="px-6 py-4">
                      <form action={updateCaseFormAction} className="grid gap-2">
                        <input type="hidden" name="case_id" value={row.id} />
                        <input type="hidden" name="company_id" value={row.company_id} />
                        <input type="hidden" name="customer_id" value={row.customer_id} />
                        <select name="status" defaultValue={row.status} className="rounded-xl border border-slate-300 px-3 py-2 text-xs">
                          <option value="open">Öppen</option>
                          <option value="action_required">Kräver åtgärd</option>
                          <option value="awaiting_external_response">Väntar externt svar</option>
                          <option value="billing_blocked">Fakturering blockerad</option>
                          <option value="manual_follow_up">Manuell uppföljning</option>
                          <option value="resolved">Löst</option>
                          <option value="closed">Stängd</option>
                        </select>
                        <input name="message" placeholder="Kort notering" className="rounded-xl border border-slate-300 px-3 py-2 text-xs" />
                        <button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">Spara</button>
                      </form>
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
