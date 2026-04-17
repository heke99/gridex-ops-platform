'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  createAckDraftAction,
  createNegativeUtiltsResponseAction,
  createProdatDraftAction,
  pollMailboxAction,
  prepareSwitchZ03Action,
  prepareSwitchZ09Action,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import {
  getNewestSwitchId,
  getPreferredRouteId,
  getRecommendedAckableMessages,
  getRecommendedInboundUtiltsMessages,
  getRecommendedRouteSummary,
  getRecommendedRoutes,
  getRecommendedSendableMessages,
  getSelectedRoute,
  type EdielRecommendationMessageRow,
  type EdielRecommendationOutboundRow,
  type EdielRecommendationRouteRow,
  type EdielRecommendationSwitchRow,
} from '@/lib/ediel/recommendations'

type Props = {
  switchRequests: EdielRecommendationSwitchRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  messages: EdielRecommendationMessageRow[]
  routes: EdielRecommendationRouteRow[]
}

function routeLabel(route: EdielRecommendationRouteRow) {
  const owner = route.grid_owner_name ? ` · ${route.grid_owner_name}` : ''
  return `${route.route_name} (${route.route_scope})${owner}`
}

function messageLabel(message: EdielRecommendationMessageRow) {
  return `${message.id} · ${message.direction} · ${message.message_family} ${message.message_code} · ${message.status}`
}

function formatMaybe(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : '—'
}

