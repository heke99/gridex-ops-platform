// components/admin/ediel/EdielInboundCasesPanel.tsx

import Link from 'next/link'
import type { EdielInboundCaseRow } from '@/lib/ediel/inboundCases'
import { edielCodeLabel } from '@/lib/ediel/codeLabels'
import {
  approveEdielInboundCaseAction,
  rejectEdielInboundCaseAction,
} from '@/app/admin/ediel/actions'

function text(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '—'
}

function statusTone(status: string): string {
  if (status === 'applied') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'rejected' || status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-slate-900">{text(value)}</div>
    </div>
  )
}

function CaseRow({ item }: { item: EdielInboundCaseRow }) {
  const customer = item.parsed_customer ?? {}
  const site = item.parsed_site ?? {}
  const meteringPoint = item.parsed_metering_point ?? {}
  const contract = item.parsed_contract ?? {}
  const production = item.parsed_production ?? {}
  const isPending = item.status === 'pending_review' || item.status === 'failed'

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
              {item.status}
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
              {item.case_type}
            </span>
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-950">
            {text(customer.fullName ?? customer.companyName)}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Skapad {formatDateTime(item.created_at)} · matchning {item.match_confidence ?? 0}%
          </p>
        </div>
        <Link
          href={`/admin/ediel/messages/${item.ediel_message_id}`}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Öppna EDI
        </Link>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Detail label="Kund-id" value={`${text(customer.customerId)} · ${text(customer.customerIdLabel)}`} />
        <Detail label="Anläggnings-/mätpunkt-id" value={meteringPoint.meterPointId ?? site.facilityId} />
        <Detail label="Nätområde" value={site.gridAreaCode ?? contract.gridAreaCode} />
        <Detail label="Avtalsstart" value={contract.startDate ?? site.contractStartDate} />
        <Detail label="Transaktion" value={edielCodeLabel('reason_for_transaction', item.transaction_type)} />
        <Detail label="Mätmetod" value={meteringPoint.meteringMethodLabel ?? edielCodeLabel('metering_method', String(meteringPoint.meteringMethod ?? ''))} />
        <Detail label="Produkt" value={production.productCodeLabel ?? edielCodeLabel('product_code', String(production.productCode ?? ''))} />
        <Detail label="Referens mätpunkt" value={production.referenceToMeteringPoint ?? meteringPoint.referenceToMeteringPoint} />
      </div>

      {production.isMicroProduction === true ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-semibold">Mottagningspliktig mikroproduktion</div>
          <p className="mt-1 text-xs leading-5">
            Vid godkännande skapas eller uppdateras kund, produktionsanläggning och mätpunkt som produktion. Referens till huvudmätpunkten sparas i intern notering och Ediel-referens.
          </p>
        </div>
      ) : null}

      {item.failure_reason ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {item.failure_reason}
        </div>
      ) : null}

      {isPending ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
          <form action={approveEdielInboundCaseAction} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <input type="hidden" name="caseId" value={item.id} />
            <label className="text-xs font-semibold text-slate-700" htmlFor={`mode-${item.id}`}>
              Godkänn som
            </label>
            <select
              id={`mode-${item.id}`}
              name="mode"
              defaultValue={item.customer_id ? 'update_existing_customer' : 'create_new_customer'}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="create_new_customer">Skapa ny kund + anläggning + mätpunkt</option>
              <option value="update_existing_customer">Koppla/uppdatera befintlig kund om matchning finns</option>
              <option value="link_existing_only">Koppla till befintligt underlag utan att skapa ny kund</option>
            </select>
            <textarea
              name="note"
              rows={2}
              placeholder="Intern kommentar, t.ex. godkänd mikroproduktion från Z04D."
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button className="mt-2 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
              Godkänn och applicera
            </button>
          </form>

          <form action={rejectEdielInboundCaseAction} className="rounded-2xl border border-slate-200 bg-white p-3">
            <input type="hidden" name="caseId" value={item.id} />
            <label className="text-xs font-semibold text-slate-700" htmlFor={`reject-${item.id}`}>
              Avvisa / kräver manuell handläggning
            </label>
            <textarea
              id={`reject-${item.id}`}
              name="note"
              rows={3}
              placeholder="Varför ska detta inte appliceras?"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button className="mt-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100">
              Avvisa case
            </button>
          </form>
        </div>
      ) : null}
    </article>
  )
}

export default function EdielInboundCasesPanel({ cases }: { cases: EdielInboundCaseRow[] }) {
  const pending = cases.filter((item) => item.status === 'pending_review' || item.status === 'failed')
  const handled = cases.filter((item) => !pending.includes(item)).slice(0, 8)

  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Inbound PRODAT – admin-godkännande</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Inkommande PRODAT skapar ett staging-case. Masterdata ändras först när admin godkänner. Det gör flödet säkert för produktion, TGT och framtida multi-tenant där varje elhandelsbolag bara ska se sitt eget scope.
          </p>
        </div>
        <div className="flex gap-2 text-xs font-semibold">
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
            {pending.length} väntar
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">
            {cases.length} totalt
          </span>
        </div>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
          Inga inbound PRODAT-case väntar på admin-godkännande.
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((item) => (
            <CaseRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {handled.length > 0 ? (
        <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">Visa senaste hanterade case</summary>
          <div className="mt-4 space-y-3">
            {handled.map((item) => (
              <CaseRow key={item.id} item={item} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
