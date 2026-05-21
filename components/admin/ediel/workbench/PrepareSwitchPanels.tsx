'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
 prepareAiListAction,
 prepareSwitchZ03Action,
 prepareSwitchZ04Action,
 prepareSwitchZ05Action,
 prepareSwitchZ06Action,
 prepareSwitchZ09Action,
 prepareSwitchZ10Action,
 prepareUtiltsE66Action,
 prepareUtiltsE73Action,
} from '@/app/admin/ediel/actions'
import type {
 EdielRecommendationRouteRow,
 EdielRecommendationSwitchRow,
} from '@/lib/ediel/recommendations'
import { formatMaybe, routeLabel } from './helpers'

function todayIsoDate(offsetDays = 0): string {
 const date = new Date()
 date.setDate(date.getDate() + offsetDays)
 return date.toISOString().slice(0, 10)
}

function canPrepareAiList(params: {
 aiListType: 'AI' | 'BI'
 aiCustomerId: string
 aiSiteId: string
 aiFromDate: string
 aiToDate: string
 senderEdielId: string
 receiverEdielId: string
 selectedRouteId: string
}) {
 if (!params.selectedRouteId) return false
 if (!params.senderEdielId || !params.receiverEdielId) return false
 if (!params.aiCustomerId || !params.aiSiteId) return false
 if (!params.aiFromDate || !params.aiToDate) return false
 if (params.aiListType === 'BI' && !params.aiSiteId) return false
 return true
}

