'use client'

import Link from 'next/link'
import type {
  EdielRecommendationRouteIssue,
  EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'
import EdielRouteIssueActions from '@/components/admin/ediel/EdielRouteIssueActions'
import type { SwitchRecommendationSummary } from './types'
import {
  routeIssueTone,
  routeLabel,
} from './helpers'

type Props = {
  customerId: string
  recommendation: SwitchRecommendationSummary
  edielRecommendation: {
    selectedSwitchId: string | null
    recommendedRoute: EdielRecommendationRouteRow | null
    recommendedSendMessage:
      | {
          id: string
          message_family: string
          message_code: string
        }
      | null
    recommendedInboundUtilts:
      | {
          id: string
          message_family: string
          message_code: string
        }
      | null
    recommendedAckSource:
      | {
          id: string
          message_family: string
          message_code: string
        }
      | null
    routeSummary: string
    routeIssues: EdielRecommendationRouteIssue[]
    routeHealth: {
      isRouteActive: boolean
      isEdielEnabled: boolean
      hasTargetEmail: boolean
      hasSenderEdielId: boolean
      hasReceiverEdielId: boolean
      hasMailbox: boolean
    }
  }
  edielMessageCount: number
}

function HealthPill({
  ok,
  okLabel,
  badLabel,
  okTone = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  badTone = 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
}: {
  ok: boolean
  okLabel: string
  badLabel: string
  okTone?: string
  badTone?: string
}) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ok ? okTone : badTone}`}>
      {ok ? okLabel : badLabel}
    </span>
  )
}

export default function SwitchRecommendationPanel({
  customerId,
  recommendation,
  edielRecommendation,
  edielMessageCount,
}: Props) {
  return (
    <div className="rounded-3xl border border-blue-200 bg-blue-50/70 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
      <div className="border-b border-blue-200 px-6 py-5 dark:border-blue-900/50">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Rekommenderat nästa steg i switchkedjan
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Panelen använder nu samma EDIEL-rekommendationsmotor som /admin/ediel och
          CustomerEdielOperationsCard, men serverhämtad från parent-vyn.
        </p>
      </div>

      <div className="grid gap-4 p-6 md:grid-cols-5">
        <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Vald switch
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
            {edielRecommendation.selectedSwitchId || recommendation.latestRequest?.id || '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {recommendation.latestRequest?.status ?? 'Inget ärende ännu'}
          </div>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Rekommenderad route
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
            {routeLabel(edielRecommendation.recommendedRoute)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {edielRecommendation.recommendedRoute?.id ?? 'Ingen route vald'}
          </div>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Rekommenderat skickbart meddelande
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
            {edielRecommendation.recommendedSendMessage
              ? `${edielRecommendation.recommendedSendMessage.message_family} ${edielRecommendation.recommendedSendMessage.message_code}`
              : 'Inget skickbart meddelande'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {edielRecommendation.recommendedSendMessage?.id ?? '—'}
          </div>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Rekommenderad inbound UTILTS
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
            {edielRecommendation.recommendedInboundUtilts
              ? `${edielRecommendation.recommendedInboundUtilts.message_family} ${edielRecommendation.recommendedInboundUtilts.message_code}`
              : 'Ingen inbound UTILTS ännu'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {edielRecommendation.recommendedInboundUtilts?.id ?? '—'}
          </div>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Rekommenderad ACK-källa
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">
            {edielRecommendation.recommendedAckSource
              ? `${edielRecommendation.recommendedAckSource.message_family} ${edielRecommendation.recommendedAckSource.message_code}`
              : 'Ingen ACK-källa ännu'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {edielRecommendation.recommendedAckSource?.id ?? '—'}
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-6 pb-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
        <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            Rekommenderad åtgärd nu
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Routebedömning
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {edielRecommendation.routeSummary}
            </p>

            {edielRecommendation.routeIssues.length > 0 ? (
              <div className="mt-3 space-y-2">
                {edielRecommendation.routeIssues.map((issue) => (
                  <div
                    key={issue.key}
                    className={`rounded-xl border px-3 py-2 text-sm ${routeIssueTone(issue)}`}
                  >
                    <div className="font-medium">{issue.label}</div>
                    <div className="mt-1 text-xs opacity-80">{issue.resolution}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-4">
              <EdielRouteIssueActions
                route={edielRecommendation.recommendedRoute}
                issues={edielRecommendation.routeIssues}
                customerId={customerId}
              />
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
            {recommendation.nextStep}
          </p>

          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            {edielRecommendation.routeSummary}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <HealthPill
              ok={edielRecommendation.routeHealth.isRouteActive}
              okLabel="route aktiv"
              badLabel="route inaktiv"
            />
            <HealthPill
              ok={edielRecommendation.routeHealth.isEdielEnabled}
              okLabel="ediel på"
              badLabel="ediel av"
            />
            <HealthPill
              ok={edielRecommendation.routeHealth.hasTargetEmail}
              okLabel="target email ok"
              badLabel="target email saknas"
              badTone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
            />
            <HealthPill
              ok={edielRecommendation.routeHealth.hasSenderEdielId}
              okLabel="sender ok"
              badLabel="sender saknas"
            />
            <HealthPill
              ok={edielRecommendation.routeHealth.hasReceiverEdielId}
              okLabel="receiver ok"
              badLabel="receiver saknas"
            />
            <HealthPill
              ok={edielRecommendation.routeHealth.hasMailbox}
              okLabel="mailbox ok"
              badLabel="mailbox saknas"
            />
          </div>

          {edielRecommendation.routeIssues.length > 0 ? (
            <div className="mt-4 space-y-2">
              {edielRecommendation.routeIssues.map((issue) => (
                <div
                  key={issue.key}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${routeIssueTone(issue)}`}>
                      {issue.severity === 'error' ? 'blockerare' : 'varning'}
                    </span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {issue.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {issue.resolution}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={recommendation.primaryWorkspaceHref}
              className="rounded-2xl border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
            >
              {recommendation.primaryWorkspaceLabel}
            </Link>
            <Link
              href="/admin/ediel"
              className="rounded-2xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 dark:border-blue-800 dark:text-blue-300"
            >
              Öppna Ediel-center
            </Link>
            <Link
              href="/admin/ediel/routes"
              className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              Ediel-routes
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            Operativ snabbstatus
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <div>
              unresolved routes:{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {recommendation.unresolvedCount}
              </span>
            </div>
            <div>
              auto-köade outbound:{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {recommendation.autoQueuedCount}
              </span>
            </div>
            <div>
              väntar kvittens:{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {recommendation.awaitingResponseCount}
              </span>
            </div>
            <div>
              ready to execute:{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {recommendation.readyToExecuteCount}
              </span>
            </div>
            <div>
              EDIEL-signaler:{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {edielMessageCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}