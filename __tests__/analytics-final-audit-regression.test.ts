import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
type TestQuery = {
    [key: string]: unknown;
    then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};
const io = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, pageCap: 1000, omitCount: false, error: null as null | {
        message: string;
    }, calls: [] as Array<{
        table: string;
        limit?: number;
        filters: Array<[
            string,
            unknown
        ]>;
    }> }));
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
            const filters: Array<[
                string,
                unknown
            ]> = [];
            let start = 0, end = 999;
            const q: TestQuery = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; }, in: (k: string, v: unknown[]) => { filters.push([k, v]); return q; }, order: () => q, limit: (n: number) => { end = n - 1; return q; }, range: (a: number, b: number) => { start = a; end = b; return q; }, gte: () => q, lt: () => q, lte: () => q, gt: () => q,
                maybeSingle: async () => ({ data: null, error: io.error }), then(resolve: (value: unknown) => unknown) { io.calls.push({ table, filters, limit: end - start + 1 }); const rows = (io.tables[table] ?? []).filter(row => filters.every(([k, v]) => Array.isArray(v) ? v.includes(row[k]) : row[k] === v)); return Promise.resolve({ data: rows.slice(start, Math.min(end + 1, start + io.pageCap)), count: io.omitCount ? null : rows.length, error: io.error }).then(resolve); } };
            return q;
        }, rpc: async () => ({ data: 0, error: null }) } }));
vi.mock('@/lib/analytics/customerPortfolio', () => ({ getPortfolioMonthForCompany: async () => null }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: {
        href: string;
        children?: React.ReactNode;
    }) => React.createElement('a', { href, ...props }, children) }));
