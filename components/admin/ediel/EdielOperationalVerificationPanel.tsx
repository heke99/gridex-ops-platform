// components/admin/ediel/EdielOperationalVerificationPanel.tsx

import Link from 'next/link'
import type { ReactNode } from 'react'
import { createSafeMasterdataProposalAction } from '@/app/admin/ediel/actions'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  getEdielOperationalVerificationSummary,
  type EdielOperationalVerificationSummary,
} from '@/lib/ediel/operationalVerification'

type SwitchRow = {
  id: string
  status: string
  external_reference?: string | null
}

type DataRequestRow = {
  id: string
  status: string
  request_scope: string
  external_reference?: string | null
}

type OutboundRow = {
  id: string
  request_type: string
  source_type: string | null
  source_id: string | null
  status: string
}

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

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  )
}

function statusTone(status: EdielOperationalVerificationSummary['status']): 'emerald' | 'amber' | 'red' {
  if (status === 'ok') return 'emerald'
  if (status === 'blocked') return 'red'
  return 'amber'
}

function issueTone(severity: string): 'emerald' | 'amber' | 'red' | 'slate' {
  if (severity === 'ok') return 'emerald'
  if (severity === 'blocked') return 'red'
  if (severity === 'warning') return 'amber'
  return 'slate'
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function isSafeApplyCandidate(row: EdielMessageRow): boolean {
  return row.direction === 'inbound' && row.message_family === 'PRODAT' && ['Z06', 'Z10'].includes(String(row.message_code))
}

function isUnlinkedAck(row: EdielMessageRow): boolean {
  return (
    row.direction === 'inbound' &&
    ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(row.message_family) &&
    !row.related_message_id &&
    !row.outbound_request_id
  )
}

function isUnlinkedOperationalMessage(row: EdielMessageRow): boolean {
  if (row.direction !== 'inbound') return false
  if (row.message_family !== 'PRODAT' && row.message_family !== 'UTILTS') return false
  return !row.switch_request_id && !row.grid_owner_data_request_id && !row.customer_id && !row.site_id && !row.metering_point_id
}

function Metric({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: 'slate' | 'emerald' | 'amber' | 'red' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
        {value}
        <Badge tone={tone}>{tone}</Badge>
      </div>
    </div>
  )
}

function MessageCard({ row, action }: { row: EdielMessageRow; action?: 'safe_apply' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/admin/ediel/messages/${row.id}`} className="break-all text-sm font-semibold text-emerald-700 underline-offset-2 hover:underline">
            {row.message_family} {row.message_code}
          </Link>
          <div className="mt-1 text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={row.direction === 'inbound' ? 'emerald' : 'emerald'}>{row.direction}</Badge>
          <Badge tone="slate">{row.status}</Badge>
        </div>
      </div>

      <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <div>Switch: {row.switch_request_id ?? '—'}</div>
        <div>Outbound: {row.outbound_request_id ?? '—'}</div>
        <div>Data request: {row.grid_owner_data_request_id ?? '—'}</div>
        <div>Mätpunkt: {row.metering_point_id ?? '—'}</div>
        <div className="sm:col-span-2">Extern referens: {row.external_reference ?? row.transaction_reference ?? '—'}</div>
      </div>

      {action === 'safe_apply' ? (
        <form action={createSafeMasterdataProposalAction} className="mt-3">
          <input type="hidden" name="edielMessageId" value={row.id} />
          <button className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
            Skapa safe apply-förslag
          </button>
        </form>
      ) : null}
    </div>
  )
}

export default function EdielOperationalVerificationPanel({
  messages,
  switchRequests,
  dataRequests,
  outboundRequests,
}: {
  messages: EdielMessageRow[]
  switchRequests: SwitchRow[]
  dataRequests: DataRequestRow[]
  outboundRequests: OutboundRow[]
}) {
  const summary = getEdielOperationalVerificationSummary({
    messages,
    switchRequests,
    dataRequests,
    outboundRequests,
  })

  const safeApplyCandidates = messages.filter(isSafeApplyCandidate).slice(0, 8)
  const unlinkedAcks = messages.filter(isUnlinkedAck).slice(0, 6)
  const unlinkedOperational = messages.filter(isUnlinkedOperationalMessage).slice(0, 6)

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Batch 6B · Verifiering och safe apply</h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-700">
            Detta lager kontrollerar att Ediel-filer är säkert kopplade till rätt Gridex-flöde. Z06/Z10 skapar endast föreslagna ändringar — masterdata skrivs inte över automatiskt.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={statusTone(summary.status)}>status: {summary.status}</Badge>
          <Badge tone="emerald">score {summary.score}/100</Badge>
          <Badge tone="amber">SMTP/ECP live: nej</Badge>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Z03 med länk" value={summary.z03WithSwitchLink} tone="emerald" />
        <Metric label="Z03 utan länk" value={summary.z03MissingSwitchLink} tone={summary.z03MissingSwitchLink > 0 ? 'amber' : 'emerald'} />
        <Metric label="ACK ok-länkade" value={summary.inboundAckLinked} tone="emerald" />
        <Metric label="ACK utan länk" value={summary.inboundAckUnlinked} tone={summary.inboundAckUnlinked > 0 ? 'amber' : 'emerald'} />
        <Metric label="Safe apply" value={summary.safeApplyCandidates} tone={summary.safeApplyCandidates > 0 ? 'amber' : 'emerald'} />
        <Metric label="UTILTS E66/E30" value={summary.meteringCandidates} tone="emerald" />
      </div>

      {summary.issues.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">Verifieringspunkter att åtgärda</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {summary.issues.map((issue) => (
              <div key={issue.code} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-950">{issue.title}</div>
                  <Badge tone={issueTone(issue.severity)}>{issue.severity}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-600">{issue.description}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-emerald-700">
          Inga verifieringsproblem hittades i senaste urvalet. Fortsätt ändå köra filbaserat tills TGT/AGT och transportkrav är klara.
        </div>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Z06/Z10 safe apply</h3>
              <p className="mt-1 text-xs text-slate-600">Skapa förslag innan masterdata uppdateras. Inga fält skrivs över automatiskt.</p>
            </div>
            <Badge tone={safeApplyCandidates.length > 0 ? 'amber' : 'emerald'}>{safeApplyCandidates.length}</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {safeApplyCandidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Inga Z06/Z10 att granska i senaste urvalet.</div>
            ) : (
              safeApplyCandidates.map((row) => <MessageCard key={row.id} row={row} action="safe_apply" />)
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">ACK utan källkoppling</h3>
              <p className="mt-1 text-xs text-slate-600">Dessa ska kopplas innan de får styra switch/outbound-status.</p>
            </div>
            <Badge tone={unlinkedAcks.length > 0 ? 'amber' : 'emerald'}>{unlinkedAcks.length}</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {unlinkedAcks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Inga okopplade ACK i senaste urvalet.</div>
            ) : (
              unlinkedAcks.map((row) => <MessageCard key={row.id} row={row} />)
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Inbound utan verksamhetslänk</h3>
              <p className="mt-1 text-xs text-slate-600">PRODAT/UTILTS ska helst länkas till switch, data request, kund, anläggning eller mätpunkt.</p>
            </div>
            <Badge tone={unlinkedOperational.length > 0 ? 'amber' : 'emerald'}>{unlinkedOperational.length}</Badge>
          </div>
          <div className="mt-3 space-y-3">
            {unlinkedOperational.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Inga okopplade inbound PRODAT/UTILTS i senaste urvalet.</div>
            ) : (
              unlinkedOperational.map((row) => <MessageCard key={row.id} row={row} />)
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
