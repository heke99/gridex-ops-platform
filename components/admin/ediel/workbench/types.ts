import type {
  EdielRecommendationMessageRow,
  EdielRecommendationOutboundRow,
  EdielRecommendationRouteRow,
  EdielRecommendationSwitchRow,
} from '@/lib/ediel/recommendations'

export type EdielWorkbenchProps = {
  switchRequests: EdielRecommendationSwitchRow[]
  outboundRequests: EdielRecommendationOutboundRow[]
  messages: EdielRecommendationMessageRow[]
  routes: EdielRecommendationRouteRow[]
}