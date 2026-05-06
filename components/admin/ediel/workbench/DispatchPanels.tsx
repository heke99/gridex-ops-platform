'use client'

import Link from 'next/link'
import {
  createAckDraftAction,
  createNegativeUtiltsResponseAction,
  createProdatDraftAction,
  processEdielOperationalMessageAction,
  pollMailboxAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type {
  EdielRecommendationMessageRow,
  EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'
import { formatMaybe, messageLabel, routeLabel } from './helpers'

type AckDraftType = 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
type SupportedProdatCode = 'Z03' | 'Z04' | 'Z05' | 'Z06' | 'Z09' | 'Z10'

function deriveAckTypeFromSelection(
  selectedAckSource: EdielRecommendationMessageRow | null,
  prodatCode: SupportedProdatCode
): AckDraftType {
  if (selectedAckSource?.message_family === 'UTILTS') {
    return 'APERAK'
  }

  if (selectedAckSource?.message_family === 'UTILTS_ERR') {
    return 'UTILTS_ERR'
  }

  if (prodatCode === 'Z05') return 'APERAK'
  return 'CONTRL'
}

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
  prodatCode: SupportedProdatCode
  setProdatCode: (value: SupportedProdatCode) => void
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
  const derivedAckType = deriveAckTypeFromSelection(selectedAckSource, prodatCode)

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Skicka Ediel-meddelande</h2>
          <p className="mt-1 text-sm text-slate-600">
            Listan prioriterar outbound-meddelanden för vald switch och vald route inom aktivt scope.
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

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                TGT/systemtest skickas okrypterat som application/EDIFACT base64
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Valt meddelande</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  ID:{' '}
                  {selectedMessage?.id ? (
                    <Link
                      href={`/admin/ediel/messages/${selectedMessage.id}`}
                      className="text-indigo-700 underline-offset-2 hover:underline"
                    >
                      {selectedMessage.id}
                    </Link>
                  ) : (
                    '—'
                  )}
                </div>
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

            {selectedMessage?.id ? (
              <Link
                href={`/admin/ediel/messages/${selectedMessage.id}`}
                className="inline-flex items-center rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Öppna message detail
              </Link>
            ) : null}

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
            Pollning använder vald route och mailbox.
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
                <div>IMAP körs mot: {mailbox || selectedPollRoute?.profile?.mailbox || '—'}</div>
                <div>Target system: {formatMaybe(selectedPollRoute?.target_system)}</div>
              </div>
            </div>

            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
              Poll mailbox
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">Inbound UTILTS kandidat</h2>
          <p className="mt-1 text-sm text-slate-600">
            Aktivt scope visar bara UTILTS-spår som kan länkas vidare i processen.
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Inbound UTILTS
              </label>
              <select
                value={selectedInboundUtiltsId}
                onChange={(event) => setSelectedInboundUtiltsId(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                {inboundUtiltsMessagesToShow.length === 0 ? (
                  <option value="">Inga inbound UTILTS</option>
                ) : (
                  inboundUtiltsMessagesToShow.map((message) => (
                    <option key={message.id} value={message.id}>
                      {messageLabel(message)}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Valt inbound UTILTS</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  ID:{' '}
                  {selectedInboundUtilts?.id ? (
                    <Link
                      href={`/admin/ediel/messages/${selectedInboundUtilts.id}`}
                      className="text-indigo-700 underline-offset-2 hover:underline"
                    >
                      {selectedInboundUtilts.id}
                    </Link>
                  ) : (
                    '—'
                  )}
                </div>
                <div>Status: {formatMaybe(selectedInboundUtilts?.status)}</div>
                <div>
                  Kod:{' '}
                  {selectedInboundUtilts
                    ? `${selectedInboundUtilts.message_family} ${selectedInboundUtilts.message_code}`
                    : '—'}
                </div>
                <div>Data request: {formatMaybe(selectedInboundUtilts?.grid_owner_data_request_id)}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <form action={processEdielOperationalMessageAction}>
                <input type="hidden" name="edielMessageId" value={selectedInboundUtiltsId} />
                <button
                  disabled={!selectedInboundUtiltsId}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Kör UTILTS engine / skapa TGT-svar
                </button>
              </form>

              <form action={createNegativeUtiltsResponseAction}>
                <input type="hidden" name="edielMessageId" value={selectedInboundUtiltsId} />
                <input type="hidden" name="messageText" value="Functional error" />
                <button
                  disabled={!selectedInboundUtiltsId}
                  className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Manuell UTILTS-ERR
                </button>
              </form>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-950">ACK-utkast</h2>
          <p className="mt-1 text-sm text-slate-600">
            ACK-typen styrs nu av faktiskt sammanhang i aktivt scope istället för gamla placeholder-koder.
          </p>

          <form action={createAckDraftAction} className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
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
                    <option value="">Inga ACK-källor</option>
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

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  ACK-typ
                </label>
                <input
                  readOnly
                  value={derivedAckType}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2"
                />
                <input type="hidden" name="ackType" value={derivedAckType} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-medium text-slate-900">Vald ACK-källa</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  ID:{' '}
                  {selectedAckSource?.id ? (
                    <Link
                      href={`/admin/ediel/messages/${selectedAckSource.id}`}
                      className="text-indigo-700 underline-offset-2 hover:underline"
                    >
                      {selectedAckSource.id}
                    </Link>
                  ) : (
                    '—'
                  )}
                </div>
                <div>Status: {formatMaybe(selectedAckSource?.status)}</div>
                <div>
                  Kod:{' '}
                  {selectedAckSource
                    ? `${selectedAckSource.message_family} ${selectedAckSource.message_code}`
                    : '—'}
                </div>
                <div>Route: {formatMaybe(selectedAckSource?.communication_route_id)}</div>
              </div>
            </div>

            {selectedAckSource?.id ? (
              <Link
                href={`/admin/ediel/messages/${selectedAckSource.id}`}
                className="inline-flex items-center rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Öppna ACK-källa
              </Link>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
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

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Switch request-id
                </label>
                <input
                  name="switchRequestId"
                  value={selectedSwitchId}
                  readOnly
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Sender Ediel-id
                </label>
                <input
                  value={senderEdielId}
                  onChange={(event) => setSenderEdielId(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Receiver Ediel-id
                </label>
                <input
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
                  value={dispatchMailbox}
                  onChange={(event) => setDispatchMailbox(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Receiver e-post
                </label>
                <input
                  value={receiverEmail}
                  onChange={(event) => setReceiverEmail(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Outcome
              </label>
              <select
                name="outcome"
                defaultValue="positive"
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="positive">positive</option>
                <option value="negative">negative</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Meddelandetext
              </label>
              <input
                name="messageText"
                defaultValue=""
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
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

            <button
              disabled={!selectedAckSourceId}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Skapa ACK-utkast
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Manuellt PRODAT-utkast</h2>
        <p className="mt-1 text-sm text-slate-600">
          Endast koder i aktivt switch-scope visas här.
        </p>

        <form action={createProdatDraftAction} className="mt-4 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="switchRequestId" value={selectedSwitchId} />
          <input type="hidden" name="communicationRouteId" value={selectedRouteId} />

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              PRODAT-kod
            </label>
            <select
              name="messageCode"
              value={prodatCode}
              onChange={(event) => setProdatCode(event.target.value as SupportedProdatCode)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2"
            >
              <option value="Z03">Z03 · Leverantörsbyte</option>
              <option value="Z04">Z04 · Svar på leverantörsbyte</option>
              <option value="Z05">Z05 · Inflytt/övertagande</option>
              <option value="Z06">Z06 · Svar på inflytt/övertagande</option>
              <option value="Z09">Z09 · Anläggningsändring</option>
              <option value="Z10">Z10 · Svar på anläggningsändring</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Sender Ediel-id
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
              Receiver Ediel-id
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
              Receiver e-post
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
            <button
              disabled={!selectedSwitchId || !selectedRouteId}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Skapa PRODAT-utkast
            </button>
          </div>
        </form>
      </div>
    </>
  )
}