import { monthStart, formatMwh } from '@/lib/analytics/utils';
import { SimpleBars, ForecastTable, AnalyticsTabs, AnalyticsFilters } from '@/app/admin/analytics/_components';
import { buildLiveMonthlyFallback, getDeviationRows, getLatestForecastByBiddingZone, getReportRows, getOverviewBreakdowns } from '@/lib/analytics/db';
beforeEach(() => { io.tables = {}; io.pageCap = 1000; io.omitCount = false; io.error = null; io.calls = []; });
it('uses the Swedish business month at UTC month boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T23:30:00Z'));
    expect(monthStart()).toBe('2026-11-01');
    vi.useRealTimers();
});
it('keeps small positive energy volumes distinguishable from zero', () => { expect(formatMwh(300)).not.toBe(formatMwh(0)); expect(formatMwh(499)).not.toBe(formatMwh(0)); expect(formatMwh(null)).toBe('–'); });
it('draws a zero bar with zero width and keeps unknown values unknown', () => { const html = renderToStaticMarkup(React.createElement(SimpleBars, { rows: [{ month: '2026-10-01', forecast_kwh: 0 }, { month: '2026-11-01', forecast_kwh: null }], valueKey: 'forecast_kwh', labelKey: 'month' })); expect(html).toContain('width:0%'); expect(html).toContain('–'); });
it('shows known zero confidence, not an absent confidence', () => { const html = renderToStaticMarkup(React.createElement(ForecastTable, { rows: [{ biddingZoneCode: 'SE3', forecastKwh: 0, forecastMwh: 0, actualKwh: 0, diffKwh: 0, diffPercent: null, confidenceScore: 0, missingDataCount: 0 }] })); expect(html).toContain('0 %'); });
it('marks the current analytics page and includes associations', () => { expect(renderToStaticMarkup(React.createElement(AnalyticsTabs, { active: 'forecast' }))).toContain('aria-current="page"'); expect(renderToStaticMarkup(React.createElement(AnalyticsFilters, { month: '2026-10-01', biddingZones: [], gridOwners: [] }))).toContain('value="association"'); });
it('does not invent historical stocks or forecasts when a monthly snapshot is absent', async () => { const row = await buildLiveMonthlyFallback('A', '2020-01-01'); expect(row.total_customers).toBeNull(); expect(row.active_sites).toBeNull(); expect(row.forecast_kwh).toBeNull(); expect(row.failed_metering_requests).toBeNull(); expect(io.calls.some(c => c.table === 'customers')).toBe(false); });
it('never converts missing schema into an all-clear empty list', async () => { io.error = { message: 'relation does not exist' }; await expect(getDeviationRows('A')).rejects.toThrow(); });
it('counts all open deviations beyond the old 50-row cap', async () => { io.tables.gridex_actionable_data_quality_issues_v = Array.from({ length: 51 }, (_, i) => ({ id: String(i), company_id: 'A', status: 'open', issue_type: 'missing_grid_owner' })); expect(await getDeviationRows('A')).toHaveLength(51); });
it('uses point counts consistently, including known zero', async () => { io.tables.bidding_zone_monthly_metrics = [{ company_id: 'A', month: '2026-10-01', bidding_zone_code: 'SE3', metering_points_count: 0, forecast_kwh: 12000 }]; const rows = await getOverviewBreakdowns('A', '2026-10-01'); expect(rows.biddingZones[0].value).toBe(0); });
it('does not replace absent historical area metrics with current points', async () => { io.tables.metering_points = [{ company_id: 'A', bidding_zone_code: 'SE3' }]; expect((await getOverviewBreakdowns('A', '2020-01-01')).biddingZones).toEqual([]); });
it('preserves unknown confidence through forecast aggregation', async () => { io.tables.forecast_runs = [{ id: 'run', company_id: 'A', forecast_type: 'consumption', status: 'completed' }]; io.tables.forecast_run_items = [{ company_id: 'A', forecast_run_id: 'run', bidding_zone_code: 'SE3', forecast_kwh: 3, confidence_score: null }]; expect((await getLatestForecastByBiddingZone('A', { month: '2026-10-01' }))[0].confidenceScore).toBeNull(); });
it('exports the same latest run and dimensional filters as the screen', async () => { io.tables.forecast_runs = [{ id: 'run', company_id: 'A', forecast_type: 'consumption', status: 'completed' }]; io.tables.forecast_run_items = [{ company_id: 'A', forecast_run_id: 'run', customer_id: 'yes', bidding_zone_code: 'SE3' }, { company_id: 'A', forecast_run_id: 'old', customer_id: 'yes', bidding_zone_code: 'SE3' }, { company_id: 'A', forecast_run_id: 'run', customer_id: 'no', bidding_zone_code: 'SE3' }, { company_id: 'B', forecast_run_id: 'run', customer_id: 'yes', bidding_zone_code: 'SE3' }]; io.tables.customers = [{ id: 'yes', company_id: 'A', customer_type: 'association' }]; const rows = await getReportRows('A', 'forecast_run_items', '2026-10-01', { month: '2026-10-01', customerType: 'association' }); expect(rows).toHaveLength(1); expect(rows[0].customer_id).toBe('yes'); });
it('links supported site and meter issues only through their own company customer', async () => { io.tables.gridex_actionable_data_quality_issues_v = [{ id: 'issue', company_id: 'A', status: 'open', issue_type: 'missing_site_address', entity_type: 'site', entity_id: 'site' }]; io.tables.customer_sites = [{ id: 'site', company_id: 'A', customer_id: 'customer' }]; io.tables.customers = [{ id: 'customer', company_id: 'A' }]; expect((await getDeviationRows('A'))[0].actionHref).toBe('/admin/customers/customer?tab=sites'); io.tables.customer_sites = [{ id: 'site', company_id: 'B', customer_id: 'foreign' }]; expect((await getDeviationRows('A'))[0].actionHref).toBeUndefined(); });
it('reads a complete deviation dataset across database pages', async () => { io.tables.gridex_actionable_data_quality_issues_v = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), company_id: 'A', status: 'open', issue_type: 'missing_grid_owner' })); expect(await getDeviationRows('A')).toHaveLength(1001); });
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ email: 'synthetic@example.invalid', permissions: ['reports.read'], isPlatformAdmin: false }) }));
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: async () => ({ companyId: 'A', isPlatformAdmin: false }) }));
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: {
        title: string;
    }) => React.createElement('h1', null, title) }));
