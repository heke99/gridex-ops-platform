// lib/ediel/prodat/types.ts

import type { EdielAckStatus } from '@/lib/ediel/types'

export type ProdatEngineCode =
  | 'Z01'
  | 'Z02'
  | 'Z03'
  | 'Z04'
  | 'Z05'
  | 'Z06'
  | 'Z09'
  | 'Z10'
  | 'Z13'
  | 'Z14'
  | 'Z15'
  | 'Z18'

export type ProdatEngineMode = 'test' | 'production'

export type ProdatEnginePortalSnapshot = Record<string, unknown> | null

export type ProdatEngineActorContext = {
  senderEdielId: string
  receiverEdielId: string
  senderName?: string | null
  receiverName?: string | null
}

export type ProdatEngineRouteContext = {
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  applicationReference?: string | null
  communicationRouteId?: string | null
  receiverEmail?: string | null
  mailbox?: string | null
  routeDecisionReason?: string | null
}

export type ProdatEngineVersionContext = {
  selectedVersion: string
  messageTypeToken: string
  acceptedVersions?: string[]
  selectedRuleId?: string | null
}

export type ProdatEngineProductionContext = {
  code: ProdatEngineCode
  bgmReference: string
  transactionReference: string
  senderEdielId: string
  receiverEdielId: string
  customerName: string
  customerId?: string | null
  customerIdCodeListQualifier?: string | null
  meterPointId: string
  gridAreaId?: string | null
  startDate?: string | null
  customerAddress?: string | null
  customerCity?: string | null
  customerPostalCode?: string | null
  customerCountry?: string | null
  siteAddress?: string | null
  siteCity?: string | null
  sitePostalCode?: string | null
  siteCountry?: string | null
  reasonForTransaction?: string | null
  meteringMethod?: string | null
  reportingFrequency?: string | null
  installationDirection?: string | null
  permissionStatus?: string | null
  permissionPurpose?: string | null
  permissionEndReason?: string | null
  energyProductId?: string | null
  powerOfAttorneyReference?: string | null
  balanceResponsibleId?: string | null
}

export type ProdatEngineInput = {
  code: ProdatEngineCode
  variant?: string | null
  mode: ProdatEngineMode
  actor: ProdatEngineActorContext
  route: ProdatEngineRouteContext
  version: ProdatEngineVersionContext
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
}

export type ProdatEngineValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  title: string
  description: string
}

export type ProdatEngineAckExpectation = {
  requiresContrl: boolean
  requiresAperak: boolean
  contrlStatus: EdielAckStatus
  aperakStatus: EdielAckStatus
  utiltsErrStatus: EdielAckStatus
  ackDueAt: string | null
}

export type ProdatEngineDiagnostics = {
  engine: 'prodat'
  renderer: string
  code: ProdatEngineCode
  variant?: string | null
  mode?: ProdatEngineMode
  lineItemReference: string
  bgmReference: string
  reasonForTransaction: string | null
  meteringMethod: string | null
  hasPortalSnapshot: boolean
  segmentCountBeforeEnvelope: number
  routeDecisionReason?: string | null
  selectedVersion?: string | null
  acceptedVersions?: string[]
  rulebookProcessGroup?: string | null
  rulebookApplicationReference?: string | null
  rulebookIssues?: Array<Record<string, unknown>>
}

export type ProdatEngineRenderResult = {
  segments: string[]
  diagnostics: ProdatEngineDiagnostics
  issues: ProdatEngineValidationIssue[]
  ackExpectation?: ProdatEngineAckExpectation
}

export type ProdatSnapshotAssertion = {
  name: string
  expected: string[]
  actual: string[]
  passed: boolean
  diff: string[]
}
