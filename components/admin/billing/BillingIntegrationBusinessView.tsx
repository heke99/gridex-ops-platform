import AdminDisclosurePanel from '@/components/admin/ui/AdminDisclosurePanel'
import { saveNordfinClientIdAction, selectInvoiceProviderAction, setInvoiceDispatchEnabledAction, testCapwayConnectionAction } from '@/app/admin/billing/integrations/actions'
import type { InvoiceProviderCatalogEntry, TenantInvoiceProviderSelection } from '@/lib/billing/providers/registry'
import { formatStatusLabel } from '@/lib/ui/format'

const providerNames: Record<string, string> = { capway_aptic: 'Capway/Aptic', nordfin: 'Nordfin', file_export: 'Fakturaexport till fil' }
const control = 'min-h-11 min-w-0 w-full rounded-xl border border-slate-300 px-3 py-2'
const button = 'min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700'
export default function BillingIntegrationBusinessView({ catalog, selection, connection, runs, canManage, unavailable, reviewCount, failedCount, notice }: {
  catalog: InvoiceProviderCatalogEntry[]
  selection: TenantInvoiceProviderSelection | null
  connection: Record<string, unknown> | undefined
  runs: Record<string, unknown>[]
  canManage: boolean
  unavailable: boolean
  reviewCount: number
  failedCount: number
  notice: { tone: 'ok' | 'error'; text: string } | null
}) {
  const selected = selection?.invoice_export_target_system
  const label = (provider: unknown) => catalog.find(entry => entry.provider === provider)?.label ?? providerNames[String(provider)] ?? 'Fakturaleverantör'
  const ready = ['ready', 'active'].includes(String(connection?.status ?? ''))
  const enabled = selection?.invoice_export_enabled === true
  const settings = connection?.settings as Record<string, unknown> | undefined
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
    {notice ? <p role="status" className={`rounded-2xl border p-4 text-sm ${notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>{notice.text}</p> : null}
    {unavailable ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Fakturainställningarna kunde inte läsas fullständigt. Försök igen innan du ändrar något.</p> : null}
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Fakturaleverantör och utskick">
      <h2 className="text-base font-semibold text-slate-950">Fakturaleverantör</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-slate-500">Leverantör</dt><dd className="mt-1 font-semibold">{selected ? label(selected) : unavailable ? 'Kan inte bekräftas' : 'Ingen vald'}</dd></div>
        <div><dt className="text-slate-500">Anslutning</dt><dd className="mt-1 font-semibold">{unavailable ? 'Kan inte bekräftas' : ready ? 'Godkänd' : selected ? 'Behöver kontrolleras' : 'Inte ansluten'}</dd></div>
        <div><dt className="text-slate-500">Automatiska utskick</dt><dd className="mt-1 font-semibold">{unavailable ? 'Kan inte bekräftas' : enabled ? 'Aktiverade' : 'Avstängda'}</dd></div>
      </dl>
      {selected ? <p className="mt-3 text-sm text-slate-600">{selection?.billing_provider_environment === 'production' ? 'Anslutningen används för ordinarie fakturor.' : selection?.billing_provider_environment === 'test' ? 'Anslutningen används för testfakturor.' : 'Anslutningens användning behöver kontrolleras.'}</p> : null}
      {canManage && !unavailable ? <div className="mt-3 flex flex-wrap gap-2">
        {selected ? <form action={setInvoiceDispatchEnabledAction}><input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} /><button disabled={!enabled && !ready} className={button}>{enabled ? 'Stäng av utskick' : 'Aktivera utskick'}</button></form> : null}
        {selected === 'capway_aptic' ? <form action={testCapwayConnectionAction}><button className={button}>Kontrollera anslutning</button></form> : null}
      </div> : null}
    </section>
    {canManage && !unavailable ? <AdminDisclosurePanel id="billing-select-provider" title="Ändra fakturaleverantör" defaultOpen={!selected} className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">Byte av leverantör stänger av utskick tills den nya anslutningen är kontrollerad och utskick aktiveras igen.</p>
      <form action={selectInvoiceProviderAction} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-sm">Leverantör<select name="provider" required defaultValue={selected ?? ''} className={control}><option value="" disabled>Välj fakturaleverantör</option>{catalog.filter(entry => entry.selectable || entry.provider === selected).map(entry => <option key={entry.provider} value={entry.provider} disabled={!entry.selectable}>{entry.label}</option>)}</select></label>
        <label className="grid min-w-0 gap-1 text-sm">Användning<select name="environment" defaultValue={selection?.billing_provider_environment === 'production' ? 'production' : 'test'} className={control}><option value="test">Testfakturor</option><option value="production">Ordinarie fakturor</option></select></label>
        <button className={button}>Spara leverantör</button>
      </form>
      {selected === 'nordfin' ? <form action={saveNordfinClientIdAction} className="mt-4 grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1 text-sm">Bolagets kundnummer hos Nordfin<input name="client_id" required maxLength={40} pattern="[A-Za-z0-9_\-]{1,40}" defaultValue={typeof settings?.client_id === 'string' ? settings.client_id : ''} className={control} /></label><button className={button}>Spara kundnummer</button></form> : null}
    </AdminDisclosurePanel> : null}
    {failedCount > 0 ? <p role="status" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">Misslyckade fakturaposter: {failedCount}. Behöver följas upp.</p> : null}
    {reviewCount > 0 ? <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Fakturahändelser att granska: {reviewCount}. Kontakta support för uppföljning.</p> : null}
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Senaste överföringar ({runs.length})</summary>
      {runs.length === 0 ? <p className="mt-3 text-sm text-slate-600">Inga överföringar registrerade.</p> : <div role="region" aria-label="Fakturaöverföringar" tabIndex={0} className="mt-3 max-h-80 space-y-2 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{runs.map(row => <div key={String(row.id)} className="rounded-xl border border-slate-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{String(row.billing_month ?? 'Period saknas')} · {label(row.provider)}</span><span>{formatStatusLabel(typeof row.status === 'string' ? row.status : null, 'Status saknas', 'Behöver granskning')}</span></div><p className="mt-1 text-slate-600">Fakturor: {String(row.total_items ?? '—')} · Skickade: {String(row.sent_items ?? '—')} · Fel: {String(row.failed_items ?? '—')}</p></div>)}</div>}
    </details>
  </main>
}