function ProdatPrepareCard({
 code,
 title,
 description,
 action,
 selectedSwitchId,
 selectedRouteId,
 linkedMessageId,
 disabled,
}: {
 code: string
 title: string
 description: string
 action: (formData: FormData) => void | Promise<void>
 selectedSwitchId: string
 selectedRouteId: string
 linkedMessageId: string | null
 disabled: boolean
}) {
 return (
 <form action={action} className="rounded-2xl border border-slate-200 p-4">
 <input type="hidden" name="switchRequestId" value={selectedSwitchId} />
 <input type="hidden" name="communicationRouteId" value={selectedRouteId} />
 {code === 'Z03' ? <input type="hidden" name="forceRegenerate" value="true" /> : null}

 <div className="text-sm font-semibold text-slate-900">{title}</div>

 <p className="mt-2 text-sm text-slate-700">{description}</p>

 <div className="mt-3 text-xs text-slate-700">
 Senaste {code}:{' '}
 {linkedMessageId ? (
 <Link
 href={`/admin/ediel/messages/${linkedMessageId}`}
 className="text-emerald-700 underline-offset-2 hover:underline"
 >
 {linkedMessageId}
 </Link>
 ) : (
 'ingen ännu'
 )}
 </div>

 <button
 type="submit"
 disabled={disabled}
 className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
 >
 Förbered {code}
 </button>
 </form>
 )
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
 z04LinkedMessageId,
 z05LinkedMessageId,
 z06LinkedMessageId,
 z09LinkedMessageId,
 z10LinkedMessageId,
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
 z04LinkedMessageId: string | null
 z05LinkedMessageId: string | null
 z06LinkedMessageId: string | null
 z09LinkedMessageId: string | null
 z10LinkedMessageId: string | null
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

 useEffect(() => {
 const nextCustomerId = selectedSwitch?.customer_id ?? ''
 const nextSiteId = selectedSwitch?.site_id ?? ''
 const nextMeteringPointId = selectedSwitch?.metering_point_id ?? ''
 queueMicrotask(() => {
 setAiCustomerId(nextCustomerId)
 setAiSiteId(nextSiteId)
 setAiMeteringPointId(nextMeteringPointId)
 })
 }, [selectedSwitch])

 const latestSwitchReference = selectedSwitch?.external_reference ?? 'ingen extern ref'
 const canPrepareSwitch =
 !!selectedSwitchId && !!selectedRouteId && !!senderEdielId && !!receiverEdielId

 const canPrepareE73 = Boolean(selectedDataRequestId && selectedRouteId)
 const canPrepareE66 = Boolean(
 selectedDataRequestId &&
 selectedRouteId &&
 e66PeriodStart &&
 e66PeriodEnd &&
 e66RegistrationTime
 )

 const canPrepareAi = useMemo(
 () =>
 canPrepareAiList({
 aiListType,
 aiCustomerId,
 aiSiteId,
 aiFromDate,
 aiToDate,
 senderEdielId,
 receiverEdielId,
 selectedRouteId,
 }),
 [
 aiListType,
 aiCustomerId,
 aiSiteId,
 aiFromDate,
 aiToDate,
 senderEdielId,
 receiverEdielId,
 selectedRouteId,
 ]
 )

 return (
 <div className="space-y-6">
 <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">
 Förbered-paneler i aktiv release
 </h2>
 <p className="mt-1 text-sm text-slate-700">
 Den här workbenchen är låst till aktivt scope: switch/PRODAT,
 data request/UTILTS och AI-lista. Framtida familjer ska inte förberedas här.
 </p>
 </div>

 <div className="flex flex-wrap gap-2 text-xs">
 <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 font-medium text-emerald-700">
 PRODAT Z03 / Z04 / Z05 / Z06 / Z09 / Z10
 </span>
 <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 font-medium text-emerald-700">
 UTILTS E73 / E66
 </span>
 <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 font-medium text-emerald-700">
 AI-lista
 </span>
 </div>
 </div>
 </div>

 <div className="grid gap-6 xl:grid-cols-3">
 <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-1">
 <h2 className="text-lg font-semibold text-slate-950">Gemensam route-kontext</h2>
 <p className="mt-1 text-sm text-slate-700">
 Alla prepare-flöden använder samma route-kontext. Byt route här först.
 </p>

 <div className="mt-4 space-y-4">
 <div>
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
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
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
 Gridex Ediel-id
 </label>
 <input
 value={senderEdielId}
 onChange={(event) => setSenderEdielId(event.target.value)}
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 </div>

 <div>
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
 Mottagarens Ediel-id
 </label>
 <input
 value={receiverEdielId}
 onChange={(event) => setReceiverEdielId(event.target.value)}
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 </div>

 <div>
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
 Mottagarens e-post
 </label>
 <input
 value={receiverEmail}
 onChange={(event) => setReceiverEmail(event.target.value)}
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 </div>

 <div>
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
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
 <div>
 Receiver Ediel-id:{' '}
 {formatMaybe(selectedRoute?.profile?.receiver_ediel_id)}
 </div>
 </div>
 </div>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-2">
 <h2 className="text-lg font-semibold text-slate-950">Switch → PRODAT</h2>
 <p className="mt-1 text-sm text-slate-700">
 Ett switchärende kan driva flera PRODAT-steg i samma system.
 </p>

 <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
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

 <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
 <div>Kund: {formatMaybe(selectedSwitch?.customer_id)}</div>
 <div>Site: {formatMaybe(selectedSwitch?.site_id)}</div>
 <div>Mätpunkt: {formatMaybe(selectedSwitch?.metering_point_id)}</div>
 <div>Status: {formatMaybe(selectedSwitch?.status)}</div>
 <div>Extern ref: {latestSwitchReference}</div>
 <div>Route: {recommendedRouteText}</div>
 </div>
 </div>

 <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
 <ProdatPrepareCard
 code="Z03"
 title="Förbered Z03"
 description="Starta leverantörsbytesflödet från valt switchärende."
 action={prepareSwitchZ03Action}
 selectedSwitchId={selectedSwitchId}
 selectedRouteId={selectedRouteId}
 linkedMessageId={z03LinkedMessageId}
 disabled={!canPrepareSwitch}
 />

 <ProdatPrepareCard
 code="Z04"
 title="Förbered Z04"
 description="PRODAT-steg för kompletterande/relaterad switchhantering."
 action={prepareSwitchZ04Action}
 selectedSwitchId={selectedSwitchId}
 selectedRouteId={selectedRouteId}
 linkedMessageId={z04LinkedMessageId}
 disabled={!canPrepareSwitch}
 />

 <ProdatPrepareCard
 code="Z05"
 title="Förbered Z05"
 description="Slut-/statusmeddelande i samma switchkedja."
 action={prepareSwitchZ05Action}
 selectedSwitchId={selectedSwitchId}
 selectedRouteId={selectedRouteId}
 linkedMessageId={z05LinkedMessageId}
 disabled={!canPrepareSwitch}
 />

 <ProdatPrepareCard
 code="Z06"
 title="Förbered Z06"
 description="PRODAT-steg för fel-/avslags- eller kompletterande svarshantering."
 action={prepareSwitchZ06Action}
 selectedSwitchId={selectedSwitchId}
 selectedRouteId={selectedRouteId}
 linkedMessageId={z06LinkedMessageId}
 disabled={!canPrepareSwitch}
 />

 <ProdatPrepareCard
 code="Z09"
 title="Förbered Z09"
 description="Alternativt steg i samma PRODAT-scope."
 action={prepareSwitchZ09Action}
 selectedSwitchId={selectedSwitchId}
 selectedRouteId={selectedRouteId}
 linkedMessageId={z09LinkedMessageId}
 disabled={!canPrepareSwitch}
 />

 <ProdatPrepareCard
 code="Z10"
 title="Förbered Z10"
 description="PRODAT-steg för senare switch-/statushantering i kedjan."
 action={prepareSwitchZ10Action}
 selectedSwitchId={selectedSwitchId}
 selectedRouteId={selectedRouteId}
 linkedMessageId={z10LinkedMessageId}
 disabled={!canPrepareSwitch}
 />
 </div>
 </div>
 </div>

 <div className="grid gap-6 xl:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 bg-white p-5">
 <h2 className="text-lg font-semibold text-slate-950">Data request → UTILTS</h2>
 <p className="mt-1 text-sm text-slate-700">
 Data request-flödet hålls separat från switch men i samma Ediel-motor.
 </p>

 <div className="mt-4 space-y-4">
 <div>
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
 Grid owner data request-id
 </label>
 <input
 value={selectedDataRequestId}
 onChange={(event) => setSelectedDataRequestId(event.target.value)}
 placeholder="Klistra in grid_owner_data_request-id"
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 </div>

 <div className="grid gap-4 md:grid-cols-2">
 <form
 action={prepareUtiltsE73Action}
 className="rounded-2xl border border-slate-200 p-4"
 >
 <input
 type="hidden"
 name="gridOwnerDataRequestId"
 value={selectedDataRequestId}
 />
 <input
 type="hidden"
 name="communicationRouteId"
 value={selectedRouteId}
 />

 <div className="text-sm font-semibold text-slate-900">Förbered E73</div>
 <p className="mt-2 text-sm text-slate-700">
 Begär saknade/efterfrågade mätdata från nätägaren.
 </p>

 <button
 type="submit"
 disabled={!canPrepareE73}
 className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
 >
 Förbered E73
 </button>
 </form>

 <form
 action={prepareUtiltsE66Action}
 className="rounded-2xl border border-slate-200 p-4"
 >
 <input
 type="hidden"
 name="gridOwnerDataRequestId"
 value={selectedDataRequestId}
 />
 <input
 type="hidden"
 name="communicationRouteId"
 value={selectedRouteId}
 />

 <div className="text-sm font-semibold text-slate-900">Förbered E66</div>
 <p className="mt-2 text-sm text-slate-700">
 Registrering/förberedelse av validerade mätvärden i aktivt UTILTS-scope.
 </p>

 <div className="mt-4 space-y-3">
 <input
 name="quantity"
 value={e66Quantity}
 onChange={(event) => setE66Quantity(event.target.value)}
 placeholder="Kvantitet"
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="periodStart"
 value={e66PeriodStart}
 onChange={(event) => setE66PeriodStart(event.target.value)}
 type="date"
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="periodEnd"
 value={e66PeriodEnd}
 onChange={(event) => setE66PeriodEnd(event.target.value)}
 type="date"
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="registrationTime"
 value={e66RegistrationTime}
 onChange={(event) => setE66RegistrationTime(event.target.value)}
 type="datetime-local"
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 </div>

 <button
 type="submit"
 disabled={!canPrepareE66}
 className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
 >
 Förbered E66
 </button>
 </form>
 </div>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-5">
 <h2 className="text-lg font-semibold text-slate-950">AI-lista</h2>
 <p className="mt-1 text-sm text-slate-700">
 AI-lista ligger kvar i aktiv release men bara som kontroll-/avvikelseflöde,
 inte auto-update.
 </p>

 <form action={prepareAiListAction} className="mt-4 space-y-4">
 <div className="grid gap-3 md:grid-cols-2">
 <div>
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
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
 <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-700">
 Receiver Ediel-id
 </label>
 <input
 name="receiverEdielId"
 value={receiverEdielId}
 onChange={(event) => setReceiverEdielId(event.target.value)}
 className="w-full rounded-xl border border-slate-300 px-3 py-2"
 />
 </div>

 <input
 name="customerId"
 value={aiCustomerId}
 onChange={(event) => setAiCustomerId(event.target.value)}
 placeholder="customerId"
 className="rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="siteId"
 value={aiSiteId}
 onChange={(event) => setAiSiteId(event.target.value)}
 placeholder="siteId"
 className="rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="meteringPointId"
 value={aiMeteringPointId}
 onChange={(event) => setAiMeteringPointId(event.target.value)}
 placeholder="meteringPointId"
 className="rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="supplierEdielId"
 value={senderEdielId}
 onChange={(event) => setSenderEdielId(event.target.value)}
 placeholder="supplierEdielId"
 className="rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="balanceResponsibleEdielId"
 value={aiBalanceResponsibleEdielId}
 onChange={(event) => setAiBalanceResponsibleEdielId(event.target.value)}
 placeholder="balanceResponsibleEdielId"
 className="rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="receiverEmail"
 value={receiverEmail}
 onChange={(event) => setReceiverEmail(event.target.value)}
 placeholder="receiverEmail"
 className="rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="fromDate"
 value={aiFromDate}
 onChange={(event) => setAiFromDate(event.target.value)}
 type="date"
 className="rounded-xl border border-slate-300 px-3 py-2"
 />
 <input
 name="toDate"
 value={aiToDate}
 onChange={(event) => setAiToDate(event.target.value)}
 type="date"
 className="rounded-xl border border-slate-300 px-3 py-2"
 />
 </div>

 <input type="hidden" name="communicationRouteId" value={selectedRouteId} />

 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
 <div className="font-medium text-slate-900">AI-lista i denna release</div>
 <div className="mt-2 space-y-1">
 <div>Syfte: kontroll och avvikelsehantering</div>
 <div>Format: semikolonseparerad CSV i gällande version</div>
 <div>Ingen automatisk DB-uppdatering från filen</div>
 </div>
 </div>

 <button
 type="submit"
 disabled={!canPrepareAi}
 className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
 >
 Förbered AI-lista
 </button>
 </form>
 </div>
 </div>
 </div>
 )
}