export default function EdielWorkbench({
  switchRequests,
  outboundRequests,
  messages,
  routes,
}: Props) {
  const newestSwitchId = useMemo(() => getNewestSwitchId(switchRequests), [switchRequests])

  const [selectedSwitchId, setSelectedSwitchId] = useState(newestSwitchId)
  const [selectedRouteId, setSelectedRouteId] = useState(
    getPreferredRouteId({
      routes,
      outboundRequests,
      selectedSwitchId: newestSwitchId,
    })
  )
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [selectedInboundUtiltsId, setSelectedInboundUtiltsId] = useState('')
  const [selectedAckSourceId, setSelectedAckSourceId] = useState('')
  const [mailbox, setMailbox] = useState('INBOX')
  const [pollRouteId, setPollRouteId] = useState(
    getPreferredRouteId({
      routes,
      outboundRequests,
      selectedSwitchId: newestSwitchId,
    })
  )
  const [prodatCode, setProdatCode] = useState<'Z03' | 'Z09' | 'Z01' | 'Z13' | 'Z18'>('Z03')

  const recommendedRoutes = useMemo(
    () =>
      getRecommendedRoutes({
        routes,
        outboundRequests,
        selectedSwitchId,
      }),
    [routes, outboundRequests, selectedSwitchId]
  )

  const preferredRouteId = useMemo(
    () =>
      getPreferredRouteId({
        routes,
        outboundRequests,
        selectedSwitchId,
      }),
    [routes, outboundRequests, selectedSwitchId]
  )

  useEffect(() => {
    if (!selectedRouteId || !routes.some((route) => route.id === selectedRouteId)) {
      setSelectedRouteId(preferredRouteId)
      return
    }

    const shouldAutoSwitch =
      preferredRouteId &&
      selectedRouteId !== preferredRouteId &&
      outboundRequests.some(
        (row) =>
          row.source_type === 'supplier_switch_request' &&
          row.source_id === selectedSwitchId &&
          row.communication_route_id === preferredRouteId
      )

    if (shouldAutoSwitch) {
      setSelectedRouteId(preferredRouteId)
    }
  }, [preferredRouteId, routes, outboundRequests, selectedSwitchId, selectedRouteId])

  const selectedRoute = useMemo(
    () => getSelectedRoute(routes, selectedRouteId),
    [routes, selectedRouteId]
  )

  const selectedPollRoute = useMemo(
    () => getSelectedRoute(routes, pollRouteId),
    [routes, pollRouteId]
  )

  const selectedSwitch = useMemo(
    () => switchRequests.find((row) => row.id === selectedSwitchId) ?? null,
    [switchRequests, selectedSwitchId]
  )

  const [senderEdielId, setSenderEdielId] = useState(
    selectedRoute?.profile?.sender_ediel_id ?? ''
  )
  const [receiverEdielId, setReceiverEdielId] = useState(
    selectedRoute?.profile?.receiver_ediel_id ?? selectedRoute?.grid_owner_ediel_id ?? ''
  )
  const [receiverEmail, setReceiverEmail] = useState(selectedRoute?.target_email ?? '')
  const [dispatchMailbox, setDispatchMailbox] = useState(selectedRoute?.profile?.mailbox ?? '')
  const [senderSubAddress, setSenderSubAddress] = useState(
    selectedRoute?.profile?.sender_sub_address ?? 'GRIDEX'
  )
  const [receiverSubAddress, setReceiverSubAddress] = useState(
    selectedRoute?.profile?.receiver_sub_address ?? 'PRODAT'
  )
  const [applicationReference, setApplicationReference] = useState(
    selectedRoute?.profile?.application_reference ?? '23-DDQ-PRODAT'
  )

  useEffect(() => {
    setSenderEdielId(selectedRoute?.profile?.sender_ediel_id ?? '')
    setReceiverEdielId(
      selectedRoute?.profile?.receiver_ediel_id ?? selectedRoute?.grid_owner_ediel_id ?? ''
    )
    setReceiverEmail(selectedRoute?.target_email ?? '')
    setDispatchMailbox(selectedRoute?.profile?.mailbox ?? '')
    setSenderSubAddress(selectedRoute?.profile?.sender_sub_address ?? 'GRIDEX')
    setReceiverSubAddress(selectedRoute?.profile?.receiver_sub_address ?? 'PRODAT')
    setApplicationReference(
      selectedRoute?.profile?.application_reference ?? '23-DDQ-PRODAT'
    )
  }, [selectedRoute])

  const sendableMessagesToShow = useMemo(
    () =>
      getRecommendedSendableMessages({
        messages,
        selectedSwitchId,
        selectedRouteId,
      }),
    [messages, selectedSwitchId, selectedRouteId]
  )

  useEffect(() => {
    const nextId = sendableMessagesToShow[0]?.id ?? ''
    if (!selectedMessageId || !sendableMessagesToShow.some((row) => row.id === selectedMessageId)) {
      setSelectedMessageId(nextId)
    }
  }, [selectedMessageId, sendableMessagesToShow])

  const inboundUtiltsMessagesToShow = useMemo(
    () =>
      getRecommendedInboundUtiltsMessages({
        messages,
        selectedRoute,
        selectedRouteId,
      }),
    [messages, selectedRoute, selectedRouteId]
  )

  useEffect(() => {
    const nextId = inboundUtiltsMessagesToShow[0]?.id ?? ''
    if (
      !selectedInboundUtiltsId ||
      !inboundUtiltsMessagesToShow.some((row) => row.id === selectedInboundUtiltsId)
    ) {
      setSelectedInboundUtiltsId(nextId)
    }
  }, [inboundUtiltsMessagesToShow, selectedInboundUtiltsId])

  const ackPreferredFamily = prodatCode === 'Z03' || prodatCode === 'Z09' ? 'PRODAT' : 'UTILTS'

  const ackableMessagesToShow = useMemo(
    () =>
      getRecommendedAckableMessages({
        messages,
        selectedSwitchId,
        selectedRouteId,
        preferredFamily: ackPreferredFamily,
      }),
    [messages, selectedSwitchId, selectedRouteId, ackPreferredFamily]
  )

  useEffect(() => {
    const nextId = ackableMessagesToShow[0]?.id ?? ''
    if (
      !selectedAckSourceId ||
      !ackableMessagesToShow.some((row) => row.id === selectedAckSourceId)
    ) {
      setSelectedAckSourceId(nextId)
    }
  }, [ackableMessagesToShow, selectedAckSourceId])

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) ?? null,
    [messages, selectedMessageId]
  )

  const selectedInboundUtilts = useMemo(
    () => messages.find((message) => message.id === selectedInboundUtiltsId) ?? null,
    [messages, selectedInboundUtiltsId]
  )

  const selectedAckSource = useMemo(
    () => messages.find((message) => message.id === selectedAckSourceId) ?? null,
    [messages, selectedAckSourceId]
  )

  const z03LinkedMessage = useMemo(
    () =>
      messages.find(
        (message) =>
          message.switch_request_id === selectedSwitchId &&
          message.direction === 'outbound' &&
          message.message_code === 'Z03'
      ) ?? null,
    [messages, selectedSwitchId]
  )

  const z09LinkedMessage = useMemo(
    () =>
      messages.find(
        (message) =>
          message.switch_request_id === selectedSwitchId &&
          message.direction === 'outbound' &&
          message.message_code === 'Z09'
      ) ?? null,
    [messages, selectedSwitchId]
  )

  const recommendedRouteText = useMemo(
    () =>
      getRecommendedRouteSummary({
        routes,
        outboundRequests,
        selectedSwitchId,
        selectedRouteId,
      }),
    [routes, outboundRequests, selectedSwitchId, selectedRouteId]
  )

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Operativ EDIEL-workbench</h2>
        <p className="mt-1 text-sm text-slate-600">
          Rekommendationerna kommer nu från en separat EDIEL-modul, så samma logik
          kan återanvändas i andra vyer senare.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Rekommenderad route
            </div>
            <div className="mt-2 text-sm text-slate-700">{recommendedRouteText}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Skickbara meddelanden
            </div>
            <div className="mt-2 text-sm text-slate-700">
              {sendableMessagesToShow.length} rekommenderade val
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Inbound UTILTS
            </div>
            <div className="mt-2 text-sm text-slate-700">
              {inboundUtiltsMessagesToShow.length} rekommenderade val
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              ACK-källor
            </div>
            <div className="mt-2 text-sm text-slate-700">
              {ackableMessagesToShow.length} rekommenderade val
            </div>
          </div>
        </div>
      </div>

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
                Senaste Z03 på detta ärende: {z03LinkedMessage?.id ?? 'ingen ännu'}
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
                Senaste Z09 på detta ärende: {z09LinkedMessage?.id ?? 'ingen ännu'}
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

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Skicka Ediel-meddelande</h2>
          <p className="mt-1 text-sm text-slate-600">
            Listan prioriterar outbound-meddelanden för vald switch och vald route.
          </p>

          <form action={sendEdielMessageAction} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Ediel-meddelande
              </label>
              <select
                value={selectedMessageId}
                onChange={(event) => setSelectedMessageId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                {sendableMessagesToShow.length === 0 ? (
                  <option value="">Inga skickbara meddelanden</option>
                ) : (
                  sendableMessagesToShow.map((message) => (
                    <option key={message.id} value={message.id}>
                      {messageLabel(message)}
                    </option>
                  ))
                )}
              </select>
              <input type="hidden" name="edielMessageId" value={selectedMessageId} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Valt meddelande</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>ID: {formatMaybe(selectedMessage?.id)}</div>
                <div>Status: {formatMaybe(selectedMessage?.status)}</div>
                <div>
                  Kod:{' '}
                  {selectedMessage
                    ? `${selectedMessage.message_family} ${selectedMessage.message_code}`
                    : '—'}
                </div>
                <div>Route: {formatMaybe(selectedMessage?.communication_route_id)}</div>
                <div>Switch request: {formatMaybe(selectedMessage?.switch_request_id)}</div>
                <div>Mottagarens e-post: {formatMaybe(selectedMessage?.receiver_email)}</div>
              </div>
            </div>

            <button
              disabled={!selectedMessageId}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Skicka Ediel-meddelande
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Mailbox polling</h2>
          <p className="mt-1 text-sm text-slate-600">
            Pollning använder vald route och mailbox. IMAP ser frisk ut; tom inbox ger bara 0 träffar.
          </p>

          <form action={pollMailboxAction} className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Mailbox
                </label>
                <input
                  name="mailbox"
                  value={mailbox}
                  onChange={(event) => setMailbox(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Route för pollning
                </label>
                <select
                  value={pollRouteId}
                  onChange={(event) => setPollRouteId(event.target.value)}
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
                <input type="hidden" name="communicationRouteId" value={pollRouteId} />
              </div>
            </div>

            <input type="hidden" name="limit" value="10" />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Vald route för pollning</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>Route: {selectedPollRoute ? routeLabel(selectedPollRoute) : '—'}</div>
                <div>Mailbox i profilen: {formatMaybe(selectedPollRoute?.profile?.mailbox)}</div>
                <div>IMAP körs mot: {mailbox || selectedPollRoute?.profile?.mailbox || 'INBOX'}</div>
                <div>Route-id: {formatMaybe(selectedPollRoute?.id)}</div>
              </div>
            </div>

            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Poll mailbox
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Negativ UTILTS-respons</h2>
          <p className="mt-1 text-sm text-slate-600">
            Listan prioriterar inbound UTILTS för vald route eller matchande Ediel-par.
          </p>

          <form action={createNegativeUtiltsResponseAction} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Inbound UTILTS-meddelande
              </label>
              <select
                value={selectedInboundUtiltsId}
                onChange={(event) => setSelectedInboundUtiltsId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                {inboundUtiltsMessagesToShow.length === 0 ? (
                  <option value="">Inga inbound UTILTS-meddelanden</option>
                ) : (
                  inboundUtiltsMessagesToShow.map((message) => (
                    <option key={message.id} value={message.id}>
                      {messageLabel(message)}
                    </option>
                  ))
                )}
              </select>
              <input type="hidden" name="edielMessageId" value={selectedInboundUtiltsId} />
            </div>

            <textarea
              name="messageText"
              placeholder="Felorsak"
              className="min-h-[100px] w-full rounded-xl border border-slate-300 px-3 py-2"
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Valt inbound UTILTS</div>
              <div className="mt-2 space-y-1">
                <div>ID: {formatMaybe(selectedInboundUtilts?.id)}</div>
                <div>
                  Kod:{' '}
                  {selectedInboundUtilts
                    ? `${selectedInboundUtilts.message_family} ${selectedInboundUtilts.message_code}`
                    : '—'}
                </div>
                <div>Sender Ediel-id: {formatMaybe(selectedInboundUtilts?.sender_ediel_id)}</div>
                <div>Receiver Ediel-id: {formatMaybe(selectedInboundUtilts?.receiver_ediel_id)}</div>
              </div>
            </div>

            <button
              disabled={!selectedInboundUtiltsId}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Skapa UTILTS-ERR
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Skapa ACK-utkast</h2>
          <p className="mt-1 text-sm text-slate-600">
            Listan prioriterar meddelanden för vald switch och vald route först.
          </p>

          <form action={createAckDraftAction} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Källmeddelande
              </label>
              <select
                value={selectedAckSourceId}
                onChange={(event) => setSelectedAckSourceId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                {ackableMessagesToShow.length === 0 ? (
                  <option value="">Inga källmeddelanden</option>
                ) : (
                  ackableMessagesToShow.map((message) => (
                    <option key={message.id} value={message.id}>
                      {messageLabel(message)}
                    </option>
                  ))
                )}
              </select>
              <input type="hidden" name="sourceMessageId" value={selectedAckSourceId} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <select
                name="ackType"
                defaultValue="CONTRL"
                className="rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="CONTRL">CONTRL</option>
                <option value="APERAK">APERAK</option>
                <option value="UTILTS_ERR">UTILTS_ERR</option>
              </select>

              <select
                name="outcome"
                defaultValue="positive"
                className="rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="positive">positive</option>
                <option value="negative">negative</option>
              </select>
            </div>

            <textarea
              name="messageText"
              placeholder="Meddelandetext"
              className="min-h-[100px] w-full rounded-xl border border-slate-300 px-3 py-2"
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Valt källmeddelande</div>
              <div className="mt-2 space-y-1">
                <div>ID: {formatMaybe(selectedAckSource?.id)}</div>
                <div>
                  Kod:{' '}
                  {selectedAckSource
                    ? `${selectedAckSource.message_family} ${selectedAckSource.message_code}`
                    : '—'}
                </div>
                <div>Direction: {formatMaybe(selectedAckSource?.direction)}</div>
                <div>Sender Ediel-id: {formatMaybe(selectedAckSource?.sender_ediel_id)}</div>
                <div>Receiver Ediel-id: {formatMaybe(selectedAckSource?.receiver_ediel_id)}</div>
              </div>
            </div>

            <button
              disabled={!selectedAckSourceId}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Skapa ACK-utkast
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Manuellt PRODAT-utkast</h2>
          <p className="mt-1 text-sm text-slate-600">
            Routeprefill är kvar, men nu använder workbenchen samma rekommendationsmotor överallt.
          </p>

          <form action={createProdatDraftAction} className="mt-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  PRODAT-kod
                </label>
                <select
                  name="code"
                  value={prodatCode}
                  onChange={(event) =>
                    setProdatCode(event.target.value as 'Z03' | 'Z09' | 'Z01' | 'Z13' | 'Z18')
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                >
                  <option value="Z03">Z03</option>
                  <option value="Z09">Z09</option>
                  <option value="Z01">Z01</option>
                  <option value="Z13">Z13</option>
                  <option value="Z18">Z18</option>
                </select>
              </div>

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
                <input type="hidden" name="communicationRouteId" value={selectedRouteId} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input type="hidden" name="switchRequestId" value={selectedSwitchId} />

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Avsändarens Ediel-id
                </label>
                <input
                  name="senderEdielId"
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
                  name="receiverEdielId"
                  value={receiverEdielId}
                  onChange={(event) => setReceiverEdielId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Sender sub address
                </label>
                <input
                  name="senderSubAddress"
                  value={senderSubAddress}
                  onChange={(event) => setSenderSubAddress(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Receiver sub address
                </label>
                <input
                  name="receiverSubAddress"
                  value={receiverSubAddress}
                  onChange={(event) => setReceiverSubAddress(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Application reference
                </label>
                <input
                  name="applicationReference"
                  value={applicationReference}
                  onChange={(event) => setApplicationReference(event.target.value)}
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

              <div className="md:col-span-2">
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
            </div>

            <textarea
              name="payload"
              placeholder='{"meterPointId":"735999...","customerName":"Test Customer"}'
              className="min-h-[140px] w-full rounded-xl border border-slate-300 px-3 py-2"
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Prefill från vald route</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>Route: {recommendedRouteText}</div>
                <div>Target email: {formatMaybe(selectedRoute?.target_email)}</div>
                <div>Sender Ediel-id: {formatMaybe(senderEdielId)}</div>
                <div>Receiver Ediel-id: {formatMaybe(receiverEdielId)}</div>
                <div>Sender sub address: {formatMaybe(senderSubAddress)}</div>
                <div>Receiver sub address: {formatMaybe(receiverSubAddress)}</div>
                <div>Application ref: {formatMaybe(applicationReference)}</div>
                <div>Mailbox: {formatMaybe(dispatchMailbox)}</div>
              </div>
            </div>

            <button
              disabled={!selectedRouteId}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Skapa PRODAT-utkast
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}