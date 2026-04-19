import type {
  CommunicationRouteRow,
  GridOwnerDataRequestRow,
  OutboundRequestRow,
} from '@/lib/cis/types'
import type {
  CustomerSiteRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

export type ResolutionSummary = {
  reasonTitle: string
  reasonText: string
  recommendation: string
  routeMatches: CommunicationRouteRow[]
  inactiveRouteMatches: CommunicationRouteRow[]
  globalActiveRoute: CommunicationRouteRow | null
  scopedActiveRoute: CommunicationRouteRow | null
  assignableRoutes: CommunicationRouteRow[]
}

export function tone(status: string): string {
  if (['acknowledged', 'ready', 'resolved', 'active'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }
  if (['failed', 'cancelled', 'unresolved', 'missing_route', 'inactive'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }
  if (['sent', 'submitted'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }
  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function siteLabel(siteId: string | null, sites: CustomerSiteRow[]): string {
  if (!siteId) return '—'
  return sites.find((site) => site.id === siteId)?.site_name ?? siteId
}

export function meteringPointLabel(
  meteringPointId: string | null,
  meteringPoints: MeteringPointRow[]
): string {
  if (!meteringPointId) return '—'
  return (
    meteringPoints.find((point) => point.id === meteringPointId)?.meter_point_id ??
    meteringPointId
  )
}

export function requestScopeLabel(requestType: OutboundRequestRow['request_type']): string {
  if (requestType === 'supplier_switch') return 'supplier_switch'
  if (requestType === 'meter_values') return 'meter_values'
  return 'billing_underlay'
}

export function buildResolutionSummary(params: {
  request: OutboundRequestRow
  routes: CommunicationRouteRow[]
}): ResolutionSummary {
  const { request, routes } = params
  const scope = requestScopeLabel(request.request_type)

  const routeMatches = routes.filter((route) => route.route_scope === scope)
  const assignableRoutes = routeMatches.filter((route) => route.is_active)
  const scopedActiveRoute =
    routeMatches.find(
      (route) => route.is_active && route.grid_owner_id === request.grid_owner_id
    ) ?? null
  const globalActiveRoute =
    routeMatches.find(
      (route) => route.is_active && route.grid_owner_id === null
    ) ?? null
  const inactiveRouteMatches = routeMatches.filter(
    (route) =>
      !route.is_active &&
      (route.grid_owner_id === request.grid_owner_id || route.grid_owner_id === null)
  )

  if (!request.grid_owner_id && !globalActiveRoute && inactiveRouteMatches.length === 0) {
    return {
      reasonTitle: 'Saknar grid owner + ingen global route',
      reasonText:
        'Requesten saknar grid_owner_id och systemet hittar inte heller någon global aktiv route för detta scope.',
      recommendation:
        'Gå till kund/site eller källdata och säkra grid owner. Alternativt skapa en global route om processen ska gå utan nätägarspecifik routning.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  if (!request.grid_owner_id && inactiveRouteMatches.length > 0 && !globalActiveRoute) {
    return {
      reasonTitle: 'Global route finns men är inaktiv',
      reasonText:
        'Systemet hittar routes för detta scope, men ingen aktiv global route som kan användas när grid_owner_id saknas.',
      recommendation:
        'Aktivera global route i communication routes eller komplettera requesten med korrekt grid owner.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  if (
    request.grid_owner_id &&
    !scopedActiveRoute &&
    inactiveRouteMatches.some((route) => route.grid_owner_id === request.grid_owner_id)
  ) {
    return {
      reasonTitle: 'Nätägarspecifik route finns men är inaktiv',
      reasonText:
        'Det finns en route för rätt grid owner och scope, men den är inte aktiv och kan därför inte väljas.',
      recommendation:
        'Öppna communication routes och aktivera den specifika routen eller skapa en aktiv ersättare.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  if (routeMatches.length === 0) {
    return {
      reasonTitle: 'Ingen route konfigurerad för scopet',
      reasonText:
        'Systemet hittar inga communication routes alls för den här requesttypen.',
      recommendation:
        'Skapa en ny communication route för detta scope innan requesten kan lämna unresolved.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  if (!scopedActiveRoute && !globalActiveRoute) {
    return {
      reasonTitle: 'Ingen aktiv route matchar requesten',
      reasonText:
        'Det finns routes för scopet, men ingen aktiv route matchar grid owner eller global fallback.',
      recommendation:
        'Skapa eller aktivera en aktiv route för rätt grid owner, eller lägg upp en global fallback-route om det är tillåtet.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  return {
    reasonTitle: 'Route bör gå att lösa om',
    reasonText:
      'Det finns minst en möjlig route. Kör ny route-upplösning eller välj route manuellt för att få requesten ur unresolved.',
    recommendation:
      'Använd “Välj route nu” nedan om du redan vet vilken route som ska användas. Annars klicka på “Kör route-upplösning igen”.',
    routeMatches,
    inactiveRouteMatches,
    globalActiveRoute,
    scopedActiveRoute,
    assignableRoutes,
  }
}

export function getPrimaryLink(params: {
  request: OutboundRequestRow
  switchRequests: SupplierSwitchRequestRow[]
  dataRequests: GridOwnerDataRequestRow[]
}): { href: string; label: string } {
  const { request, switchRequests, dataRequests } = params

  if (
    request.request_type === 'supplier_switch' &&
    request.source_type === 'supplier_switch_request' &&
    request.source_id
  ) {
    const match = switchRequests.find((row) => row.id === request.source_id)
    if (match) {
      return {
        href: `/admin/operations/switches/${match.id}`,
        label: 'Öppna switch detail',
      }
    }
  }

  if (
    request.source_type === 'grid_owner_data_request' &&
    request.source_id
  ) {
    const match = dataRequests.find((row) => row.id === request.source_id)
    if (match) {
      return {
        href: `/admin/operations/grid-owner-requests/${match.id}`,
        label: 'Öppna grid owner request detail',
      }
    }
  }

  return {
    href: `/admin/customers/${request.customer_id}`,
    label: 'Öppna kundkort',
  }
}