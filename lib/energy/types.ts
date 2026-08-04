export type PriceArea = 'SE1' | 'SE2' | 'SE3' | 'SE4'

export type PriceAreaAssuranceStatus = 'verified' | 'estimated' | 'ambiguous' | 'unresolved'

export type PriceAreaAssuranceSource =
  | 'facility_data'
  | 'grid_area_master'
  | 'address_polygon'
  | 'postal_city_consensus'
  | 'postal_consensus'
  | null

export type PriceAreaAssurance = {
  status: PriceAreaAssuranceStatus
  priceArea: PriceArea | null
  confidence: number
  source: PriceAreaAssuranceSource
  candidateCount: number
  uniquePriceAreaCount: number
  sourceVersion: string | null
  evidence: Record<string, unknown>
}

export type RequestedStartMode = 'earliest_possible' | 'specific_date'

export type EnergyResolutionStatus =
  | 'postal_suggested'
  | 'address_resolved'
  | 'grid_area_resolved'
  | 'grid_area_master_validated'
  | 'facility_data_requested'
  | 'facility_data_received'
  | 'facility_verified'
  | 'needs_review'
  | 'facility_data_invalid'
  | 'customer_information_mismatch'
  | 'grid_owner_rejected_request'
  | 'negative_aperak_received'
  | 'z02_rejected'
  | 'needs_customer_correction'
  | 'needs_grid_owner_followup'
  | 'protected_identity'
  | 'failed'

export type EnergyGeocodeStatus =
  | 'not_configured'
  | 'missing_api_key'
  | 'missing_base_url'
  | 'unauthorized'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'no_match'
  | 'success'

export type EnergyResolverDiagnostics = {
  addressAttempts?: Array<{ street: string; streetNumber: string | null; outcome: string; httpStatus?: number | null }>
  geocodeProvider?: string | null
  geocodeStatus?: EnergyGeocodeStatus | string
  providerStatus?: string | null
  providerHttpStatus?: number | null
  providerErrorCode?: string | null
  geocodeHttpStatus?: number | null
  geocodeResponseShape?: string | null
  coordinateReferenceSystem?: 'EPSG:3006' | 'EPSG:4326' | null
  polygonStatus?: 'matched' | 'no_match' | 'not_attempted' | 'schema_missing' | null
  mappingStatus?: 'mapped' | 'platform_to_ops_missing' | 'not_applicable' | null
}

export type EnergyResolverCoordinates = {
  latitude?: number | null
  longitude?: number | null
  sweref99X?: number | null
  sweref99Y?: number | null
}

export type EnergyResolverInput = {
  companyId?: string | null
  customerId?: string | null
  customerSiteId?: string | null
  customerApplicationId?: string | null
  street?: string | null
  streetNumber?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
  gridAreaCode?: string | null
  facilityId?: string | null
  meteringPointId?: string | null
  requestedStartMode?: RequestedStartMode | string | null
  requestedStartDate?: string | null
  metadata?: Record<string, unknown> | null
}

export type EnergyResolverResult = {
  resolutionId?: string | null
  gridAreaCode: string | null
  gridAreaName: string | null
  gridOwnerId: string | null
  gridOwnerName: string | null
  suggestedGridAreaCode?: string | null
  suggestedGridOwnerId?: string | null
  suggestedGridOwnerName?: string | null
  suggestionSource?: string | null
  suggestionConfidence?: number | null
  priceArea: PriceArea | null
  priceAreaAssurance: PriceAreaAssurance
  resolutionStatus: EnergyResolutionStatus
  confidence: number
  sourceChain: string[]
  automationAllowed: boolean
  nextRequiredAction: string
  lookupKey: string
  coordinates?: EnergyResolverCoordinates | null
  warnings: string[]
  gridOwnerVerificationStatus?: string | null
  gridOwnerVerificationIssues?: string[]
  raw?: Record<string, unknown>
  diagnostics?: EnergyResolverDiagnostics
  resolverVersion?: string | null
  geodataVersion?: string | null
  resolvedAt?: string | null
  expiresAt?: string | null
  conflictCode?: string | null
}

export type GridOwnerInformationRequestInput = {
  companyId: string
  customerId?: string | null
  customerSiteId?: string | null
  customerApplicationId?: string | null
  resolutionId?: string | null
  gridOwnerId?: string | null
  gridAreaCode?: string | null
  priceArea?: PriceArea | string | null
  createdBy?: string | null
  requestType?: 'facility_lookup' | 'metering_point_lookup' | 'grid_area_confirmation' | 'metering_values_request' | 'switch_prerequisite_check'
}

export type GridOwnerInformationRequestResult = {
  requestId: string | null
  status: 'draft' | 'ready_to_send' | 'sent' | 'waiting_response' | 'received' | 'completed' | 'failed' | 'needs_review' | 'facility_data_invalid' | 'customer_information_mismatch' | 'grid_owner_rejected_request' | 'negative_aperak_received' | 'z02_rejected' | 'needs_customer_correction' | 'needs_grid_owner_followup' | 'timeout' | 'retry_blocked' | 'skipped'
  channel: 'email' | 'ediel' | 'portal' | 'manual' | null
  nextStep: string
  routeId?: string | null
  communicationRouteId?: string | null
  edielRouteProfileId?: string | null
  outboundRequestId?: string | null
  edielMessageId?: string | null
  operationId?: string | null
  dispatchStatus?: string | null
  warnings: string[]
}
