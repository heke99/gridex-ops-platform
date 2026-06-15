export type ActorRegistryRole =
  | 'grid_owner'
  | 'electricity_supplier'
  | 'balance_responsible'
  | 'energy_service_company'
  | 'system_supplier'
  | 'edi_operator'
  | 'other'

export type ActorRegistryRoute = {
  messageFamily: 'PRODAT' | 'UTILTS' | string
  applicationReference?: string | null
  environment: 'test' | 'production'
  subaddress?: string | null
  communicationType?: string | null
  communicationAddress?: string | null
  partyId?: string | null
  interchangePartyId?: string | null
  status?: 'active' | 'inactive' | 'needs_review' | 'blocked'
  isVerified?: boolean
  metadata?: Record<string, unknown>
}

export type ActorRegistryCertificate = {
  environment?: 'test' | 'production' | string | null
  purpose?: 'encryption' | 'signing' | 'both' | string | null
  pem?: string | null
  fingerprintSha256?: string | null
  validFrom?: string | null
  validTo?: string | null
  subject?: string | null
  issuer?: string | null
  serialNumber?: string | null
  metadata?: Record<string, unknown>
}

export type ParsedActorRegistryActor = {
  name: string
  legalName?: string | null
  edielId?: string | null
  orgNumber?: string | null
  eic?: string | null
  countryCode?: string | null
  roles: ActorRegistryRole[]
  routes: ActorRegistryRoute[]
  certificates: ActorRegistryCertificate[]
  raw: Record<string, unknown>
}

export type ActorRegistryImportSummary = {
  importRunId: string
  reusedExistingRun: boolean
  totalRecords: number
  created: number
  updated: number
  unchanged: number
  conflicts: number
  errors: number
}
