import { PUBLIC_API_ROUTES, type PublicApiRouteContract } from '@/lib/api/publicRouteRegistry'

export type PublicApiRateLimitClass = PublicApiRouteContract['rateLimitClass']

function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true
  const expected = pattern.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)
  if (expected.length !== actual.length) return false
  return expected.every((segment, index) =>
    /^\[[^\]]+\]$/.test(segment) || segment === actual[index],
  )
}

export function publicApiRouteContractForRequest(
  method: string,
  pathname: string,
): PublicApiRouteContract | null {
  const normalizedMethod = method.toUpperCase()
  return PUBLIC_API_ROUTES.find((route) =>
    route.method === normalizedMethod && pathMatches(route.path, pathname),
  ) ?? null
}

export function publicApiRateLimitClassForRequest(
  method: string,
  pathname: string,
): PublicApiRateLimitClass {
  const contract = publicApiRouteContractForRequest(method, pathname)
  if (contract) return contract.rateLimitClass
  // A route missing from the registry is a parity defect, but authentication
  // still needs a deterministic fail-safe traffic class until CI catches it.
  return method.toUpperCase() === 'GET' ? 'read' : 'write'
}

export const PUBLIC_API_RATE_LIMIT_COST: Record<PublicApiRateLimitClass, number> = {
  read: 1,
  write: 2,
  expensive: 5,
}

export function effectiveRouteRateLimit(
  clientLimitPerMinute: number,
  rateLimitClass: PublicApiRateLimitClass,
): number {
  const cost = PUBLIC_API_RATE_LIMIT_COST[rateLimitClass]
  return Math.max(1, Math.floor(clientLimitPerMinute / cost))
}
