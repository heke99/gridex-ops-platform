// reality-defects: F101
// FINDINGS F101 variants (reality world 2026-10-23). In the registry model grid owners are platform-shared rows
// (grid_owners.company_id IS NULL) that the product assigns to the tenant's own metering points and sites. F101
// fixed the UTILTS attribution lock; the same tenant-owned-only assumption also
//   * left every shared grid owner out of the per-grid-owner monthly statistics
//     (gridex_rebuild_company_analytics_month), and
//   * made gridex_bilateral_prodat.scope_v1 return NULL for a point whose site names a shared grid owner.
// 20261023170000_shared_grid_owner_variants.sql applies the canonical rule: the tenant's own row, or a shared row
// the tenant's own records name; never another tenant's row.
// Proved natively on the owned local stack by calling the installed functions. Every case runs in one
// transaction that is rolled back, so the synthetic rows never become visible to a running world.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json npx vitest run -c scripts/shared-grid-owner-variants-native.config.ts
import { randomInt, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { literal as lit, sql } from './helpers/live-chain-fixture'

const MONTH = '2026-09-01'
const ediel = () => `73${String(randomInt(0, 1e9)).padStart(9, '0')}${String(randomInt(0, 100)).padStart(2, '0')}`
/** Seeds, acts and reads inside one transaction that is always rolled back. */
const inRolledBackTransaction = <T>(body: string): T => sql<T>(`BEGIN;
SET LOCAL lock_timeout = '10s';
${body}
ROLLBACK;`)
const company = (id: string, name: string) => `INSERT INTO public.companies(id,name,status) VALUES(${lit(id)},${lit(name)},'active');`
const gridOwner = (id: string, companyId: string | null, edielId: string) =>
  `INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status)
   VALUES(${lit(id)},${lit(companyId)},${lit(`F101 variants synthetic ${id.slice(0, 8)}`)},${lit(edielId)},'test',true,'active');`
const customer = (id: string, companyId: string) =>
  `INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,status) VALUES(${lit(id)},${lit(companyId)},${lit(id)},'Synthetic F101 variants','private','active');`
const facility = (companyId: string, customerId: string, siteId: string, pointId: string, gridOwnerId: string | null, extra = { gridArea: null as string | null, gridEdiel: null as string | null }) =>
  `INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,grid_owner_id)
   VALUES(${lit(siteId)},${lit(companyId)},${lit(customerId)},'Synthetic F101 variants','consumption','active','SE',${lit(gridOwnerId)});
   INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,grid_owner_id,bidding_zone_code,grid_area_code,grid_owner_ediel_id)
   VALUES(${lit(pointId)},${lit(companyId)},${lit(customerId)},${lit(siteId)},${lit(siteId)},${lit(gridOwnerId)},'SE3',${lit(extra.gridArea)},${lit(extra.gridEdiel)});`

describe('per-grid-owner monthly statistics (gridex_rebuild_company_analytics_month)', () => {
  it('include the shared grid owner the tenant points/sites name, for that tenant only, and never another tenant row', () => {
    const a = randomUUID(), b = randomUUID()
    const g = { shared: randomUUID(), unnamed: randomUUID(), ownA: randomUUID(), ownB: randomUUID() }
    const c = { a: randomUUID(), b: randomUUID() }
    const site = { shared: randomUUID(), ownA: randomUUID(), foreign: randomUUID(), b: randomUUID() }
    const point = { shared: randomUUID(), ownA: randomUUID(), foreign: randomUUID(), b: randomUUID() }
    const value = (pointId: string, at: string, kwh: number) =>
      `(${lit(a)},${lit(c.a)},${lit(pointId)},'consumption',${kwh},${kwh},${lit(at)},${lit(new Date(Date.parse(at) + 900_000).toISOString())},'f101_variants',${lit(randomUUID())},true,'current')`
    const metrics = (companyId: string) => `(SELECT coalesce(jsonb_object_agg(m.grid_owner_id::text, jsonb_build_object('points',m.metering_points_count,'sites',m.sites_count,
      'customers',m.customers_count,'values',m.metering_values_received,'kwh',m.actual_kwh)),'{}') FROM public.grid_owner_monthly_metrics m
      WHERE m.company_id=${lit(companyId)} AND m.month=${lit(MONTH)})`
    const result = inRolledBackTransaction<Record<string, Record<string, Record<string, number>>>>(`
      ${company(a, 'F101 variants tenant A synthetic')}${company(b, 'F101 variants tenant B synthetic')}
      ${gridOwner(g.shared, null, ediel())}${gridOwner(g.unnamed, null, ediel())}${gridOwner(g.ownA, a, ediel())}${gridOwner(g.ownB, b, ediel())}
      ${customer(c.a, a)}${customer(c.b, b)}
      ${facility(a, c.a, site.shared, point.shared, g.shared)}
      ${facility(a, c.a, site.ownA, point.ownA, g.ownA)}
      ${facility(a, c.a, site.foreign, point.foreign, g.ownB)}
      ${facility(b, c.b, site.b, point.b, g.ownB)}
      INSERT INTO public.metering_values(company_id,customer_id,metering_point_id,reading_type,value_kwh,quantity_kwh,period_start,period_end,source_system,source_transaction_id,is_current,value_status)
      VALUES ${value(point.shared, '2026-09-10T10:00:00Z', 3)},${value(point.shared, '2026-09-10T10:15:00Z', 4)};
      DO $do$ BEGIN
        PERFORM public.gridex_rebuild_company_analytics_month(${lit(a)}, ${lit(MONTH)}::date);
        PERFORM public.gridex_rebuild_company_analytics_month(${lit(b)}, ${lit(MONTH)}::date);
      END $do$;
      SELECT jsonb_build_object('a', ${metrics(a)}, 'b', ${metrics(b)});`)
    // Tenant A: its own grid owner and the shared grid owner its point and site name. The shared row carries the
    // values of A's point on it. Another tenant's row (named by A's misattributed point) and an unnamed shared
    // row get no statistics row for A.
    expect(Object.keys(result.a).sort()).toEqual([g.shared, g.ownA].sort())
    expect(result.a[g.shared]).toEqual({ points: 1, sites: 1, customers: 1, values: 2, kwh: 7 })
    expect(result.a[g.ownA]).toMatchObject({ points: 1, sites: 1, values: 0 })
    // Tenant B: only its own grid owner; the shared row is not B's because none of B's records name it.
    expect(Object.keys(result.b)).toEqual([g.ownB])
    expect(result.b[g.ownB]).toMatchObject({ points: 1, sites: 1 })
  })
})

describe('bilateral PRODAT scope (gridex_bilateral_prodat.scope_v1)', () => {
  type Ownership = 'shared' | 'own' | 'foreign' | 'unnamed_shared'
  const scope = (ownership: Ownership) => {
    const c = randomUUID(), other = randomUUID(), legal = randomUUID(), dso = randomUUID(), agreement = randomUUID(), grid = randomUUID()
    const customerId = randomUUID(), siteId = randomUUID(), pointId = randomUUID(), sender = ediel(), receiver = ediel(), gridArea = `F${randomInt(100, 999)}`
    const owner = ownership === 'own' ? c : ownership === 'foreign' ? other : null
    const selector = (pack: string) => `jsonb_build_object('environment','test','kind','normal_start_h','rulePackId',${pack},'bilateralAgreementId',${lit(agreement)},
      'gridAreaCode',${lit(gridArea)},'validFrom','2000-01-02T00:00:00Z','validTo','2099-01-01T00:00:00Z')`
    const pack = `(SELECT pack.id::text FROM public.ediel_rule_packs pack WHERE pack.family='PRODAT' AND pack.market='electricity' AND pack.guide_version='26.A' AND pack.guide_revision='3'
      AND pack.status IN('active','transition','future') AND pack.valid_from<=current_date AND (pack.valid_to IS NULL OR current_date<=pack.valid_to)
      AND (SELECT count(*) FROM public.ediel_message_profiles p WHERE p.rule_pack_id=pack.id AND p.is_enabled AND p.message_code IN('Z03','Z04') AND p.transaction_subtype='H')=2
      ORDER BY pack.id LIMIT 1)`
    return inRolledBackTransaction<{ pack: string | null; scope: Record<string, unknown> | null; gridCompany: string | null }>(`
      ${company(c, 'F101 variants bilateral tenant synthetic')}${company(other, 'F101 variants other tenant synthetic')}
      INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${lit(c)},'test','electricity',true,clock_timestamp()-interval '1 day');
      INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${lit(c)},'test',${lit(legal)},'EdielId',${lit(sender)},clock_timestamp()-interval '1 day');
      INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${lit(c)},'test',${lit(legal)},'electricity_supplier',clock_timestamp()-interval '1 day');
      INSERT INTO public.platform_market_actors(id,name,status) VALUES(${lit(dso)},'F101 variants synthetic DSO','active');
      INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified) VALUES(${lit(dso)},'EdielId',${lit(receiver)},true);
      INSERT INTO public.tenant_bilateral_agreements(id,company_id,environment,counterparty_actor_id,capability_code,terms,is_enabled,valid_from,valid_to,source_reference)
      VALUES(${lit(agreement)},${lit(c)},'test',${lit(dso)},'PRODAT:BILATERAL:normal_start_h','{"synthetic_fixture_only":true}',true,'2000-01-01','2100-01-01','SYNTHETIC F101 VARIANTS');
      ${gridOwner(grid, owner, receiver)}
      ${customer(customerId, c)}
      ${facility(c, customerId, siteId, pointId, ownership === 'unnamed_shared' ? null : grid, { gridArea, gridEdiel: receiver })}
      SELECT jsonb_build_object('pack',${pack},'gridCompany',(SELECT company_id FROM public.grid_owners WHERE id=${lit(grid)}),
        'scope',gridex_bilateral_prodat.scope_v1(${lit(c)},${selector(pack)}));`)
  }

  it('scopes a tenant point whose own site names the shared grid owner of the receiver', () => {
    const result = scope('shared')
    expect(result.pack).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.gridCompany).toBeNull() // platform-shared registry row
    expect(result.scope).toMatchObject({ environment: 'test', kind: 'normal_start_h' })
    expect(result.scope?.legalReceiverId).toEqual(expect.stringMatching(/^73\d{11}$/))
  })

  it("still scopes the tenant's own grid owner row", () => {
    expect(scope('own').scope).toMatchObject({ kind: 'normal_start_h' })
  })

  it("never scopes another tenant's grid owner row, even when the tenant's own site names it", () => {
    const result = scope('foreign')
    expect(result.pack).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.gridCompany).not.toBeNull()
    expect(result.scope).toBeNull()
  })

  it('does not scope a shared grid owner that no tenant site names', () => {
    expect(scope('unnamed_shared').scope).toBeNull()
  })
})
