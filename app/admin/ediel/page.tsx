import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import EdielWorkbench from '@/components/admin/ediel/EdielWorkbench'
import EdielRouteIssueActions from '@/components/admin/ediel/EdielRouteIssueActions'
import EdielTgtWorkbenchPanel from '@/components/admin/ediel/EdielTgtWorkbenchPanel'
import EdielProductionProdatPanel from '@/components/admin/ediel/EdielProductionProdatPanel'
import EdielOperationalBridgePanel from '@/components/admin/ediel/EdielOperationalBridgePanel'
import EdielOperationalVerificationPanel from '@/components/admin/ediel/EdielOperationalVerificationPanel'
import EdielSafeApplyReviewPanel from '@/components/admin/ediel/EdielSafeApplyReviewPanel'
import EdielInboundCasesPanel from '@/components/admin/ediel/EdielInboundCasesPanel'
import InboundTestDataUploadForm from '@/components/admin/ediel/InboundTestDataUploadForm'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getCanonicalAckState } from '@/lib/ediel/ack'
import {
  getEdielRouteProfileByCommunicationRouteId,
  listCanonicalAckConflictEvents,
  listCanonicalDuplicateBlockEvents,
  listDuplicateAckCandidates,
  listEdielMessages,
  listEdielTestRuns,
  listOverdueAckMessages,
  listRecentInvalidCodeUsageMessages,
  listRecentVersionMismatchMessages,
  listRuleAmbiguities,
} from '@/lib/ediel/db'
import {
  cancelEdielMessageAction,
  createAndSendAckAction,
  createAndSendRecommendedAckAction,
  createAndSendTgtS142AperakAction,
  createAndSendTgtS142BAperakAction,
  createAndSendTgtS143AperakAction,
  createEdielTestRunAction,
  pollMailboxAction,
  registerInboundUtiltsAction,
  runEdielSelfTestAction,
  saveEdielInboundMessageTestDataAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import {
  getRecommendationSummary,
  type EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  ACTIVE_EDIEL_TEST_SUITES,
  isActiveEdielMessageFamily,
  isActiveEdielTestSuite,
} from '@/lib/ediel/types'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listSafeApplyReviewItems, listUtiltsBillingReviewItems } from '@/lib/ediel/safeApplyReview'
import { listEdielInboundCases } from '@/lib/ediel/inboundCases'
import { listEdielProdatProductionCandidates } from '@/lib/ediel/prodatContext'
import { listEdielTgtDynamicTestData, type EdielTgtDynamicTestDataSummary } from '@/lib/ediel/tgtTestDataStore'
import { resolveRecommendedAckForInboundMessage, type EdielAckDecision } from '@/lib/ediel/core/ackDecisionEngine'

export const dynamic = 'force-dynamic'

type SimpleSwitchRequestRow = {
  id: string
  status: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
}

type SimpleDataRequestRow = {
  id: string
  status: string
  request_scope: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  external_reference: string | null
  created_at: string
}

type SimpleOutboundRow = {
  id: string
  request_type: string
  source_type: string | null
  source_id: string | null
  status: string
  channel_type: string | null
  communication_route_id: string | null
  external_reference: string | null
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  created_at: string
}

type SimpleCommunicationRouteRow = {
  id: string
  route_name: string
  is_active: boolean
  route_scope: string
  route_type: string
  grid_owner_id: string | null
  target_system: string | null
  target_email: string | null
}

type SimpleGridOwnerRow = {
  id: string
  name: string
  ediel_id: string | null
}

function isEdielCandidateRoute(route: SimpleCommunicationRouteRow): boolean {
  if (route.route_type === 'ediel_partner') return true
  if (route.target_system?.toLowerCase().includes('ediel')) return true
  if (route.target_email?.toLowerCase().includes('ediel')) return true
  return false
}

function Cell({
  label,
  value,
  href,
}: {
  label: string
  value: string | null | undefined
  href?: string
}) {
  const displayValue = value && value.length > 0 ? value : '—'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-slate-900">
        {href && value ? (
          <Link
            href={href}
            className="font-medium text-indigo-700 underline-offset-2 hover:underline"
          >
            {displayValue}
          </Link>
        ) : (
          displayValue
        )}
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

function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode
  tone?: 'slate' | 'green' | 'yellow' | 'red' | 'blue'
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'yellow'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : tone === 'red'
          ? 'bg-rose-50 text-rose-700 border-rose-200'
          : tone === 'blue'
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : 'bg-slate-50 text-slate-700 border-slate-200'

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  )
}

function getOutboundStatusTone(
  status: string | null | undefined
): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (status === 'acknowledged') return 'green'
  if (status === 'sent' || status === 'prepared') return 'blue'
  if (status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'queued') return 'yellow'
  return 'slate'
}

function getRouteTone(routeId: string | null | undefined): 'green' | 'red' {
  return routeId ? 'green' : 'red'
}

function getMessageTone(
  direction: string | null | undefined
): 'blue' | 'green' | 'slate' {
  if (direction === 'outbound') return 'blue'
  if (direction === 'inbound') return 'green'
  return 'slate'
}

function getRequestTone(
  status: string | null | undefined
): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (status === 'completed' || status === 'received' || status === 'accepted') {
    return 'green'
  }
  if (status === 'submitted' || status === 'sent') return 'blue'
  if (status === 'failed' || status === 'cancelled' || status === 'rejected') {
    return 'red'
  }
  if (status === 'queued' || status === 'pending' || status === 'draft') {
    return 'yellow'
  }
  return 'slate'
}

function findMessagesForOutbound(
  messages: Awaited<ReturnType<typeof listEdielMessages>>,
  outboundRequestId: string
) {
  return messages.filter((row) => row.outbound_request_id === outboundRequestId)
}

function routeLabel(route: EdielRecommendationRouteRow | null): string {
  if (!route) return '—'
  return `${route.route_name} (${route.route_scope})${
    route.grid_owner_name ? ` · ${route.grid_owner_name}` : ''
  }`
}

function ackStateTone(state: string): 'slate' | 'green' | 'yellow' | 'red' | 'blue' {
  if (
    state === 'ack_overdue' ||
    state === 'contrl_failed' ||
    state === 'aperak_received_negative'
  ) {
    return 'red'
  }
  if (state === 'awaiting_contrl' || state === 'awaiting_aperak' || state === 'in_progress') {
    return 'yellow'
  }
  if (
    state === 'contrl_received' ||
    state === 'aperak_received_positive' ||
    state === 'utilts_err_received' ||
    state === 'no_ack_required'
  ) {
    return 'green'
  }
  return 'slate'
}

function QuickNavItem({
  href,
  label,
  description,
  tone = 'slate',
}: {
  href: string
  label: string
  description: string
  tone?: 'slate' | 'green' | 'yellow' | 'red' | 'blue'
}) {
  const borderClass =
    tone === 'green'
      ? 'border-emerald-200 hover:bg-emerald-50'
      : tone === 'yellow'
        ? 'border-amber-200 hover:bg-amber-50'
        : tone === 'red'
          ? 'border-rose-200 hover:bg-rose-50'
          : tone === 'blue'
            ? 'border-blue-200 hover:bg-blue-50'
            : 'border-slate-200 hover:bg-slate-50'

  return (
    <a
      href={href}
      className={`rounded-2xl border bg-white p-3 text-left transition ${borderClass}`}
    >
      <div className="text-sm font-semibold text-slate-950">{label}</div>
      <div className="mt-1 text-xs leading-5 text-slate-600">{description}</div>
    </a>
  )
}

function WorkflowStep({
  number,
  title,
  text,
  href,
}: {
  number: string
  title: string
  text: string
  href: string
}) {
  return (
    <a
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:bg-indigo-50"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
          {number}
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-950 group-hover:text-indigo-800">
            {title}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-600">{text}</div>
        </div>
      </div>
    </a>
  )
}

function MetricCard({
  label,
  value,
  help,
  tone = 'slate',
}: {
  label: string
  value: number | string
  help: string
  tone?: 'slate' | 'green' | 'yellow' | 'red' | 'blue'
}) {
  const className =
    tone === 'green'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'yellow'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : tone === 'red'
          ? 'border-rose-200 bg-rose-50 text-rose-900'
          : tone === 'blue'
            ? 'border-blue-200 bg-blue-50 text-blue-900'
            : 'border-slate-200 bg-white text-slate-950'

  return (
    <div className={`rounded-2xl border p-4 ${className}`}>
      <div className="text-sm opacity-80">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      <div className="mt-2 text-xs leading-5 opacity-75">{help}</div>
    </div>
  )
}

