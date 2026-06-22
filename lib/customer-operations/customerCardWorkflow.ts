/**
 * Customer Card Workflow View Model
 *
 * Computes the operational state of a customer from disparate table rows and
 * returns a structured model the UI renders directly, instead of scattering
 * EDIEL logic across React components.
 *
 * Normal company admins get plain Swedish text with no internal codes.
 * Platform admins additionally get technical details.
 */

import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { CustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type {
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'

export type WorkflowStepStatus = 'done' | 'current' | 'waiting' | 'blocked' | 'not_started'

export type CustomerWorkflowStep = {
  id: string
  label: string
  explanation: string
  status: WorkflowStepStatus
  timestamp?: string | null
  blockerReason?: string | null
  messageId?: string | null
}

export type WorkflowPrimaryAction =
  | 'request_data'
  | 'continue_data_request'
  | 'review_blocker'
  | 'approve_and_send'
  | 'wait_for_grid_owner'
  | 'create_supplier_switch'
  | 'no_action_required'

export type WorkflowSecondaryAction = {
  id: string
  label: string
  href?: string
}

export type CustomerCardWorkflow = {
  primaryStatus: string
  adminMessage: string
  nextRequiredAction: string | null
  primaryAction: WorkflowPrimaryAction
  workflowSteps: CustomerWorkflowStep[]
  secondaryActions: WorkflowSecondaryAction[]
  blockerCode: string | null
  blockerReason: string | null
  blockerAdminMessage: string | null
  routeStatus: string | null
  z01Status: string | null
  outboundStatus: string | null
  edielMessageStatus: string | null
  latestMessageId: string | null
  canShowTechnicalActions: boolean
  canRunRepair: boolean
  technicalDetails: {
    outboundRequestId: string | null
    edielMessageId: string | null
    gridOwnerDataRequestId: string | null
    communicationRouteId: string | null
    edielRouteProfileId: string | null
    operationId: string | null
    customerInfoRequestId: string | null
    blockerCode: string | null
    routeResolutionStatus: string | null
  }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function blockerToAdminMessage(blockerCode: string | null | undefined): string | null {
  if (!blockerCode) return null
  const messages: Record<string, string> = {
    operational_route_missing: 'Kontaktväg till nätägaren är inte klar. Plattformsadministratören behöver konfigurera Ediel-route.',
    platform_route_exists_but_not_materialized: 'Nätägaren finns i aktörsregistret men den operativa kontaktvägen är inte aktiverad.',
    production_send_locked: 'Produktionsutskick kräver godkännande från plattformsadministratören.',
    certificate_missing: 'Mottagarcertifikat saknas för krypterad Ediel-kommunikation.',
    missing_power_of_attorney: 'Signerad fullmakt saknas för uppgiftsbegäran.',
    grid_area_not_verified: 'Nätområde eller nätägare är inte verifierad för automatiskt utskick.',
    invalid_customer_site_snapshot: 'Anläggningsuppgifterna är ofullständiga och behöver uppdateras.',
    environment_not_resolved: 'Systemet kunde inte avgöra om begäran gäller test- eller produktionsmiljön.',
    sender_settings_missing: 'Avsändarinställning saknas i systemet.',
    stale_response_requires_review: 'Nätägarsvar är för gammalt och kräver manuell granskning.',
  }
  return messages[blockerCode] ?? null
}

function infoRequestToStepStatus(status: string | null | undefined): WorkflowStepStatus {
  if (!status) return 'not_started'
  if (['z01_prepared', 'sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl'].includes(status)) return 'waiting'
  if (['z02_received', 'ready_for_switch', 'completed'].includes(status)) return 'done'
  if (['blocked', 'route_missing', 'missing_authorization', 'manual_review_required'].includes(status)) return 'blocked'
  if (['draft'].includes(status)) return 'not_started'
  return 'current'
}

export type CustomerCardWorkflowInput = {
  customerId: string
  snapshot: CustomerCardSnapshot
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  infoRequests: CustomerInfoRequestRow[]
  contracts: CustomerContractRow[]
  switchRequests: SupplierSwitchRequestRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
  isPlatformAdmin: boolean
}

export function buildCustomerCardWorkflow(input: CustomerCardWorkflowInput): CustomerCardWorkflow {
  const { snapshot, infoRequests, switchRequests, isPlatformAdmin } = input

  const openInfoRequest = infoRequests.find(
    (row) => !['completed', 'cancelled', 'rejected'].includes(row.status),
  ) ?? infoRequests[0] ?? null

  const activeSwitchRequest = switchRequests.find((r) =>
    ['queued', 'validated', 'ready_to_send', 'submitted', 'waiting_response'].includes(String(r.status ?? '')),
  ) ?? null

  const infoStatus = openInfoRequest?.status ?? null
  const blockerCode = asString(openInfoRequest?.blocker_code)
  const blockerReason = asString(openInfoRequest?.blocker_reason)

  const verifiedPayload = asRecord(openInfoRequest?.verified_payload)
  const outboundRequestId = asString(openInfoRequest?.outbound_request_id ?? verifiedPayload.outboundRequestId)
  const edielMessageId = asString(openInfoRequest?.ediel_message_id ?? verifiedPayload.edielMessageId)
  const gridOwnerDataRequestId = asString(openInfoRequest?.grid_owner_data_request_id)
  const communicationRouteId = asString(verifiedPayload.communication_route_id)
  const edielRouteProfileId = asString(verifiedPayload.ediel_route_profile_id)
  const operationId = asString(openInfoRequest?.operation_id)
  const routeResolutionStatus = asString(openInfoRequest?.route_resolution_status)

  // Build visual workflow steps
  const steps: CustomerWorkflowStep[] = []

  // Step 1: Kund mottagen
  steps.push({
    id: 'customer_received',
    label: 'Kund mottagen',
    explanation: 'Kunden är registrerad i systemet.',
    status: 'done',
    timestamp: null,
  })

  // Step 2: Avtal och fullmakt
  const hasAuth = snapshot.hasAuthorization
  const hasContract = snapshot.hasContract
  const legalStatus = hasAuth && hasContract ? 'done' : hasContract || hasAuth ? 'current' : 'blocked'
  steps.push({
    id: 'legal_ready',
    label: 'Avtal och fullmakt',
    explanation: hasAuth && hasContract
      ? 'Vi har kundens avtal och fullmakt.'
      : !hasAuth
        ? 'Signerad fullmakt saknas.'
        : 'Avtal behöver registreras.',
    status: legalStatus,
    blockerReason: !hasAuth ? 'Fullmakt saknas' : !hasContract ? 'Avtal saknas' : null,
  })

  // Step 3: Anläggning och nätägare
  const hasFacility = snapshot.hasFacilityId && snapshot.hasGridOwner && snapshot.hasGridArea
  const facilityStatus: WorkflowStepStatus = hasFacility ? 'done' : !legalStatus.startsWith('d') ? 'not_started' : 'current'
  const gridOwnerName = snapshot.primarySite?.grid_owner_id ? null : null
  steps.push({
    id: 'facility_verified',
    label: 'Anläggning och nätägare',
    explanation: hasFacility
      ? `Anläggning och nätägare är kontrollerade.${gridOwnerName ? ` Nätägare: ${gridOwnerName}.` : ''}`
      : !snapshot.hasFacilityId
        ? 'Anläggnings-ID saknas.'
        : !snapshot.hasGridOwner
          ? 'Nätägare saknas eller är inte verifierad.'
          : 'Nätområde saknas.',
    status: facilityStatus,
    blockerReason: !hasFacility ? 'Anläggning eller nätägare ofullständig' : null,
  })

  // Step 4: Uppgifter begärs från nätägare
  let dataRequestStatus: WorkflowStepStatus = 'not_started'
  let dataRequestExplanation = 'Systemet har inte begärt uppgifter från nätägaren ännu.'
  let dataRequestBlocker: string | null = null

  if (openInfoRequest) {
    if (['completed', 'z02_received', 'ready_for_switch'].includes(infoStatus ?? '')) {
      dataRequestStatus = 'done'
      dataRequestExplanation = 'Uppgifter mottagna från nätägaren.'
    } else if (['z01_prepared'].includes(infoStatus ?? '')) {
      dataRequestStatus = 'current'
      dataRequestExplanation = 'Systemet förbereder begäran om anläggningsuppgifter till nätägaren.'
    } else if (['sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl'].includes(infoStatus ?? '')) {
      dataRequestStatus = 'waiting'
      dataRequestExplanation = 'Begäran har skickats. Väntar på svar från nätägaren.'
    } else if (['blocked', 'route_missing'].includes(infoStatus ?? '')) {
      dataRequestStatus = 'blocked'
      dataRequestExplanation = blockerToAdminMessage(blockerCode) ?? 'Uppgiftsbegäran är blockerad. Se detaljer nedan.'
      dataRequestBlocker = blockerToAdminMessage(blockerCode) ?? blockerReason
    } else if (['missing_authorization'].includes(infoStatus ?? '')) {
      dataRequestStatus = 'blocked'
      dataRequestExplanation = 'Signerad fullmakt saknas för uppgiftsbegäran.'
      dataRequestBlocker = 'Fullmakt saknas'
    } else if (['manual_review_required'].includes(infoStatus ?? '')) {
      dataRequestStatus = 'current'
      dataRequestExplanation = 'Manuell granskning av leverantörsavtal krävs.'
    } else {
      dataRequestStatus = infoRequestToStepStatus(infoStatus)
      dataRequestExplanation = 'Uppgiftsbegäran pågår.'
    }
  }

  steps.push({
    id: 'data_request',
    label: 'Uppgifter begärs från nätägare',
    explanation: dataRequestExplanation,
    status: dataRequestStatus,
    blockerReason: dataRequestBlocker,
    messageId: isPlatformAdmin ? gridOwnerDataRequestId : null,
  })

  // Step 5: Meddelande förbereds / skickat
  const outboundExists = Boolean(outboundRequestId)
  const edielExists = Boolean(edielMessageId)
  let messageStep: WorkflowStepStatus = 'not_started'
  let messageExplanation = 'Ediel-meddelandet är inte förberett ännu.'

  if (edielExists) {
    if (['sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl'].includes(infoStatus ?? '')) {
      messageStep = 'done'
      messageExplanation = 'Meddelandet har skickats till nätägaren.'
    } else {
      messageStep = 'current'
      messageExplanation = 'Meddelandet är förberett och väntar på att skickas.'
    }
  } else if (outboundExists) {
    messageStep = 'current'
    messageExplanation = 'Systemet förbereder Ediel-meddelandet.'
  } else if (dataRequestStatus === 'blocked') {
    messageStep = 'not_started'
    messageExplanation = 'Meddelandet kan inte förberedas förrän blockeraren är löst.'
  }

  steps.push({
    id: 'message_prepared',
    label: 'Meddelande förbereds',
    explanation: messageExplanation,
    status: messageStep,
    messageId: isPlatformAdmin ? edielMessageId : null,
  })

  // Step 6: Väntar på svar
  const isWaiting = ['sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl'].includes(infoStatus ?? '')
  const responseReceived = ['z02_received', 'ready_for_switch', 'completed'].includes(infoStatus ?? '')
  steps.push({
    id: 'waiting_response',
    label: 'Väntar på svar från nätägare',
    explanation: responseReceived
      ? 'Svar mottaget från nätägaren.'
      : isWaiting
        ? 'Vi väntar på svar från nätägaren.'
        : 'Inte skickat ännu.',
    status: responseReceived ? 'done' : isWaiting ? 'waiting' : 'not_started',
  })

  // Step 7: Nästa steg
  const hasResponseForSwitch = ['z02_received', 'ready_for_switch'].includes(infoStatus ?? '')
  const hasPendingSwitch = Boolean(activeSwitchRequest)
  steps.push({
    id: 'next_step',
    label: 'Nästa steg',
    explanation: hasPendingSwitch
      ? 'Leverantörsbyte pågår.'
      : hasResponseForSwitch
        ? 'Uppgifter mottagna. Redo för leverantörsbyte eller komplettering.'
        : 'Nästa steg bestäms när uppgifter från nätägaren är mottagna.',
    status: hasPendingSwitch ? 'current' : hasResponseForSwitch ? 'current' : 'not_started',
  })

  // Primary action
  let primaryAction: WorkflowPrimaryAction = 'request_data'
  let adminMessage = 'Begär anläggningsuppgifter från nätägaren för att komma vidare.'
  let nextRequiredAction: string | null = null

  if (hasPendingSwitch) {
    primaryAction = 'wait_for_grid_owner'
    adminMessage = 'Leverantörsbyte pågår. Väntar på svar.'
  } else if (hasResponseForSwitch) {
    primaryAction = 'create_supplier_switch'
    adminMessage = 'Uppgifter mottagna. Starta leverantörsbyte när du är redo.'
  } else if (isWaiting) {
    primaryAction = 'wait_for_grid_owner'
    adminMessage = 'Vi väntar på svar från nätägaren. Ingen åtgärd krävs just nu.'
  } else if (dataRequestStatus === 'blocked') {
    primaryAction = 'review_blocker'
    adminMessage = blockerToAdminMessage(blockerCode) ?? 'Uppgiftsbegäran är blockerad. Granska detaljer.'
    nextRequiredAction = asString(openInfoRequest?.next_required_action)
  } else if (infoStatus === 'z01_prepared' || messageStep === 'current') {
    primaryAction = 'approve_and_send'
    adminMessage = 'Meddelandet är förberett och väntar på godkänt utskick.'
  } else if (openInfoRequest && ['route_missing', 'blocked'].includes(infoStatus ?? '')) {
    primaryAction = 'continue_data_request'
    adminMessage = 'Uppgiftsbegäran är blockerad. Starta om för att försöka med uppdaterad route.'
  } else if (!openInfoRequest && hasFacility && hasAuth) {
    primaryAction = 'request_data'
    adminMessage = 'Begär anläggningsuppgifter från nätägaren.'
  } else if (!hasAuth) {
    primaryAction = 'review_blocker'
    adminMessage = 'Fullmakt saknas. Lägg till signerad fullmakt innan uppgifter kan begäras.'
  } else if (!hasFacility) {
    primaryAction = 'review_blocker'
    adminMessage = 'Anläggningsuppgifter är ofullständiga. Kontrollera anläggning och nätägare.'
  } else if (infoStatus === 'completed') {
    primaryAction = 'no_action_required'
    adminMessage = 'Inga åtgärder krävs. Uppgiftsbegäran är slutförd.'
  }

  // Secondary actions
  const secondaryActions: WorkflowSecondaryAction[] = [
    { id: 'view_history', label: 'Visa historik', href: `#history` },
    { id: 'view_info_requests', label: 'Uppgiftsbegäran', href: '/admin/customer-info-requests' },
    { id: 'view_messages', label: 'Meddelanden', href: '/admin/messages' },
  ]

  // Technical details (only populated for platform admin rendering)
  const technicalDetails = {
    outboundRequestId: outboundRequestId ?? null,
    edielMessageId: edielMessageId ?? null,
    gridOwnerDataRequestId: gridOwnerDataRequestId ?? null,
    communicationRouteId: communicationRouteId ?? null,
    edielRouteProfileId: edielRouteProfileId ?? null,
    operationId: operationId ?? null,
    customerInfoRequestId: openInfoRequest?.id ?? null,
    blockerCode: blockerCode ?? null,
    routeResolutionStatus: routeResolutionStatus ?? null,
  }

  const canRunRepair = isPlatformAdmin &&
    Boolean(gridOwnerDataRequestId) &&
    ['blocked', 'route_missing'].includes(infoStatus ?? '') &&
    ['operational_route_missing', 'platform_route_exists_but_not_materialized'].includes(blockerCode ?? '')

  return {
    primaryStatus: infoStatus ?? 'no_request',
    adminMessage,
    nextRequiredAction,
    primaryAction,
    workflowSteps: steps,
    secondaryActions,
    blockerCode,
    blockerReason,
    blockerAdminMessage: blockerToAdminMessage(blockerCode),
    routeStatus: routeResolutionStatus,
    z01Status: infoStatus,
    outboundStatus: outboundRequestId ? 'exists' : null,
    edielMessageStatus: edielMessageId ? 'exists' : null,
    latestMessageId: edielMessageId ?? null,
    canShowTechnicalActions: isPlatformAdmin,
    canRunRepair,
    technicalDetails,
  }
}
