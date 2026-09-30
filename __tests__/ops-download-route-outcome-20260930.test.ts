import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only',()=>({}))
type Row = Record<string, unknown>
const fixture = vi.hoisted(()=>({ companyId:'company-a' as string|null, guardCompanyId:'company-a' as string|null, authId:'actor-a' as string|null, permissions:['billing_underlay.read'], platform:false,
  rows:{} as Record<string,Row[]>, queries:[] as Array<{table:string;filters:Row}>, failTable:'', pageDenied:false }))
vi.mock('@/lib/admin/guards',()=>({
  requireAdminPageKeyAccess:async()=>{ if(fixture.pageDenied) throw new Error('current_page_permission_denied'); return {userId:'actor-a',companyId:fixture.guardCompanyId,permissions:fixture.permissions,isPlatformAdmin:fixture.platform} },
  isPlatformAdminContext:(context:{isPlatformAdmin:boolean})=>context.isPlatformAdmin,
}))
vi.mock('@/lib/tenant/scope',()=>({getOperationalCompanyScope:async()=>({companyId:fixture.companyId})}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:fixture.authId?{id:fixture.authId}:null}})}})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
  const filters:Row={}
  const result=()=>{ fixture.queries.push({table,filters:{...filters}}); return {data:(fixture.rows[table]??[]).filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value)),error:fixture.failTable===table?new Error('SQL PRIVATE download failure'):null} }
  const query={select:()=>query,eq:(key:string,value:unknown)=>{filters[key]=value;return query},order:()=>query,limit:()=>query,
    maybeSingle:async()=>{const value=result();return {...value,data:value.data[0]??null}},then:(resolve:(value:unknown)=>void)=>Promise.resolve(result()).then(resolve)}
  return query
}}}))
import { GET as analytics } from '@/app/admin/analytics/export/route'
import { GET as billing } from '@/app/admin/billing/export-center/[id]/download/route'
const request=(path:string)=>new NextRequest(`http://localhost${path}`)
const download=(id='run-a',format='json')=>billing(request(`/admin/billing/export-center/${id}/download?format=${format}`),{params:Promise.resolve({id})})

