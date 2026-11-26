import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/cron/billing/invoice-file-reconciliation/route'

const worker = vi.hoisted(() => vi.fn())
vi.mock('@/lib/billing/invoiceFileReconciliation', () => ({ runInvoiceFileReconciliation:worker }))

const scheduler = 'synthetic-host-scheduler'
const dedicated = 'synthetic-billing-scheduler'
const route = 'https://cron-fixture.invalid/api/cron/billing/invoice-file-reconciliation'
const handlers = { GET, POST }
const base = {
  status:'completed',
  period:{ scanned:3, locked:1, alreadyLocked:0, incomplete:0, superseded:1, retryPending:1, failed:0, listFailed:false, deferred:0 },
  legacy:{ scanned:2, applied:1, held:1, retryPending:0, failed:0, listFailed:false, deferred:0 },
}
function call(method: keyof typeof handlers, headers: Record<string,string> = {}, query = '') {
  const body = method === 'POST' ? JSON.stringify({ company_id:'ignored-company', file_id:'ignored-file', limit:5000 }) : undefined
  return handlers[method](new NextRequest(route + query, { method, headers, body }))
}
beforeEach(() => {
  worker.mockReset().mockResolvedValue(structuredClone(base))
  vi.stubEnv('CRON_SECRET', undefined)
  vi.stubEnv('BILLING_AUTOMATION_CRON_SECRET', undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('PUNKT09 scheduled route uses the existing scheduler policy', () => {
  it.each(['GET','POST'] as const)('denies %s before invoking any worker for no credentials or unconfigured secrets', async method => {
    const denied: Record<string,string>[] = [{}, {authorization:'Bearer '+scheduler}, {'user-agent':'vercel-cron/1.0'}]
    for (const headers of denied) {
      const result = await call(method,headers)
      expect(result.status).toBe(401)
      expect(result.headers.get('cache-control')).toBe('no-store')
      expect(await result.json()).toEqual({ok:false,error:'Unauthorized.'})
    }
    expect(worker).not.toHaveBeenCalled()
  })
  it.each([
    ['GET','CRON_SECRET',scheduler,'authorization'],
    ['POST','CRON_SECRET',scheduler,'authorization'],
    ['GET','BILLING_AUTOMATION_CRON_SECRET',dedicated,'x-cron-secret'],
    ['POST','BILLING_AUTOMATION_CRON_SECRET',dedicated,'x-cron-secret'],
  ] as const)('allows %s with authorized %s and fixed scope, including unrelated request input', async (method,env,secret,header)=>{
    vi.stubEnv(env,secret)
    const result = await call(method, {[header]:header==='authorization' ? 'Bearer '+secret:secret},
      '?company_id=ignored-company&file_id=ignored-file&limit=2000&environment=production')
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toEqual({ok:true,outcome:'completed',period:base.period,legacy:base.legacy})
    expect(worker).toHaveBeenCalledExactlyOnceWith()
  })
  it('retains both configured credentials and actual bearer precedence from the shared guard',async()=>{
    vi.stubEnv('BILLING_AUTOMATION_CRON_SECRET',dedicated)
    vi.stubEnv('CRON_SECRET',scheduler)
    const cases: Record<string,string>[] = [
      {authorization:'bEaReR '+scheduler},
      {authorization:'Bearer '+dedicated},
      {'x-cron-secret':dedicated},
    ]
    for (const headers of cases) expect((await call('GET',headers)).status).toBe(200)
    worker.mockClear()
    expect((await call('GET',{authorization:'Bearer same-but-incorrect','x-cron-secret':dedicated})).status).toBe(401)
    expect(worker).not.toHaveBeenCalled()
  })
})

describe('PUNKT09 exposes only bounded outcome counters', () => {
  beforeEach(()=>vi.stubEnv('CRON_SECRET',scheduler))
  it('names partial execution and retains legitimate incomplete/held counts without returning job or tenant identifiers',async()=>{
    const period={...base.period,incomplete:1,failed:1,deferred:2,company_id:'private-company',reason:'private SQL detail'}
    const legacy={...base.legacy}
    worker.mockResolvedValueOnce({status:'partial',period,legacy,internalError:'private transport detail'})
    const result=await call('GET',{authorization:'Bearer '+scheduler})
    expect(result.status).toBe(503)
    expect(result.headers.get('cache-control')).toBe('no-store')
    const body=await result.json()
    expect(body).toEqual({ok:false,outcome:'partial',code:'invoice_file_reconciliation_incomplete',
      period:{...base.period,incomplete:1,failed:1,deferred:2},legacy:base.legacy})
    expect(JSON.stringify(body)).not.toContain('private')
  })
  it('distinguishes failure to load either queue from a job that was attempted and failed',async()=>{
    const period={...base.period,scanned:0,locked:0,superseded:0,retryPending:0,listFailed:true}
    const legacy={...base.legacy,scanned:0,applied:0,held:0,listFailed:true}
    worker.mockResolvedValueOnce({status:'failed',period,legacy})
    const result=await call('POST',{authorization:'Bearer '+scheduler})
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ok:false,outcome:'failed',code:'invoice_file_reconciliation_incomplete',period,legacy})
  })
  it('returns a correlatable generic failure for an unexpected worker exception',async()=>{
    const logged=vi.spyOn(console,'error').mockImplementation(()=>{})
    worker.mockRejectedValueOnce(new Error('private token and database detail'))
    const result=await call('GET',{authorization:'Bearer '+scheduler})
    expect(result.status).toBe(503)
    expect(result.headers.get('cache-control')).toBe('no-store')
    const body=await result.json()
    expect(body).toEqual({ok:false,outcome:'failed',code:'invoice_file_reconciliation_unavailable',
      trace_id:expect.stringMatching(/^[a-f0-9-]{36}$/)})
    expect(logged.mock.calls).toEqual([['[invoice-file-reconciliation-cron] worker failed',{traceId:body.trace_id}]])
    expect(JSON.stringify(body)).not.toContain('private')
  })
})
