// components/admin/ediel/EdielOperationalBridgePanel.tsx

import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  prepareSwitchZ03Action,
  processEdielOperationalMessageAction,
} from '@/app/admin/ediel/actions'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  getEdielOperationalBridgeSummary,
  type EdielOperationalBridgeSummary,
} from '@/lib/ediel/operationalBridge'
import {
  getEdielTransportReadinessSummary,
  type EdielTransportRouteLike,
} from '@/lib/ediel/transportReadiness'

type SwitchRow = {
  id: string
  status: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
}

type DataRequestRow = {
  id: string
  status: string
  request_scope: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
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

function StatCard({ label, value, tone = 'slate' }: { label: string; value: string | number; tone?: 'slate' | 'emerald' | 'amber' | 'red' }) {
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function isOperationalCandidate(row: EdielMessageRow): boolean {
  if (row.direction !== 'inbound') return false
  if (!['received', 'parsed', 'validated'].includes(row.status)) return false
  if (row.message_family === 'PRODAT') return ['Z04', 'Z05', 'Z06', 'Z10'].includes(String(row.message_code))
  if (row.message_family === 'UTILTS') return ['E66', 'E30', 'S02', 'S03', 'E31'].includes(String(row.message_code))
  return ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(row.message_family)
}

function switchTone(status: string): 'emerald' | 'amber' | 'red' | 'slate' {
  if (status === 'completed' || status === 'accepted') return 'emerald'
  if (status === 'submitted') return 'emerald'
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'red'
  if (status === 'queued' || status === 'draft') return 'amber'
  return 'slate'
}

function dataTone(status: string): 'emerald' | 'amber' | 'red' | 'slate' {
  if (status === 'received') return 'emerald'
  if (status === 'sent') return 'emerald'
  if (status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'pending') return 'amber'
  return 'slate'
}

function SummaryStrip({ summary }: { summary: EdielOperationalBridgeSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Öppna switchar" value={summary.switchRequestsOpen} tone={summary.switchRequestsOpen > 0 ? 'amber' : 'emerald'} />
      <StatCard label="Z03 skapade" value={summary.prodatZ03Outbound} tone="emerald" />
      <StatCard label="Inbound Z04" value={summary.prodatZ04Inbound} tone="emerald" />
      <StatCard label="Inbound Z05" value={summary.prodatZ05Inbound} tone="emerald" />
      <StatCard label="UTILTS mätvärden" value={summary.utiltsInboundMetering} tone="emerald" />
      <StatCard label="Att processa" value={summary.candidateInboundToProcess} tone={summary.candidateInboundToProcess > 0 ? 'amber' : 'emerald'} />
    </div>
  )
}

export default function EdielOperationalBridgePanel({
  messages,
  switchRequests,
  dataRequests,
  outboundRequests,
  routes,
}: {
  messages: EdielMessageRow[]
  switchRequests: SwitchRow[]
  dataRequests: DataRequestRow[]
  outboundRequests: OutboundRow[]
  routes: EdielTransportRouteLike[]
}) {
  const summary = getEdielOperationalBridgeSummary({
    messages,
    switchRequests,
    dataRequests,
    outboundRequests,
  })
  const transportReadiness = getEdielTransportReadinessSummary(routes)
  const candidates = messages.filter(isOperationalCandidate).slice(0, 10)
  const switchCandidates = switchRequests
    .filter((row) => !['completed', 'failed', 'rejected', 'cancelled'].includes(row.status))
    .slice(0, 8)

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Batch 6 · Verksamhetskoppling</h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-700">
            Här går Ediel från testverktyg till operationsmotor: Z03 skapas från riktiga switchärenden,
            inkommande Z04/Z05/Z06/Z10 uppdaterar switch/masterdata-spår, och UTILTS E66/E30 kopplas till
            mätvärden och faktureringsunderlag. Motorn är fortfarande filbaserad.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="emerald">filbaserad motor</Badge>
          <Badge tone={summary.smtpEcpEnabled ? 'red' : 'amber'}>SMTP/ECP ej aktivt</Badge>
          <Badge tone="emerald">Ediel-id via route/runtime</Badge>
        </div>
      </div>

      <div className="mt-5">
        <SummaryStrip summary={summary} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Skapa PRODAT Z03 från switchärende</h3>
              <p className="mt-1 text-xs text-slate-600">
                Använd detta när ett riktigt supplier_switch_request är redo och ska bli en filbaserad PRODAT Z03.
              </p>
            </div>
            <Badge tone={switchCandidates.length > 0 ? 'amber' : 'emerald'}>{switchCandidates.length} kandidater</Badge>
          </div>

          <div className="mt-4 space-y-3">
            {switchCandidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Inga öppna switchärenden i senaste urvalet.
              </div>
            ) : (
              switchCandidates.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-all text-sm font-semibold text-slate-950">{row.id}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
                    </div>
                    <Badge tone={switchTone(row.status)}>{row.status}</Badge>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                    <div>Customer: {row.customer_id ?? '—'}</div>
                    <div>Metering point: {row.metering_point_id ?? '—'}</div>
                    <div className="md:col-span-2">External ref: {row.external_reference ?? '—'}</div>
                  </div>
                  <form action={prepareSwitchZ03Action} className="mt-3">
                    <input type="hidden" name="switchRequestId" value={row.id} />
                  <input type="hidden" name="forceRegenerate" value="true" />
                    <button className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
                      Skapa filbaserad PRODAT Z03
                    </button>
                  </form>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Processa inbound Ediel / skapa UTILTS TGT-svar</h3>
              <p className="mt-1 text-xs text-slate-600">
                Efter IMAP-import kör denna knapp rätt runtime. För inbound UTILTS skapas CONTRL + APERAK/UTILTS-ERR innan verksamhetskoppling.
              </p>
            </div>
            <Badge tone={candidates.length > 0 ? 'amber' : 'emerald'}>{candidates.length} att granska</Badge>
          </div>

          <div className="mt-4 space-y-3">
            {candidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Inga inbound-meddelanden behöver manuell verksamhetsprocessning just nu.
              </div>
            ) : (
              candidates.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">
                        {row.message_family} {row.message_code}
                      </div>
                      <div className="mt-1 break-all text-xs text-slate-500">{row.id}</div>
                    </div>
                    <Badge tone={row.status === 'failed' ? 'red' : 'emerald'}>{row.status}</Badge>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                    <div>Switch: {row.switch_request_id ?? '—'}</div>
                    <div>Data request: {row.grid_owner_data_request_id ?? '—'}</div>
                    <div>External ref: {row.external_reference ?? '—'}</div>
                    <div>Transaction ref: {row.transaction_reference ?? '—'}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={processEdielOperationalMessageAction}>
                      <input type="hidden" name="edielMessageId" value={row.id} />
                      <button className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
                        Kör engine / skapa svar
                      </button>
                    </form>
                    <Link href={`/admin/ediel/messages/${row.id}`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      Öppna meddelande
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-amber-950">Punkt 8 · SMTP/ECP readiness, inte aktivering</h3>
            <p className="mt-1 text-xs text-amber-800">
              Vi kan förbereda readiness och route-kontroll nu, men automatisk SMTP/ECP ska inte slås på förrän filflöden,
              certifikat, mailbox och Edieltester är godkända. Därför är live-transport fortfarande avstängd.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="amber">SMTP off</Badge>
            <Badge tone="amber">ECP/EDX off</Badge>
            <Badge tone={transportReadiness.blockedIssues > 0 ? 'red' : 'emerald'}>
              blocked: {transportReadiness.blockedIssues}
            </Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <StatCard label="Routes" value={transportReadiness.routesTotal} tone="slate" />
          <StatCard label="Filredo routes" value={transportReadiness.fileReadyRoutes} tone={transportReadiness.fileReadyRoutes > 0 ? 'emerald' : 'red'} />
          <StatCard label="SMTP-kandidater" value={transportReadiness.smtpReadyCandidates} tone={transportReadiness.smtpReadyCandidates > 0 ? 'amber' : 'slate'} />
          <StatCard label="ECP-kandidater" value={transportReadiness.ecpReadyCandidates} tone="slate" />
        </div>

        <div className="mt-4 space-y-2">
          {transportReadiness.issues.map((issue) => (
            <div key={issue.key} className="rounded-xl border border-white/70 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-950">{issue.title}</div>
                <Badge tone={issue.severity === 'blocked' ? 'red' : issue.severity === 'warning' ? 'amber' : 'emerald'}>
                  {issue.severity}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-600">{issue.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
