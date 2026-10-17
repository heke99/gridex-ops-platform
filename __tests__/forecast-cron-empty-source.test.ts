import { beforeEach,expect,it,vi } from 'vitest'
const io=vi.hoisted(()=>({hasData:vi.fn(),run:vi.fn()}))
vi.mock('@/lib/analytics/cron',()=>({isAnalyticsCronAuthorized:()=>true,listAnalyticsCompanyIds:async()=>['empty','real']}))
vi.mock('@/lib/analytics/monthlyMetricsBuilder',()=>({hasCustomerAnalyticsData:io.hasData}))
vi.mock('@/lib/forecasting/forecastRuns',()=>({runCompanyForecast:io.run}))
import { POST } from '@/app/api/cron/forecast/run/route'
import { NextRequest } from 'next/server'
beforeEach(()=>{io.hasData.mockImplementation(async(id:string)=>id==='real');io.run.mockResolvedValue({forecastRunId:'new-run',items:1,missing:0});vi.clearAllMocks()})
it('does not repopulate empty-company forecast runs and continues processing real customers',async()=>{
 const response=await POST(new NextRequest('https://example.test/api/cron/forecast/run?month=2026-10'))
 expect(response.status).toBe(200)
 expect(io.run).toHaveBeenCalledTimes(1)
 expect(io.run).toHaveBeenCalledWith({companyId:'real',periodStart:'2026-10-01'})
 expect((await response.json()).results).toContainEqual({companyId:'empty',items:0,missing:0,skipped:'no_customer_data'})
})
