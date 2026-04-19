'use client'

import {
  createAckDraftAction,
  createNegativeUtiltsResponseAction,
  createProdatDraftAction,
  pollMailboxAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type {
  EdielRecommendationMessageRow,
  EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'
import { formatMaybe, messageLabel, routeLabel } from './helpers'

export default function DispatchPanels({
  selectedMessageId,
  setSelectedMessageId,
  sendableMessagesToShow,
  selectedMessage,
  mailbox,
  setMailbox,
  pollRouteId,
  setPollRouteId,
  recommendedRoutes,
  selectedPollRoute,
  selectedInboundUtiltsId,
  setSelectedInboundUtiltsId,
  inboundUtiltsMessagesToShow,
  selectedInboundUtilts,
  selectedAckSourceId,
  setSelectedAckSourceId,
  ackableMessagesToShow,
  selectedAckSource,
  prodatCode,
  setProdatCode,
  selectedRouteId,
  setSelectedRouteId,
  selectedRoute,
  selectedSwitchId,
  senderEdielId,
  setSenderEdielId,
  receiverEdielId,
  setReceiverEdielId,
  senderSubAddress,
  setSenderSubAddress,
  receiverSubAddress,
  setReceiverSubAddress,
  applicationReference,
  setApplicationReference,
  dispatchMailbox,
  setDispatchMailbox,
  receiverEmail,
  setReceiverEmail,
  recommendedRouteText,
}: {
  selectedMessageId: string
  setSelectedMessageId: (value: string) => void
  sendableMessagesToShow: EdielRecommendationMessageRow[]
  selectedMessage: EdielRecommendationMessageRow | null
  mailbox: string
  setMailbox: (value: string) => void
  pollRouteId: string
  setPollRouteId: (value: string) => void
  recommendedRoutes: EdielRecommendationRouteRow[]
  selectedPollRoute: EdielRecommendationRouteRow | null
  selectedInboundUtiltsId: string
  setSelectedInboundUtiltsId: (value: string) => void
  inboundUtiltsMessagesToShow: EdielRecommendationMessageRow[]
  selectedInboundUtilts: EdielRecommendationMessageRow | null
  selectedAckSourceId: string
  setSelectedAckSourceId: (value: string) => void
  ackableMessagesToShow: EdielRecommendationMessageRow[]
  selectedAckSource: EdielRecommendationMessageRow | null
  prodatCode: 'Z03' | 'Z09' | 'Z01' | 'Z13' | 'Z18'
  setProdatCode: (value: 'Z03' | 'Z09' | 'Z01' | 'Z13' | 'Z18') => void
  selectedRouteId: string
  setSelectedRouteId: (value: string) => void
  selectedRoute: EdielRecommendationRouteRow | null
  selectedSwitchId: string
  senderEdielId: string
  setSenderEdielId: (value: string) => void
  receiverEdielId: string
  setReceiverEdielId: (value: string) => void
  senderSubAddress: string
  setSenderSubAddress: (value: string) => void
  receiverSubAddress: string
  setReceiverSubAddress: (value: string) => void
  applicationReference: string
  setApplicationReference: (value: string) => void
  dispatchMailbox: string
  setDispatchMailbox: (value: string) => void
  receiverEmail: string
  setReceiverEmail: (value: string) => void
  recommendedRouteText: string
}) {
  return (
    <>
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
    </>
  )
}