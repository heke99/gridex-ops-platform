export type FullmaktAutomationPolicyInput = {
  documentType: 'power_of_attorney' | 'complete_agreement' | 'grid_invoice_suggested'
  markAsSigned: boolean
  savedPowerOfAttorneyId: string | null
  autoCreateGridOwnerRequests: boolean
  autoCreateSwitchRequest: boolean
  autoQueueSwitchOutbound: boolean
  autoSendRequestsAfterSignedFullmakt: boolean
  autoSendRequestsAfterUploadedFullmakt: boolean
}

export type FullmaktAutomationPolicyResult = {
  canUseDocumentForRequests: boolean
  canUseDocumentForSwitch: boolean
  shouldCreateGridOwnerRequests: boolean
  shouldCreateSwitchRequest: boolean
  shouldQueueSwitchOutbound: boolean
  blockedReasons: string[]
  warnings: string[]
}

export const FULLMAKT_REQUEST_SCOPES = [
  {
    code: 'customer_masterdata',
    label: 'Kund- och anläggningsdata',
    description:
      'Begär grunddata som anläggnings-id, nätområde, mätmetod, avräkningsmetod och aktuell leverantör.',
  },
  {
    code: 'meter_values',
    label: 'Mätvärden',
    description:
      'Begär mätvärden för vald period när fullmakten omfattar mätdata.',
  },
  {
    code: 'billing_underlay',
    label: 'Faktureringsunderlag',
    description:
      'Begär underlag som behövs för fakturering eller partnerhandoff.',
  },
] as const

export function resolveFullmaktAutomationPolicy(
  input: FullmaktAutomationPolicyInput
): FullmaktAutomationPolicyResult {
  const blockedReasons: string[] = []
  const warnings: string[] = []

  let shouldCreateGridOwnerRequests = input.autoCreateGridOwnerRequests
  let shouldCreateSwitchRequest = input.autoCreateSwitchRequest
  let shouldQueueSwitchOutbound = input.autoQueueSwitchOutbound

  const isPowerOfAttorney = input.documentType === 'power_of_attorney'
  const hasPowerOfAttorneyRecord = Boolean(input.savedPowerOfAttorneyId)
  const isSignedPowerOfAttorney = isPowerOfAttorney && input.markAsSigned
  const isUploadedPowerOfAttorney = isPowerOfAttorney && !input.markAsSigned

  if (isPowerOfAttorney && !hasPowerOfAttorneyRecord) {
    shouldCreateGridOwnerRequests = false
    shouldCreateSwitchRequest = false
    shouldQueueSwitchOutbound = false
    blockedReasons.push(
      'Automatisering stoppades eftersom fullmaktsdokumentet inte kunde kopplas till en fullmaktspost.'
    )
  }

  if (isSignedPowerOfAttorney && !input.autoSendRequestsAfterSignedFullmakt) {
    shouldCreateGridOwnerRequests = false
    shouldCreateSwitchRequest = false
    shouldQueueSwitchOutbound = false
    warnings.push(
      'Fullmakten är signerad men automatiska begäran efter signerad fullmakt är avstängd för detta uppladdningstillfälle.'
    )
  }

  if (isUploadedPowerOfAttorney) {
    if (!input.autoSendRequestsAfterUploadedFullmakt) {
      shouldCreateGridOwnerRequests = false
      shouldCreateSwitchRequest = false
      shouldQueueSwitchOutbound = false
      warnings.push(
        'Fullmakten laddades upp utan att markeras signerad. Systemet väntar på manuell verifiering innan begäran skickas.'
      )
    } else {
      shouldCreateGridOwnerRequests = false
      shouldCreateSwitchRequest = false
      shouldQueueSwitchOutbound = false
      blockedReasons.push(
        'Uppladdad fullmakt måste markeras som signerad eller verifieras manuellt innan systemet skickar begäran till nätägare.'
      )
    }
  }

  const canUseDocumentForRequests =
    input.documentType === 'complete_agreement' ||
    (isPowerOfAttorney && hasPowerOfAttorneyRecord && input.markAsSigned)

  const canUseDocumentForSwitch =
    canUseDocumentForRequests &&
    (input.documentType === 'power_of_attorney' || hasPowerOfAttorneyRecord)

  return {
    canUseDocumentForRequests,
    canUseDocumentForSwitch,
    shouldCreateGridOwnerRequests,
    shouldCreateSwitchRequest,
    shouldQueueSwitchOutbound,
    blockedReasons,
    warnings,
  }
}

export function describeFullmaktAutomationTrigger(params: {
  markAsSigned: boolean
  documentType: 'power_of_attorney' | 'complete_agreement' | 'grid_invoice_suggested'
}): string {
  if (params.documentType !== 'power_of_attorney') {
    return 'Komplett avtal kan kopplas till operationsflödet när det samtidigt finns eller skapas en giltig fullmakt.'
  }

  if (params.markAsSigned) {
    return 'Signerad fullmakt kan verifieras, kopplas till kund/anläggning och automatiskt skapa begäran om uppgifter.'
  }

  return 'Uppladdad fullmakt sparas och kan verifieras manuellt från kundkortet innan begäran skickas.'
}
