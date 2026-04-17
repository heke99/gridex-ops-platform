'use client'

import {
  quickFixEdielProfileBasicsAction,
  quickFixEdielRouteActivationAction,
  quickFixEdielTargetEmailAction,
  quickFixGridOwnerEdielIdAction,
} from '@/app/admin/ediel/routes/actions'
import type {
  EdielRecommendationRouteIssue,
  EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'

type Props = {
  route: EdielRecommendationRouteRow | null
  issues: EdielRecommendationRouteIssue[]
  customerId?: string | null
}

function hasIssue(
  issues: EdielRecommendationRouteIssue[],
  key: EdielRecommendationRouteIssue['key']
) {
  return issues.some((issue) => issue.key === key)
}

export default function EdielRouteIssueActions({
  route,
  issues,
  customerId,
}: Props) {
  if (!route || issues.length === 0) {
    return null
  }

  const needsTargetEmail = hasIssue(issues, 'target_email')
  const needsSender = hasIssue(issues, 'sender_ediel_id')
  const needsReceiver = hasIssue(issues, 'receiver_ediel_id')
  const needsMailbox = hasIssue(issues, 'mailbox')
  const needsActivation = hasIssue(issues, 'inactive_route')
  const needsEnable = hasIssue(issues, 'ediel_disabled')

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Operativa fixar för vald route
      </div>

      {(needsActivation || needsEnable) && (
        <form
          action={quickFixEdielRouteActivationAction}
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
        >
          <input type="hidden" name="routeId" value={route.id} />
          <input type="hidden" name="customerId" value={customerId ?? ''} />
          <input type="hidden" name="activateRoute" value="true" />
          <input type="hidden" name="enableEdiel" value="true" />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {needsActivation && needsEnable
                  ? 'Aktivera route + Ediel-profil'
                  : needsActivation
                    ? 'Aktivera route'
                    : 'Aktivera Ediel-profil'}
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Detta sparas direkt på routen/profilen och används automatiskt nästa gång.
              </p>
            </div>

            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
              Spara fix
            </button>
          </div>
        </form>
      )}

      {needsTargetEmail && (
        <form
          action={quickFixEdielTargetEmailAction}
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
        >
          <input type="hidden" name="routeId" value={route.id} />
          <input type="hidden" name="customerId" value={customerId ?? ''} />

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                target_email
              </label>
              <input
                name="targetEmail"
                defaultValue={route.target_email ?? ''}
                placeholder="ediel@motpart.se"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Sparas på communication route och används nästa gång routen väljs.
              </p>
            </div>

            <div className="flex items-end">
              <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                Spara target_email
              </button>
            </div>
          </div>
        </form>
      )}

      {(needsSender || needsMailbox || needsReceiver) && (
        <form
          action={quickFixEdielProfileBasicsAction}
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
        >
          <input type="hidden" name="routeId" value={route.id} />
          <input type="hidden" name="customerId" value={customerId ?? ''} />
          <input type="hidden" name="enableEdiel" value="true" />

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                sender_ediel_id
              </label>
              <input
                name="senderEdielId"
                defaultValue={route.profile?.sender_ediel_id ?? ''}
                placeholder="Ert Ediel-id"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                receiver_ediel_id
              </label>
              <input
                name="receiverEdielId"
                defaultValue={
                  route.profile?.receiver_ediel_id ?? route.grid_owner_ediel_id ?? ''
                }
                placeholder="Motpartens Ediel-id"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                mailbox
              </label>
              <input
                name="mailbox"
                defaultValue={route.profile?.mailbox ?? ''}
                placeholder="ediel@gridex.se"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>
          </div>

          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Sparas på Ediel-profilen för denna route och återanvänds framöver.
          </p>

          <div className="mt-3">
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
              Spara routeprofil
            </button>
          </div>
        </form>
      )}

      {needsReceiver && route.grid_owner_id ? (
        <form
          action={quickFixGridOwnerEdielIdAction}
          className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20"
        >
          <input type="hidden" name="gridOwnerId" value={route.grid_owner_id} />
          <input type="hidden" name="customerId" value={customerId ?? ''} />

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Nätägarens Ediel-id
              </label>
              <input
                name="edielId"
                defaultValue={route.grid_owner_ediel_id ?? ''}
                placeholder="Nätägarens Ediel-id"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Sparas i nätägar-masterdata och används som fallback nästa gång.
              </p>
            </div>

            <div className="flex items-end">
              <button className="rounded-2xl border border-blue-300 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/30">
                Spara på nätägare
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  )
}