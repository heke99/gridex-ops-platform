// components/admin/ediel/EdielWorkbench.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
 getNewestSwitchId,
 getPreferredRouteId,
 getRecommendedAckableMessages,
 getRecommendedInboundUtiltsMessages,
 getRecommendedRouteSummary,
 getRecommendedRoutes,
 getRecommendedSendableMessages,
 getSelectedRoute,
} from '@/lib/ediel/recommendations'
import type { EdielWorkbenchProps } from '@/components/admin/ediel/workbench/types'
import WorkbenchSummary from '@/components/admin/ediel/workbench/WorkbenchSummary'
import PrepareSwitchPanels from '@/components/admin/ediel/workbench/PrepareSwitchPanels'
import DispatchPanels from '@/components/admin/ediel/workbench/DispatchPanels'
import { isActiveEdielMessageFamily } from '@/lib/ediel/types'

type SupportedProdatCode = 'Z03' | 'Z04' | 'Z05' | 'Z06' | 'Z09' | 'Z10'

export default function EdielWorkbench({
 switchRequests,
 outboundRequests,
 messages,
 routes,
}: EdielWorkbenchProps) {
 const scopedMessages = useMemo(
 () => messages.filter((message) => isActiveEdielMessageFamily(message.message_family)),
 [messages]
 )

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
 const [prodatCode, setProdatCode] = useState<SupportedProdatCode>('Z03')

 const [senderEdielId, setSenderEdielId] = useState('')
 const [receiverEdielId, setReceiverEdielId] = useState('')
 const [senderSubAddress, setSenderSubAddress] = useState('')
 const [receiverSubAddress, setReceiverSubAddress] = useState('')
 const [applicationReference, setApplicationReference] = useState('')
 const [dispatchMailbox, setDispatchMailbox] = useState('INBOX')
 const [receiverEmail, setReceiverEmail] = useState('')

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
 if (!selectedSwitchId && newestSwitchId) {
 queueMicrotask(() => setSelectedSwitchId(newestSwitchId))
 }
 }, [newestSwitchId, selectedSwitchId])

 useEffect(() => {
 if (!selectedRouteId && preferredRouteId) {
 queueMicrotask(() => setSelectedRouteId(preferredRouteId))
 }
 }, [preferredRouteId, selectedRouteId])

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

 useEffect(() => {
 const nextSenderEdielId = selectedRoute?.profile?.sender_ediel_id ?? ''
 const nextReceiverEdielId = selectedRoute?.profile?.receiver_ediel_id ?? ''
 const nextSenderSubAddress = selectedRoute?.profile?.sender_sub_address ?? ''
 const nextReceiverSubAddress = selectedRoute?.profile?.receiver_sub_address ?? ''
 const nextApplicationReference = selectedRoute?.profile?.application_reference ?? ''
 const nextDispatchMailbox = selectedRoute?.profile?.mailbox ?? ''
 const nextReceiverEmail = selectedRoute?.target_email ?? ''

 queueMicrotask(() => {
 if (nextSenderEdielId && !senderEdielId) {
 setSenderEdielId(nextSenderEdielId)
 }

 if (nextReceiverEdielId && !receiverEdielId) {
 setReceiverEdielId(nextReceiverEdielId)
 }

 if (nextSenderSubAddress) {
 setSenderSubAddress(nextSenderSubAddress)
 }

 if (nextReceiverSubAddress) {
 setReceiverSubAddress(nextReceiverSubAddress)
 }

 if (nextApplicationReference && !applicationReference) {
 setApplicationReference(nextApplicationReference)
 }

 if (nextDispatchMailbox && !dispatchMailbox) {
 setDispatchMailbox(nextDispatchMailbox)
 }

 if (nextReceiverEmail && !receiverEmail) {
 setReceiverEmail(nextReceiverEmail)
 }
 })
 }, [
 selectedRoute,
 senderEdielId,
 receiverEdielId,
 applicationReference,
 dispatchMailbox,
 receiverEmail,
 ])

 const sendableMessagesToShow = useMemo(
 () =>
 getRecommendedSendableMessages({
 messages: scopedMessages,
 selectedSwitchId,
 selectedRouteId,
 }),
 [scopedMessages, selectedSwitchId, selectedRouteId]
 )

 const inboundUtiltsMessagesToShow = useMemo(
 () =>
 getRecommendedInboundUtiltsMessages({
 messages: scopedMessages,
 selectedSwitchId,
 }),
 [scopedMessages, selectedSwitchId]
 )

 const ackableMessagesToShow = useMemo(
 () =>
 getRecommendedAckableMessages({
 messages: scopedMessages,
 selectedSwitchId,
 }),
 [scopedMessages, selectedSwitchId]
 )

 useEffect(() => {
 if (!selectedMessageId && sendableMessagesToShow.length > 0) {
 queueMicrotask(() => setSelectedMessageId(sendableMessagesToShow[0].id))
 }
 }, [sendableMessagesToShow, selectedMessageId])

 useEffect(() => {
 if (!selectedInboundUtiltsId && inboundUtiltsMessagesToShow.length > 0) {
 queueMicrotask(() => setSelectedInboundUtiltsId(inboundUtiltsMessagesToShow[0].id))
 }
 }, [inboundUtiltsMessagesToShow, selectedInboundUtiltsId])

 useEffect(() => {
 if (!selectedAckSourceId && ackableMessagesToShow.length > 0) {
 queueMicrotask(() => setSelectedAckSourceId(ackableMessagesToShow[0].id))
 }
 }, [ackableMessagesToShow, selectedAckSourceId])

 const selectedMessage = useMemo(
 () => scopedMessages.find((message) => message.id === selectedMessageId) ?? null,
 [scopedMessages, selectedMessageId]
 )

 const selectedInboundUtilts = useMemo(
 () => scopedMessages.find((message) => message.id === selectedInboundUtiltsId) ?? null,
 [scopedMessages, selectedInboundUtiltsId]
 )

 const selectedAckSource = useMemo(
 () => scopedMessages.find((message) => message.id === selectedAckSourceId) ?? null,
 [scopedMessages, selectedAckSourceId]
 )

 const z03LinkedMessage = useMemo(
 () =>
 scopedMessages.find(
 (message) =>
 message.switch_request_id === selectedSwitchId &&
 message.direction === 'outbound' &&
 message.message_code === 'Z03'
 ) ?? null,
 [scopedMessages, selectedSwitchId]
 )

 const z04LinkedMessage = useMemo(
 () =>
 scopedMessages.find(
 (message) =>
 message.switch_request_id === selectedSwitchId &&
 message.direction === 'outbound' &&
 message.message_code === 'Z04'
 ) ?? null,
 [scopedMessages, selectedSwitchId]
 )

 const z05LinkedMessage = useMemo(
 () =>
 scopedMessages.find(
 (message) =>
 message.switch_request_id === selectedSwitchId &&
 message.direction === 'outbound' &&
 message.message_code === 'Z05'
 ) ?? null,
 [scopedMessages, selectedSwitchId]
 )

 const z06LinkedMessage = useMemo(
 () =>
 scopedMessages.find(
 (message) =>
 message.switch_request_id === selectedSwitchId &&
 message.direction === 'outbound' &&
 message.message_code === 'Z06'
 ) ?? null,
 [scopedMessages, selectedSwitchId]
 )

 const z09LinkedMessage = useMemo(
 () =>
 scopedMessages.find(
 (message) =>
 message.switch_request_id === selectedSwitchId &&
 message.direction === 'outbound' &&
 message.message_code === 'Z09'
 ) ?? null,
 [scopedMessages, selectedSwitchId]
 )

 const z10LinkedMessage = useMemo(
 () =>
 scopedMessages.find(
 (message) =>
 message.switch_request_id === selectedSwitchId &&
 message.direction === 'outbound' &&
 message.message_code === 'Z10'
 ) ?? null,
 [scopedMessages, selectedSwitchId]
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
 <WorkbenchSummary
 recommendedRouteText={recommendedRouteText}
 sendableCount={sendableMessagesToShow.length}
 inboundUtiltsCount={inboundUtiltsMessagesToShow.length}
 ackableCount={ackableMessagesToShow.length}
 />

 <PrepareSwitchPanels
 switchRequests={switchRequests}
 selectedSwitchId={selectedSwitchId}
 setSelectedSwitchId={setSelectedSwitchId}
 selectedRouteId={selectedRouteId}
 setSelectedRouteId={setSelectedRouteId}
 recommendedRoutes={recommendedRoutes}
 selectedRoute={selectedRoute}
 selectedSwitch={selectedSwitch}
 senderEdielId={senderEdielId}
 setSenderEdielId={setSenderEdielId}
 receiverEdielId={receiverEdielId}
 setReceiverEdielId={setReceiverEdielId}
 receiverEmail={receiverEmail}
 setReceiverEmail={setReceiverEmail}
 dispatchMailbox={dispatchMailbox}
 setDispatchMailbox={setDispatchMailbox}
 recommendedRouteText={recommendedRouteText}
 z03LinkedMessageId={z03LinkedMessage?.id ?? null}
 z04LinkedMessageId={z04LinkedMessage?.id ?? null}
 z05LinkedMessageId={z05LinkedMessage?.id ?? null}
 z06LinkedMessageId={z06LinkedMessage?.id ?? null}
 z09LinkedMessageId={z09LinkedMessage?.id ?? null}
 z10LinkedMessageId={z10LinkedMessage?.id ?? null}
 />

 <DispatchPanels
 selectedMessageId={selectedMessageId}
 setSelectedMessageId={setSelectedMessageId}
 sendableMessagesToShow={sendableMessagesToShow}
 selectedMessage={selectedMessage}
 mailbox={mailbox}
 setMailbox={setMailbox}
 pollRouteId={pollRouteId}
 setPollRouteId={setPollRouteId}
 recommendedRoutes={recommendedRoutes}
 selectedPollRoute={selectedPollRoute}
 selectedInboundUtiltsId={selectedInboundUtiltsId}
 setSelectedInboundUtiltsId={setSelectedInboundUtiltsId}
 inboundUtiltsMessagesToShow={inboundUtiltsMessagesToShow}
 selectedInboundUtilts={selectedInboundUtilts}
 selectedAckSourceId={selectedAckSourceId}
 setSelectedAckSourceId={setSelectedAckSourceId}
 ackableMessagesToShow={ackableMessagesToShow}
 selectedAckSource={selectedAckSource}
 prodatCode={prodatCode}
 setProdatCode={setProdatCode}
 selectedRouteId={selectedRouteId}
 setSelectedRouteId={setSelectedRouteId}
 selectedRoute={selectedRoute}
 selectedSwitchId={selectedSwitchId}
 senderEdielId={senderEdielId}
 setSenderEdielId={setSenderEdielId}
 receiverEdielId={receiverEdielId}
 setReceiverEdielId={setReceiverEdielId}
 senderSubAddress={senderSubAddress}
 setSenderSubAddress={setSenderSubAddress}
 receiverSubAddress={receiverSubAddress}
 setReceiverSubAddress={setReceiverSubAddress}
 applicationReference={applicationReference}
 setApplicationReference={setApplicationReference}
 dispatchMailbox={dispatchMailbox}
 setDispatchMailbox={setDispatchMailbox}
 receiverEmail={receiverEmail}
 setReceiverEmail={setReceiverEmail}
 recommendedRouteText={recommendedRouteText}
 />
 </section>
 )
}