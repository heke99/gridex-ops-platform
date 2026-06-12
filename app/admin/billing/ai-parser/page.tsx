import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { createDocumentAiExtractionAction, reviewDocumentAiExtractionAction } from './actions'

export const dynamic = 'force-dynamic'

type ExtractionRow = {
  id: string
  customer_id: string | null
  source_file_name: string | null
  status: string
  extracted_fields: Record<string, unknown> | null
  field_confidence: Record<string, unknown> | null
  detected_signatures: Array<Record<string, unknown>> | null
  detected_authorizations: Array<Record<string, unknown>> | null
  detected_sites: Array<Record<string, unknown>> | null
  detected_invoice_address: Record<string, unknown> | null
  review_notes: string | null
  created_at: string
}

function tone(status: string) {
  if (status === 'approved_for_manual_create') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'rejected') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-amber-200 bg-amber-50 text-amber-900'
}

function asJson(value: unknown) {
  if (!value || (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)) return '—'
  return JSON.stringify(value, null, 2)
}

export default async function BillingAiParserPage() {
  const admin = await requireAdminPageKeyAccess('billing.import')
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null

  const { data, error } = companyId
    ? await supabase
        .from('document_ai_extractions')
        .select('id, customer_id, source_file_name, status, extracted_fields, field_confidence, detected_signatures, detected_authorizations, detected_sites, detected_invoice_address, review_notes, created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(40)
    : { data: [], error: null }

  const rows = error ? [] : ((data ?? []) as ExtractionRow[])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="AI/OCR-granskning"
        subtitle="Säker granskningskö för scannade eller ostrukturerade avtal och fullmakter. Systemet föreslår fält men skapar aldrig kund automatiskt utan manuell verifiering."
        userEmail={admin.email}
      />
      <div className="grid gap-6 p-8 xl:grid-cols-[440px_minmax(0,1fr)]">
        <form action={createDocumentAiExtractionAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Ny granskning</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-950">Klistra in OCR/PDF-text</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">Använd detta för scannade avtal, fullmakter eller ostrukturerade PDF:er. Resultatet måste granskas innan kund/anläggning/avtal skapas.</p>
          <div className="mt-5 grid gap-4">
            <input name="source_file_name" placeholder="Filnamn / källa" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
            <input name="customer_id" placeholder="Kund-id om dokumentet redan hör till kund" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
            <textarea name="raw_text" rows={12} placeholder="OCR-text / PDF-text" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            <textarea name="review_notes" rows={3} placeholder="Intern granskningsnotering" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
            <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Skapa granskningsrad</button>
          </div>
        </form>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Granskningskö</h2>
            <p className="mt-1 text-sm text-slate-700">Identifierade fält, confidence, signaturmarkörer, fullmaktsmarkörer, anläggningar och fakturaadress.</p>
            {error ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Kör Batch 4C-migrationen först: {error.message}</p> : null}
          </div>
          <div className="space-y-4 p-6">
            {rows.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-600">Inga AI/OCR-granskningar ännu.</div> : null}
            {rows.map((row) => (
              <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(row.status)}`}>{row.status}</span>
                  <span className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString('sv-SE')}</span>
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-950">{row.source_file_name ?? 'Dokument utan filnamn'}</div>
                <div className="mt-1 text-xs text-slate-600">Kund: {row.customer_id ?? 'Ej kopplad'}</div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <pre className="max-h-52 overflow-auto rounded-2xl bg-slate-50 p-3 text-xs text-slate-700">{asJson(row.extracted_fields)}</pre>
                  <pre className="max-h-52 overflow-auto rounded-2xl bg-slate-50 p-3 text-xs text-slate-700">{asJson({ confidence: row.field_confidence, signatures: row.detected_signatures, authorizations: row.detected_authorizations, sites: row.detected_sites, invoiceAddress: row.detected_invoice_address })}</pre>
                </div>
                <form action={reviewDocumentAiExtractionAction} className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                  <input type="hidden" name="extraction_id" value={row.id} />
                  <select name="status" defaultValue={row.status} className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                    <option value="needs_review">Kräver granskning</option>
                    <option value="approved_for_manual_create">Godkänd för manuell skapelse</option>
                    <option value="rejected">Avvisad</option>
                  </select>
                  <input name="review_notes" defaultValue={row.review_notes ?? ''} placeholder="Granskningsnotering" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
                  <button className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">Spara</button>
                </form>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