function SectionLabel({
  id,
  title,
  description,
}: {
  id: string
  title: string
  description: string
}) {
  return (
    <div id={id} className="scroll-mt-28 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Arbetsyta
      </div>
      <h2 className="mt-1 text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
        {description}
      </p>
    </div>
  )
}


function payloadContainsAll(rawPayload: string | null | undefined, values: string[]): boolean {
  const payload = rawPayload ?? ''
  return values.every((value) => payload.includes(value))
}

function isActiveAckStatus(status: string | null | undefined): boolean {
  return status !== 'cancelled'
}

function isBlockingDraftStatus(status: string | null | undefined): boolean {
  return status === 'draft' || status === 'queued' || status === 'prepared' || status === 'failed'
}

function isS142AperakPayload(rawPayload: string | null | undefined): boolean {
  return payloadContainsAll(rawPayload, [
    'ERC+42::260',
    '210::260',
    '213::260',
    '214::260',
    '226::260',
    '735999888000000123',
    '735999888000000130',
    '735999888000000147',
  ])
}

function extractZ04Reference(rawPayload: string | null | undefined): string | null {
  const payload = rawPayload ?? ''
  const bgm = payload
    .split("'")
    .map((part) => part.trim())
    .find((part) => part.startsWith('BGM+Z04+'))
  if (!bgm) return null
  return bgm.replace('BGM+Z04+', '').split('+')[0] || null
}

function messageCodePrefixesForTgt(message: Awaited<ReturnType<typeof listEdielMessages>>[number]): string[] {
  const family = String(message.message_family ?? '').toUpperCase()
  const code = String(message.message_code ?? '').toUpperCase()

  if (family === 'PRODAT') {
    if (code === 'Z03') return ['1.2', '1.3']
    if (code === 'Z04') return ['1.4', '1.5']
    if (code === 'Z06') return ['2.1', '2.2']
    if (code === 'Z10') return ['2.3', '2.4']
    if (code === 'Z09') return ['2.5']
    if (code === 'Z05') return ['3.1', '3.2']
  }

  if (family === 'UTILTS') {
    if (code === 'S02') return ['U1.1', 'U1.2']
    if (code === 'S03') return ['U1.3', 'U1.4']
    if (code === 'E66') return ['U2.1', 'U2.2']
  }

  return []
}

