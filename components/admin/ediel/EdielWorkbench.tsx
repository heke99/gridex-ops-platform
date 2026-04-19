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

export default function EdielWorkbench({
  switchRequests,
  outboundRequests,
  messages,
  routes,
}: EdielWorkbenchProps) {
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
        z09LinkedMessageId={z09LinkedMessage?.id ?? null}
        outboundRequests={outboundRequests}
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