describe('actual OPS download routes and builders',()=>{
  beforeEach(()=>{
    fixture.companyId='company-a';fixture.guardCompanyId='company-a';fixture.authId='actor-a';fixture.permissions=['billing_underlay.read'];fixture.platform=false;fixture.failTable='';fixture.pageDenied=false;fixture.queries=[]
    fixture.rows={
      company_monthly_metrics:[{company_id:'company-a',month:'2026-09-01',label:'Synthetic; A',actual_kwh:100},{company_id:'company-b',month:'2026-09-01',label:'Synthetic B PRIVATE',actual_kwh:999}],
      billing_export_runs:[{id:'run-a',company_id:'company-a',period_month:'2026-09',export_format:'json'},{id:'run-b',company_id:'company-b',period_month:'2026-09',export_format:'json'}],
      billing_export_run_items:[{id:'item-a',company_id:'company-a',billing_export_run_id:'run-a',energy_direction:'consumption',settlement_type:'invoice',invoice_email:'a@example.invalid'},
        {id:'item-b',company_id:'company-b',billing_export_run_id:'run-b',energy_direction:'consumption',settlement_type:'invoice',invoice_email:'b@example.invalid'}],
    }
  })
  it('returns exact scoped analytics CSV bytes, month filename and no-store attachment headers',async()=>{
    const response=await analytics(request('/admin/analytics/export?report=company_monthly_metrics&month=2026-09'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('company_id;month;label;actual_kwh\ncompany-a;2026-09-01;"Synthetic; A";100')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="analytics-company_monthly_metrics-2026-09.csv"')
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fixture.queries[0].filters).toEqual({company_id:'company-a',month:'2026-09-01'})
  })
  it('rejects unknown report and missing company before export reads',async()=>{
    expect((await analytics(request('/admin/analytics/export?report=unknown'))).status).toBe(400)
    fixture.companyId=null
    expect((await analytics(request('/admin/analytics/export?report=company_monthly_metrics'))).status).toBe(403)
    expect(fixture.queries).toHaveLength(0)
  })
  it('runs the actual billing run/item predicates and JSON builder with no B data',async()=>{
    const response=await download()
    expect(response.status).toBe(200)
    const text=await response.text(), body=JSON.parse(text)
    expect(body.run).toEqual(fixture.rows.billing_export_runs[0]);expect(body.rows).toHaveLength(1)
    expect(body.rows[0]).toMatchObject({export_run_item_id:'item-a',invoice_email:'a@example.invalid',energy_direction:'consumption',settlement_type:'invoice'})
    expect(text).not.toContain('b@example.invalid')
    expect(fixture.queries).toEqual([{table:'billing_export_runs',filters:{id:'run-a',company_id:'company-a'}},{table:'billing_export_run_items',filters:{billing_export_run_id:'run-a',company_id:'company-a'}}])
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="billing-export-2026-09-run-a.json"');expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('gives explicit foreign-run404 without reading its items',async()=>{
    const response=await download('run-b')
    expect(response.status).toBe(404);expect(await response.text()).toBe('Exportkörningen hittades inte.')
    expect(fixture.queries).toHaveLength(1)
  })
  it('denies missing permission and nonplatform scope before querying the database',async()=>{
    fixture.permissions=[]
    expect((await download()).status).toBe(403)
    fixture.permissions=['billing_underlay.read'];fixture.companyId=null
    expect((await download()).status).toBe(403)
    expect(fixture.queries).toHaveLength(0)
  })
  it('preserves canonical global administrator download access without role-name inference',async()=>{
    fixture.platform=true
    const response=await download('run-b')
    expect(response.status).toBe(200);expect((await response.json()).rows[0].invoice_email).toBe('b@example.invalid')
    expect(fixture.queries[0].filters).toEqual({id:'run-b'})
  })
  it('preserves canonical global analytics access to the currently selected company',async()=>{
    fixture.platform=true;fixture.companyId='company-b'
    const response=await analytics(request('/admin/analytics/export?report=company_monthly_metrics&month=2026-09'))
    expect(response.status).toBe(200);expect(await response.text()).toContain('company-b;2026-09-01;Synthetic B PRIVATE;999')
    expect(fixture.queries[0].filters).toEqual({company_id:'company-b',month:'2026-09-01'})
  })
  it.each(['billing','analytics'] as const)('denies changed actor before %s database reads',async route=>{
    fixture.authId='actor-other'
    const response=route==='billing'?await download():await analytics(request('/admin/analytics/export?report=company_monthly_metrics'))
    expect(response.status).toBe(403);expect(response.headers.get('content-disposition')).toBeNull();expect(fixture.queries).toHaveLength(0)
  })
  it.each(['billing','analytics'] as const)('denies changed guard/selected company before %s database reads',async route=>{
    fixture.guardCompanyId='company-b'
    const response=route==='billing'?await download():await analytics(request('/admin/analytics/export?report=company_monthly_metrics'))
    expect(response.status).toBe(403);expect(response.headers.get('content-disposition')).toBeNull();expect(fixture.queries).toHaveLength(0)
  })
  it.each(['billing','analytics'] as const)('denies missing fresh Auth even for canonical global %s guard',async route=>{
    fixture.authId=null;fixture.platform=true
    const response=route==='billing'?await download():await analytics(request('/admin/analytics/export?report=company_monthly_metrics'))
    expect(response.status).toBe(403);expect(fixture.queries).toHaveLength(0)
  })
  it('returns safe generic500 for DB export failure',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    try {fixture.failTable='billing_export_run_items';const response=await download();expect(response.status).toBe(500);expect(await response.text()).toBe('Kunde inte skapa exportfil.')} finally {log.mockRestore()}
  })
  it('returns explicit safe500 when actual billing file generation refuses inconsistent stored energy flow',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    try {
      fixture.rows.billing_export_run_items[0].settlement_type='credit_invoice'
      const response=await download()
      expect(response.status).toBe(500);expect(await response.text()).toBe('Kunde inte skapa exportfil.')
    } finally {log.mockRestore()}
  })
})
