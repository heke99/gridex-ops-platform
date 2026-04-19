'use client'

import {
  prepareSwitchZ03Action,
  prepareSwitchZ09Action,
} from '@/app/admin/ediel/actions'
import type {
  EdielRecommendationOutboundRow,
  EdielRecommendationRouteRow,
  EdielRecommendationSwitchRow,
} from '@/lib/ediel/recommendations'
import { formatMaybe, routeLabel } from './helpers'

export default function PrepareSwitchPanels({
  switchRequests,
  selectedSwitchId,
  setSelectedSwitchId,
  selectedRouteId,
  setSelectedRouteId,
  recommendedRoutes,
  selectedRoute,
  selectedSwitch,
  senderEdielId,
  setSenderEdielId,
  receiverEdielId,
  setReceiverEdielId,
  receiverEmail,
  setReceiverEmail,
  dispatchMailbox,
  setDispatchMailbox,
  recommendedRouteText,
  z03LinkedMessageId,
  z09LinkedMessageId,
  outboundRequests,
}: {
  switchRequests: EdielRecommendationSwitchRow[]
  selectedSwitchId: string
  setSelectedSwitchId: (value: string) => void
  selectedRouteId: string
  setSelectedRouteId: (value: string) => void
  recommendedRoutes: EdielRecommendationRouteRow[]
  selectedRoute: EdielRecommendationRouteRow | null
  selectedSwitch: EdielRecommendationSwitchRow | null
  senderEdielId: string
  setSenderEdielId: (value: string) => void
  receiverEdielId: string
  setReceiverEdielId: (value: string) => void
  receiverEmail: string
  setReceiverEmail: (value: string) => void
  dispatchMailbox: string
  setDispatchMailbox: (value: string) => void
  recommendedRouteText: string
  z03LinkedMessageId: string | null
  z09LinkedMessageId: string | null
  outboundRequests: EdielRecommendationOutboundRow[]
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Förbered Z03 från switchärende</h2>
        <form action={prepareSwitchZ03Action} className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Switch request
              </label>
              <select
                value={selectedSwitchId}
                onChange={(event) => setSelectedSwitchId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                {switchRequests.length === 0 ? (
                  <option value="">Inga switch requests</option>
                ) : (
                  switchRequests.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.id} · {row.status} · {row.external_reference ?? 'ingen extern ref'}
                    </option>
                  ))
                )}
              </select>
              <input type="hidden" name="switchRequestId" value={selectedSwitchId} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Route
              </label>
              <select
                value={selectedRouteId}
                onChange={(event) => setSelectedRouteId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                {recommendedRoutes.length === 0 ? (
                  <option value="">Inga Ediel-routes</option>
                ) : (
                  recommendedRoutes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {routeLabel(route)}
                    </option>
                  ))
                )}
              </select>
              <input type="hidden" name="communicationRouteId" value={selectedRouteId} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Gridex Ediel-id
              </label>
              <input
                name="senderEdielId"
                value={senderEdielId}
                onChange={(event) => setSenderEdielId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Mottagarens Ediel-id
              </label>
              <input
                name="receiverEdielId"
                value={receiverEdielId}
                onChange={(event) => setReceiverEdielId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Mottagarens e-post
              </label>
              <input
                name="receiverEmail"
                value={receiverEmail}
                onChange={(event) => setReceiverEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Mailbox
              </label>
              <input
                name="mailbox"
                value={dispatchMailbox}
                onChange={(event) => setDispatchMailbox(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">Det här skickas in för Z03</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>Switch request-id: {formatMaybe(selectedSwitch?.id)}</div>
              <div>Status: {formatMaybe(selectedSwitch?.status)}</div>
              <div>Extern ref: {formatMaybe(selectedSwitch?.external_reference)}</div>
              <div>Route: {recommendedRouteText}</div>
              <div>Sender Ediel-id: {formatMaybe(senderEdielId)}</div>
              <div>Receiver Ediel-id: {formatMaybe(receiverEdielId)}</div>
              <div>Receiver e-post: {formatMaybe(receiverEmail)}</div>
              <div>Mailbox: {formatMaybe(dispatchMailbox)}</div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              Senaste Z03 på detta ärende: {z03LinkedMessageId ?? 'ingen ännu'}
            </div>
          </div>

          <button
            disabled={!selectedSwitchId || !selectedRouteId || !senderEdielId || !receiverEdielId}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Förbered Z03
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Förbered Z09 från switchärende</h2>
        <form action={prepareSwitchZ09Action} className="mt-4 space-y-4">
          <input type="hidden" name="switchRequestId" value={selectedSwitchId} />
          <input type="hidden" name="communicationRouteId" value={selectedRouteId} />

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Gridex Ediel-id
              </label>
              <input
                name="senderEdielId"
                value={senderEdielId}
                onChange={(event) => setSenderEdielId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Mottagarens Ediel-id
              </label>
              <input
                name="receiverEdielId"
                value={receiverEdielId}
                onChange={(event) => setReceiverEdielId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Mottagarens e-post
              </label>
              <input
                name="receiverEmail"
                value={receiverEmail}
                onChange={(event) => setReceiverEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Mailbox
              </label>
              <input
                name="mailbox"
                value={dispatchMailbox}
                onChange={(event) => setDispatchMailbox(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">Det här skickas in för Z09</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>Switch request-id: {formatMaybe(selectedSwitch?.id)}</div>
              <div>Status: {formatMaybe(selectedSwitch?.status)}</div>
              <div>Kund: {formatMaybe(selectedSwitch?.customer_id)}</div>
              <div>Mätpunkt: {formatMaybe(selectedSwitch?.metering_point_id)}</div>
              <div>Route: {recommendedRouteText}</div>
              <div>Target system: {formatMaybe(selectedRoute?.target_system)}</div>
              <div>Sender Ediel-id: {formatMaybe(senderEdielId)}</div>
              <div>Receiver Ediel-id: {formatMaybe(receiverEdielId)}</div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              Senaste Z09 på detta ärende: {z09LinkedMessageId ?? 'ingen ännu'}
            </div>
          </div>

          <button
            disabled={!selectedSwitchId || !selectedRouteId || !senderEdielId || !receiverEdielId}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Förbered Z09
          </button>
        </form>
      </div>
    </div>
  )
}