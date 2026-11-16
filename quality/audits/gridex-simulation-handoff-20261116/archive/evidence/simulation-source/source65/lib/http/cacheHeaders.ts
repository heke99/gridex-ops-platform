// Shared HTTP cache-control helpers.
//
// Classification rules (see audit report):
//   - publicCache: only for public, non-tenant, non-customer, stable data.
//   - tenantScopedShortCache: tenant-scoped semi-stable data; never public CDN cache.
//   - privateNoStore / noStore: private/dynamic and internal/cron/webhook responses.
//
// These return plain header objects so they can be spread into NextResponse.json
// init.headers or merged into an existing Headers instance.

export function publicCache(seconds = 3600, staleWhileRevalidateSeconds = 86400): Record<string, string> {
  return {
    'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
  }
}

export function privateNoStore(): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
  }
}

export function noStore(): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
  }
}

// Tenant-scoped data must never be cached on a shared/public CDN. This keeps the
// response private and uncached at the edge while signalling the intended
// application-level TTL via a custom header for server-side caches that key on
// company_id/tenant_id.
export function tenantScopedShortCache(seconds = 60): Record<string, string> {
  return {
    'Cache-Control': 'private, max-age=0, s-maxage=0',
    'X-Gridex-Cache-TTL': String(seconds),
  }
}
