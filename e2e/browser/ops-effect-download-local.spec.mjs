import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { test,expect } from '@playwright/test'

const enabled=process.env.GRIDEX_OPS_EFFECT_LOCAL_E2E==='1'
  && process.env.NEXT_PUBLIC_SUPABASE_URL==='http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL
  && Boolean(process.env.GRIDEX_OPS_EFFECT_FIXTURE_PATH && process.env.GRIDEX_OPS_EFFECT_PASSWORD)
test.skip(!enabled,'Requires isolated disposable OPS effects Auth/database fixture.')
test.describe.configure({mode:'serial',retries:0})
const fixture=enabled?JSON.parse(readFileSync(process.env.GRIDEX_OPS_EFFECT_FIXTURE_PATH,'utf8')):null
const records=new WeakMap()
async function login(page,email,path='/admin/billing/integrations') {
  const record={pageErrors:[],serverErrors:[],posts:[],downloads:[]}
  records.set(page,record)
  page.on('pageerror',error=>record.pageErrors.push(error.name))
  page.on('response',response=>{if(response.status()>=500) record.serverErrors.push({path:new URL(response.url()).pathname,status:response.status()})})
  page.on('request',request=>{if(request.method()==='POST' && new URL(request.url()).pathname==='/admin/billing/integrations') record.posts.push('/admin/billing/integrations')})
  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_OPS_EFFECT_PASSWORD)
  await page.getByRole('button',{name:'Logga in',exact:true}).click()
  await page.waitForURL(url=>!url.pathname.startsWith('/login'))
  await page.goto(path)
}
async function runtime(page,testInfo) {
  const record=records.get(page)
  expect(record.pageErrors).toEqual([]);expect(record.serverErrors).toEqual([])
  await testInfo.attach('sanitized-ops-effect-runtime',{body:JSON.stringify(record),contentType:'application/json'})
}
async function downloaded(page,download,expected,fileName) {
  expect(download.suggestedFilename()).toBe(fileName)
  const path=await download.path();expect(path).toBeTruthy()
  const bytes=readFileSync(path)
  expect(bytes.toString('utf8')).toBe(expected)
  records.get(page).downloads.push({fileName,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
}

test('actual integration failure is visible and persisted; a double click dispatches one command and reprocess reports remaining review',async({page},testInfo)=>{
  await login(page,fixture.writerEmail)
  const connection=page.locator('#capway-connection-test')
  await connection.getByRole('button',{name:'Testa Aptic-anslutning',exact:true}).dblclick()
  await expect(connection.getByRole('alert')).toContainText('Felresultatet är sparat för valt bolag')
  expect(records.get(page).posts).toHaveLength(1)
  await expect(connection.getByRole('button',{name:'Testa Aptic-anslutning',exact:true})).toBeEnabled()
  const events=page.locator('#provider-events-reprocess')
  await events.getByRole('button',{name:'Ombearbeta händelser',exact:true}).click()
  await expect(events.getByRole('status').filter({hasText:'Ombearbetning klar'})).toContainText('0 behandlade, 1 kvar för granskning och 0 misslyckade')
  expect(records.get(page).posts).toHaveLength(2)
  await page.reload()
  await expect(page.getByText('Senaste test: ej godkänt',{exact:false})).toBeVisible()
  await page.screenshot({path:testInfo.outputPath('ops-effect-integration-persisted.png'),fullPage:true})
  await runtime(page,testInfo)
})

test('read-only integration controls cannot dispatch and remain usable on mobile with keyboard navigation',async({page},testInfo)=>{
  await login(page,fixture.readerEmail)
  await expect(page.locator('#capway-connection-test').getByRole('button',{name:'Testa Aptic-anslutning',exact:true})).toBeDisabled()
  await expect(page.locator('#provider-events-reprocess').getByRole('button',{name:'Ombearbeta händelser',exact:true})).toBeDisabled()
  await expect(page.locator('#capway-connection-test').getByText(/Läsläge/)).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  const navigation=page.getByText('Navigation och arbetsyta',{exact:true})
  await navigation.focus();await expect(navigation).toBeFocused()
  expect(await page.evaluate(()=>document.body.scrollWidth>innerWidth+1)).toBe(false)
  expect(records.get(page).posts).toHaveLength(0)
  await page.screenshot({path:testInfo.outputPath('ops-effect-integration-readonly-mobile.png'),fullPage:true})
  await runtime(page,testInfo)
})

test('the real ReportsList control downloads exact scoped CSV bytes; direct billing route downloads and foreign run stays unavailable',async({page},testInfo)=>{
  await login(page,fixture.writerEmail,'/admin/analytics/reports?month=2026-09')
  const card=page.getByRole('heading',{name:'Kundstatistik per månad',exact:true}).locator('..')
  const [analytics]=await Promise.all([page.waitForEvent('download'),card.getByRole('link',{name:'Exportera CSV',exact:true}).click()])
  await downloaded(page,analytics,fixture.expectedAnalytics,'analytics-company_monthly_metrics-2026-09.csv')
  const billingPath=`/admin/billing/export-center/${fixture.runA}/download?format=csv`
  // This verifies native URL navigation to the existing attachment route. The
  // original billing screen has no exposed legacy-run download link; that UI
  // discoverability remains explicitly unqualified by this direct-route case.
  const [billing]=await Promise.all([page.waitForEvent('download'),page.evaluate(path=>{window.location.assign(path)},billingPath)])
  await downloaded(page,billing,fixture.expectedBilling,`billing-export-2026-09-${fixture.runA.slice(0,8)}.csv`)
  const response=await page.request.get(`/admin/billing/export-center/${fixture.runB}/download?format=csv`,{maxRedirects:0})
  expect(response.status()).toBe(404);expect(await response.text()).toBe('Exportkörningen hittades inte.')
  expect(response.headers()['content-disposition']).toBeUndefined()
  await page.screenshot({path:testInfo.outputPath('ops-effect-download-controls.png'),fullPage:true})
  await runtime(page,testInfo)
})

test('a real signed-in actor without report/export access receives no attachment or foreign data',async({page},testInfo)=>{
  await login(page,fixture.deniedEmail,'/admin')
  for(const path of ['/admin/analytics/export?report=company_monthly_metrics&month=2026-09',`/admin/billing/export-center/${fixture.runA}/download?format=csv`]) {
    const response=await page.request.get(path,{maxRedirects:0})
    expect([302,303,307,308,401,403]).toContain(response.status())
    expect(response.headers()['content-disposition']).toBeUndefined()
    expect(await response.text()).not.toMatch(/billing-a@example.invalid|billing-b@example.invalid|Synthetic OPS company B/)
  }
  await runtime(page,testInfo)
})
