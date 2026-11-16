import type { GridOwnerDataRequestRow, OutboundRequestRow } from '@/lib/cis/types'
import type { AuditLogRow, CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'

export type CustomerAuthorizationDocumentsCardProps = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  documents: CustomerAuthorizationDocumentRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
}

export type RelationsResponse = {
  gridOwnerDataRequests: GridOwnerDataRequestRow[]
  outboundRequests: OutboundRequestRow[]
  switchRequests: SupplierSwitchRequestRow[]
  documentAuditLogs: AuditLogRow[]
}

export type DocumentFlowStep = {
  label: string
  value: string
  href?: string
  tone: string
}

export type TimelineLink = {
  label: string
  href: string
}

export type TimelineItem = {
  id: string
  occurredAt: string
  title: string
  description: string
  tone: string
  links: TimelineLink[]
}

export type DocumentRelationsBundle = {
  matchingGridOwnerRequests: GridOwnerDataRequestRow[]
  matchingSwitchRequests: SupplierSwitchRequestRow[]
  matchingOutbounds: OutboundRequestRow[]
  matchingAuditLogs: AuditLogRow[]
}