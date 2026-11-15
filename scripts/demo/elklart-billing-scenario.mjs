#!/usr/bin/env node
// Actual ordinary billing controls, restricted to the isolated Elklart tenant.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createClient} from '@supabase/supabase-js'
import {stockholmMonthBounds} from '../../lib/time/stockholm.ts'
import {assertPrivatePath,runtimeRoot,assertOpsContainer,opsContainer} from './elklart-ops-bootstrap.mjs'

export function assertBillingTarget(status,tenant) {
  if(!['http://127.0.0.1:54321','http://localhost:54321'].includes(status.API_URL)) throw new Error('Dedicated loopback OPS required')
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(tenant.companyId??'')) throw new Error('Canonical tenant required')
  if(!status.SERVICE_ROLE_KEY) throw new Error('Private local service credential required')
}
export function assertDemoCapwayConnection(connection) {
  if(connection.provider!=='capway_aptic'||connection.environment!=='test') throw new Error('Only Capway TEST configuration permitted')
  if(connection.settings?.base_url!=='http://127.0.0.1:38480') throw new Error('Exact local provider adapter configuration required before connection test')
  if(connection.settings?.auth_mode!=='apikey'||connection.settings?.api_key_header!=='x-elklart-demo-key'||connection.secret_reference?.api_key_env!=='ELKLART_CAPWAY_API_KEY') throw new Error('Explicit supported local API-key CONFIG binding required; connection status must be established by ordinary test action')
}
export function demoCapwayConfigPatch(existing={}) {
  // Supported structure from lib/integrations/billing/capway/auth.ts. No status/results.
  return {settings:{...(existing.settings??{}),auth_mode:'apikey',api_key_header:'x-elklart-demo-key',base_url:'http://127.0.0.1:38480',demo:true,fictional:true},secret_reference:{...(existing.secret_reference??{}),api_key_env:'ELKLART_CAPWAY_API_KEY'}}
}
export async function bindPreparedCapwayConfig(client,tenant,connection) {
  if(connection.provider!=='capway_aptic'||connection.environment!=='test'||!connection.id) throw new Error('Scoped Capway TEST connection required')
  const patch=demoCapwayConfigPatch(connection)
  const result=await client.from('billing_provider_connections').update(patch).eq('company_id',tenant.companyId).eq('id',connection.id).eq('provider','capway_aptic').eq('environment','test')
  if(result.error) throw new Error(`Prepared provider CONFIG binding: ${result.error.code}`)
  return {...connection,...patch}
}
export function buildProviderCatalogSql(repoRoot) {
  const sourcePath='supabase/migrations/20261002160000_tenant_invoice_provider_selection.sql'
  const source=fs.readFileSync(path.join(repoRoot,sourcePath),'utf8')
  const match=/INSERT INTO public\.invoice_provider_catalog \(provider, label, selectable, unavailable_reason, sort_order\) VALUES([\s\S]*?)ON CONFLICT \(provider\) DO NOTHING;/i.exec(source)
  if(!match) throw new Error('Exact invoice provider program reference seed missing')
  const residue=match[1].replace(/'(?:[^']|'')*'/g,"''").replace(/''|[\s(),]|\b(?:true|false|null)\b|\b\d+\b/gi,'')
  if(residue) throw new Error('Nonliteral provider reference seed refused')
  return {provenance:{source:sourcePath,source_sha256:crypto.createHash('sha256').update(source).digest('hex'),statement_sha256:crypto.createHash('sha256').update(match[0]).digest('hex'),target:'public.invoice_provider_catalog',preparedProgramReference:true},sql:`BEGIN;\nDO $elklart_billing_target$ BEGIN IF current_setting('elklart.runtime_project',true) IS DISTINCT FROM 'elklart-ops-demo' THEN RAISE EXCEPTION 'dedicated_elklart_runtime_required'; END IF; END $elklart_billing_target$;\n${match[0]}\nCOMMIT;\n`}
}
function dedicatedDatabase() {
  const docker=args=>execFileSync('docker',['--host','unix:///var/run/docker.sock',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']})
  assertOpsContainer(JSON.parse(docker(['inspect',opsContainer]))[0])
  const marker=docker(['exec',opsContainer,'psql','-U','postgres','-d','postgres','-XAt','-c',"select current_setting('elklart.runtime_project',true)"]).trim()
  if(marker!=='elklart-ops-demo') throw new Error('Dedicated local billing database marker required')
}
function seedProviderCatalog() {
  dedicatedDatabase()
  const result=buildProviderCatalogSql(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'))
  savePrivate('billing-provider-catalogue.provenance.json',result.provenance)
  const sqlPath=assertPrivatePath(path.join(runtimeRoot,'ops/billing-provider-catalogue.sql'))
  fs.writeFileSync(sqlPath,result.sql,{mode:0o600});fs.chmodSync(sqlPath,0o600)
  execFileSync('docker',['--host','unix:///var/run/docker.sock','exec','-i',opsContainer,'psql','-U','postgres','-d','postgres','-XAt','-v','ON_ERROR_STOP=1'],{input:result.sql,encoding:'utf8',stdio:['pipe','pipe','pipe']})
}
function readPrivate(relative) {return JSON.parse(fs.readFileSync(assertPrivatePath(path.join(runtimeRoot,'ops',relative)),'utf8'))}
function savePrivate(relative,data) {const target=assertPrivatePath(path.join(runtimeRoot,'ops',relative));fs.writeFileSync(target,JSON.stringify(data,null,2),{mode:0o600});fs.chmodSync(target,0o600)}
export async function readBillingSetup(client,companyId) {
  const selection=await client.from('companies').select('invoice_export_target_system,billing_provider_environment,invoice_export_enabled').eq('id',companyId).single()
  if(selection.error) throw new Error(`Billing tenant read: ${selection.error.code}`)
  const connection=await client.from('billing_provider_connections').select('id,provider,environment,status,settings,secret_reference,last_tested_at,last_test_result,readiness_issues').eq('company_id',companyId).eq('provider','capway_aptic').eq('environment','test').maybeSingle()
  if(connection.error) throw new Error(`Billing connection read: ${connection.error.code}`)
  return {selection:selection.data,connection:connection.data}
}
function publicEvidence(setup) {
  const connection=setup.connection
  return {selection:setup.selection,connection:connection?{id:connection.id,provider:connection.provider,environment:connection.environment,status:connection.status,lastTestedAt:connection.last_tested_at,lastTestOk:connection.last_test_result?.ok===true,providerEndpoint:connection.last_test_result?.endpoint,readinessIssues:connection.readiness_issues}:null,scenarioExecution:false}
}
export async function configureCapwayThroughUi(client,tenant) {
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
  const context=await browser.newContext({ignoreHTTPSErrors:true})
  const page=await context.newPage()
  const target='https://localhost:3000/admin/billing/integrations'
  try {
    const account=readPrivate('accounts.json').platform
    await page.goto('https://localhost:3000/login?next='+encodeURIComponent('/admin/billing/integrations'),{waitUntil:'domcontentloaded',timeout:90000})
    await page.locator('[name="email"]').fill(account.email)
    await page.locator('[name="password"]').fill(account.password)
    await Promise.all([page.waitForURL(url=>!url.pathname.startsWith('/login'),{timeout:60000}),page.locator('form').filter({has:page.locator('[name="password"]')}).locator('button').click()])
    await context.addCookies([{name:'gridex_admin_selected_company_id',value:tenant.companyId,url:'https://localhost:3000',secure:true,httpOnly:true,sameSite:'Lax'}])
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:90000})
    const providerForm=page.locator('#billing-select-provider form')
    if(await page.locator('#billing-select-provider summary').count()) await page.locator('#billing-select-provider').evaluate(element=>{element.open=true})
    await providerForm.locator('[name="provider"][value="capway_aptic"]').check({timeout:30000})
    await providerForm.locator('[name="environment"]').selectOption('test')
    await Promise.all([page.waitForURL(url=>url.searchParams.has('provider'),{timeout:60000}),providerForm.getByRole('button',{name:'Spara leverantör',exact:true}).click()])
    let setup=await readBillingSetup(client,tenant.companyId)
    savePrivate('billing-setup.json',{...publicEvidence(setup),source:'ordinary_provider_selection_action',providerSimulation:true})
    if(setup.selection.invoice_export_target_system!=='capway_aptic'||setup.selection.billing_provider_environment!=='test'||!setup.connection) throw new Error('Ordinary provider selection did not establish Capway TEST; private safe read-back saved')
    setup.connection=await bindPreparedCapwayConfig(client,tenant,setup.connection)
    assertDemoCapwayConnection(setup.connection)
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:90000})
    await Promise.all([page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/admin/billing/integrations',{timeout:60000}),page.getByRole('button',{name:'Testa Aptic-anslutning',exact:true}).click()])
    setup=await readBillingSetup(client,tenant.companyId)
    savePrivate('billing-setup.json',{...publicEvidence(setup),source:'ordinary_provider_selection_and_real_ping_action',providerSimulation:true})
    if(setup.connection?.status!=='ready'||setup.connection?.last_test_result?.ok!==true) throw new Error('Ordinary Capway TEST connection test did not succeed; safe read-back saved')
    return publicEvidence(setup)
  } catch(error) {
    savePrivate('billing-ui-diagnostic.json',{url:page.url(),title:await page.title(),bodyPreview:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1400)})
    throw error
  } finally {await browser.close()}
}
export function assertAllowedInvoiceScope(rows,companyId,allowedCustomerIds) {
  if(!Array.isArray(allowedCustomerIds)||allowedCustomerIds.length===0||allowedCustomerIds.some(id=>!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))) throw new Error('Explicit fictional customer allowlist required')
  if(rows.some(row=>row.company_id!==companyId||!allowedCustomerIds.includes(row.customer_id))) throw new Error('Whole-month billing scope includes a customer outside the explicit allowlist')
}
export function assertCompleteInvoiceScopeRead(result,label) {
  if(result.error) throw new Error(`Invoice prerequisite read failed: ${result.error.code}`)
  // PostgREST may cap a requested limit below 1001. An exact count must prove
  // that every matching row was fetched before whole-month controls can run.
  if(!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count<0||result.count!==result.data.length||result.count>1000) throw new Error(`Incomplete ${label} scope; exact count must equal all fetched rows within the demo bound`)
  return result.data
}
export async function invoiceScenarioPreflight(client,tenant,billingMonth,allowedCustomerIds) {
  const bounds=stockholmMonthBounds(billingMonth)
  assertAllowedInvoiceScope([],tenant.companyId,allowedCustomerIds)
  const results=await Promise.all([
    client.from('customer_supply_periods').select('id,company_id,customer_id,status,start_date,end_date',{count:'exact'}).eq('company_id',tenant.companyId).in('status',['active','confirmed_by_grid_owner','ended']).lt('start_date',bounds.endDateExclusive).or(`end_date.is.null,end_date.gte.${bounds.startDate}`).limit(1001),
    client.from('billing_underlays').select('id,company_id,customer_id,status,readiness_status,missing_values_count,source_meter_value_count,total_kwh',{count:'exact'}).eq('company_id',tenant.companyId).eq('underlay_year',bounds.year).eq('underlay_month',bounds.month).limit(1001),
    client.from('normalized_metering_values').select('id,company_id,customer_id').eq('company_id',tenant.companyId).eq('revision_status','current').eq('billing_status','billable').eq('billing_gate_status','eligible').not('supply_period_id','is',null).lt('period_start',bounds.end).gt('period_end',bounds.start).limit(1),
  ])
  for(const result of results) if(result.error) throw new Error(`Invoice prerequisite read failed: ${result.error.code}`)
  assertCompleteInvoiceScopeRead(results[0],'delivery period')
  assertCompleteInvoiceScopeRead(results[1],'billing underlay')
  assertAllowedInvoiceScope(results[0].data,tenant.companyId,allowedCustomerIds)
  assertAllowedInvoiceScope(results[1].data,tenant.companyId,allowedCustomerIds)
  if(!results[0].data.length) throw new Error('No ordinary confirmed delivery periods for the requested demo month')
  if(!results[2].data.length) throw new Error('No current billable eligible meter values bound to actual delivery; scenario remains unexecuted')
  return {billingMonth,bounds,supplyPeriods:results[0].data,underlays:results[1].data,qualifiedMeterValuePresent:true,missingCoverageNotAssumedZero:true}
}
export async function runInvoiceScenarioThroughUi(client,tenant,{billingMonth,allowedCustomerIds,approveAndSend=false}) {
  const before=await invoiceScenarioPreflight(client,tenant,billingMonth,allowedCustomerIds)
  const setup=await readBillingSetup(client,tenant.companyId)
  assertDemoCapwayConnection(setup.connection??{})
  if(setup.connection.status!=='ready'||!setup.connection.last_test_result?.ok) throw new Error('Real ordinary provider Ping must pass before invoice scenario')
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
  const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage()
  try {
    const account=readPrivate('accounts.json').platform
    await page.goto('https://localhost:3000/login?next='+encodeURIComponent('/admin/billing'),{waitUntil:'domcontentloaded',timeout:90000})
    await page.locator('[name="email"]').fill(account.email);await page.locator('[name="password"]').fill(account.password)
    await Promise.all([page.waitForURL(url=>!url.pathname.startsWith('/login'),{timeout:60000}),page.locator('form').filter({has:page.locator('[name="password"]')}).locator('button').click()])
    await context.addCookies([{name:'gridex_admin_selected_company_id',value:tenant.companyId,url:'https://localhost:3000',secure:true,httpOnly:true,sameSite:'Lax'}])
    const stages=[]
    for(const route of ['/api/internal/billing/generate-underlay','/api/internal/invoice-exports/create']) {
      const response=await page.request.post('https://localhost:3000'+route,{data:{company_id:tenant.companyId,billing_month:billingMonth},headers:{Origin:'https://localhost:3000'},timeout:120000})
      const data=await response.json()
      stages.push({route,httpStatus:response.status(),data})
      savePrivate('billing-scenario-progress.json',{before,stages,approvalRequested:approveAndSend,scenarioComplete:false})
      if(!response.ok()) throw new Error(`Ordinary billing preparation failed at ${route}; private stage evidence saved`)
    }
    const afterPreparation=await invoiceScenarioPreflight(client,tenant,billingMonth,allowedCustomerIds)
    if(afterPreparation.underlays.some(row=>row.status!=='validated'||row.readiness_status!=='ready'||Number(row.missing_values_count)>0)) throw new Error('Ordinary invoice preparation retains blocked/missing data; no approval sent')
    if(!approveAndSend) return {prepared:true,approved:false,stages}
    if(!setup.selection.invoice_export_enabled) {
      await page.goto('https://localhost:3000/admin/billing/integrations',{waitUntil:'domcontentloaded',timeout:90000})
      await Promise.all([page.waitForURL(url=>url.searchParams.get('provider')==='enabled',{timeout:60000}),page.getByRole('button',{name:'Aktivera utskick',exact:true}).click()])
    }
    await page.goto(`https://localhost:3000/admin/billing?month=${billingMonth}`,{waitUntil:'domcontentloaded',timeout:90000})
    const approveForm=page.locator('form').filter({has:page.locator(`[name="billing_month"][value="${billingMonth}"]`)})
    await Promise.all([page.waitForURL(url=>url.searchParams.has('sent'),{timeout:120000}),approveForm.getByRole('button',{name:/Godkänn och skicka/}).click()])
    const outcome=new URL(page.url()).searchParams
    if(Number(outcome.get('failed'))>0||Number(outcome.get('sent'))<1) throw new Error('Ordinary invoice approve/send returned failures or no sent invoices')
    const invoices=await client.from('customer_invoices').select('id,company_id,customer_id,invoice_export_item_id,partner_invoice_reference,status,amount_inc_vat,total_kwh,period_start,period_end').eq('company_id',tenant.companyId).in('customer_id',allowedCustomerIds).in('status',['issued','sent','paid','overdue','cancelled','credited']).gte('period_start',before.bounds.startDate).lt('period_start',before.bounds.endDateExclusive)
    if(invoices.error) throw new Error(`Published invoice read-back failed: ${invoices.error.code}`)
    if(!invoices.data.length||invoices.data.some(row=>!row.invoice_export_item_id||!row.partner_invoice_reference)) throw new Error('Provider-confirmed canonical customer invoice missing')
    const evidence={source:'ordinary_billing_generation_prepare_approve_send',providerSimulation:true,billingMonth,stages,invoices:invoices.data,opsInvoiceLinks:invoices.data.map(row=>`https://localhost:3000/admin/billing/invoices/${row.id}`),portalViewVerified:false,scenarioComplete:false}
    savePrivate('billing-scenario-result.json',evidence)
    return evidence
  } finally {await browser.close()}
}
async function main() {
  const status=readPrivate('status.json'),tenant=readPrivate('tenant.json')
  assertBillingTarget(status,tenant)
  const client=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  const company=await client.from('companies').select('slug').eq('id',tenant.companyId).single()
  if(company.error||company.data?.slug!=='elklart-demo') throw new Error('Fictional Elklart tenant required')
  const monthArg=process.argv.find(value=>value.startsWith('--invoice-month='))
  if(monthArg) {const billingMonth=monthArg.split('=')[1],allowedCustomerIds=process.argv.filter(value=>value.startsWith('--allowed-customer-id=')).map(value=>value.split('=')[1]);await runInvoiceScenarioThroughUi(client,tenant,{billingMonth,allowedCustomerIds,approveAndSend:process.argv.includes('--approve-and-send')});console.log('Ordinary billing controls completed; inspect private evidence and separately verify the real customer portal.');return}
  seedProviderCatalog()
  await configureCapwayThroughUi(client,tenant)
  console.log('Capway TEST selected and ordinary OPS connection test passed against the controlled adapter. Invoice preparation/export remains separate.')
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1})
