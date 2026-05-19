// components/admin/ediel/EdielSafeApplyReviewPanel.tsx

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  approveEdielSafeApplyAction,
  processEdielUtiltsBillingAction,
  rejectEdielSafeApplyAction,
} from '@/app/admin/ediel/actions'
import type {
  EdielSafeApplyReviewItem,
  EdielUtiltsBillingReviewItem,
} from '@/lib/ediel/safeApplyReview'

function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode
  tone?: 'slate' | 'emerald' | 'amber' | 'red'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'red'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-slate-200 bg-slate-50 text-slate-700'

  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${toneClass}`}>{children}</span>
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function reviewTone(status: EdielSafeApplyReviewItem['status']): 'slate' | 'emerald' | 'amber' | 'red' {
  if (status === 'applied') return 'emerald'
  if (status === 'rejected') return 'red'
  if (status === 'pending') return 'amber'
  return 'slate'
}

function utiltsTone(status: EdielUtiltsBillingReviewItem['status']): 'slate' | 'emerald' | 'amber' | 'red' {
  if (status === 'processed') return 'emerald'
  if (status === 'ready') return 'emerald'
  if (status === 'needs_link') return 'amber'
  return 'slate'
}

function valueText(value: string | number | boolean | null): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'ja' : 'nej'
  return String(value)
}

function ChangeTable({ item }: { item: EdielSafeApplyReviewItem }) {
  if (item.changes.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-500">Inga föreslagna ändringar.</div>
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Objekt</th>
            <th className="px-3 py-2 text-left">Fält</th>
            <th className="px-3 py-2 text-left">Nuvarande</th>
            <th className="px-3 py-2 text-left">Föreslaget</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {item.changes.map((change, index) => (
            <tr key={`${change.entityType}-${change.entityId}-${change.label}-${index}`}>
              <td className="px-3 py-2 text-slate-600">
                <div className="font-medium text-slate-900">{change.entityType === 'customer_site' ? 'Anläggning' : 'Mätpunkt'}</div>
                <div className="max-w-[180px] truncate text-xs text-slate-500">{change.entityId}</div>
              </td>
              <td className="px-3 py-2 font-medium text-slate-900">{change.label}</td>
              <td className="px-3 py-2 text-slate-600">{valueText(change.currentValue)}</td>
              <td className="px-3 py-2 text-slate-950">{valueText(change.proposedValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SafeApplyCard({ item }: { item: EdielSafeApplyReviewItem }) {
  const disabled = item.status !== 'pending'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-950">
              {item.message.message_family} {item.message.message_code}
            </h3>
            <Badge tone={reviewTone(item.status)}>{item.status}</Badge>
            <Badge tone="emerald">Batch 6C</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
          <div className="mt-2 text-xs text-slate-500">
            Importerad: {formatDate(item.message.created_at)} · Message ID:{' '}
            <Link href={`/admin/ediel/messages/${item.message.id}`} className="text-emerald-700 underline-offset-2 hover:underline">
              {item.message.id}
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <ChangeTable item={item} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          Safe apply skriver bara till whitelisted masterdatafält. Allt annat hoppas över och måste hanteras manuellt.
        </div>
        <form action={rejectEdielSafeApplyAction} className="flex gap-2">
          <input type="hidden" name="edielMessageId" value={item.message.id} />
          <input
            name="reason"
            placeholder="Avvisningsorsak"
            className="w-36 rounded-xl border border-slate-300 px-3 py-2 text-xs"
            disabled={disabled}
          />
          <button
            type="submit"
            disabled={disabled}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Avvisa
          </button>
        </form>
        <form action={approveEdielSafeApplyAction}>
          <input type="hidden" name="edielMessageId" value={item.message.id} />
          <button
            type="submit"
            disabled={disabled}
            className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Godkänn och applicera
          </button>
        </form>
      </div>
    </div>
  )
}

function UtiltsCard({ item }: { item: EdielUtiltsBillingReviewItem }) {
  const payload = item.normalizedPayload ?? {}
  const quantity = typeof payload.quantity === 'number' ? payload.quantity : null
  const periodStart = typeof payload.periodStart === 'string' ? payload.periodStart : null
  const periodEnd = typeof payload.periodEnd === 'string' ? payload.periodEnd : null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-950">
              {item.message.message_family} {item.message.message_code}
            </h3>
            <Badge tone={utiltsTone(item.status)}>{item.status}</Badge>
            {item.hasMeteringValue ? <Badge tone="emerald">mätvärde skapat</Badge> : null}
            {item.hasBillingUnderlay ? <Badge tone="emerald">billing-underlay skapat</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
          <div className="mt-2 text-xs text-slate-500">
            <Link href={`/admin/ediel/messages/${item.message.id}`} className="text-emerald-700 underline-offset-2 hover:underline">
              {item.message.id}
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-xs uppercase text-slate-500">Mätpunkt</div>
          <div className="mt-1 truncate text-sm font-medium text-slate-900">{item.message.metering_point_id ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-xs uppercase text-slate-500">Kvantitet</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{quantity ?? '—'} kWh</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-xs uppercase text-slate-500">Period</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{periodStart ?? '—'} → {periodEnd ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-xs uppercase text-slate-500">Data request</div>
          <div className="mt-1 truncate text-sm font-medium text-slate-900">{item.message.grid_owner_data_request_id ?? '—'}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          Processning är idempotent på meddelandenivå: om parsed_payload redan har resultat-ID ska admin se att raden är färdig.
        </div>
        <form action={processEdielUtiltsBillingAction}>
          <input type="hidden" name="edielMessageId" value={item.message.id} />
          <button
            type="submit"
            disabled={item.status !== 'ready'}
            className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Processa till mätvärde/underlag
          </button>
        </form>
      </div>
    </div>
  )
}

export default function EdielSafeApplyReviewPanel({
  safeApplyItems,
  utiltsItems,
}: {
  safeApplyItems: EdielSafeApplyReviewItem[]
  utiltsItems: EdielUtiltsBillingReviewItem[]
}) {
  const pendingSafeApply = safeApplyItems.filter((item) => item.status === 'pending').length
  const readyUtilts = utiltsItems.filter((item) => item.status === 'ready').length
  const processedUtilts = utiltsItems.filter((item) => item.status === 'processed').length

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-950">Batch 6C · Safe apply och mätvärdesunderlag</h2>
            <Badge tone="emerald">filbaserat</Badge>
            <Badge tone="slate">SMTP/ECP off</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Här gör admin sista granskningen innan Z06/Z10 får ändra masterdata. UTILTS E66/E30 kan processas till mätvärden och faktureringsunderlag när meddelandet har stark koppling.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={pendingSafeApply > 0 ? 'amber' : 'emerald'}>safe apply: {pendingSafeApply}</Badge>
          <Badge tone={readyUtilts > 0 ? 'emerald' : 'slate'}>UTILTS redo: {readyUtilts}</Badge>
          <Badge tone="emerald">UTILTS klara: {processedUtilts}</Badge>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">Z06/Z10 ändringsförslag</h3>
            <Badge tone={safeApplyItems.length > 0 ? 'amber' : 'emerald'}>{safeApplyItems.length}</Badge>
          </div>
          {safeApplyItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
              Inga Z06/Z10 safe-apply-kandidater finns i senaste Ediel-urvalet.
            </div>
          ) : (
            safeApplyItems.map((item) => <SafeApplyCard key={item.message.id} item={item} />)
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">UTILTS till mätvärden/fakturaunderlag</h3>
            <Badge tone={utiltsItems.length > 0 ? 'emerald' : 'slate'}>{utiltsItems.length}</Badge>
          </div>
          {utiltsItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
              Inga inbound UTILTS E66/E30 finns i senaste Ediel-urvalet.
            </div>
          ) : (
            utiltsItems.map((item) => <UtiltsCard key={item.message.id} item={item} />)
          )}
        </div>
      </div>
    </section>
  )
}
