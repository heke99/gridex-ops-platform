import type { OutboundRequestRow } from '@/lib/cis/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type {
  SupplierSwitchEventRow,
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import type {
  EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'
import type { CustomerEdielMessageRow } from '@/lib/ediel/customerData'
import { getSwitchLifecycle } from '@/lib/operations/controlTower'

export type CustomerSwitchOperationsCardProps = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  switchRequests: SupplierSwitchRequestRow[]
  switchEvents: SupplierSwitchEventRow[]
  outboundRequests: OutboundRequestRow[]
  edielMessages: CustomerEdielMessageRow[]
  edielRecommendationRoutes: EdielRecommendationRouteRow[]
}

export type SwitchTimelineEntry = {
  id: string
  occurredAt: string
  title: string
  description: string
  tone: string
}

export type ValidationSummary = {
  label: string
  isReady: boolean | null
  issueCount: number
  validatedAt: string | null
  issueCodes: string[]
}

export type SiteLifecycleSummary = {
  site: CustomerSiteRow
  requests: SupplierSwitchRequestRow[]
  latestRequest: SupplierSwitchRequestRow | null
  outbound: OutboundRequestRow | null
  validation: ValidationSummary | null
  lifecycle: ReturnType<typeof getSwitchLifecycle> | null
  latestEvent: SupplierSwitchEventRow | null
  stuckReason: string
}

export type SwitchRecommendationSummary = {
  latestRequest: SupplierSwitchRequestRow | null
  latestOutbound: OutboundRequestRow | null
  latestLifecycle: ReturnType<typeof getSwitchLifecycle> | null
  latestValidation: ValidationSummary | null
  latestEvent: SupplierSwitchEventRow | null
  nextStep: string
  primaryWorkspaceHref: string
  primaryWorkspaceLabel: string
  unresolvedCount: number
  autoQueuedCount: number
  awaitingResponseCount: number
  readyToExecuteCount: number
}