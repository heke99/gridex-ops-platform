#!/usr/bin/env node
// Prepared fictional catalogue only. Scenario actions must run through product APIs.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { assertPrivatePath, runtimeRoot, assertOpsContainer, opsContainer } from './elklart-ops-bootstrap.mjs'
import { CANONICAL_LEGAL_MODULES } from '../../lib/legal/canonicalModules.ts'
import { API_CLIENT_PROFILES } from '../../lib/integrations/apiClientProfiles.ts'

export function assertLocalFixtureTarget(status, tenant) {
  if (!['http://127.0.0.1:54321', 'http://localhost:54321'].includes(status.API_URL)) throw new Error('Dedicated local OPS API required')
  for (const key of ['companyId', 'actorUserId']) if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(tenant[key] ?? '')) throw new Error('Canonical tenant identity required')
  if (!status.SERVICE_ROLE_KEY) throw new Error('Private local service credential required')
}
export async function invokeCanonical(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.code ?? 'rpc_failed'} ${error.message ?? ''}`)
  if (data?.ok === false) throw new Error(`${name}: ${data.code ?? data.error ?? 'command_rejected'}${Array.isArray(data.blockers) ? ' ['+data.blockers.map(item=>item.code).join(',')+']' : ''}`)
  return data
}
export function demoLegalProfile() {
  const input = { dispute_resolution_override:{authority:'Elklart Demo tvistnämnd (fiktiv)',url:'https://elklart.example.invalid/tvist',description:'Fiktiv tvistinformation endast för isolerad systemdemonstration.'}, legal_name:'Elklart Demo AB (fiktivt)', address_line_1:'Demogatan 1', postal_code:'211 20', city:'Malmö', country_code:'SE', support_email:'support@elklart.example.invalid', phone:'0400000000', website:'https://elklart.example.invalid', customer_service_hours:'Vardagar 09–16, endast demo', complaints_description:'Fiktivt klagomålsflöde för isolerad demonstration.', billing_terms_summary:'Demofakturor, inga betalningar eller externa utskick.' }
  for (const prefix of ['complaints','data_protection']) Object.assign(input, { [`${prefix}_contact_name`]:'Elklart demoteam', [`${prefix}_email`]:'support@elklart.example.invalid', [`${prefix}_phone`]:'0400000000', [`${prefix}_address_line_1`]:'Demogatan 1', [`${prefix}_postal_code`]:'211 20', [`${prefix}_city`]:'Malmö', [`${prefix}_country_code`]:'SE' })
  Object.assign(input, {billing_contact_email:'faktura@elklart.example.invalid', billing_contact_phone:'0400000000', billing_address_line_1:'Demogatan 1', billing_postal_code:'211 20',billing_city:'Malmö',billing_country_code:'SE'})
  return input
}
export function demoOfferCommand(companyId, actorUserId, offerId = null) {
  const component = (component_code, amount, unit, calculation_type) => ({component_code,component_type:component_code,amount,unit,calculation_type,status:'active',vat_rate:0.25,website_card_visible:true})
  const price = {interval_resolution:'fixed',base_components:[{source_type:'fixed',label:'Fast pris',weight_percent:100,fixed_price_sek_per_kwh:1,price_area:'SE4'}],snapshot_schema:'gridex_contract_pricing_v6_selection',schema_version:'gridex_contract_pricing_v6_selection',pricing_model:'fixed',energy_direction:'consumption',customer_type:'private',contract_type:'fixed',currency:'SEK',vat_rate:0.25,invoice_fee_sek:0, fixed_price_ore_per_kwh:100,monthly_fee_sek:39,price_areas:['SE4'],invoice_delivery_methods:['email'],commercial_components:[],default_price_option_reference:'elklart_demo_fixed_se4',price_components:[component('fixed_price',100,'ore_per_kwh','per_kwh'),component('monthly_fee',39,'sek_month','per_month'),component('invoice_fee',0,'sek_invoice','per_invoice')],price_options:[{price_option_reference:'elklart_demo_fixed_se4',option_code:'elklart_demo_fixed_se4',customer_name:'Elklart Demo SE4',contract_type:'fixed',customer_type:'private',binding_months:12,notice_months:1,auto_renew_enabled:false,status:'active',sort_order:0,version_number:1,default:true,selection_required:true,metadata:{is_default:true,customer_type:'private',selection_required:true},area_prices:[{price_row_reference:'elklart_demo_se4_price',price_area:'SE4',amount:100,unit:'ore_per_kwh',vat_treatment:'standard'}]}]}
  return {p_company_id:companyId,p_offer_id:offerId,p_actor_user_id:actorUserId,p_payload:{name:'Elklart Demo SE4',slug:'elklart-demo-se4',status:'draft',lifecycle_status:'draft',contract_type:'fixed',energy_direction:'consumption',customer_type:'private',pricing_model:'fixed',terms_version:'elklart-demo-v1',description:'Fiktivt demonstrationsavtal. Förberedda priser: 100 öre/kWh, 39 kr/månad, 0 kr fakturaavgift. Ingen verklig elleverans.',fixed_price_ore_per_kwh:100,monthly_fee_sek:39,invoice_fee_sek:0,default_binding_months:12,default_notice_months:1,vat_rate:0.25,power_of_attorney_mode:'not_required',power_of_attorney_required:false,automatic_renewal:false,is_active:false,channels:{internal:'paused',website:'paused',api:'paused'}},p_pricing_snapshot:price}
}
function readPrivate(file) { return JSON.parse(fs.readFileSync(assertPrivatePath(file),'utf8')) }
function savePrivate(file,data) { assertPrivatePath(file);fs.writeFileSync(file,JSON.stringify(data,null,2),{mode:0o600});fs.chmodSync(file,0o600) }
export async function prepareCatalogue(client, tenant, persist = () => {}) {
  const base={p_company_id:tenant.companyId,p_actor_user_id:tenant.actorUserId}
  await invokeCanonical(client,'gridex_update_company_and_rebuild_legal_profile',{...base,p_input:demoLegalProfile(),p_mark_reviewed:false})
  await invokeCanonical(client,'gridex_review_company_legal_profile',base)
  for (const legalModule of CANONICAL_LEGAL_MODULES) await invokeCanonical(client,'gridex_create_tenant_legal_override',{...base,p_module_key:legalModule,p_legal_mode:'replacement',p_version_label:'elklart-demo-v1',p_title:`DEMO – ${legalModule}`,p_body:`FÖRBERETT DEMOMATERIAL – ${legalModule}. Elklart Demo är en helt fiktiv elleverantör. Detta dokument gäller endast isolerad systemdemonstration. Inga verkliga leveranser, betalningar eller fullmakter uppstår. Support: support@elklart.example.invalid. Demopris SE4: 100 öre/kWh, 39 kr/månad, 0 kr/faktura. Ångerrätt och personuppgifter demonstreras utan verkliga personuppgifter.`,p_publish:true})
  let lookup=client.from('contract_offers').select('id,lifecycle_status,commercial_snapshot').eq('company_id',tenant.companyId)
  lookup=tenant.fixtureOfferId ? lookup.eq('id',tenant.fixtureOfferId) : lookup.eq('slug','elklart-demo-se4')
  const existing=await lookup.maybeSingle()
  if(existing.error) throw new Error(`offer_lookup: ${existing.error.code}`)
  let offerId=existing.data?.id
  if(!offerId || (existing.data?.lifecycle_status==='draft' && existing.data?.commercial_snapshot?.interval_resolution!=='fixed') || (existing.data?.commercial_snapshot?.vat_rate!==0.25)) {
    const result=await invokeCanonical(client,'gridex_upsert_internal_contract_offer_v3',demoOfferCommand(tenant.companyId,tenant.actorUserId,offerId ?? null))
    offerId=result.offer?.id ?? result.offer_id
    if(!offerId) throw new Error('Canonical offer result missing ID')
    persist({offerId,source:'canonical_prepared_catalogue',fictional:true})
  }
  await invokeCanonical(client,'gridex_publish_internal_contract_version',{...base,p_offer_id:offerId})
  const scopedOffer=await client.from('contract_offers').select('contract_product_version_id').eq('company_id',tenant.companyId).eq('id',offerId).single()
  if(scopedOffer.error || !scopedOffer.data?.contract_product_version_id) throw new Error('Published canonical product version missing')
  const assignment=await client.from('tenant_contract_assignments').select('id').eq('company_id',tenant.companyId).eq('contract_product_version_id',scopedOffer.data.contract_product_version_id).single()
  if(assignment.error || !assignment.data?.id) throw new Error('Canonical tenant assignment missing')
  for(const channel of ['website','api']) await invokeCanonical(client,'gridex_set_contract_channel_permission',{...base,p_assignment_id:assignment.data.id,p_channel:channel,p_allowed:true,p_reason:'Förberett fiktivt Elklart demoavtal, endast isolerad lokal portal/API.'})
  for(const channel of ['internal','website','api']) await invokeCanonical(client,'gridex_publish_contract_channel',{...base,p_offer_id:offerId,p_channel:channel})
  return offerId
}
export async function prepareFictionalActor(client,tenant) {
  // Same canonical command used by saveCompanyEdielActorAction; no test/certification attestation.
  const command={company_id:tenant.companyId,company_name:'Elklart Demo (fiktiv lokal aktör)',actor_role:'supplier',actor_user_id:tenant.actorUserId,idempotency_key:'elklart-local-demo:actor:v1',production_ediel_id:'ELKLARTDEMO',production_sender_sub_address:'ELKLARTDEMO',production_sender_subaddress_prodat:'ELKLARTDEMO',production_sender_subaddress_utilts:'ELKLARTDEMO',production_application_reference:'PRODAT',production_mailbox:'ediel@elklart.example.invalid',technical_contact_name:'Elklart demo endast lokal',technical_contact_email:'ediel@elklart.example.invalid',brp_name:'Elklart Demo BRP (fiktiv)',brp_ediel_id:'ELKLARTDEMOBRP',metadata:{fictional:true,demo:true,runtime_project:'elklart-ops-demo',prepared_state:true,source:'saveCompanyEdielActorAction',marketCertification:false}}
  if(!/^[A-Z0-9]{3,35}$/.test(command.production_ediel_id) || !/^[A-Z0-9_-]{1,35}$/.test(command.production_sender_sub_address)) throw new Error('Invalid fictional actor identifiers')
  const result=await invokeCanonical(client,'canonical_save_ediel_actor_profile',{p_command:command})
  const annotation=await client.from('ediel_actor_settings').update({metadata:command.metadata}).eq('company_id',tenant.companyId).eq('environment','production').eq('ediel_id','ELKLARTDEMO')
  if(annotation.error) throw new Error('Actor prepared provenance write failed')
  return result
}
export async function provisionWebsiteClient(client,tenant,existing,persist) {
  if(existing) { if(existing.companyId!==tenant.companyId) throw new Error('Integration tenant mismatch');return existing }
  const prefix=`gdxp_${crypto.randomBytes(8).toString('hex').slice(0,7)}`
  const apiKey=`${prefix}.${crypto.randomBytes(32).toString('base64url')}`
  const receipt=await invokeCanonical(client,'gridex_provision_tenant_website_client_v1',{p_company_id:tenant.companyId,p_environment:'development',p_client_name:'Elklart isolated demo website',p_key_prefix:prefix,p_secret_hash:crypto.createHash('sha256').update(apiKey).digest('hex'),p_scopes:API_CLIENT_PROFILES.tenant_website.defaultScopes,p_allowed_origins:['https://localhost:3001'],p_rate_limit_per_minute:120,p_actor_user_id:tenant.actorUserId,p_idempotency_key:'elklart-local-demo:website:v1'})
  const row=Array.isArray(receipt)?receipt[0]:receipt
  if(!row?.client_created) throw new Error('Existing API client needs its original private credential; refusing unusable replacement')
  const result={apiKey,webhookSigningSecret:crypto.randomBytes(32).toString('base64url'),companyId:tenant.companyId,apiBaseUrl:'https://localhost:3000/api/v1'}
  persist(result)
  return result
}
// Exact immutable program classifications, never retention decisions or grants.
export const REFERENCE_CATALOG_SOURCES = [
  {file:'20261001012305_ediel_customer_record_class_retention.sql',table:'gridex_ediel_retention.record_class_catalog',columns:['retention_class','source_table','permission_key','operation','redaction']},
  {file:'20261001015945_ediel_process_journal_class_retention.sql',table:'gridex_ediel_retention.process_class_catalog',columns:['retention_class','source_table','operation']},
]
export function extractLiteralCatalogInsert(source, table) {
  if (!REFERENCE_CATALOG_SOURCES.some(item=>item.table===table)) throw new Error('Reference catalog target not allowlisted')
  const escaped=table.replaceAll('.', '\\.')
  const match=new RegExp(`INSERT\\s+INTO\\s+${escaped}\\s+VALUES\\s+`,'i').exec(source)
  if(!match) throw new Error('Exact literal catalog INSERT missing')
  const start=match.index+match[0].length
  let index=start,quoted=false
  for(;index<source.length;index++) {
    if(source[index]==="'") {
      if(quoted && source[index+1]==="'") {index++;continue}
      quoted=!quoted
    }
    if(!quoted && source[index]===';') break
  }
  if(quoted || index===source.length) throw new Error('Unterminated literal catalog INSERT')
  const values=source.slice(start,index).trim()
  // Only scalar literals, JSONB literal casts and tuple punctuation are admitted.
  // Comments, identifiers, calls, SELECTs, dollar bodies and arbitrary casts fail.
  const residue=values.replace(/'(?:[^']|'')*'/g,"''").replace(/::jsonb\b/gi,'').replace(/''|[\s(),]|\b(?:true|false|null)\b|\b\d+\b/gi,'')
  if(residue) throw new Error('Nonliteral reference catalog expression refused')
  return {statement:source.slice(match.index,index+1),values}
}
export function buildReferenceCatalogSql(repoRoot) {
  const provenance=[],chunks=[]
  for(const spec of REFERENCE_CATALOG_SOURCES) {
    const file=path.join(repoRoot,'supabase/migrations',spec.file),source=fs.readFileSync(file,'utf8')
    const extracted=extractLiteralCatalogInsert(source,spec.table)
    const entry={source:`supabase/migrations/${spec.file}`,source_sha256:crypto.createHash('sha256').update(source).digest('hex'),statement_sha256:crypto.createHash('sha256').update(extracted.statement).digest('hex'),target:spec.table}
    provenance.push(entry)
    const columns=spec.columns.join(',')
    const comparable=spec.columns.map(column=>`a.${column} IS DISTINCT FROM e.${column}`).join(' OR ')
    chunks.push(`-- ${entry.source}; source SHA256 ${entry.source_sha256}; statement SHA256 ${entry.statement_sha256}\nWITH expected(${columns}) AS (VALUES ${extracted.values})\nINSERT INTO ${spec.table}(${columns}) SELECT * FROM expected ON CONFLICT DO NOTHING;\nDO $elklart_reference_verify$ BEGIN\nIF EXISTS(WITH expected(${columns}) AS (VALUES ${extracted.values}) SELECT FROM expected e LEFT JOIN ${spec.table} a USING(retention_class) WHERE ${comparable}) THEN RAISE EXCEPTION 'elklart_reference_catalog_mismatch'; END IF;\nEND $elklart_reference_verify$;`)
  }
  return {sql:`-- Repository program reference data only. No scenario execution or retention authority.\nBEGIN;\nDO $elklart_reference_target$ BEGIN IF current_setting('elklart.runtime_project',true) IS DISTINCT FROM 'elklart-ops-demo' THEN RAISE EXCEPTION 'dedicated_elklart_runtime_required'; END IF; END $elklart_reference_target$;\n${chunks.join('\n')}\nCOMMIT;\n`,provenance}
}
export function writeReferenceCatalogFiles(repoRoot) {
  const result=buildReferenceCatalogSql(repoRoot)
  const target=assertPrivatePath(path.join(runtimeRoot,'ops/reference-catalog.sql'))
  fs.writeFileSync(target,result.sql,{mode:0o600});fs.chmodSync(target,0o600)
  savePrivate(path.join(runtimeRoot,'ops/reference-catalog.provenance.json'),result.provenance)
  return result.provenance
}
export function buildLegalMasterReferenceSql(repoRoot) {
  const relative='supabase/migrations/20260716183000_contract_canonical_finalization.sql'
  const source=fs.readFileSync(path.join(repoRoot,relative),'utf8')
  const match=/with template_seed\(module_key,name,description,title,body,mandatory\) as \(\s*values([\s\S]*?)\n\), upsert_templates as \(/i.exec(source)
  if(!match) throw new Error('Exact legal master reference seed missing')
  const values=match[1]
  const residue=values.replace(/E?'(?:[^']|'')*'/g,"''").replace(/''|[\s(),]|\b(?:true|false)\b/gi,'')
  if(residue) throw new Error('Nonliteral legal master reference expression refused')
  const sourceHash=crypto.createHash('sha256').update(source).digest('hex')
  const statement=`WITH template_seed(module_key,name,description,title,body,mandatory) AS (VALUES ${values})\nINSERT INTO public.legal_templates(module_key,name,description,mandatory,status)\nSELECT module_key,name,description,mandatory,'active' FROM template_seed ON CONFLICT(module_key) DO NOTHING;`
  const provenance={source:relative,source_sha256:sourceHash,statement_sha256:crypto.createHash('sha256').update(statement).digest('hex'),target:'public.legal_templates',sourceKind:'repository_program_reference',scenarioExecution:false}
  const rules=[]
  const ruleProvenance=[]
  for(const relativeRule of ['supabase/migrations/20260714160000_canonical_contract_runtime_completion.sql','supabase/migrations/20260716140000_contract_legal_publication_single_source_completion.sql']) {
    const body=fs.readFileSync(path.join(repoRoot,relativeRule),'utf8')
    const insert=/insert into public\.legal_requirement_rules\(([^)]+)\)\s*values([\s\S]*?)\non conflict[^;]+;/i.exec(body)
    if(!insert) throw new Error('Exact legal requirement reference seed missing')
    const residue=insert[2].replace(/'(?:[^']|'')*'/g,"''").replace(/''|[\s(),\[\]]|\b(?:array|true|false|null)\b|\b\d+\b/gi,'')
    if(residue || !/^[a-z_,]+$/.test(insert[1])) throw new Error('Nonliteral legal requirement seed refused')
    // Keep repository conflict behavior: later program definitions supersede earlier ones.
    rules.push(insert[0])
    ruleProvenance.push({source:relativeRule,source_sha256:crypto.createHash('sha256').update(body).digest('hex'),statement_sha256:crypto.createHash('sha256').update(insert[0]).digest('hex'),target:'public.legal_requirement_rules'})
    if(relativeRule.includes('20260716140000')) {
      const extension=/update public\.legal_requirement_rules r\s+set required_module_keys=\([\s\S]*?where r\.status='active';/i.exec(body)
      if(!extension) throw new Error('Exact legal requirement extension missing')
      rules.push(extension[0])
      ruleProvenance.push({source:relativeRule,source_sha256:crypto.createHash('sha256').update(body).digest('hex'),statement_sha256:crypto.createHash('sha256').update(extension[0]).digest('hex'),target:'public.legal_requirement_rules',kind:'exact_program_rule_extension'})
    }
  }
  return {provenance:[provenance,...ruleProvenance],sql:`BEGIN;\nDO $elklart_reference_target$ BEGIN IF current_setting('elklart.runtime_project',true) IS DISTINCT FROM 'elklart-ops-demo' THEN RAISE EXCEPTION 'dedicated_elklart_runtime_required'; END IF; END $elklart_reference_target$;\n-- Source ${relative}; SHA256 ${sourceHash}\n${statement}\n${rules.join('\n')}\nCOMMIT;\n`}

}
function installLegalMasterReference(repoRoot) {
  const result=buildLegalMasterReferenceSql(repoRoot)
  const docker=args=>execFileSync('docker',['--host','unix:///var/run/docker.sock',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']})
  assertOpsContainer(JSON.parse(docker(['inspect',opsContainer]))[0])
  const target=assertPrivatePath(path.join(runtimeRoot,'ops/legal-reference-catalog.sql'))
  fs.writeFileSync(target,result.sql,{mode:0o600});fs.chmodSync(target,0o600)
  savePrivate(path.join(runtimeRoot,'ops/legal-reference-catalog.provenance.json'),result.provenance)
  execFileSync('docker',['--host','unix:///var/run/docker.sock','exec','-i',opsContainer,'psql','-U','postgres','-d','postgres','-XAt','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input:result.sql,stdio:['pipe','pipe','pipe']})
}
export function assertLocalAdapterUrl(value) {
  if(!value) throw new Error('Controlled loopback EDIEL adapter URL is required')
  const parsed=new URL(value)
  if(!['http:','https:'].includes(parsed.protocol) || !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('Controlled loopback EDIEL adapter required')
  return parsed.href
}
export async function prepareFictionalEdielViaUi(client,tenant,endpoint,options={routes:true,email:false}) {
  if(options.routes) endpoint=endpoint ? assertLocalAdapterUrl(endpoint) : null
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
  const context=await browser.newContext({ignoreHTTPSErrors:true})
  const page=await context.newPage()
  const notes='FÖRBERETT FIKTIVT DEMOLÄGE. Endast lokal adapter; ingen verklig marknadscertifiering eller LIVE-behörighet.'
  const metadata={demo:true,fictional:true,runtime_project:'elklart-ops-demo',prepared_state:true,source:'ordinary_next_server_actions',marketCertification:false}
  try {
    const accounts=readPrivate(path.join(runtimeRoot,'ops/accounts.json'))
    await page.goto(`https://localhost:3000/login?next=${encodeURIComponent('/admin/companies/'+tenant.companyId)}`,{waitUntil:'domcontentloaded',timeout:90000})
    await page.locator('input[name="email"]').fill(accounts.platform.email)
    await page.locator('input[name="password"]').fill(accounts.platform.password)
    await Promise.all([page.waitForURL(url=>!url.pathname.startsWith('/login'),{timeout:60000}),page.locator('form').filter({has:page.locator('input[name="password"]')}).locator('button[type="submit"],button:not([type])').first().click()])
    await context.addCookies([{name:'gridex_admin_selected_company_id',value:tenant.companyId,url:'https://localhost:3000',secure:true,httpOnly:true,sameSite:'Lax'}])
    if(options.brp!==false) {
    await page.goto(`https://localhost:3000/admin/companies/${tenant.companyId}`,{waitUntil:'domcontentloaded',timeout:90000})
    try {await page.locator('#brp form').waitFor({state:'attached',timeout:30000})} catch { savePrivate(path.join(runtimeRoot,'ops/ui-setup-diagnostic.json'),{url:page.url(),title:await page.title(),bodyPreview:(await page.locator('body').innerText()).slice(0,1600)});throw new Error('Ordinary company BRP form unavailable; private UI diagnostic saved')}
    const brp=page.locator('#brp form')
    await brp.locator('[name="environment"]').selectOption('production')
    await brp.locator('[name="brp_ediel_id"]').fill('ELKLARTDEMOBRP')
    await brp.locator('[name="brp_name"]').fill('Elklart Demo BRP (fiktiv, endast lokal adapter)')
    await brp.locator('[name="brp_email"]').fill('ediel@elklart.example.invalid')
    await brp.locator('[name="contact_person"]').fill('Elklart Demo fiktiv kontakt')
    await brp.locator('[name="is_default"]').check()
    await Promise.all([page.waitForURL(url=>url.searchParams.has('success')||url.searchParams.has('error'),{timeout:60000}),brp.locator('button').click()])
    if(new URL(page.url()).searchParams.has('error')) throw new Error('Ordinary BRP action rejected: '+new URL(page.url()).searchParams.get('error'))
    const brpAnnotation=await client.from('ediel_brp_settings').update({metadata}).eq('company_id',tenant.companyId).eq('brp_ediel_id','ELKLARTDEMOBRP').eq('environment','production')
    if(brpAnnotation.error) throw new Error('BRP prepared provenance write failed')
    }
    if(options.email) {
      await page.goto(`https://localhost:3000/admin/companies/${tenant.companyId}`,{waitUntil:'domcontentloaded',timeout:90000})
      const emailForm=page.locator('form').filter({has:page.locator('[name="sender_name"]')})
      for(const [name,value] of Object.entries({sender_name:'Elklart Demo',sender_email:'support@elklart.example.invalid',reply_to_email:'support@elklart.example.invalid',support_email:'support@elklart.example.invalid',domain:'elklart.example.invalid'})) await emailForm.locator(`[name="${name}"]`).fill(value)
      await Promise.all([page.waitForURL(url=>url.searchParams.has('success')||url.searchParams.has('error'),{timeout:60000}),emailForm.locator('button').click()])
      if(new URL(page.url()).searchParams.has('error')) throw new Error('Ordinary sender save rejected: '+new URL(page.url()).searchParams.get('error'))
      for(const label of ['Starta verifiering','Kontrollera DNS','Skapa standardmallar']) {
        await page.goto(`https://localhost:3000/admin/companies/${tenant.companyId}`,{waitUntil:'domcontentloaded',timeout:90000})
        await Promise.all([page.waitForURL(url=>url.searchParams.has('success')||url.searchParams.has('error'),{timeout:60000}),page.getByRole('button',{name:label,exact:true}).click()])
        if(new URL(page.url()).searchParams.has('error')) throw new Error('Ordinary sender verification rejected: '+new URL(page.url()).searchParams.get('error'))
      }
      const sender=await client.from('company_email_settings').select('verification_status,domain,sender_email').eq('company_id',tenant.companyId).single()
      if(sender.error || sender.data?.verification_status!=='verified') throw new Error('Local simulated provider verification not confirmed')
      savePrivate(path.join(runtimeRoot,'ops/sender-prepared.json'),{source:'ordinary_sender_settings_start_check_actions',fictional:true,providerGateway:'https://localhost:38481',simulatedDns:true,realDomainCertification:false,scenarioExecution:false,result:sender.data})
    }
    if(!options.routes) return {brpPrepared:true,senderPrepared:options.email}
    await page.goto('https://localhost:3000/admin/ediel/routes/legacy',{waitUntil:'domcontentloaded',timeout:90000})
    const bootstrap=page.locator('form').filter({has:page.locator('[name="route_name"]')}).filter({has:page.getByText('Skapa första Ediel-route',{exact:true})})
    const actionReceipt=path.join(runtimeRoot,'ops/ediel-bootstrap-action.json')
    const actionSourceHash=crypto.createHash('sha256').update(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../app/admin/ediel/routes/actions.ts'))).digest('hex')
    let actionField=null
    if(await bootstrap.count()>0) {actionField=await bootstrap.locator('input[type="hidden"][name^="$ACTION_ID_"]').getAttribute('name');savePrivate(actionReceipt,{actionField,actionSourceHash})}
    else if(fs.existsSync(actionReceipt)) {const saved=readPrivate(actionReceipt);if(saved.actionSourceHash===actionSourceHash) actionField=saved.actionField}

    const outcomes=[]
    let actionTransport=null
    for(const family of ['PRODAT','UTILTS']) {
      const existing=await client.from('ediel_route_profiles').select('id').eq('company_id',tenant.companyId).eq('environment','production').eq('message_family',family).maybeSingle()
      if(existing.error) throw new Error('Demo route lookup failed')
      if(existing.data) {outcomes.push({family,profileId:existing.data.id,reused:true});continue}
      const communication=await client.from('communication_routes').select('id').eq('company_id',tenant.companyId).eq('route_name',`Elklart Demo ${family} lokal adapter`).maybeSingle()
      if(communication.error) throw new Error('Demo communication route lookup failed')
      let selectedAction=actionField
      if(communication.data) {
        const profileForm=page.locator('form').filter({has:page.locator(`input[name="communicationRouteId"][value="${communication.data.id}"]`)})
        selectedAction=await profileForm.locator('input[type="hidden"][name^="$ACTION_ID_"]').getAttribute('name')
      }
      if(!selectedAction) throw new Error('Ordinary route configuration action unavailable; no fallback direct state write')
      const fields={ [selectedAction]:'',...(communication.data ? {communicationRouteId:communication.data.id,isEnabled:'true',notes} : {}),route_name:`Elklart Demo ${family} lokal adapter`,route_scope:family==='PRODAT'?'supplier_switch':'meter_values',environment:'production',environmentType:'production',target_system:'elklart_local_smtp',...(endpoint ? {endpoint} : {}),target_email:'network-owner@elklart.example.invalid',route_notes:notes,profile_notes:notes,messageFamily:family,senderEdielId:'ELKLARTDEMO',senderName:'Elklart Demo fiktiv',senderSubAddress:'ELKLARTDEMO',receiverEdielId:'ELKLARTDEMONET',receiverName:'Elklart Demo nätägare fiktiv',receiverSubAddress:'ELKLARTDEMONET',applicationReference:family,defaultMessageVersion:'D96A',defaultTestFlag:'1',defaultTimezone:'1',ackMode:'contrl_and_aperak',messageStandard:'edifact',payloadFormat:'edifact',transportSecurityMode:'required_encrypted',certificateRequired:'true',smtpHost:'127.0.0.1',smtpPort:process.env.ELKLART_EDIEL_SMTP_PORT ?? '',mailbox:'ediel@elklart.example.invalid'}
      let response
      if(!actionTransport && await bootstrap.count()>0 && !communication.data) {
        await page.waitForFunction(form=>Object.keys(form).some(key=>key.startsWith('__reactProps$')),await bootstrap.elementHandle(),{timeout:60000})
        const observed=page.waitForRequest(request=>request.method()==='POST' && request.url().includes('/admin/ediel/routes/legacy'),{timeout:60000})
        await bootstrap.evaluate((form,values)=>{
          for(const [name,value] of Object.entries(values)) {
            if(name.startsWith('$ACTION_')) continue
            let input=form.elements.namedItem(name)
            if(!input) {input=document.createElement('input');input.type='hidden';input.name=name;form.appendChild(input)}
            input.value=value
          }
          form.requestSubmit()
        },fields)
        const request=await observed
        response=await request.response()
        const headers=await request.allHeaders()
        const decoded=await new Request(request.url(),{method:'POST',headers:{'content-type':headers['content-type']},body:request.postDataBuffer()}).formData()
        const template=Object.fromEntries([...decoded.entries()].filter(([,value])=>typeof value==='string'))
        const fieldName=Object.keys(template).find(name=>name.endsWith('_route_name'))
        savePrivate(path.join(runtimeRoot,'ops/ediel-ui-transport-diagnostic.json'),{fieldNames:Object.keys(template),hasNextAction:Boolean(headers['next-action']),contentType:headers['content-type']})
        if(headers['next-action'] && fieldName) {actionTransport={actionId:headers['next-action'],prefix:fieldName.slice(0,-'route_name'.length),template};savePrivate(path.join(runtimeRoot,'ops/ediel-observed-action.json'),{...actionTransport,actionSourceHash})}
      } else {
        if(!actionTransport) {
          const observed=page.waitForRequest(request=>request.method()==='POST' && request.url().includes('/admin/ediel/routes/legacy'),{timeout:60000})
          await page.evaluate(values=>{const form=document.createElement('form');form.method='POST';form.enctype='multipart/form-data';form.action='/admin/ediel/routes/legacy';for(const [name,value] of Object.entries(values)){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.appendChild(input)}document.body.appendChild(form);form.submit()},fields)
          response=await (await observed).response()
        } else {
        const multipart={...actionTransport.template}
        for(const [name,value] of Object.entries(fields)) if(!name.startsWith('$ACTION_')) multipart[actionTransport.prefix+name]=value
        response=await page.request.post('https://localhost:3000/admin/ediel/routes/legacy',{multipart,headers:{'Next-Action':actionTransport.actionId,Accept:'text/x-component',Origin:'https://localhost:3000',Referer:'https://localhost:3000/admin/ediel/routes/legacy'},timeout:90000})
      }
        }
      if(!response || !response.ok()) throw new Error(`Ordinary ${family} route action HTTP ${response?.status() ?? 'missing'}`)

      const check=await client.from('ediel_route_profiles').select('id,communication_route_id').eq('company_id',tenant.companyId).eq('environment','production').eq('message_family',family).single()
      if(check.error||!check.data) throw new Error(`Ordinary ${family} route action did not create scoped profile`)
      for(const [table,id] of [['ediel_route_profiles',check.data.id],['communication_routes',check.data.communication_route_id]]) {
        const annotation=await client.from(table).update({metadata}).eq('company_id',tenant.companyId).eq('id',id)
        if(annotation.error) throw new Error('Route prepared provenance write failed')
      }
      outcomes.push({family,profileId:check.data.id,communicationRouteId:check.data.communication_route_id,reused:false})
    }
    savePrivate(path.join(runtimeRoot,'ops/ediel-prepared.json'),{source:'ordinary_next_server_actions',fictional:true,scenarioExecution:false,endpoint,marketCertification:false,outcomes})
    return outcomes
  } finally {await browser.close()}
}
async function main() {
  if(process.argv.includes('--reference-catalog-only')) { writeReferenceCatalogFiles(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));console.log('Repository reference catalog SQL and hashes written privately; no database requests performed.');return }
  const root=fs.statSync(runtimeRoot)
  if(root.uid!==process.getuid() || (root.mode&0o777)!==0o700) throw new Error('Private owned runtime required')
  const status=readPrivate(path.join(runtimeRoot,'ops/status.json')),tenant=readPrivate(path.join(runtimeRoot,'ops/tenant.json'))
  assertLocalFixtureTarget(status,tenant)
  const client=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
  const company=await client.from('companies').select('id,slug').eq('id',tenant.companyId).single()
  if(company.error || company.data?.slug!=='elklart-demo') throw new Error('Fictional canonical Elklart tenant required')
  if(process.argv.includes('--routes-only-ui')) {await prepareFictionalEdielViaUi(client,tenant,null,{routes:true,email:false,brp:false});console.log('Ordinary fictional route actions completed; certification and dispatch remain separately gated.');return}
  if(process.argv.includes('--brp-email-ui')) {await prepareFictionalEdielViaUi(client,tenant,null,{routes:false,email:true});console.log('Ordinary BRP and local simulated sender verification actions completed.');return}
  if(process.argv.includes('--ediel-ui')) {await prepareFictionalEdielViaUi(client,tenant,process.env.ELKLART_EDIEL_ADAPTER_URL);console.log('Fictional EDIEL config submitted through ordinary authenticated actions; no market certification claimed.');return}
  const integrationPath=path.join(runtimeRoot,'ops/integration.json')
  // Preserve a one-time credential immediately, even if later catalogue readiness fails.
  await provisionWebsiteClient(client,tenant,fs.existsSync(integrationPath)?readPrivate(integrationPath):null,data=>savePrivate(integrationPath,data))
  await prepareFictionalActor(client,tenant)
  installLegalMasterReference(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'))
  const previousFixturePath=path.join(runtimeRoot,'ops/fixtures.json')
  const fixtureTenant={...tenant,fixtureOfferId:fs.existsSync(previousFixturePath)?readPrivate(previousFixturePath).offerId:null}
  const offerId=await prepareCatalogue(client,fixtureTenant,data=>savePrivate(path.join(runtimeRoot,'ops/fixtures.json'),data))
  savePrivate(path.join(runtimeRoot,'ops/fixtures.json'),{offerId,source:'canonical_prepared_catalogue',fictional:true,scenarioExecution:false,annaCreatedByFixture:false})
  console.log('Prepared fictional catalogue published. The fixture builder did not create Anna. Scenario execution and webhook readiness require separate verification.')
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1})
