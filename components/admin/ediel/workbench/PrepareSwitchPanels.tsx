'use client'

import { useState } from 'react'
import {
  prepareAiListAction,
  prepareSwitchZ03Action,
  prepareSwitchZ05Action,
  prepareSwitchZ09Action,
  prepareUtiltsE66Action,
  prepareUtiltsE73Action,
} from '@/app/admin/ediel/actions'
import type {
  EdielRecommendationOutboundRow,
  EdielRecommendationRouteRow,
  EdielRecommendationSwitchRow,
} from '@/lib/ediel/recommendations'
import { formatMaybe, routeLabel } from './helpers'

function todayIsoDate(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

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
  z05LinkedMessageId,
  z09LinkedMessageId,
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
  z05LinkedMessageId: string | null
  z09LinkedMessageId: string | null
  outboundRequests: EdielRecommendationOutboundRow[]
}) {
  const [selectedDataRequestId, setSelectedDataRequestId] = useState('')
  const [e66Quantity, setE66Quantity] = useState('0')
  const [e66PeriodStart, setE66PeriodStart] = useState(todayIsoDate(-1))
  const [e66PeriodEnd, setE66PeriodEnd] = useState(todayIsoDate())
  const [e66RegistrationTime, setE66RegistrationTime] = useState(
    `${todayIsoDate()}T00:00`
  )

  const [aiListType, setAiListType] = useState<'AI' | 'BI'>('AI')
  const [aiCustomerId, setAiCustomerId] = useState(selectedSwitch?.customer_id ?? '')
  const [aiSiteId, setAiSiteId] = useState(selectedSwitch?.site_id ?? '')
  const [aiMeteringPointId, setAiMeteringPointId] = useState(
    selectedSwitch?.metering_point_id ?? ''
  )
  const [aiFromDate, setAiFromDate] = useState(todayIsoDate(-30))
  const [aiToDate, setAiToDate] = useState(todayIsoDate())
  const [aiBalanceResponsibleEdielId, setAiBalanceResponsibleEdielId] = useState('')

  const latestSwitchReference = selectedSwitch?.external_reference ?? 'ingen extern ref'
  const canPrepareSwitch =
    !!selectedSwitchId && !!selectedRouteId && !!senderEdielId && !!receiverEdielId

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-1">
          <h2 className="text-lg font-semibold text-slate-950">Gemensam route-kontext</h2>
          <p className="mt-1 text-sm text-slate-600">
            Alla förbered-flöden nedan använder samma route-kontext. Byt här först, sedan kör du rätt meddelandetyp.
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
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
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Gridex Ediel-id
                </label>
                <input
                  value={senderEdielId}
                  onChange={(event) => setSenderEdielId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Mottagarens Ediel-id
                </label>
                <input
                  value={receiverEdielId}
                  onChange={(event) => setReceiverEdielId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Mottagarens e-post
                </label>
                <input
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
                  value={dispatchMailbox}
                  onChange={(event) => setDispatchMailbox(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Nuvarande rekommendation</div>
              <div className="mt-2 space-y-1">
                <div>Route: {recommendedRouteText}</div>
                <div>Target system: {formatMaybe(selectedRoute?.target_system)}</div>
                <div>Grid owner: {formatMaybe(selectedRoute?.grid_owner_name)}</div>
                <div>Mailbox i profilen: {formatMaybe(selectedRoute?.profile?.mailbox)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2">
          <h2 className="text-lg font-semibold text-slate-950">Switch → PRODAT</h2>
          <p className="mt-1 text-sm text-slate-600">
            Här använder du samma switchärende för att skapa de vanligaste outbound-meddelandena mot Ediel.
          </p>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Switch request
            </label>
            <select
              value={selectedSwitchId}
              onChange={(event) => {
                const nextId = event.target.value
                setSelectedSwitchId(nextId)
                const nextRow = switchRequests.find((row) => row.id === nextId) ?? null
                setAiCustomerId(nextRow?.customer_id ?? '')
                setAiSiteId(nextRow?.site_id ?? '')
                setAiMeteringPointId(nextRow?.metering_point_id ?? '')
              }}
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

            <div className="mt-3 grid gap-2 md:grid-cols-3 text-sm text-slate-700">
              <div>Kund: {formatMaybe(selectedSwitch?.customer_id)}</div>
              <div>Site: {formatMaybe(selectedSwitch?.site_id)}</div>
              <div>Mätpunkt: {formatMaybe(selectedSwitch?.metering_point_id)}</div>
              <div>Status: {formatMaybe(selectedSwitch?.status)}</div>
              <div>Extern ref: {latestSwitchReference}</div>
              <div>Route: {recommendedRouteText}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <form action={prepareSwitchZ03Action} className="rounded-2xl border border-slate-200 p-4">
              <input type="hidden" name="switchRequestId" value={selectedSwitchId} />
              <input type="hidden" name="communicationRouteId" value={selectedRouteId} />
              <div className="text-sm font-semibold text-slate-900">Förbered Z03</div>
              <p className="mt-2 text-sm text-slate-600">
                Starta leverantörsbytesflödet från valt switchärende.
              </p>
              <div className="mt-3 text-xs text-slate-500">
                Senaste Z03: {z03LinkedMessageId ?? 'ingen ännu'}
              </div>
              <button
                disabled={!canPrepareSwitch}
                className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Förbered Z03
              </button>
            </form>

            <form action={prepareSwitchZ05Action} className="rounded-2xl border border-slate-200 p-4">
              <input type="hidden" name="switchRequestId" value={selectedSwitchId} />
              <input type="hidden" name="communicationRouteId" value={selectedRouteId} />
              <div className="text-sm font-semibold text-slate-900">Förbered Z05</div>
              <p className="mt-2 text-sm text-slate-600">
                Slutför/meddela bekräftat switchläge från samma ärende.
              </p>
              <div className="mt-3 text-xs text-slate-500">
                Senaste Z05: {z05LinkedMessageId ?? 'ingen ännu'}
              </div>
              <button
                disabled={!canPrepareSwitch}
                className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Förbered Z05
              </button>
            </form>

            <form action={prepareSwitchZ09Action} className="rounded-2xl border border-slate-200 p-4">
              <input type="hidden" name="switchRequestId" value={selectedSwitchId} />
              <input type="hidden" name="communicationRouteId" value={selectedRouteId} />
              <div className="text-sm font-semibold text-slate-900">Förbered Z09</div>
              <p className="mt-2 text-sm text-slate-600">
                Skicka masterdata-relaterat PRODAT från samma switchkontext.
              </p>
              <div className="mt-3 text-xs text-slate-500">
                Senaste Z09: {z09LinkedMessageId ?? 'ingen ännu'}
              </div>
              <button
                disabled={!canPrepareSwitch}
                className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Förbered Z09
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Grid owner data request → UTILTS</h2>
          <p className="mt-1 text-sm text-slate-600">
            Klistra in ett riktigt data request-id från listan längre ner på sidan och använd samma route-kontext som ovan.
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Data request-id
              </label>
              <input
                value={selectedDataRequestId}
                onChange={(event) => setSelectedDataRequestId(event.target.value)}
                placeholder="grid_owner_data_request id"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <form action={prepareUtiltsE73Action} className="rounded-2xl border border-slate-200 p-4">
                <input type="hidden" name="gridOwnerDataRequestId" value={selectedDataRequestId} />
                <input type="hidden" name="communicationRouteId" value={selectedRouteId} />
                <div className="text-sm font-semibold text-slate-900">Förbered UTILTS E73</div>
                <p className="mt-2 text-sm text-slate-600">
                  Begär saknade eller validerade mätvärden via Ediel.
                </p>
                <div className="mt-3 text-xs text-slate-500">
                  Kräver data request-id + route.
                </div>
                <button
                  disabled={!selectedDataRequestId || !selectedRouteId}
                  className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Förbered E73
                </button>
              </form>

              <form action={prepareUtiltsE66Action} className="rounded-2xl border border-slate-200 p-4">
                <input type="hidden" name="gridOwnerDataRequestId" value={selectedDataRequestId} />
                <input type="hidden" name="communicationRouteId" value={selectedRouteId} />

                <div className="text-sm font-semibold text-slate-900">Förbered UTILTS E66</div>
                <p className="mt-2 text-sm text-slate-600">
                  Skapa ett outbound E66 med period och kvantitet.
                </p>

                <div className="mt-3 grid gap-3">
                  <input
                    name="quantity"
                    value={e66Quantity}
                    onChange={(event) => setE66Quantity(event.target.value)}
                    placeholder="Kvantitet, t.ex. 1250"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    name="periodStart"
                    type="date"
                    value={e66PeriodStart}
                    onChange={(event) => setE66PeriodStart(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    name="periodEnd"
                    type="date"
                    value={e66PeriodEnd}
                    onChange={(event) => setE66PeriodEnd(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    name="registrationTime"
                    type="datetime-local"
                    value={e66RegistrationTime}
                    onChange={(event) => setE66RegistrationTime(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <button
                  disabled={!selectedDataRequestId || !selectedRouteId}
                  className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Förbered E66
                </button>
              </form>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">AI/BI-list export</h2>
          <p className="mt-1 text-sm text-slate-600">
            Exportera AI- eller BI-list från samma route-kontext. Fyll in riktiga customer/site-id från ditt kundflöde.
          </p>

          <form action={prepareAiListAction} className="mt-4 space-y-4">
            <input type="hidden" name="communicationRouteId" value={selectedRouteId} />
            <input type="hidden" name="supplierEdielId" value={senderEdielId} />

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Listtyp
                </label>
                <select
                  name="listType"
                  value={aiListType}
                  onChange={(event) => setAiListType(event.target.value as 'AI' | 'BI')}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                >
                  <option value="AI">AI</option>
                  <option value="BI">BI</option>
                </select>
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
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Customer-id
                </label>
                <input
                  name="customerId"
                  value={aiCustomerId}
                  onChange={(event) => setAiCustomerId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Site-id
                </label>
                <input
                  name="siteId"
                  value={aiSiteId}
                  onChange={(event) => setAiSiteId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Metering point-id
                </label>
                <input
                  name="meteringPointId"
                  value={aiMeteringPointId}
                  onChange={(event) => setAiMeteringPointId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Balansansvarig Ediel-id
                </label>
                <input
                  name="balanceResponsibleEdielId"
                  value={aiBalanceResponsibleEdielId}
                  onChange={(event) => setAiBalanceResponsibleEdielId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Från datum
                </label>
                <input
                  name="fromDate"
                  type="date"
                  value={aiFromDate}
                  onChange={(event) => setAiFromDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Till datum
                </label>
                <input
                  name="toDate"
                  type="date"
                  value={aiToDate}
                  onChange={(event) => setAiToDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">AI/BI-kontext</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>Listtyp: {aiListType}</div>
                <div>Route: {recommendedRouteText}</div>
                <div>Supplier Ediel-id: {formatMaybe(senderEdielId)}</div>
                <div>Receiver Ediel-id: {formatMaybe(receiverEdielId)}</div>
                <div>Customer-id: {formatMaybe(aiCustomerId)}</div>
                <div>Site-id: {formatMaybe(aiSiteId)}</div>
              </div>
            </div>

            <button
              disabled={!selectedRouteId || !aiCustomerId || !aiSiteId || !receiverEdielId}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Förbered {aiListType}-list
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}