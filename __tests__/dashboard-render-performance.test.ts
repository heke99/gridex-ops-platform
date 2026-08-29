import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('authenticated shell performance invariants', () => {
  it('keeps verified auth server-side while deduplicating it per dashboard render request', () => {
    const authHelper = read('lib/auth/currentUser.ts')
    const layout = read('app/dashboard/layout.tsx')
    const page = read('app/dashboard/page.tsx')

    expect(authHelper).toContain("import { cache } from 'react'")
    expect(authHelper).toContain('createSupabaseServerClient')
    expect(authHelper).toContain('.auth.getUser()')
    expect(authHelper).toContain('cache(async () =>')
    expect(authHelper).toContain('if (error || !user) return null')

    expect(layout).toContain('getVerifiedAuthUser')
    expect(layout).toContain('await getVerifiedAuthUser()')
    expect(layout).toContain("if (!user) redirect('/login')")
    expect(page).toContain('getVerifiedAuthUser')
    expect(page).toContain('await getVerifiedAuthUser()')
  })

  it('starts independent dashboard role and company-scope reads together', () => {
    const page = read('app/dashboard/page.tsx')

    expect(page).toMatch(
      /const \[isPlatformAdmin, companyScope\] = await Promise\.all\(\[\s*userHasPlatformRole\(user\.id\),\s*getOperationalCompanyScope\(user\.id\),\s*\]\)/,
    )
  })

  it('starts independent admin-shell cookie, scope, and live-access reads together', () => {
    const layout = read('app/admin/layout.tsx')

    expect(layout).toMatch(
      /const \[cookieStore, scope, liveAccess\] = await Promise\.all\(\[\s*cookies\(\),\s*getOperationalCompanyScope\(admin\.userId\),\s*getTenantLiveAccessForAdmin\(admin\),\s*\]\)/,
    )
  })

  it('keeps the admin layout interactive while dynamic route content streams', () => {
    const loading = read('app/admin/loading.tsx')

    expect(loading).toContain('export default function AdminLoading')
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain('AdminSidebar')
  })

  it('prefetches expensive sidebar routes only when the user shows intent', () => {
    const sidebar = read('components/admin/AdminSidebar.tsx')

    expect(sidebar).toContain('useRouter')
    expect(sidebar).toContain('router.prefetch(href)')
    expect(sidebar).toContain('prefetch={false}')
    expect(sidebar).toContain('onPointerEnter={() => prefetchOnIntent(item.href)}')
    expect(sidebar).toContain('onFocus={() => prefetchOnIntent(item.href)}')
  })

  it('reuses the verified permission context on the metering page', () => {
    const page = read('app/admin/metering/page.tsx')

    expect(page).toContain("requirePermissionServer('metering.read')")
    expect(page).toContain('getOperationalCompanyScope(context.userId)')
    expect(page).toContain('userEmail={context.email}')
    expect(page).not.toContain('createSupabaseServerClient')
    expect(page).not.toContain('.auth.getUser()')
  })

  it('keeps the default tenant customer registry on the paged database path', () => {
    const customers = read('lib/customers/getCustomers.ts')

    expect(customers).toContain('excludeTestData = false')
    expect(customers).toContain(".or('is_test_data.is.null,is_test_data.eq.false')")
    expect(customers).toContain(".or('source.is.null,source.not.ilike.*test*')")
    expect(customers).toContain('if (canUsePagedCustomerQuery({ query, contractFilter, flag }))')
    expect(customers).not.toContain('if (!excludeTestData && canUsePagedCustomerQuery')
    expect(customers).toContain('excludeTestData: params.excludeTestData')
  })

  it('starts independent switch read dependencies together and reuses guard identity', () => {
    const page = read('app/admin/operations/switches/page.tsx')

    expect(page).toContain('const [tenantScope, resolvedSearchParams] = await Promise.all([')
    expect(page).toContain('const [sites, events, outboundRequests, meteringPoints] = await Promise.all([')
    expect(page).toContain('sitesPromise,')
    expect(page).toContain('listSupplierSwitchEventsByRequestIds(supabase, requestIds)')
    expect(page).toContain('listMeteringPointsBySiteIds(supabase, siteIds, { companyId })')
    expect(page).toContain('userEmail={context.email}')
    expect(page).not.toContain('.auth.getUser()')
  })
})
