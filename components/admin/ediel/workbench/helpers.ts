import type {
  EdielRecommendationMessageRow,
  EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'

export function routeLabel(route: EdielRecommendationRouteRow) {
  const owner = route.grid_owner_name ? ` · ${route.grid_owner_name}` : ''
  return `${route.route_name} (${route.route_scope})${owner}`
}

export function messageLabel(message: EdielRecommendationMessageRow) {
  return `${message.id} · ${message.direction} · ${message.message_family} ${message.message_code} · ${message.status}`
}

export function formatMaybe(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : '—'
}