function textForTgtMatch(message: Awaited<ReturnType<typeof listEdielMessages>>[number]): string {
  return [
    message.raw_payload,
    message.external_reference,
    message.transaction_reference,
    message.interchange_reference,
    JSON.stringify(message.parsed_payload ?? {}),
    JSON.stringify(message.validation_report ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
}

function relevantTgtRowsForMessage(
  message: Awaited<ReturnType<typeof listEdielMessages>>[number],
  rows: EdielTgtDynamicTestDataSummary[]
): EdielTgtDynamicTestDataSummary[] {
  const family = String(message.message_family ?? '').toUpperCase()
  const suite = family === 'UTILTS' ? 'UTILTS' : family === 'PRODAT' ? 'PRODAT' : null
  if (!suite) return []

  const prefixes = messageCodePrefixesForTgt(message)
  const text = textForTgtMatch(message)

  const scopedRows = rows.filter((row) => row.testSuite === suite && row.roleCode === 'supplier')
  const exactMarker = `GRIDCORE_SOURCE_MESSAGE_ID:${message.id}`
  const exactRows = scopedRows.filter((row) => String(row.rawText ?? '').includes(exactMarker))

  if (exactRows.length > 0) {
    return exactRows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  return scopedRows
    .filter((row) => {
      if (text.includes(String(row.testCaseCode).toUpperCase())) return true
      return prefixes.some((prefix) => row.testCaseCode === prefix || row.testCaseCode.startsWith(`${prefix}.`) || row.testCaseCode.startsWith(`${prefix}b`))
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function selectedTgtRowForMessage(
  message: Awaited<ReturnType<typeof listEdielMessages>>[number],
  rows: EdielTgtDynamicTestDataSummary[]
): EdielTgtDynamicTestDataSummary | null {
  return relevantTgtRowsForMessage(message, rows)[0] ?? null
}

function defaultTestCaseCodeForMessage(message: Awaited<ReturnType<typeof listEdielMessages>>[number]): string {
  const firstRelevant = messageCodePrefixesForTgt(message)[0]
  return firstRelevant ? `${firstRelevant}.1` : ''
}

type AckRecommendation = {
  title: string
  description: string
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate'
  actionLabel: string | null
  ackFamily?: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  messageText?: string
  reasonItems: string[]
  decision: EdielAckDecision
}

function resolveAckRecommendation(params: {
  message: Awaited<ReturnType<typeof listEdielMessages>>[number]
  acks: Awaited<ReturnType<typeof listEdielMessages>>
  selectedTgtRow?: EdielTgtDynamicTestDataSummary | null
}): AckRecommendation {
  const decision = resolveRecommendedAckForInboundMessage({
    message: params.message,
    relatedAcks: params.acks,
    tgtTestData: params.selectedTgtRow?.parsedPayload ?? null,
  })

  return {
    title: decision.title,
    description: decision.description,
    tone: decision.tone,
    actionLabel: decision.action ? 'Skapa och skicka rekommenderat svar' : null,
    ackFamily: decision.action?.ackFamily,
    outcome: decision.action?.outcome,
    messageText: decision.action?.messageText ?? undefined,
    reasonItems: [
      `Backendregel: ${decision.matchedRule ?? decision.kind}`,
      params.selectedTgtRow ? `Jämför mot TGT-testdata: ${params.selectedTgtRow.testCaseCode} · ${params.selectedTgtRow.title}` : 'Ingen importerad TGT-testdata kopplad till detta inbound-beslut.',
      ...decision.reasonItems,
    ],
    decision,
  }
}

function RecommendedAckActionForm({
  messageId,
  recommendation,
  selectedTgtRow,
}: {
  messageId: string
  recommendation: AckRecommendation
  selectedTgtRow?: EdielTgtDynamicTestDataSummary | null
}) {
  if (!recommendation.actionLabel) return null

  return (
    <form action={createAndSendRecommendedAckAction}>
      <input type="hidden" name="sourceMessageId" value={messageId} />
      {selectedTgtRow ? (
        <>
          <input type="hidden" name="testSuite" value={selectedTgtRow.testSuite} />
          <input type="hidden" name="roleCode" value={selectedTgtRow.roleCode} />
          <input type="hidden" name="testCaseCode" value={selectedTgtRow.testCaseCode} />
        </>
      ) : null}
      <button className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800">
        {recommendation.actionLabel}
      </button>
    </form>
  )
}

function RecommendedAckPanel({
  message,
  acks,
  selectedTgtRow,
  relevantTgtRows,
}: {
  message: Awaited<ReturnType<typeof listEdielMessages>>[number]
  acks: Awaited<ReturnType<typeof listEdielMessages>>
  selectedTgtRow?: EdielTgtDynamicTestDataSummary | null
  relevantTgtRows?: EdielTgtDynamicTestDataSummary[]
}) {
  const recommendation = resolveAckRecommendation({ message, acks, selectedTgtRow })
  const panelToneClass =
    recommendation.tone === 'red'
      ? 'border-rose-200 bg-rose-50'
      : recommendation.tone === 'yellow'
        ? 'border-amber-200 bg-amber-50'
        : recommendation.tone === 'blue'
          ? 'border-blue-200 bg-blue-50'
          : recommendation.tone === 'green'
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-slate-200 bg-slate-50'

  return (
    <div className={`rounded-2xl border p-4 ${panelToneClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Rekommenderat svar</div>
          <h3 className="mt-1 text-sm font-semibold text-slate-950">{recommendation.title}</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-700">{recommendation.description}</p>
        </div>
        <Badge tone={recommendation.tone}>{recommendation.tone}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <RecommendedAckActionForm messageId={message.id} recommendation={recommendation} selectedTgtRow={selectedTgtRow} />
        {recommendation.ackFamily ? <Badge>{recommendation.ackFamily}</Badge> : null}
        {recommendation.outcome ? <Badge tone={recommendation.outcome === 'negative' ? 'red' : 'green'}>{recommendation.outcome}</Badge> : null}
        <Badge tone="blue">{recommendation.decision.kind}</Badge>
      </div>


      {message.message_family === 'PRODAT' || message.message_family === 'UTILTS' ? (
        <details className="mt-3 rounded-xl border border-indigo-100 bg-white/70 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-indigo-900">
            Testdata för backend-jämförelse {selectedTgtRow ? `· aktiv: ${selectedTgtRow.testCaseCode}` : '· ingen aktiv importerad data'}
          </summary>
          <InboundTestDataUploadForm
            action={saveEdielInboundMessageTestDataAction}
            sourceMessageId={message.id}
            testSuite={message.message_family === 'UTILTS' ? 'UTILTS' : 'PRODAT'}
            roleCode="supplier"
            defaultTestCaseCode={selectedTgtRow?.testCaseCode ?? ''}
            defaultTitle={selectedTgtRow?.title ?? ''}
            options={[
              ...(relevantTgtRows && relevantTgtRows.length > 0
                ? relevantTgtRows.map((row) => ({ value: row.testCaseCode, label: `${row.testCaseCode} · ${row.title}` }))
                : []),
              ...(message.message_family === 'PRODAT' && String(message.message_code).toUpperCase() === 'Z06'
                ? [
                    { value: '2.1.1', label: '2.1.1 · Z06F ändrad avräkningsmetod/mätmetod' },
                    { value: '2.1.2', label: '2.1.2 · Z06F ändrad räkneverkstyp' },
                    { value: '2.1.3', label: '2.1.3 · Z06G ändring av anläggningsadress' },
                    { value: '2.2.1', label: '2.2.1 · Z06F felaktigt anläggningsid' },
                    { value: '2.2.2', label: '2.2.2 · Z06F antal siffror saknas' },
                  ]
                : []),
              ...(message.message_family === 'PRODAT' && String(message.message_code).toUpperCase() === 'Z10'
                ? [
                    { value: '2.4.1', label: '2.4.1 · Z10M felaktig' },
                    { value: '2.4.2', label: '2.4.2 · Z10M konstant saknas' },
                  ]
                : []),
              ...(message.message_family === 'PRODAT' && String(message.message_code).toUpperCase() === 'Z05'
                ? [{ value: '3.2.1', label: '3.2.1 · Z05LK felaktigt anläggningsid' }]
                : []),
            ]}
          />
        </details>
      ) : null}

      {recommendation.reasonItems.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs leading-5 text-slate-700">
          {recommendation.reasonItems.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function isInboundProdatMessage(message: Awaited<ReturnType<typeof listEdielMessages>>[number]): boolean {
  return message.direction === 'inbound' && message.message_family === 'PRODAT'
}

function AdvancedAckActions({
  message,
  hasContrl,
  hasAperak,
}: {
  message: Awaited<ReturnType<typeof listEdielMessages>>[number]
  hasContrl: boolean
  hasAperak: boolean
}) {
  const isInboundProdatZ04 = isInboundProdatMessage(message) && String(message.message_code).toUpperCase() === 'Z04'

  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Avancerat · manuella kvittenser och testpresets</summary>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Använd normalt rekommenderad åtgärd ovan. Avancerat finns för testfall, felsökning och manuell återställning.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!hasContrl ? (
          <form action={createAndSendAckAction}>
            <input type="hidden" name="sourceMessageId" value={message.id} />
            <input type="hidden" name="ackType" value="CONTRL" />
            <input type="hidden" name="outcome" value="positive" />
            <button className="rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
              Positiv CONTRL
            </button>
          </form>
        ) : null}

        {!hasContrl ? (
          <form action={createAndSendAckAction}>
            <input type="hidden" name="sourceMessageId" value={message.id} />
            <input type="hidden" name="ackType" value="CONTRL" />
            <input type="hidden" name="outcome" value="negative" />
            <input type="hidden" name="messageText" value="Syntaxfel enligt Edielportalens TGT-test" />
            <button className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">
              Negativ CONTRL
            </button>
          </form>
        ) : null}

        {!hasAperak ? (
          <form action={createAndSendAckAction}>
            <input type="hidden" name="sourceMessageId" value={message.id} />
            <input type="hidden" name="ackType" value="APERAK" />
            <input type="hidden" name="outcome" value="positive" />
            <button className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
              Positiv APERAK
            </button>
          </form>
        ) : null}

        {isInboundProdatZ04 && !hasAperak ? (
          <>
            <form action={createAndSendTgtS142AperakAction}>
              <input type="hidden" name="sourceMessageId" value={message.id} />
              <button className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Testpreset 1.4.2</button>
            </form>
            <form action={createAndSendTgtS142BAperakAction}>
              <input type="hidden" name="sourceMessageId" value={message.id} />
              <button className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Testpreset 1.4.2B</button>
            </form>
            <form action={createAndSendTgtS143AperakAction}>
              <input type="hidden" name="sourceMessageId" value={message.id} />
              <button className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Testpreset 1.4.3</button>
            </form>
          </>
        ) : null}

        {hasContrl && hasAperak ? <Badge tone="green">CONTRL och APERAK finns</Badge> : null}
      </div>
    </details>
  )
}

function TgtS142Preview() {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      <div className="rounded-xl border border-rose-200 bg-white p-3">
        <div className="text-xs font-semibold text-rose-800">S12 · 735999888000000123</div>
        <div className="mt-1 text-xs leading-5 text-slate-700">42 / 210 · Felaktigt startdatum</div>
        <div className="text-xs leading-5 text-slate-700">41 / 213 · Årsförbrukning saknas</div>
      </div>
      <div className="rounded-xl border border-rose-200 bg-white p-3">
        <div className="text-xs font-semibold text-rose-800">S13 · 735999888000000130</div>
        <div className="mt-1 text-xs leading-5 text-slate-700">41 / 214 · Konstant saknas</div>
        <div className="text-xs leading-5 text-slate-700">41 / 226 · Ärendereferens saknas</div>
      </div>
      <div className="rounded-xl border border-emerald-200 bg-white p-3">
        <div className="text-xs font-semibold text-emerald-800">S14 · 735999888000000147</div>
        <div className="mt-1 text-xs leading-5 text-slate-700">100 / OK · Godkänd anläggning</div>
      </div>
    </div>
  )
}

function AckRow({ ack }: { ack: Awaited<ReturnType<typeof listEdielMessages>>[number] }) {
  const ackLooksLikeS142 = ack.message_family === 'APERAK' && isS142AperakPayload(ack.raw_payload)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-700">
        <span className="font-semibold">{ack.message_family}</span> · {ack.status} · {ackLooksLikeS142 ? 'S1.4.2-preset · ' : ''}{ack.file_name ?? ack.id}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/admin/ediel/messages/${ack.id}`} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Öppna
        </Link>
        {ack.status === 'draft' || ack.status === 'queued' || ack.status === 'prepared' ? (
          <form action={sendEdielMessageAction}>
            <input type="hidden" name="edielMessageId" value={ack.id} />
            <button className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700">
              Skicka
            </button>
          </form>
        ) : null}
        <form action={cancelEdielMessageAction}>
          <input type="hidden" name="edielMessageId" value={ack.id} />
          <input type="hidden" name="reason" value="Raderad/dold från inbound-kortets kopplade kvittenser." />
          <button className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">
            Radera
          </button>
        </form>
      </div>
    </div>
  )
}

function IncomingPortalResponses({
  messages,
  dynamicTgtTestDataRows,
}: {
  messages: Awaited<ReturnType<typeof listEdielMessages>>
  dynamicTgtTestDataRows: EdielTgtDynamicTestDataSummary[]
}) {
  const inboundMessages = messages
    .filter((row) => row.direction === 'inbound')
    .filter((row) => row.status !== 'cancelled')
    .filter((row) => ['PRODAT', 'CONTRL', 'APERAK', 'UTILTS_ERR'].includes(row.message_family))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 12)

  function relatedAcks(sourceId: string) {
    return messages
      .filter((row) => row.direction === 'outbound')
      .filter((row) => row.related_message_id === sourceId)
      .filter((row) => ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(row.message_family))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  }

  const latestInboundZ04 = inboundMessages.find(
    (message) =>
      message.message_family === 'PRODAT' &&
      String(message.message_code).toUpperCase() === 'Z04'
  )
  const latestInboundZ04Acks = latestInboundZ04 ? relatedAcks(latestInboundZ04.id) : []
  const latestInboundZ04ActiveAcks = latestInboundZ04Acks.filter((ack) => isActiveAckStatus(ack.status))
  const latestInboundZ04Contrl = latestInboundZ04ActiveAcks.find((ack) => ack.message_family === 'CONTRL')
  const latestInboundZ04Aperak = latestInboundZ04ActiveAcks.find((ack) => ack.message_family === 'APERAK')
  const latestInboundZ04HasCorrectS142Aperak = latestInboundZ04Aperak
    ? isS142AperakPayload(latestInboundZ04Aperak.raw_payload)
    : false
  const latestInboundZ04Reference = extractZ04Reference(latestInboundZ04?.raw_payload)

  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Senaste inbound via IMAP</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
            Här är portalens inkommande svar. GridCore visar ett rekommenderat svar per meddelande och skickar direkt. Testpresets och manuella kvittenser ligger under Avancerat.
          </p>
        </div>
        <Badge tone="green">{inboundMessages.length} visas</Badge>
      </div>

      {latestInboundZ04 ? (
        <div className="mt-4 rounded-3xl border border-rose-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="red">Åtgärd krävs · senaste inkommande PRODAT/Z04</Badge>
                <Badge tone={getOutboundStatusTone(latestInboundZ04.status)}>{latestInboundZ04.status}</Badge>
                {latestInboundZ04Contrl ? <Badge tone="green">CONTRL finns</Badge> : <Badge tone="yellow">CONTRL saknas</Badge>}
                {latestInboundZ04HasCorrectS142Aperak ? <Badge tone="green">APERAK skickad</Badge> : <Badge tone="yellow">APERAK saknas</Badge>}
              </div>
              <h3 className="mt-2 text-base font-semibold text-slate-950">Senaste inkommande PRODAT/Z04 · kontrollera rekommenderat svar</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Matchat meddelande: <span className="font-semibold">PRODAT/Z04</span>{latestInboundZ04Reference ? ` · ${latestInboundZ04Reference}` : ''}. Detta är bara en genväg till senaste Z04; den slutliga åtgärden styrs av rekommendationen på inbound-kortet.
              </p>
            </div>
            <Link href={`/admin/ediel/messages/${latestInboundZ04.id}`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Öppna Z04
            </Link>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <RecommendedAckPanel
              message={latestInboundZ04}
              acks={latestInboundZ04Acks}
              selectedTgtRow={selectedTgtRowForMessage(latestInboundZ04, dynamicTgtTestDataRows)}
              relevantTgtRows={relevantTgtRowsForMessage(latestInboundZ04, dynamicTgtTestDataRows)}
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">SaaS-säkert arbetssätt</div>
              <p className="mt-2 text-xs leading-5 text-slate-700">
                Samma vy fungerar per bolag/tenant: operatören ser rekommenderad åtgärd, medan testpresets och manuella val ligger under Avancerat på själva inbound-kortet.
              </p>
              <div className="mt-3 space-y-2 text-xs text-slate-700">
                <div className="rounded-xl bg-white p-2">1. Systemet bedömer syntax före affärskvittens.</div>
                <div className="rounded-xl bg-white p-2">2. Kvittenser skickas direkt, inte som dolda drafts.</div>
                <div className="rounded-xl bg-white p-2">3. Manuell override finns men är separerad från normalflödet.</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {inboundMessages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-emerald-300 bg-white p-4 text-sm text-slate-600">
            Inga importerade IMAP-svar hittades i aktivt scope.
          </div>
        ) : (
          inboundMessages.map((message) => {
            const isInboundBusinessMessage =
              message.message_family !== 'CONTRL' &&
              message.message_family !== 'APERAK' &&
              message.message_family !== 'UTILTS_ERR'
            const requiresContrlOnly = message.message_family === 'APERAK'
            const acks = relatedAcks(message.id)
            const activeAcks = acks.filter((ack) => isActiveAckStatus(ack.status))
            const hasContrl = activeAcks.some((row) => row.message_family === 'CONTRL')
            const hasAperak = activeAcks.some((row) => row.message_family === 'APERAK')
            const isInboundProdatZ04 =
              message.direction === 'inbound' &&
              message.message_family === 'PRODAT' &&
              String(message.message_code).toUpperCase() === 'Z04'
            const bgClass = isInboundProdatZ04 ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-white'

            return (
              <div key={message.id} className={`rounded-2xl border p-4 shadow-sm ${bgClass}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={message.message_family === 'PRODAT' ? 'blue' : 'green'}>
                        inbound {message.message_family} / {message.message_code}
                      </Badge>
                      {isInboundProdatZ04 ? <Badge tone="red">PRODAT/Z04 · rekommendation styr</Badge> : null}
                      <Badge tone={getOutboundStatusTone(message.status)}>{message.status}</Badge>
                      {message.related_message_id ? <Badge tone="green">kopplad</Badge> : <Badge tone="yellow">ej kopplad</Badge>}
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-950">{message.subject ?? message.file_name ?? message.id}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {message.sender_ediel_id ?? '—'}:{message.sender_sub_address ?? '—'} → {message.receiver_ediel_id ?? '—'}:{message.receiver_sub_address ?? '—'} · {formatDateTime(message.created_at)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/admin/ediel/messages/${message.id}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Öppna</Link>
                    <form action={cancelEdielMessageAction}>
                      <input type="hidden" name="edielMessageId" value={message.id} />
                      <input type="hidden" name="reason" value="Raderad/dold från IMAP-listan via inbound-kort." />
                      <button className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Radera</button>
                    </form>
                  </div>
                </div>

                {isInboundBusinessMessage ? (
                  <div className="mt-4 space-y-3">
                    <RecommendedAckPanel
                      message={message}
                      acks={acks}
                      selectedTgtRow={selectedTgtRowForMessage(message, dynamicTgtTestDataRows)}
                      relevantTgtRows={relevantTgtRowsForMessage(message, dynamicTgtTestDataRows)}
                    />
                    <AdvancedAckActions message={message} hasContrl={hasContrl} hasAperak={hasAperak} />
                  </div>
                ) : requiresContrlOnly ? (
                  <div className="mt-4 space-y-3">
                    <RecommendedAckPanel
                      message={message}
                      acks={acks}
                      selectedTgtRow={selectedTgtRowForMessage(message, dynamicTgtTestDataRows)}
                      relevantTgtRows={relevantTgtRowsForMessage(message, dynamicTgtTestDataRows)}
                    />
                    <AdvancedAckActions message={message} hasContrl={hasContrl} hasAperak={hasAperak} />
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800">
                    Detta är en inkommande CONTRL/teknisk kvittens från portalen. Den registreras och kopplas. Skapa ingen ny kvittens på CONTRL.
                  </div>
                )}

                {acks.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kvittenser kopplade till denna rad</div>
                    {acks.map((ack) => <AckRow key={ack.id} ack={ack} />)}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

export default async function AdminEdielPage() {
  await requirePermissionServer('communication.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [
    messagesRaw,
    testRunsRaw,
    switchRequestsRaw,
    dataRequestsRaw,
    outboundRaw,
    routesRaw,
    gridOwnersRaw,
    overdueAckMessages,
    duplicateAckCandidates,
    duplicateBlockEvents,
    ackConflictEvents,
    versionMismatchMessages,
    invalidCodeMessages,
    ruleAmbiguities,
    dynamicTgtTestData,
  ] = await Promise.all([
    listEdielMessages({ limit: 120 }),
    listEdielTestRuns(),
    supabase
      .from('supplier_switch_requests')
      .select(
        'id,status,customer_id,site_id,metering_point_id,external_reference,created_at'
      )
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('grid_owner_data_requests')
      .select(
        'id,status,request_scope,customer_id,site_id,metering_point_id,external_reference,created_at'
      )
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('outbound_requests')
      .select(
        'id,request_type,source_type,source_id,status,channel_type,communication_route_id,external_reference,customer_id,site_id,metering_point_id,created_at'
      )
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('communication_routes')
      .select(
        'id,route_name,is_active,route_scope,route_type,grid_owner_id,target_system,target_email'
      )
      .order('updated_at', { ascending: false }),
    supabase.from('grid_owners').select('id,name,ediel_id').order('name'),
    listOverdueAckMessages({ limit: 20 }),
    listDuplicateAckCandidates(),
    listCanonicalDuplicateBlockEvents({ limit: 20 }),
    listCanonicalAckConflictEvents({ limit: 20 }),
    listRecentVersionMismatchMessages({ limit: 20 }),
    listRecentInvalidCodeUsageMessages({ limit: 20 }),
    listRuleAmbiguities(),
    listEdielTgtDynamicTestData(),
  ])

  if (switchRequestsRaw.error) throw switchRequestsRaw.error
  if (dataRequestsRaw.error) throw dataRequestsRaw.error
  if (outboundRaw.error) throw outboundRaw.error
  if (routesRaw.error) throw routesRaw.error
  if (gridOwnersRaw.error) throw gridOwnersRaw.error

  const switchRequests = (switchRequestsRaw.data ?? []) as SimpleSwitchRequestRow[]
  const dataRequests = (dataRequestsRaw.data ?? []) as SimpleDataRequestRow[]
  const outboundRequests = (outboundRaw.data ?? []) as SimpleOutboundRow[]
  const allRoutes = (routesRaw.data ?? []) as SimpleCommunicationRouteRow[]
  const gridOwners = (gridOwnersRaw.data ?? []) as SimpleGridOwnerRow[]

  const messages = messagesRaw.filter((row) => isActiveEdielMessageFamily(row.message_family) && row.status !== 'cancelled')
  const cancelledMessagesCount = messagesRaw.filter((row) => row.status === 'cancelled').length
  const hiddenMessagesCount = messagesRaw.length - messages.length

  const testRuns = testRunsRaw.filter((row) => isActiveEdielTestSuite(row.test_suite))
  const hiddenTestRunsCount = testRunsRaw.length - testRuns.length
  const safeApplyReviewItems = await listSafeApplyReviewItems(messages)
  const utiltsBillingReviewItems = listUtiltsBillingReviewItems(messages)
  const prodatProductionCandidates = await listEdielProdatProductionCandidates(supabase, 30)
  const inboundCases = await listEdielInboundCases({ status: 'all', limit: 40 })

  const edielRoutes = allRoutes.filter(isEdielCandidateRoute)
  const routeProfiles = await Promise.all(
    edielRoutes.map((route) => getEdielRouteProfileByCommunicationRouteId(route.id))
  )

  const profileByRouteId = new Map(
    routeProfiles
      .filter((profile) => Boolean(profile))
      .map((profile) => [profile!.communication_route_id, profile!])
  )

  const gridOwnerById = new Map(gridOwners.map((row) => [row.id, row]))

  const workbenchRoutes = edielRoutes.map((route) => {
    const gridOwner = route.grid_owner_id
      ? gridOwnerById.get(route.grid_owner_id) ?? null
      : null

    const profile = profileByRouteId.get(route.id) ?? null

    return {
      id: route.id,
      route_name: route.route_name,
      route_scope: route.route_scope,
      route_type: route.route_type,
      target_email: route.target_email,
      target_system: route.target_system,
      grid_owner_id: route.grid_owner_id,
      grid_owner_name: gridOwner?.name ?? null,
      grid_owner_ediel_id: gridOwner?.ediel_id ?? null,
      is_active: route.is_active,
      profile: profile
        ? {
            is_enabled: profile.is_enabled,
            sender_ediel_id: profile.sender_ediel_id,
            receiver_ediel_id: profile.receiver_ediel_id,
            mailbox: profile.mailbox,
            sender_sub_address: profile.sender_sub_address,
            receiver_sub_address: profile.receiver_sub_address,
            application_reference: profile.application_reference,
            smtp_host: profile.smtp_host,
            smtp_port: profile.smtp_port,
            imap_host: profile.imap_host,
            imap_port: profile.imap_port,
            encryption_mode: profile.encryption_mode,
          }
        : null,
    }
  })

  const recommendation = getRecommendationSummary({
    switchRequests,
    outboundRequests,
    messages,
    routes: workbenchRoutes,
    preferredFamily: 'PRODAT',
  })

  const outboundWithoutRoute = outboundRequests.filter(
    (row) => !row.communication_route_id
  ).length
  const acknowledgedOutboundCount = outboundRequests.filter(
    (row) => row.status === 'acknowledged'
  ).length
  const unresolvedOutboundCount = outboundRequests.filter(
    (row) => row.channel_type === 'unresolved'
  ).length
  const outboundBackedByEdielCount = outboundRequests.filter((row) =>
    messages.some((message) => message.outbound_request_id === row.id)
  ).length
  const activeTestRunsCount = testRuns.filter((row) =>
    ['draft', 'running'].includes(row.status)
  ).length
  const inboundCount = messages.filter((row) => row.direction === 'inbound').length
  const inboundCasePendingCount = inboundCases.filter((row) => row.status === 'pending_review' || row.status === 'failed').length
  const outboundCount = messages.filter((row) => row.direction === 'outbound').length
  const prodatCount = messages.filter((row) => row.message_family === 'PRODAT').length
  const utiltsCount = messages.filter((row) => row.message_family === 'UTILTS').length
  const safeApplyPendingCount = safeApplyReviewItems.filter((row) => row.status === 'pending').length
  const utiltsReadyCount = utiltsBillingReviewItems.filter((row) => row.status === 'ready').length
  const warningCount =
    overdueAckMessages.length +
    duplicateAckCandidates.length +
    duplicateBlockEvents.length +
    ackConflictEvents.length +
    versionMismatchMessages.length +
    invalidCodeMessages.length +
    ruleAmbiguities.length +
    inboundCasePendingCount +
    unresolvedOutboundCount

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel"
        subtitle="Operativ release 1 med canonical kernel, dedupe-spårning, versionssignaler och kontrollflöden i samma runtime."
        userEmail={user?.email ?? null}
      />

      <section id="overview" className="scroll-mt-28 rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
              Starta här
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">
              Ediel arbetsyta för TGT/systemtest och riktig Ediel-drift
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
              Använd sidan uppifrån och ned. TGT/systemtest mot Edielportalen hålls tydligt separerat från riktig kundstyrd Ediel-drift, men använder samma PRODAT-, ACK- och transportmotor. Filbaserad Ediel-motor är avvecklad från huvudflödet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form action={pollMailboxAction}>
              <input type="hidden" name="limit" value="20" />
              <button className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">
                Hämta IMAP nu
              </button>
            </form>
            <Badge tone="blue">Gridex Ediel-ID 21660</Badge>
            <Badge tone="blue">Edielportalen/TGT 91100</Badge>
            <Badge tone="green">SMTP/IMAP aktivt</Badge>
            <Badge tone={warningCount > 0 ? 'yellow' : 'green'}>
              signaler: {warningCount}
            </Badge>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <WorkflowStep
            number="1"
            title="Hämta IMAP-svar"
            text="Importera Edielportalens CONTRL, APERAK och PRODAT-svar tydligt."
            href="#inbound-responses"
          />
          <WorkflowStep
            number="2"
            title="Riktig Ediel-drift"
            text="Kundstyrd PRODAT mot riktiga routes. Inte samma kö som TGT-testkörning."
            href="#production-prodat"
          />
          <WorkflowStep
            number="3"
            title="Koppla verksamhet"
            text="Knyt Z03/Z04/ACK/UTILTS mot switch, anläggning och mätpunkt."
            href="#operations"
          />
          <WorkflowStep
            number="4"
            title="Granska innan ändring"
            text="Godkänn eller avvisa Z06/Z10 och processa mätvärdesunderlag."
            href="#safe-apply"
          />
        </div>
      </section>

      <nav className="sticky top-2 z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-8">
          <QuickNavItem href="#overview" label="Översikt" description="Status och snabbstart" tone="blue" />
          <QuickNavItem href="#inbound-responses" label="IMAP-svar" description="CONTRL/APERAK/PRODAT" tone="green" />
          <QuickNavItem href="#production-prodat" label="PRODAT" description="Kundstyrd Z03/Z04" tone="green" />
          <QuickNavItem href="#tgt" label="TGT-test" description="Testfall och steg" tone="blue" />
          <QuickNavItem href="#inbound-cases" label="Inbound-case" description="Admin-godkännande" tone="yellow" />
          <QuickNavItem href="#operations" label="Verksamhet" description="Switch och UTILTS" tone="yellow" />
          <QuickNavItem href="#safe-apply" label="Safe apply" description="Granska ändringar" tone="green" />
          <QuickNavItem href="#diagnostics" label="Diagnostik" description="Fel och varningar" tone="red" />
          <QuickNavItem href="#runtime" label="Runtime" description="Queue och routes" tone="slate" />
        </div>
      </nav>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Meddelanden" value={messages.length} help="Aktiva Ediel-meddelanden i release-scope." tone="blue" />
        <MetricCard label="Aktiva test" value={activeTestRunsCount} help="TGT-runs i draft eller running." tone={activeTestRunsCount > 0 ? 'yellow' : 'slate'} />
        <MetricCard label="Inbound-case" value={inboundCasePendingCount} help="PRODAT som väntar på admin-godkännande." tone={inboundCasePendingCount > 0 ? 'yellow' : 'green'} />
        <MetricCard label="Safe apply" value={safeApplyPendingCount} help="Z06/Z10-förslag som väntar på granskning." tone={safeApplyPendingCount > 0 ? 'yellow' : 'green'} />
        <MetricCard label="UTILTS redo" value={utiltsReadyCount} help="Mätvärdesunderlag redo för handläggning." tone={utiltsReadyCount > 0 ? 'green' : 'slate'} />
        <MetricCard label="Unresolved" value={unresolvedOutboundCount} help="Outbound utan löst kanal eller route." tone={unresolvedOutboundCount > 0 ? 'red' : 'green'} />
        <MetricCard label="Varningar" value={warningCount} help="Diagnostiska signaler som bör kontrolleras." tone={warningCount > 0 ? 'red' : 'green'} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <div className="flex items-center gap-2">
            <Badge tone="blue">TGT / systemtest</Badge>
            <span className="text-sm font-semibold text-slate-950">Edielportalen 91100</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Används för typgodkännande mot Edielportalen. Här får du testdata, Z03/Z04-steg, IMAP-svar och portalens CONTRL/APERAK/PRODAT i en styrd testvy.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-2">
            <Badge tone="green">Riktig Ediel-drift</Badge>
            <span className="text-sm font-semibold text-slate-950">Kund, route och motpart</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Används för verkliga kunder och nätägare. Samma PRODAT-, ACK- och SMTP/IMAP-motor används, men underlaget måste komma från kundkort, anläggning, mätpunkt och godkänd route.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Aktivt scope är låst
            </h2>
            <p className="mt-1 text-sm text-slate-700">
              Den här vyn visar bara aktivt release-scope. Framtida spår hålls utanför den operativa Ediel-vyn tills de verkligen tas i bruk.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">
              familjer: {ACTIVE_EDIEL_MESSAGE_FAMILIES.join(', ')}
            </Badge>
            <Badge tone="blue">
              testsviter: {ACTIVE_EDIEL_TEST_SUITES.join(', ')}
            </Badge>
            <Badge tone={hiddenMessagesCount > 0 ? 'yellow' : 'green'}>
              dolda/arkiverade meddelanden: {hiddenMessagesCount}
            </Badge>
            <Badge tone={cancelledMessagesCount > 0 ? 'yellow' : 'green'}>
              rensade: {cancelledMessagesCount}
            </Badge>
            <Badge tone={hiddenTestRunsCount > 0 ? 'yellow' : 'green'}>
              dolda test runs: {hiddenTestRunsCount}
            </Badge>
          </div>
        </div>
      </section>

      <SectionLabel
        id="inbound-responses"
        title="1. Inkomna svar från Edielportalen"
        description="Här ser du exakt vad IMAP-importen hittade: CONTRL, APERAK och inkommande PRODAT. Skapa eller skicka kvittenser från rätt rad: PRODAT ska få CONTRL + APERAK, inbound APERAK ska bara kunna få CONTRL, och CONTRL ska aldrig kvitteras."
      />

      <IncomingPortalResponses messages={messages} dynamicTgtTestDataRows={dynamicTgtTestData} />

      <SectionLabel
        id="production-prodat"
        title="2. Kundstyrd PRODAT"
        description="Skapa Z03/Z04 från riktig kund, anläggning, mätpunkt, fullmakt och route. Systemet spärrar ofullständigt underlag."
      />

      <EdielProductionProdatPanel candidates={prodatProductionCandidates} messages={messages} />

      <SectionLabel
        id="tgt"
        title="3. TGT-test och guided mode"
        description="Skapa test run, se testdata, skapa fil för nästa steg och importera portalens svar."
      />

      <EdielTgtWorkbenchPanel messages={messages} testRuns={testRuns} dynamicTestDataRows={dynamicTgtTestData} />

      <SectionLabel
        id="inbound-cases"
        title="4. Inbound PRODAT-case och admin-godkännande"
        description="Inkommande PRODAT skapar ett staging-case. Admin godkänner innan kund, anläggning och mätpunkt skapas eller uppdateras."
      />

      <EdielInboundCasesPanel cases={inboundCases} />

      <SectionLabel
        id="operations"
        title="5. Verksamhetskoppling"
        description="Koppla Ediel-meddelanden till supplier switch, outbound queue, data requests och mätvärden."
      />

      <EdielOperationalBridgePanel
        messages={messages}
        switchRequests={switchRequests}
        dataRequests={dataRequests}
        outboundRequests={outboundRequests}
        routes={workbenchRoutes}
      />


      <EdielOperationalVerificationPanel
        messages={messages}
        switchRequests={switchRequests}
        dataRequests={dataRequests}
        outboundRequests={outboundRequests}
      />

      <SectionLabel
        id="safe-apply"
        title="4. Safe apply och mätvärdesunderlag"
        description="Granska Z06/Z10-förslag innan masterdata ändras och processa UTILTS till underlag."
      />

      <EdielSafeApplyReviewPanel
        safeApplyItems={safeApplyReviewItems}
        utiltsItems={utiltsBillingReviewItems}
      />

      <SectionLabel
        id="diagnostics"
        title="Diagnostik och blockerande signaler"
        description="Här ser du om något stoppar test eller drift: overdue ACK, dubletter, versionsfel och kodlistsignaler."
      />

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Försenade ack</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {overdueAckMessages.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Canonical ack overdue.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Ack-dubletter</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {duplicateAckCandidates.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Faktiska ack-kandidater i historiken.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Duplicate-block</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {duplicateBlockEvents.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Kernel-blockeringar från events.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Ack-konflikter</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {ackConflictEvents.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Dubbel eller konflikt i ack-chain.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Version mismatch</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {versionMismatchMessages.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Runtime-signal från payload/validation.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Kodlist-signaler</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {invalidCodeMessages.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Ogiltig kod eller code list usage.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Regelambiguiteter</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {ruleAmbiguities.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">Flera aktiva regler samtidigt.</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Unresolved outbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {unresolvedOutboundCount}
          </div>
          <div className="mt-2 text-xs text-slate-500">Affärsqueue utan klar route.</div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Runtime-diagnostik från canonical lagret
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Den här startsidan visar nu samma diagnosspår som control tower: overdue ack, duplicate-blocks, ack-konflikter, versionssignaler och kodlistsignaler.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/ediel/control-tower"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Öppna control tower
            </Link>
            <Link
              href="/admin/ediel/routes"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Routes
            </Link>
            <Link
              href="/admin/ediel/settings"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Settings
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">
              Senaste duplicate-blocks / ack-konflikter
            </div>
            <div className="space-y-3">
              {[...duplicateBlockEvents.slice(0, 3), ...ackConflictEvents.slice(0, 3)].length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  Inga duplicate-blocks eller ack-konflikter just nu.
                </div>
              ) : (
                [...duplicateBlockEvents.slice(0, 3), ...ackConflictEvents.slice(0, 3)].map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-950">
                        {row.issue_kind === 'ack_conflict'
                          ? `Ack-konflikt ${row.ack_family ?? ''}`
                          : `Duplicate-block ${row.dedupe_layer ?? ''}`}
                      </div>
                      <Badge tone={row.issue_kind === 'ack_conflict' ? 'red' : 'yellow'}>
                        {row.issue_kind}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{row.message ?? '—'}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {formatDateTime(row.created_at)}
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/admin/ediel/messages/${row.ediel_message_id}`}
                        className="text-sm text-indigo-700 underline-offset-2 hover:underline"
                      >
                        Öppna meddelande
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">
              Senaste versions- / kodlistsignaler
            </div>
            <div className="space-y-3">
              {[...versionMismatchMessages.slice(0, 3), ...invalidCodeMessages.slice(0, 3)].length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  Inga versions- eller kodlistsignaler just nu.
                </div>
              ) : (
                [...versionMismatchMessages.slice(0, 3), ...invalidCodeMessages.slice(0, 3)].map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-950">
                        {row.message_family} {row.message_code}
                      </div>
                      <Badge tone={versionMismatchMessages.some((m) => m.id === row.id) ? 'yellow' : 'red'}>
                        {versionMismatchMessages.some((m) => m.id === row.id)
                          ? 'version'
                          : 'code-list'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {row.message_version ?? 'utan version'} · {row.direction}
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/admin/ediel/messages/${row.id}`}
                        className="text-sm text-indigo-700 underline-offset-2 hover:underline"
                      >
                        Öppna meddelande
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <SectionLabel
        id="runtime"
        title="Runtime, rekommendationer och köer"
        description="Här ser du route-rekommendation, outbound queue, senaste switch/data requests, meddelanden och routes."
      />

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Server-side rekommendation just nu
            </h2>
            <p className="mt-1 text-sm text-slate-700">
              Panelen räknas fram på serversidan innan workbenchen renderas, så du ser bästa kandidat direkt för aktivt scope.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge tone={recommendation.routeHealth.isRouteActive ? 'green' : 'red'}>
              route {recommendation.routeHealth.isRouteActive ? 'aktiv' : 'inaktiv'}
            </Badge>
            <Badge tone={recommendation.routeHealth.isEdielEnabled ? 'green' : 'red'}>
              ediel {recommendation.routeHealth.isEdielEnabled ? 'på' : 'av'}
            </Badge>
            <Badge tone={recommendation.routeHealth.hasTargetEmail ? 'green' : 'yellow'}>
              target email {recommendation.routeHealth.hasTargetEmail ? 'ok' : 'saknas'}
            </Badge>
            <Badge tone={recommendation.routeHealth.hasSenderEdielId ? 'green' : 'red'}>
              sender {recommendation.routeHealth.hasSenderEdielId ? 'ok' : 'saknas'}
            </Badge>
            <Badge tone={recommendation.routeHealth.hasReceiverEdielId ? 'green' : 'red'}>
              receiver {recommendation.routeHealth.hasReceiverEdielId ? 'ok' : 'saknas'}
            </Badge>
            <Badge tone={recommendation.routeHealth.hasMailbox ? 'green' : 'red'}>
              mailbox {recommendation.routeHealth.hasMailbox ? 'ok' : 'saknas'}
            </Badge>
            <Badge tone={recommendation.routeHealth.isReadyForOutbound ? 'green' : 'red'}>
              outbound {recommendation.routeHealth.isReadyForOutbound ? 'redo' : 'blockerad'}
            </Badge>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/70 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">Routebedömning</div>
          <p className="mt-2 text-sm text-slate-600">{recommendation.routeSummary}</p>

          {recommendation.routeIssues.length > 0 ? (
            <div className="mt-3 space-y-2">
              {recommendation.routeIssues.map((issue) => (
                <div
                  key={issue.key}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    issue.severity === 'error'
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  <div className="font-medium">{issue.label}</div>
                  <div className="mt-1 text-xs opacity-80">{issue.resolution}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4">
            <EdielRouteIssueActions
              route={recommendation.recommendedRoute}
              issues={recommendation.routeIssues}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-5">
          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Senaste switch
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {recommendation.selectedSwitchId || '—'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bästa route
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {routeLabel(recommendation.recommendedRoute)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bästa outbound att skicka
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {recommendation.recommendedSendMessage
                ? `${recommendation.recommendedSendMessage.message_family} ${recommendation.recommendedSendMessage.message_code}`
                : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {recommendation.recommendedSendMessage?.id ?? 'inget skickbart meddelande'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bästa inbound UTILTS
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {recommendation.recommendedInboundUtilts
                ? `${recommendation.recommendedInboundUtilts.message_family} ${recommendation.recommendedInboundUtilts.message_code}`
                : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {recommendation.recommendedInboundUtilts?.id ?? 'inget inbound UTILTS ännu'}
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Bästa ACK-källa
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {recommendation.recommendedAckSource
                ? `${recommendation.recommendedAckSource.message_family} ${recommendation.recommendedAckSource.message_code}`
                : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {recommendation.recommendedAckSource?.id ?? 'ingen lämplig ACK-källa ännu'}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Aktiva meddelanden</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {messages.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Outbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {outboundCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Inbound</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {inboundCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">PRODAT</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {prodatCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">UTILTS</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {utiltsCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Aktiva test runs</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {activeTestRunsCount}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Outbound i kö</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {outboundRequests.length}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Intern queue som driver dispatch och Ediel-flöden.
          </div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm text-amber-700">Saknar route</div>
          <div className="mt-2 text-3xl font-semibold text-amber-900">
            {outboundWithoutRoute}
          </div>
          <div className="mt-2 text-xs text-amber-700">
            Registrerade men inte skickbara ännu.
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm text-emerald-700">Kvitterade outbound</div>
          <div className="mt-2 text-3xl font-semibold text-emerald-900">
            {acknowledgedOutboundCount}
          </div>
          <div className="mt-2 text-xs text-emerald-700">
            Har fått svar eller kvittens tillbaka i kedjan.
          </div>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm text-blue-700">Outbound med Ediel-koppling</div>
          <div className="mt-2 text-3xl font-semibold text-blue-900">
            {outboundBackedByEdielCount}
          </div>
          <div className="mt-2 text-xs text-blue-700">
            Outbound som verkligen blivit Ediel-meddelanden.
          </div>
        </div>
      </section>

      <EdielWorkbench
        switchRequests={switchRequests}
        outboundRequests={outboundRequests}
        messages={messages}
        routes={workbenchRoutes}
      />

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Registrera inbound UTILTS manuellt
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Använd bara för riktade test eller när du behöver mata in ett korrekt inbound-fall i aktivt scope.
          </p>

          <form action={registerInboundUtiltsAction} className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Meddelandekod
              </label>
              <select
                name="messageCode"
                defaultValue="E66"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="E66">E66</option>
                <option value="S02">S02</option>
                <option value="S03">S03</option>
                <option value="E31">E31</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Sender Ediel-id
              </label>
              <input
                name="senderEdielId"
                defaultValue=""
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Receiver Ediel-id
              </label>
              <input
                name="receiverEdielId"
                defaultValue=""
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Kvantitet
              </label>
              <input
                name="quantity"
                defaultValue="0"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Period start
              </label>
              <input
                name="periodStart"
                type="datetime-local"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Period slut
              </label>
              <input
                name="periodEnd"
                type="datetime-local"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="md:col-span-2">
              <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
                Registrera inbound UTILTS
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Starta self-test i aktivt scope
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Självtest är låsta till aktiv release. Framtida meddelandefamiljer körs inte här.
          </p>

          <form action={runEdielSelfTestAction} className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Scenario
              </label>
              <select
                name="scenario"
                defaultValue="PRODAT_Z05_IN"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="PRODAT_Z04_IN">PRODAT_Z04_IN</option>
                <option value="PRODAT_Z05_IN">PRODAT_Z05_IN</option>
                <option value="PRODAT_Z06_IN">PRODAT_Z06_IN</option>
                <option value="PRODAT_Z10_IN">PRODAT_Z10_IN</option>
                <option value="UTILTS_S02_IN">UTILTS_S02_IN</option>
                <option value="UTILTS_S03_IN">UTILTS_S03_IN</option>
                <option value="UTILTS_E66_KVART_IN">UTILTS_E66_KVART_IN</option>
                <option value="UTILTS_E66_SCH_IN">UTILTS_E66_SCH_IN</option>
                <option value="UTILTS_NEGATIVE">UTILTS_NEGATIVE</option>
              </select>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input
                name="switchRequestId"
                placeholder="switchRequestId"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="gridOwnerDataRequestId"
                placeholder="gridOwnerDataRequestId"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="senderEdielId"
                placeholder="senderEdielId"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="receiverEdielId"
                placeholder="receiverEdielId"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="mailbox"
                placeholder="mailbox"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="receiverEmail"
                placeholder="receiverEmail"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Kör self-test
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Skapa test run
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Endast testsviter i aktivt scope är tillåtna här.
          </p>

          <form action={createEdielTestRunAction} className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Test suite
                </label>
                <select
                  name="testSuite"
                  defaultValue="PRODAT"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                >
                  {ACTIVE_EDIEL_TEST_SUITES.map((suite) => (
                    <option key={suite} value={suite}>
                      {suite}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Rollkod
                </label>
                <select
                  name="roleCode"
                  defaultValue="supplier"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                >
                  <option value="supplier">supplier</option>
                  <option value="grid_owner">grid_owner</option>
                  <option value="balance_responsible">balance_responsible</option>
                  <option value="esco">esco</option>
                </select>
              </div>

              <input
                name="testCaseCode"
                placeholder="testCaseCode"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="title"
                placeholder="title"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="approvalVersion"
                placeholder="approvalVersion"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
              <input
                name="notes"
                placeholder="notes"
                className="rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Skapa test run
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Aktiva test runs
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Draft eller running inom aktiv release.
          </p>

          <div className="mt-4 space-y-3">
            {testRuns.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Inga aktiva test runs ännu.
              </div>
            ) : (
              testRuns.slice(0, 12).map((row) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">
                        {row.test_suite} · {row.test_case_code}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatDateTime(row.created_at)}
                      </div>
                    </div>
                    <Badge tone={row.status === 'failed' ? 'red' : row.status === 'passed' ? 'green' : 'yellow'}>
                      {row.status}
                    </Badge>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Cell label="ID" value={row.id} />
                    <Cell label="Roll" value={row.role_code} />
                    <Cell label="Titel" value={row.title} />
                    <Cell label="Approval version" value={row.approval_version} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Outbound queue som driver Ediel/CIS
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Här ser du om ett leverantörsbyte eller en nätägarbegäran verkligen har köats, vilken kanal som valts, om route saknas och om det sedan blivit ett riktigt Ediel-meddelande.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={unresolvedOutboundCount > 0 ? 'red' : 'green'}>
              unresolved: {unresolvedOutboundCount}
            </Badge>
            <Badge tone="blue">totalt: {outboundRequests.length}</Badge>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Typ</th>
                <th className="px-3 py-2">Källa</th>
                <th className="px-3 py-2">Source-id</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Kanal</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Ediel</th>
                <th className="px-3 py-2">Extern ref</th>
                <th className="px-3 py-2">Skapad</th>
              </tr>
            </thead>
            <tbody>
              {outboundRequests.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Inga outbound requests ännu.
                  </td>
                </tr>
              ) : (
                outboundRequests.map((row) => {
                  const relatedMessages = findMessagesForOutbound(messages, row.id)

                  return (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">
                        {row.id}
                      </td>
                      <td className="px-3 py-2">{row.request_type}</td>
                      <td className="px-3 py-2">{row.source_type ?? '—'}</td>
                      <td className="px-3 py-2 break-all text-xs text-slate-600">
                        {row.source_id ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={getOutboundStatusTone(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="px-3 py-2">{row.channel_type ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge tone={getRouteTone(row.communication_route_id)}>
                          {row.communication_route_id ? 'kopplad' : 'saknas'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {relatedMessages.length === 0 ? (
                            <Badge tone="slate">ingen Ediel-rad</Badge>
                          ) : (
                            relatedMessages.slice(0, 3).map((message) => (
                              <Link
                                key={message.id}
                                href={`/admin/ediel/messages/${message.id}`}
                                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:underline"
                              >
                                <span className="mr-2">
                                  <Badge tone={getMessageTone(message.direction)}>
                                    {message.direction}
                                  </Badge>
                                </span>
                                {message.message_family} {message.message_code}
                              </Link>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 break-all text-xs text-slate-600">
                        {row.external_reference ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {formatDateTime(row.created_at)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Senaste switch requests</h2>
          <div className="mt-4 space-y-3">
            {switchRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Inga switch requests ännu.
              </div>
            ) : (
              switchRequests.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-950">{row.id}</div>
                    <Badge tone={getRequestTone(row.status)}>{row.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Cell label="Customer" value={row.customer_id} />
                    <Cell label="Site" value={row.site_id} />
                    <Cell label="Metering point" value={row.metering_point_id} />
                    <Cell label="External ref" value={row.external_reference} />
                  </div>
                  <div className="mt-3 text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Senaste data requests</h2>
          <div className="mt-4 space-y-3">
            {dataRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Inga data requests ännu.
              </div>
            ) : (
              dataRequests.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-950">
                      {row.id} · {row.request_scope}
                    </div>
                    <Badge tone={getRequestTone(row.status)}>{row.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Cell label="Customer" value={row.customer_id} />
                    <Cell label="Site" value={row.site_id} />
                    <Cell label="Metering point" value={row.metering_point_id} />
                    <Cell label="External ref" value={row.external_reference} />
                  </div>
                  <div className="mt-3 text-xs text-slate-500">{formatDateTime(row.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Senaste Ediel-meddelanden</h2>
            <p className="mt-1 text-sm text-slate-600">
              Aktiva familjer med canonical ack-state direkt i översikten.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={pollMailboxAction}>
              <input type="hidden" name="limit" value="20" />
              <button className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100">
                Hämta IMAP
              </button>
            </form>
            <Link
              href="/admin/ediel/control-tower"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Se full kontrollvy
            </Link>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2">Skapad</th>
                <th className="px-3 py-2">Meddelande</th>
                <th className="px-3 py-2">Riktning</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Ack-state</th>
                <th className="px-3 py-2">Referenser</th>
                <th className="px-3 py-2">Åtgärd</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Inga Ediel-meddelanden ännu.
                  </td>
                </tr>
              ) : (
                messages.slice(0, 20).map((row) => {
                  const ackState = getCanonicalAckState(row)
                  return (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {formatDateTime(row.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">
                          {row.message_family} {row.message_code}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.message_version ?? 'utan version'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={getMessageTone(row.direction)}>{row.direction}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={getOutboundStatusTone(row.status)}>{row.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={ackStateTone(String(ackState))}>{String(ackState)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <div>External: {row.external_reference ?? '—'}</div>
                        <div>Transaction: {row.transaction_reference ?? '—'}</div>
                        <div>Interchange: {row.interchange_reference ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/ediel/messages/${row.id}`}
                            className="text-indigo-700 underline-offset-2 hover:underline"
                          >
                            Öppna
                          </Link>
                          <form action={cancelEdielMessageAction}>
                            <input type="hidden" name="edielMessageId" value={row.id} />
                            <input type="hidden" name="reason" value="Dold/raderad från Ediel-admin för renare testvy." />
                            <button className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100">
                              Radera/dölj
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Ediel-routes i runtime</h2>
            <p className="mt-1 text-sm text-slate-600">
              Visar vad runtime faktiskt kan använda just nu utifrån route + profil.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">routes: {edielRoutes.length}</Badge>
            <Badge tone={ruleAmbiguities.length > 0 ? 'yellow' : 'green'}>
              regelambiguiteter: {ruleAmbiguities.length}
            </Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {workbenchRoutes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Inga Ediel-routes hittades.
            </div>
          ) : (
            workbenchRoutes.slice(0, 12).map((route) => (
              <div key={route.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-950">{route.route_name}</div>
                  <Badge tone={route.is_active ? 'green' : 'red'}>
                    {route.is_active ? 'aktiv' : 'inaktiv'}
                  </Badge>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Cell label="Scope" value={route.route_scope} />
                  <Cell label="Type" value={route.route_type} />
                  <Cell label="Grid owner" value={route.grid_owner_name} />
                  <Cell label="Grid owner ediel" value={route.grid_owner_ediel_id} />
                  <Cell label="Target email" value={route.target_email} />
                  <Cell label="Target system" value={route.target_system} />
                  <Cell label="Sender ediel" value={route.profile?.sender_ediel_id ?? null} />
                  <Cell label="Receiver ediel" value={route.profile?.receiver_ediel_id ?? null} />
                  <Cell label="Mailbox" value={route.profile?.mailbox ?? null} />
                  <Cell label="App ref" value={route.profile?.application_reference ?? null} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}