it('preserves the selected and next month and never makes absent metrics green facts', async () => { const { default: Page } = await import('@/app/admin/analytics/page'); const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ month: '2020-01' }) })); expect(html).toContain('/admin/analytics/forecast?month=2020-01'); expect(html).toContain('/admin/analytics/forecast?month=2020-02'); expect(html).toContain('Månadsunderlag saknas'); expect(html).not.toContain('Stabil'); expect(html).not.toContain('0 MWh'); });
it('does not offer customer links to a report-only reader and paginates a full deviation count', async () => { io.tables.gridex_actionable_data_quality_issues_v = Array.from({ length: 51 }, (_, i) => ({ id: String(i), company_id: 'A', status: 'open', issue_type: 'missing_grid_owner', entity_type: 'customer', entity_id: 'customer' })); const { default: Page } = await import('@/app/admin/analytics/deviations/page'); const html = renderToStaticMarkup(await Page()); expect(html).toContain('51 öppna avvikelser'); expect(html).toContain('?page=2'); expect(html).not.toContain('href="/admin/customers/customer"'); });
it('keeps known zero forecast confidence visible in page cards', async () => { io.tables.forecast_runs = [{ id: 'run', company_id: 'A', forecast_type: 'consumption', status: 'completed' }]; io.tables.forecast_run_items = [{ company_id: 'A', forecast_run_id: 'run', customer_id: 'customer', bidding_zone_code: 'SE3', forecast_kwh: 0, actual_kwh: 0, confidence_score: 0 }]; const { default: Page } = await import('@/app/admin/analytics/forecast/page'); const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ month: '2026-10', biddingZoneCode: 'SE3' }) })); expect(html).toContain('0 %'); expect(html).toContain('biddingZoneCode=SE3'); expect(html).not.toContain('Ingen saknad prognosbas</p>'); });
it('renders an explicit unavailable state instead of empty green analysis when reads fail', async () => { io.error = { message: 'relation does not exist' }; const { default: Page } = await import('@/app/admin/analytics/page'); const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ month: '2020-01' }) })); expect(html).toContain('Analysunderlaget kunde inte läsas'); expect(html).not.toContain('Stabil'); expect(html).not.toContain('Inga öppna'); });
it('bounds identity lookup batches while retaining all issue links', async () => {
    io.tables.gridex_actionable_data_quality_issues_v = Array.from({ length: 201 }, (_, i) => ({ id: `issue-${i}`, company_id: 'A', status: 'open', issue_type: 'missing_site_address', entity_type: 'site', entity_id: `site-${i}` }));
    io.tables.customer_sites = Array.from({ length: 201 }, (_, i) => ({ id: `site-${i}`, company_id: 'A', customer_id: 'customer' }));
    io.tables.customers = [{ id: 'customer', company_id: 'A' }];
    const rows = await getDeviationRows('A');
    expect(rows.every(row => row.actionHref?.includes('/customer?tab=sites'))).toBe(true);
    expect(io.calls.filter(call => call.table === 'customer_sites').every(call => call.filters.every(([, value]) => !Array.isArray(value) || value.length <= 200))).toBe(true);
});
it('retains the selected forecast run creation time without pretending a read proves freshness', async () => { io.tables.forecast_runs = [{ id: 'run', company_id: 'A', forecast_type: 'consumption', status: 'completed', created_at: '2026-10-03T12:00:00Z' }]; io.tables.forecast_run_items = [{ company_id: 'A', forecast_run_id: 'run', bidding_zone_code: 'SE3', forecast_kwh: 3 }]; expect((await getLatestForecastByBiddingZone('A', { month: '2026-10-01' }))[0]).toHaveProperty('sourceCreatedAt', '2026-10-03T12:00:00Z'); });
it('follows the actual returned range when the database caps a page below 1000', async () => { io.pageCap = 100; io.tables.gridex_actionable_data_quality_issues_v = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), company_id: 'A', status: 'open', issue_type: 'missing_grid_owner' })); expect(await getDeviationRows('A')).toHaveLength(1001); });
it('reports unavailable rather than silently publishing totals beyond the bounded complete-read limit', async () => { io.tables.gridex_actionable_data_quality_issues_v = Array.from({ length: 10001 }, (_, i) => ({ id: String(i), company_id: 'A', status: 'open' })); await expect(getDeviationRows('A')).rejects.toThrow('Urvalet är för stort'); });
it('never shows unknown area forecast as zero in the actual forecast page cards',async()=>{io.tables.forecast_runs=[{id:'run',company_id:'A',forecast_type:'consumption',status:'completed'}];io.tables.forecast_run_items=[{company_id:'A',forecast_run_id:'run',bidding_zone_code:'SE3',forecast_kwh:null,actual_kwh:null,confidence_score:null}];const {default:Page}=await import('@/app/admin/analytics/forecast/page');const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({month:'2026-10'})}));expect(html).not.toContain('0 MWh');expect(html).toContain('SE3');expect(html).toContain('–')})
it('keeps the six-owner top list bounded in the query even when the company has over 10000 owners',async()=>{io.tables.grid_owner_monthly_metrics=Array.from({length:10001},(_,i)=>({id:`metric-${i}`,company_id:'A',month:'2026-10-01',grid_owner_id:`owner-${i}`,metering_values_missing:10001-i}));const result=await getOverviewBreakdowns('A','2026-10-01');expect(result.missingByGridOwner).toHaveLength(6);expect(io.calls.filter(c=>c.table==='grid_owner_monthly_metrics').every(c=>(c.limit??Infinity)<=6)).toBe(true)})
it('can complete a six-owner top list through a lower backend row cap without expanding its scope',async()=>{io.pageCap=2;io.tables.grid_owner_monthly_metrics=Array.from({length:9},(_,i)=>({id:`metric-${i}`,company_id:'A',month:'2026-10-01',grid_owner_id:`owner-${i}`,metering_values_missing:9-i}));const result=await getOverviewBreakdowns('A','2026-10-01');expect(result.missingByGridOwner).toHaveLength(6);expect(io.calls.filter(c=>c.table==='grid_owner_monthly_metrics').every(c=>(c.limit??Infinity)<=6)).toBe(true)})
it('fails closed when a short backend-capped complete read omits the requested exact count',async()=>{io.omitCount=true;io.pageCap=100;io.tables.gridex_actionable_data_quality_issues_v=Array.from({length:1001},(_,i)=>({id:String(i),company_id:'A',status:'open'}));await expect(getDeviationRows('A')).rejects.toThrow('omfattning')})
it('keeps the missing-basis count unknown for area-only fallback without inspected basis rows',async()=>{io.tables.bidding_zone_monthly_metrics=[{id:'zone',company_id:'A',month:'2026-10-01',bidding_zone_code:'SE3',forecast_kwh:null,actual_kwh:null}];const {default:Page}=await import('@/app/admin/analytics/forecast/page');const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({month:'2026-10'})}));expect(html).toContain('Antal saknade prognosbaser kan inte bedömas');expect(html).not.toContain('Ingen saknad prognosbas i urvalet')})
it('does not infer an exact missing-basis count from a null forecast alone',async()=>{io.tables.forecast_runs=[{id:'run',company_id:'A',forecast_type:'consumption',status:'completed'}];io.tables.forecast_run_items=[{company_id:'A',forecast_run_id:'run',bidding_zone_code:'SE3',forecast_kwh:null,method:null}];expect((await getLatestForecastByBiddingZone('A',{month:'2026-10-01'}))[0]).toHaveProperty('missingDataAvailable',false)})
