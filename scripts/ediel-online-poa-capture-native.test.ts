// Native synthetic local tenants only; actual execution is required for proof.
// Existing publication fixture supplies a real graph; the target is a NEW
// unsigned contract with NULL commercial dates, its own V2 consent and PDF.
// No claimed browser/customer authentication, provider delivery or activation.
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {PDFDocument} from 'pdf-lib'
import {spawn} from 'node:child_process'
import {createClient,type SupabaseClient} from '@supabase/supabase-js'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {archiveOnlineSignaturePoa} from '@/lib/customer-contracts/onlineSigning'
import {poaMailEvidenceFingerprint} from '@/lib/email/poaMailEvidence'
import {futureNativeSupplyDate,literal,nativeSql as sql,seedNormalSwitchNativeFixture,type NormalSwitchStageNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'
import {installPoaContractTriggerProfile} from './helpers/ediel-poa-contract-trigger-profile.native'
import {resolvePricingConfiguration} from '@/lib/pricing/priceSourceResolver'
import {calculatePriceComponents} from '@/lib/pricing/priceComponentCalculator'
import type {BillingUnderlayInput} from '@/lib/pricing/types'

type Pending={contractId:string;requestId:string;tokenHash:string}
type Receipt={company_id:string;customer_id:string;contract_id:string;request_id:string;signed_at:string;signature_snapshot_sha256:string;power_of_attorney_id:string;already_signed:boolean}
let f:NormalSwitchStageNativeFixture
let overlay:ReturnType<typeof installPoaContractTriggerProfile>|undefined
let own:SupabaseClient,foreign:SupabaseClient
const anon=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
const digest=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex')
const effectTables=['customer_contracts','customer_contract_signature_requests','contract_price_snapshots','customer_legal_acceptances','customer_contract_acceptances','customer_contract_evidence','powers_of_attorney','power_of_attorney_scopes','customer_authorization_documents','authorization_scopes','customer_operation_jobs','customer_operation_events','customer_contract_events']
function effects(ignoreArchiveRetryTimestamp=false){return sql<Record<string,string>>(`SELECT jsonb_build_object(${effectTables.map(t=>`${literal(t)},(SELECT encode(extensions.digest(convert_to(coalesce(jsonb_agg(${ignoreArchiveRetryTimestamp&&t==='powers_of_attorney'?"to_jsonb(r)-'updated_at'":'to_jsonb(r)'} ORDER BY r.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') FROM public.${t} r WHERE company_id=${literal(f.companyId)})`).join(',')})`)}
function guard(){overlay!.assertInstalled()}
beforeAll(async()=>{
 overlay=installPoaContractTriggerProfile()
 // The base's V1/manual-POA data is NEVER substituted for target V2 evidence.
 f=await seedNormalSwitchNativeFixture({deferOriginal:true,requestedStartDate:futureNativeSupplyDate()})
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key FROM public.permissions p
 WHERE key IN ('contracts.create','pricing.write') AND NOT EXISTS(SELECT FROM public.user_permissions u
 WHERE u.user_id=${literal(f.actorUserId)} AND u.company_id=${literal(f.companyId)} AND (u.permission_id=p.id OR u.permission_key=p.key));`)
 const otherCompany=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(otherCompany)},'Synthetic foreign POA native','active');`)
 own=(await createCustomerRecordRetentionNativeUser(f.companyId,['customers.read','customers.write','contracts.read','contracts.write','operations.read'])).client
 foreign=(await createCustomerRecordRetentionNativeUser(otherCompany,['customers.read','contracts.read','operations.read'])).client
 guard()
},180000)
afterAll(()=>{overlay?.restore()},120000)
async function pending():Promise<Pending>{
 guard();const contractId=randomUUID()
 // Reuse only the actual immutable published graph. No acceptance, signature,
 // price SHA, source receipt, POA, active period or market original is copied.
 sql(`INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
 contract_offer_id,status,contract_version,requested_start_date,starts_at,ends_at,metadata,created_by,
 contract_publication_version_id,contract_product_id,contract_product_version_id,price_plan_id,
 price_plan_version_id,price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
 SELECT ${literal(contractId)},c.company_id,c.customer_id,c.site_id,c.metering_point_id,c.contract_offer_id,
 'draft','v1',${literal(f.requestedStartDate)}::date,NULL,NULL,
 '{"test_center":{"kind":"invoice_test_customer"},"test":"SYNTHETIC V2 POA NATIVE"}',${literal(f.actorUserId)},
 v.id,p.contract_product_id,v.contract_product_version_id,v.price_plan_id,v.price_plan_version_id,
 v.price_book_id,v.legal_bundle_version_id,v.offer_reference,p.commercial_snapshot,l.rendered_snapshot
 FROM public.customer_contracts c JOIN public.contract_publication_versions v ON v.id=c.contract_publication_version_id
 JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
 JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
 WHERE c.company_id=${literal(f.companyId)} AND c.id=${literal(f.contractId)} AND v.status='published'
 AND v.locked_at IS NOT NULL AND p.power_of_attorney_required=true
 AND EXISTS(SELECT FROM public.legal_bundle_version_documents d WHERE d.legal_bundle_version_id=l.id AND d.module_key='power_of_attorney');`)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_contracts WHERE company_id=${literal(f.companyId)} AND id=${literal(contractId)} AND starts_at IS NULL AND ends_at IS NULL AND signed_at IS NULL AND locked_at IS NULL AND status='draft'`)).toBe(1)
 return requestFor(contractId)
}
async function requestFor(contractId:string):Promise<Pending>{
 const tokenHash=randomBytes(32).toString('hex')
 const result=await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1',{
 p_company_id:f.companyId,p_customer_id:f.customerId,p_contract_id:contractId,p_token_hash:tokenHash,
 p_recipient_email:`synthetic-${f.customerId}@example.invalid`,p_expires_at:new Date(Date.now()+3600000).toISOString(),
 p_actor_user_id:f.actorUserId,p_channel:'internal'})
 expect(result.error?.code??null).toBeNull()
 const r=result.data as {ok:boolean;request_id:string};expect(r.ok).toBe(true)
 expect(typeof r.request_id==='string'&&/^[a-f0-9-]{36}$/.test(r.request_id)).toBe(true)
 return {contractId,requestId:r.request_id,tokenHash}
}
const params=(p:Pending,extra:Record<string,unknown>={})=>({p_token_hash:p.tokenHash,
 p_signed_ip_hash:digest('SYNTHETIC LOCAL LOOPBACK ONLY'),p_signed_user_agent:'SYNTHETIC local V2 native; no customer browser proof',
 p_signer_ip:'127.0.0.1',p_poa_accepted:true,p_poa_scopes:['supplier_switch','facility_information_lookup'],p_poa_terms_version:'ops_online_poa_v1',...extra})
// Six real authored fees and four explicit areas: the certificate is deliberately
// absent from the customer-card scalar fields. It must survive both authoring
// and the later preferred signing aliases unchanged.
const revisionComponents=[
 {component_code:'monthly_fee',component_type:'fee',name:'Månadsavgift',amount:49,unit:'sek_month',calculation_type:'per_month',priority:100},
 {component_code:'invoice_fee',component_type:'invoice_fee',name:'Fakturaavgift',amount:19,unit:'sek_invoice',calculation_type:'per_invoice',priority:110},
 {component_code:'spot_markup',component_type:'spot_markup',name:'Påslag',amount:1,unit:'ore_per_kwh',calculation_type:'per_kwh',priority:130},
 {component_code:'variable_fee',component_type:'variable_fee',name:'Rörlig avgift',amount:8,unit:'ore_per_kwh',calculation_type:'per_kwh',priority:140},
 {component_code:'green_energy_fee',component_type:'green_energy_fee',name:'Grönt el-tillägg',amount:4,unit:'ore_per_kwh',calculation_type:'per_kwh',priority:150},
 {component_code:'electricity_certificate',component_type:'elcertificate_fee',name:'Elcertifikat',amount:1.7,unit:'ore_per_kwh',calculation_type:'per_kwh',priority:160},
].map(c=>({...c,vat_applicable:true,invoice_line_visible:true,website_card_visible:false,calculation_inclusion:'included',
 metadata:{component_key:c.component_code,visibility:{invoice:true,website_card:false},untouched_marker:'SYNTHETIC_NATIVE_EXACT'}}))
const revisionBases=['SE1','SE2','SE3','SE4'].map(price_area=>({source_type:'spot',label:'Spot',weight_percent:100,price_area}))
async function revisionPending():Promise<Pending>{
 guard();const id=randomUUID()
 const snapshot={schema:'gridex_contract_pricing_v5',pricing_model:'spot',contract_type:'variable_monthly',energy_direction:'consumption',
  interval_resolution:'hourly',vat_rate:0.25,price_areas:['SE1','SE2','SE3','SE4'],price_area:'SE3',
  base_components:revisionBases,base_price_components_snapshot:revisionBases,
  price_components:revisionComponents,price_components_snapshot:revisionComponents}
 const authored=await supabaseService.rpc('gridex_prepare_manual_contract_binding',{
  p_company_id:f.companyId,p_actor_user_id:f.actorUserId,p_pricing_snapshot:snapshot,
  p_payload:{intended_contract_id:id,name:'Synthetic unsigned fee revision',contract_type:'variable_monthly',customer_type:'both',
   pricing_model:'spot',energy_direction:'consumption',spot_markup_ore_per_kwh:1,variable_fee_ore_per_kwh:8,
   monthly_fee_sek:49,invoice_fee_sek:19,green_fee_mode:'ore_per_kwh',green_fee_value:4,vat_rate:0.25,
   default_notice_months:1,power_of_attorney_mode:'always_required',valid_from:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm'}).format(new Date())},
 })
 expect(authored.error).toBeNull();const b=authored.data as Record<string,unknown>
 const created=await supabaseService.from('customer_contracts').insert({id,company_id:f.companyId,customer_id:f.customerId,
  site_id:f.siteId,customer_site_id:f.siteId,metering_point_id:f.pointId,status:'draft',source_type:'manual_override',
  contract_name:'Synthetic unsigned fee revision',contract_type:'variable_monthly',energy_direction:'consumption',
  spot_markup_ore_per_kwh:1,variable_fee_ore_per_kwh:8,monthly_fee_sek:49,invoice_fee_sek:19,
  green_fee_mode:'ore_per_kwh',green_fee_value:4,vat_rate:0.25,notice_months:1,starts_at:null,ends_at:null,
  price_snapshot:snapshot,contract_offer_id:b.contract_offer_id,contract_product_id:b.contract_product_id,
  contract_product_version_id:b.contract_product_version_id,contract_publication_version_id:b.contract_publication_version_id,
  price_plan_id:b.price_plan_id,price_plan_version_id:b.price_plan_version_id,price_book_id:b.price_book_id,
  legal_bundle_version_id:b.legal_bundle_version_id,offer_reference:b.offer_reference,commercial_snapshot:b.commercial_snapshot,
  legal_snapshot:b.legal_snapshot,created_by:f.actorUserId,updated_by:f.actorUserId,
  metadata:{test_center:{kind:'invoice_test_customer'},test:'SYNTHETIC native unsigned fee revision only'}})
 expect(created.error).toBeNull();return requestFor(id)
}
function editArgs(p:Pending,patch:Record<string,unknown>,extra:Record<string,unknown>={}){
 const updated=sql<string>(`SELECT to_jsonb(updated_at::text) FROM public.customer_contracts WHERE id=${literal(p.contractId)} AND company_id=${literal(f.companyId)}`)
 return {p_company_id:f.companyId,p_customer_id:f.customerId,p_contract_id:p.contractId,p_actor_user_id:f.actorUserId,
  p_edit_id:randomUUID(),p_expected_updated_at:updated,p_patch:patch,p_acknowledge_current_terms:true,...extra}
}
function revisionGraph(p:Pending){return sql<{contract:Record<string,unknown>;ledger:Record<string,unknown>}>(`SELECT jsonb_build_object('contract',to_jsonb(c),'ledger',to_jsonb(s))
 FROM public.customer_contracts c JOIN public.contract_price_snapshots s ON s.id=c.contract_price_snapshot_id AND s.company_id=c.company_id AND s.contract_id=c.id
 WHERE c.id=${literal(p.contractId)} AND c.company_id=${literal(f.companyId)} AND c.customer_id=${literal(f.customerId)}`)}
function authoredState(){
 const tables=['contract_offers','contract_products','price_plans','price_plan_versions','price_books','legal_bundle_versions','canonical_command_results','audit_logs']
 return sql<unknown>(`SELECT jsonb_build_object(${tables.map(t=>`${literal(t)},(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.${t} r WHERE company_id=${literal(f.companyId)})`).join(',')},
 'revision_origins',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.snapshot_id),'[]') FROM gridex_unsigned_contract_revision.price_revisions r WHERE r.company_id=${literal(f.companyId)}),
 'products',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]') FROM public.contract_product_versions v JOIN public.contract_products p ON p.id=v.contract_product_id WHERE p.company_id=${literal(f.companyId)}),
 'publications',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]') FROM public.contract_publication_versions v JOIN public.contract_product_versions c ON c.id=v.contract_product_version_id JOIN public.contract_products p ON p.id=c.contract_product_id WHERE p.company_id=${literal(f.companyId)}))`)
}
async function signed(p:Pending){const r=await supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p));expect(r.error?.code??null).toBeNull();const receipt=r.data as Receipt;expect(receipt).toMatchObject({company_id:f.companyId,customer_id:f.customerId,contract_id:p.contractId,request_id:p.requestId,already_signed:false});return receipt}
function original(p:Pending){return sql<{poa:Record<string,unknown>;signature:Record<string,unknown>;signedAt:string;usedAt:string;startsAt:null;endsAt:null;price:string;job:Record<string,unknown>}>(`SELECT jsonb_build_object('poa',to_jsonb(p),'signature',c.signature_snapshot,
 'signedAt',c.signed_at,'usedAt',r.used_at,'startsAt',c.starts_at,'endsAt',c.ends_at,'price',s.snapshot_hash,
 'job',(SELECT to_jsonb(j) FROM public.customer_operation_jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.customer_id AND j.idempotency_key='contract-signed:'||c.id::text AND j.job_type='start_supplier_switch'))
 FROM public.customer_contracts c JOIN public.powers_of_attorney p ON p.customer_contract_id=c.id AND p.company_id=c.company_id
 JOIN public.customer_contract_signature_requests r ON r.customer_contract_id=c.id AND r.id=${literal(p.requestId)}
 JOIN public.contract_price_snapshots s ON s.id=c.contract_price_snapshot_id AND s.contract_id=c.id AND s.company_id=c.company_id
 WHERE c.company_id=${literal(f.companyId)} AND c.id=${literal(p.contractId)} AND p.source='ops_online_signature'`)}

it('captures exact NULL-start contract/customer/tenant/site/legal/price/IP/verifier and one real acceptance clock; gates its operation until private archive',async()=>{
 const p=await pending();await signed(p);const v=original(p),poa=v.poa
 expect(v.startsAt).toBeNull();expect(v.endsAt).toBeNull();expect(v.usedAt).toBe(v.signedAt)
 expect(poa).toMatchObject({company_id:f.companyId,customer_id:f.customerId,customer_site_id:f.siteId,site_id:f.siteId,
 customer_contract_id:p.contractId,source:'ops_online_signature',status:'signed',accepted_ip:'127.0.0.1',accepted_at:v.signedAt,signed_at:v.signedAt,
 signed_scope_snapshot:['supplier_switch','facility_information_lookup']})
 expect(poa.evidence_payload).toMatchObject({capture_source:'actual_signing_request',signature_request_id:p.requestId,ip_address:'127.0.0.1',verification_reference:expect.any(String)})
 expect(v.job).toMatchObject({status:'blocked',review_reason_code:'poa_archive_pending',payload:expect.objectContaining({contract_id:p.contractId,online_poa_id:poa.id,signature_request_id:p.requestId})})
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_authorization_documents WHERE company_id=${literal(f.companyId)} AND power_of_attorney_id=${literal(poa.id)}`)).toBe(0)
 expect(v.signature).toMatchObject({pricing_snapshot_sha256:v.price,accepted_at:v.signedAt,signature_request_id:p.requestId,
 power_of_attorney_snapshot:expect.objectContaining({power_of_attorney_id:poa.id})})
 const snapshotBefore=effects();const replay=await supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p,{p_signer_ip:'127.0.0.2',p_poa_scopes:['supplier_switch']}))
 expect(replay.error?.code??null).toBeNull();expect((replay.data as Receipt).already_signed).toBe(true);expect(effects()).toEqual(snapshotBefore)
})

it('edits an unsigned six-fee/four-area agreement through real authoring, revokes old consent links and freezes exactly the new fees for signing and billing',async()=>{
 const p=await revisionPending(),before=revisionGraph(p),oldLedgerId=String(before.ledger.id)
 const oldCatalog=sql<unknown>(`SELECT jsonb_build_object('offer',to_jsonb(o),'ppv',to_jsonb(v),'publication',to_jsonb(pub),'legal',to_jsonb(l))
 FROM public.contract_offers o JOIN public.price_plan_versions v ON v.id=o.price_plan_version_id
 JOIN public.contract_publication_versions pub ON pub.id=${literal(before.contract.contract_publication_version_id)}
 JOIN public.legal_bundle_versions l ON l.id=pub.legal_bundle_version_id WHERE o.id=${literal(before.contract.contract_offer_id)}`)
 const args=editArgs(p,{invoice_fee_sek:25.5,variable_fee_ore_per_kwh:9,override_reason:'SYNTHETIC complete revised proposal; current tenant terms acknowledged'})
 const saved=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',args)
 expect(saved.error).toBeNull();expect(saved.data).toMatchObject({ok:true,contract_id:p.contractId,pricing_revised:true,links_revoked:1})
 const edited=revisionGraph(p),snapshot=edited.ledger.snapshot_json as Record<string,unknown>
 expect(edited.contract).toMatchObject({status:'pending_signature',signed_at:null,locked_at:null,source_type:'manual_override',invoice_fee_sek:25.5,variable_fee_ore_per_kwh:9,starts_at:null,ends_at:null})
 expect(edited.contract.price_snapshot).toEqual(snapshot);expect(edited.contract.snapshot_hash).toBe(edited.ledger.snapshot_hash)
 const expected=(before.ledger.price_components_snapshot as Array<Record<string,unknown>>).map(c=>c.component_code==='invoice_fee'?{...c,amount:25.5}:c.component_code==='variable_fee'?{...c,amount:9}:c)
 expect(edited.ledger.price_components_snapshot).toEqual(expected);expect(snapshot.price_components).toEqual(expected);expect(snapshot.price_components_snapshot).toEqual(expected)
 expect(edited.ledger.base_price_components_snapshot).toEqual(before.ledger.base_price_components_snapshot)
 expect(snapshot.base_components).toEqual(before.ledger.base_price_components_snapshot);expect(snapshot.base_price_components_snapshot).toEqual(before.ledger.base_price_components_snapshot)
 expect(snapshot).toMatchObject({contract_product_version_id:edited.contract.contract_product_version_id,contract_publication_version_id:edited.contract.contract_publication_version_id,legal_bundle_version_id:edited.contract.legal_bundle_version_id,price_plan_version_id:edited.contract.price_plan_version_id})
 expect(sql<unknown>(`SELECT to_jsonb(s) FROM public.contract_price_snapshots s WHERE id=${literal(oldLedgerId)}`)).toEqual(before.ledger)
 expect(sql<unknown>(`SELECT jsonb_build_object('offer',to_jsonb(o),'ppv',to_jsonb(v),'publication',to_jsonb(pub),'legal',to_jsonb(l))
 FROM public.contract_offers o JOIN public.price_plan_versions v ON v.id=o.price_plan_version_id JOIN public.contract_publication_versions pub ON pub.id=${literal(before.contract.contract_publication_version_id)}
 JOIN public.legal_bundle_versions l ON l.id=pub.legal_bundle_version_id WHERE o.id=${literal(before.contract.contract_offer_id)}`)).toEqual(oldCatalog)
 const afterSave=effects(),replay=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',args)
 expect(replay.error).toBeNull();expect(replay.data).toEqual(saved.data);expect(effects()).toEqual(afterSave)
 const conflict=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',{...args,p_patch:{...args.p_patch,invoice_fee_sek:26}})
 expect(conflict.error?.message).toContain('unsigned_contract_edit_idempotency_conflict');expect(effects()).toEqual(afterSave)
 const refused=await supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p))
 expect(refused.error?.message).toContain('signature_link_revoked');expect(effects()).toEqual(afterSave)
 const current=await requestFor(p.contractId);await signed(current);const frozen=revisionGraph(p)
 expect(frozen.ledger.price_components_snapshot).toEqual(expected)
 const underlay:BillingUnderlayInput={companyId:f.companyId,customerId:f.customerId,customerSiteId:f.siteId,meteringPointId:f.pointId,
  contractId:p.contractId,priceArea:'SE3',quantityKwh:1000,periodStart:futureNativeSupplyDate(35),periodEnd:futureNativeSupplyDate(65),invoiceCreated:true,
  pricingSnapshot:frozen.ledger.snapshot_json as Record<string,unknown>}
 const config=await resolvePricingConfiguration({companyId:f.companyId,underlay,contract:frozen.contract})
 expect(config.priceComponents).toHaveLength(6);expect(config.baseComponents).toHaveLength(1)
 const calculated=calculatePriceComponents({underlay,components:config.priceComponents,baseAmountExVat:500,vatRate:config.vatRate})
 expect(calculated.errors).toEqual([]);expect(calculated.lines).toHaveLength(6)
 const amounts=Object.fromEntries(calculated.lines.map(l=>[String(l.metadata?.component_code),l.amountExVat]))
 expect(amounts).toEqual({monthly_fee:49,invoice_fee:25.5,spot_markup:10,variable_fee:90,green_energy_fee:40,electricity_certificate:17})
 expect(calculated.lines.reduce((sum,l)=>sum+l.amountExVat,0)).toBe(231.5)
 const finalState=effects(),signedEdit=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',editArgs(current,{invoice_fee_sek:1,override_reason:'Old browser after actual signature'}))
 expect(signedEdit.error?.message).toContain('unsigned_contract_edit_signed_or_locked');expect(effects()).toEqual(finalState)
},120000)

it('holds stale, cross-tenant and non-service unsigned edits without changing the actual graph',async()=>{
 const p=await revisionPending(),args=editArgs(p,{invoice_fee_sek:25,override_reason:'SYNTHETIC scoped proposal'}),before=effects()
 for(const client of [anon,own,foreign]){const refused=await client.rpc('gridex_edit_unsigned_customer_contract_v1',args);expect(refused.error).not.toBeNull()}
 const stale=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',{...args,p_expected_updated_at:'2020-01-01T00:00:00.000001+00:00'})
 expect(stale.error?.message).toContain('unsigned_contract_edit_stale')
 const other=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',{...args,p_customer_id:randomUUID()})
 expect(other.error?.message).toContain('unsigned_contract_edit_contract_not_found');expect(effects()).toEqual(before)
},120000)

it('preserves real same-day immutable revisions through a second edit and uses the actual derived contract end date',async()=>{
 const p=await revisionPending(),original=revisionGraph(p),start=String(new Date().getUTCFullYear()+1)+'-01-01'
 const first=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',editArgs(p,{invoice_fee_sek:25,override_reason:'SYNTHETIC first proposal'}))
 expect(first.error).toBeNull()
 const firstLedger=revisionGraph(p).ledger
 const second=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',editArgs(p,{invoice_fee_sek:26,starts_at:start,ends_at:null,binding_months:12,override_reason:'SYNTHETIC second complete dated proposal'}))
 expect(second.error).toBeNull();const current=revisionGraph(p),end=String(Number(start.slice(0,4))+1)+'-01-01'
 expect(current.contract.ends_at).toBe(end);expect(current.ledger.valid_to).toBe(end)
 expect((current.ledger.snapshot_json as Record<string,unknown>).ends_at).toBe(end)
 expect(sql<unknown>(`SELECT to_jsonb(s) FROM public.contract_price_snapshots s WHERE id=${literal(original.ledger.id)}`)).toEqual(original.ledger)
 expect(sql<unknown>(`SELECT to_jsonb(s) FROM public.contract_price_snapshots s WHERE id=${literal(firstLedger.id)}`)).toEqual(firstLedger)
 const link=await requestFor(p.contractId);await signed(link)
 expect(revisionGraph(p).contract).toMatchObject({status:'signed',invoice_fee_sek:26,starts_at:start,ends_at:end})
 const frozen=effects(),forged=await supabaseService.from('contract_price_snapshots').insert({company_id:f.companyId,customer_id:f.customerId,
  contract_id:p.contractId,price_plan_version_id:current.contract.price_plan_version_id,source:'customer_contract_unsigned_edit',
  snapshot_json:current.ledger.snapshot_json,snapshot_hash:current.ledger.snapshot_hash,valid_from:current.ledger.valid_from})
 expect(forged.error?.message).toContain('unsigned_contract_price_revision_origin_required');expect(effects()).toEqual(frozen)
},120000)

it('rolls back actual authored versions, ledger, request revocation and durable receipt when the real audit path refuses',async()=>{
 const p=await revisionPending(),args=editArgs(p,{invoice_fee_sek:25,override_reason:'SYNTHETIC transaction rollback'}),suffix=randomUUID().replaceAll('-',''),name='native_unsigned_audit_'+suffix
 const before=effects(),versionsBefore=authoredState()
 // One temporary guard on this disposable native tenant only. No production
 // object, retained protected body, RLS policy or original trigger is replaced.
 sql(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
  IF NEW.company_id=${literal(f.companyId)}::uuid AND NEW.customer_contract_id=${literal(p.contractId)}::uuid THEN RAISE EXCEPTION 'SYNTHETIC_NATIVE_UNSIGNED_AUDIT_FAILURE';END IF;RETURN NEW;END$$;
  CREATE TRIGGER ${name} BEFORE INSERT ON public.customer_contract_events FOR EACH ROW EXECUTE FUNCTION public.${name}();`)
 try{
  const result=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',args)
  expect(result.error?.message).toContain('SYNTHETIC_NATIVE_UNSIGNED_AUDIT_FAILURE')
  expect(effects()).toEqual(before);expect(authoredState()).toEqual(versionsBefore)
 }finally{sql(`DROP TRIGGER ${name} ON public.customer_contract_events;DROP FUNCTION public.${name}();`)}
},120000)

function nativeLockSession(){
 const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1','-f','-'],{stdio:['pipe','pipe','pipe']})
 let output='',errors='';child.stdout.on('data',b=>{output+=b.toString()});child.stderr.on('data',b=>{errors+=b.toString()})
 const done=new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)})
 const ready=async()=>{const end=Date.now()+5000;while(!output.includes('UNSIGNED_LOCK_READY')){if(Date.now()>end||child.exitCode!==null)throw Error('native_unsigned_lock_not_observed:'+errors);await new Promise(r=>setTimeout(r,20))}}
 return {child,done,ready}
}
it('rechecks the actual signed winner after waiting on the contract, without a new advisory-lock deadlock',async()=>{
 const p=await revisionPending(),args=editArgs(p,{invoice_fee_sek:25,override_reason:'SYNTHETIC waiting edit'}),lock=nativeLockSession()
 let response:PromiseLike<unknown>|undefined
 lock.child.stdin.write(`BEGIN;SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';
 SELECT id FROM public.customer_contracts WHERE id=${literal(p.contractId)} AND company_id=${literal(f.companyId)} FOR UPDATE;SELECT 'UNSIGNED_LOCK_READY';\n`)
 try{
  await lock.ready();const attempt=Promise.resolve(supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',args));response=attempt
  const end=Date.now()+5000
  while(!sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%gridex_edit_unsigned_customer_contract_v1%'))`)){
   if(Date.now()>end)throw Error('native_unsigned_contract_wait_not_observed');await new Promise(r=>setTimeout(r,20))
  }
  // Genuine local V2 finalization, explicit synthetic consent/IP only. This is
  // not a status-field edit or evidence copied from another contract.
  lock.child.stdin.end(`SELECT public.gridex_finalize_customer_contract_signature_v2(${literal(p.tokenHash)},${literal(digest('SYNTHETIC native race'))},'SYNTHETIC native concurrency','127.0.0.1',true,ARRAY['supplier_switch','facility_information_lookup'],'ops_online_poa_v1');COMMIT;\n`)
  expect(await lock.done).toBe(0);const result=await attempt
  expect(result.error?.message).toContain('unsigned_contract_edit_signed_or_locked')
  expect(revisionGraph(p).contract).toMatchObject({status:'signed',invoice_fee_sek:19})
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.canonical_command_results WHERE company_id=${literal(f.companyId)} AND command_type='customer_contract.unsigned.edit.v1' AND idempotency_key=${literal(p.contractId+':'+args.p_edit_id)}`)).toBe(0)
 }finally{
  try{if(lock.child.exitCode===null){lock.child.stdin.end('ROLLBACK;\n');await lock.done}}
  finally{if(response)await Promise.allSettled([response])}
 }
},120000)

it('refuses a busy direct-event advisory key immediately and leaves the contract and ledger unchanged',async()=>{
 const p=await revisionPending(),args=editArgs(p,{invoice_fee_sek:25,override_reason:'SYNTHETIC event contention'}),before=effects(),lock=nativeLockSession()
 lock.child.stdin.write(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended(${literal(f.companyId+':'+p.contractId)},0));SELECT 'UNSIGNED_LOCK_READY';\n`)
 try{
  await lock.ready();const result=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',args)
  expect(result.error?.code).toBe('40001');expect(result.error?.message).toContain('unsigned_contract_edit_concurrent_event');expect(effects()).toEqual(before)
 }finally{if(lock.child.exitCode===null){lock.child.stdin.end('ROLLBACK;\n');expect(await lock.done).toBe(0)}}
},120000)

it('refuses an already-locked customer before an archival lock-order cycle can form',async()=>{
 const p=await revisionPending(),args=editArgs(p,{invoice_fee_sek:25,override_reason:'SYNTHETIC customer archive contention'}),before=effects(),lock=nativeLockSession()
 lock.child.stdin.write(`BEGIN;SELECT id FROM public.customers WHERE id=${literal(f.customerId)} AND company_id=${literal(f.companyId)} FOR UPDATE;SELECT 'UNSIGNED_LOCK_READY';\n`)
 try{
  await lock.ready();const result=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',args)
  expect(result.error?.code).toBe('40001');expect(result.error?.message).toContain('unsigned_contract_edit_customer_busy');expect(effects()).toEqual(before)
 }finally{if(lock.child.exitCode===null){lock.child.stdin.end('ROLLBACK;\n');expect(await lock.done).toBe(0)}}
},120000)

it.each([
 ['missing consent',{p_poa_accepted:false,p_poa_scopes:[]},'poa_explicit_consent_required'],
 ['missing IP',{p_signer_ip:null},'poa_signer_ip_required'],
 ['bad scopes',{p_poa_scopes:['supplier_switch','terminate_any_contract']},'poa_explicit_scopes_invalid'],
 ['wrong terms version',{p_poa_terms_version:'not-current'},'poa_explicit_scopes_invalid'],
] as const)('rejects %s with zero tenant effects',async(_name,change,code)=>{
 const p=await pending(),before=effects();const r=await supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p,change));expect(r.error?.message).toContain(code);expect(effects()).toEqual(before)
})

it('rejects anon/authenticated JWT finalization even with the exact bearer hash',async()=>{
 const p=await pending(),before=effects()
 for(const client of [anon,own,foreign]){const r=await client.rpc('gridex_finalize_customer_contract_signature_v2',params(p));expect(r.error).not.toBeNull()}
 expect(effects()).toEqual(before)
})

it('uploads genuine private PDF, verifies exact bytes/hash and document-bound scopes, releases only matching archive hold, and recovers idempotently',async()=>{
 const p=await pending(),receipt=await signed(p),before=original(p),poaId=String(before.poa.id)
 const immutableBefore={poa:{...before.poa,metadata:undefined,updated_at:undefined,document_path:undefined,document_hash:undefined,document_id:undefined},signature:before.signature,signedAt:before.signedAt,price:before.price}
 const attachment=await archiveOnlineSignaturePoa(receipt)
 expect(attachment?.contentType).toBe('application/pdf');expect(attachment).not.toBeNull()
 const bytes=Buffer.from(attachment!.content,'base64');expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.byteLength).toBeGreaterThan(128)
 const after=original(p),archive=(after.poa.metadata as {document_archive:{path:string;storage_bucket:string;sha256:string;evidence_sha256:string}}).document_archive
 expect(archive.storage_bucket).toBe('customer-documents');expect(archive.path).toContain(`companies/${f.companyId}/customers/${f.customerId}/powers-of-attorney/${poaId}/`)
 expect(archive.sha256).toBe(digest(bytes));expect(archive.evidence_sha256).toBe(poaMailEvidenceFingerprint(after.poa))
 const downloaded=await supabaseService.storage.from('customer-documents').download(archive.path);expect(downloaded.error).toBeNull();expect(digest(Buffer.from(await downloaded.data!.arrayBuffer()))).toBe(archive.sha256)
 const bucket=sql<{public:boolean}>(`SELECT jsonb_build_object('public',public) FROM storage.buckets WHERE id='customer-documents'`);expect(bucket.public).toBe(false)
 const document=sql<{id:string;company:string;customer:string;sha:string;scopes:string[]}>(`SELECT jsonb_build_object('id',d.id,'company',d.company_id,'customer',d.customer_id,'sha',d.file_checksum,'scopes',s.signed_scope_snapshot)
 FROM public.customer_authorization_documents d JOIN public.authorization_scopes s ON s.authorization_document_id=d.id AND s.company_id=d.company_id AND s.customer_id=d.customer_id
 WHERE d.power_of_attorney_id=${literal(poaId)} AND d.company_id=${literal(f.companyId)} AND d.customer_contract_id=${literal(p.contractId)} AND d.status='active'`)
 expect(document).toMatchObject({id:expect.any(String),company:f.companyId,customer:f.customerId,sha:archive.sha256,scopes:['supplier_switch','facility_information_lookup']})
 expect(after.job).toMatchObject({status:'queued',review_reason_code:null})
 expect({poa:{...after.poa,metadata:undefined,updated_at:undefined,document_path:undefined,document_hash:undefined,document_id:undefined},signature:after.signature,signedAt:after.signedAt,price:after.price}).toEqual(immutableBefore)
 const ownDocs=await own.from('customer_authorization_documents').select('id').eq('id',document.id);expect(ownDocs.error).toBeNull();expect(ownDocs.data).toHaveLength(1)
 const otherDocs=await foreign.from('customer_authorization_documents').select('id').eq('id',document.id);expect(otherDocs.error).toBeNull();expect(otherDocs.data).toHaveLength(0)
 for(const client of [anon,foreign]){const denied=await client.storage.from('customer-documents').download(archive.path);expect(denied.error).not.toBeNull()}
 // Archive completion legitimately refreshes the POA retry timestamp, but
 // cannot create new consent, documents, scopes or jobs or change originals.
 const stateBeforeReplay=effects(true);const second=await archiveOnlineSignaturePoa(receipt);expect(second?.content).toBe(attachment?.content);expect(effects(true)).toEqual(stateBeforeReplay)
})

it('fences an actual old-runtime service claim before delivery and advances only a new owned confirmation lease',async()=>{
 const p=await pending();await signed(p)
 let oldDeliveryCallbacks=0
 const oldClaim=await supabaseService.from('customer_contract_confirmation_deliveries')
  .update({next_attempt_at:new Date(Date.now()+600000).toISOString()})
  .eq('company_id',f.companyId).eq('signature_request_id',p.requestId)
  .eq('state','pending').lte('next_attempt_at',new Date().toISOString()).select('attempts')
 if(!oldClaim.error&&oldClaim.data?.length)oldDeliveryCallbacks++
 expect(oldClaim.error?.message).toContain('confirmation_v2_runtime_required');expect(oldDeliveryCallbacks).toBe(0)
 const args={p_company_id:f.companyId,p_contract_id:p.contractId,p_request_id:p.requestId,p_action:'claim'}
 for(const client of [anon,own,foreign]){
  const denied=await client.rpc('gridex_advance_contract_confirmation_v2',args);expect(denied.error).not.toBeNull()
 }
 const wrong=await supabaseService.rpc('gridex_advance_contract_confirmation_v2',{...args,p_company_id:randomUUID()})
 expect(wrong.error?.message).toContain('confirmation_binding_invalid')
 const competing=await Promise.all([supabaseService.rpc('gridex_advance_contract_confirmation_v2',args),supabaseService.rpc('gridex_advance_contract_confirmation_v2',args)])
 // Preserve each actual PostgREST error in a failed original; a boolean
 // discarded the SQL cause of the tenant-key regression.
 expect(competing.map(r=>r.error)).toEqual([null,null])
 expect(competing.filter(r=>(r.data as {claimed:boolean}).claimed)).toHaveLength(1)
 const claim=competing.find(r=>(r.data as {claimed:boolean}).claimed)!.data as {claimed:boolean;state:string;attempts:number;lease_until:string}
 expect(claim).toMatchObject({claimed:true,state:'pending',attempts:0});expect(typeof claim.lease_until).toBe('string')
 const duplicate=await supabaseService.rpc('gridex_advance_contract_confirmation_v2',args)
 expect(duplicate.error).toBeNull();expect(duplicate.data).toMatchObject({claimed:false,state:'pending',attempts:0})
 const stale=await supabaseService.rpc('gridex_advance_contract_confirmation_v2',{...args,p_action:'failed',p_expected_lease_until:'2000-01-01T00:00:00.123456Z',p_error:'SYNTHETIC stale owner'})
 expect(stale.error).toBeNull();expect(stale.data).toMatchObject({advanced:false,state:'pending',attempts:0})
 const failed=await supabaseService.rpc('gridex_advance_contract_confirmation_v2',{...args,p_action:'failed',p_expected_lease_until:claim.lease_until,p_error:'SYNTHETIC owned failure; no provider call'})
 expect(failed.error).toBeNull();expect(failed.data).toMatchObject({advanced:true,state:'pending',attempts:1})
 const oldFailure=await supabaseService.from('customer_contract_confirmation_deliveries').update({attempts:99})
  .eq('company_id',f.companyId).eq('signature_request_id',p.requestId)
 expect(oldFailure.error?.message).toContain('confirmation_v2_runtime_required')
 const row=sql<{attempts:number;seconds:number}>(`SELECT jsonb_build_object('attempts',attempts,'seconds',extract(epoch FROM next_attempt_at-updated_at)) FROM public.customer_contract_confirmation_deliveries WHERE signature_request_id=${literal(p.requestId)} AND company_id=${literal(f.companyId)}`)
 expect(row).toEqual({attempts:1,seconds:300})
})

it('refuses archive receipt customer/tenant substitution before any storage or job effect',async()=>{
 const p=await pending(),receipt=await signed(p),before=effects()
 await expect(archiveOnlineSignaturePoa({...receipt,customer_id:randomUUID()})).rejects.toThrow()
 await expect(archiveOnlineSignaturePoa({...receipt,company_id:randomUUID()})).rejects.toThrow()
 expect(effects()).toEqual(before)
})

it('preserves the original POA provenance against service relabels and authenticated normalized reserved-source inserts',async()=>{
 const p=await pending();await signed(p);const v=original(p),poaId=String(v.poa.id),before=effects()
 const relabel=await supabaseService.from('powers_of_attorney').update({source:'manual_pdf'}).eq('id',poaId).eq('company_id',f.companyId)
 expect(relabel.error?.message).toContain('poa_online_original_capture_immutable')
 for(const source of ['ops_online_signature',' OPS_ONLINE_SIGNATURE ','\u00a0ops_online_signature\ufeff']){
  // The canonical generated-reference default is service-only. Supply a
  // valid synthetic reference so this JWT actually reaches the POA guard;
  // retain its exact rejection and the zero-effects assertion below.
  const inserted=await own.from('powers_of_attorney').insert({company_id:f.companyId,customer_id:f.customerId,site_id:f.siteId,source,scope:'supplier_switch',status:'draft',reference:'SYNTHETIC-'+randomUUID(),power_of_attorney_reference:'poa_'+randomUUID().replaceAll('-','')})
  expect(inserted.error?.message).toContain('poa_online_capture_service_role_required')
 }
 expect(effects()).toEqual(before)
})

it('rechecks expiry after actual blocked-row lock acquisition, never committing a late acceptance',async()=>{
 const p=await pending();guard()
 // A genuine competing native SQL session holds the customer row after V2's
 // first expiry check; observe V2 actually waiting before crossing the deadline.
 const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1','-f','-'],{stdio:['pipe','pipe','pipe']})
 let output='';child.stdout.on('data',b=>{output+=b.toString()})
 const done=new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)})
 let response:PromiseLike<unknown>|undefined
 const waitUntil=async(check:()=>boolean,ms=5000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('native_lock_observation_timeout');await new Promise(r=>setTimeout(r,20))}}
 child.stdin.write(`BEGIN;SELECT id FROM public.customers WHERE id=${literal(f.customerId)} AND company_id=${literal(f.companyId)} FOR UPDATE;SELECT 'POA_LOCK_READY';\n`)
 try{
  await waitUntil(()=>output.includes('POA_LOCK_READY'))
  const expiry=sql<string>(`UPDATE public.customer_contract_signature_requests SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=${literal(p.requestId)} AND company_id=${literal(f.companyId)} RETURNING to_jsonb(expires_at)`)
  const before=effects();const invocation=supabaseService.rpc('gridex_finalize_customer_contract_signature_v2',params(p))
  // Force the PostgREST thenable to start now while the independent lock holds.
  const invocationResponse=Promise.resolve(invocation);response=invocationResponse
  await waitUntil(()=>sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%gridex_finalize_customer_contract_signature_v2%'))`))
  expect(Date.now()).toBeLessThan(Date.parse(expiry))
  await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(expiry)-Date.now()+50)))
  child.stdin.end('COMMIT;\n');expect(await done).toBe(0)
  const result=await invocationResponse;expect(result.error?.message).toContain('signature_link_expired');expect(effects()).toEqual(before)
 }finally{
  try{if(child.exitCode===null){child.stdin.end('COMMIT;\n');await done}}
  finally{if(response)await Promise.allSettled([response])}
 }
})

// Real local Storage + full native DB profile. Synthetic fixture PDF only;
// this never proves a real customer's signature, IP, utility reply or LIVE.
async function importedNativeFixturePdf(contractId:string){
 guard()
 const pdf=await PDFDocument.create();pdf.addPage().drawText('SYNTHETIC LOCAL NATIVE FIXTURE - not a real customer signature')
 const bytes=Buffer.from(await pdf.save()),checksum=digest(bytes),path=`${f.customerId}/native-signed-import/${randomUUID()}.pdf`
 const upload=await supabaseService.storage.from('customer-documents').upload(path,bytes,{contentType:'application/pdf',upsert:false})
 expect(upload.error).toBeNull()
 const result=await supabaseService.from('customer_authorization_documents').insert({
  company_id:f.companyId,customer_id:f.customerId,site_id:f.siteId,metering_point_id:f.pointId,
  customer_contract_id:contractId,document_type:'complete_agreement',status:'active',
  title:'SYNTHETIC local native imported fixture',file_name:'synthetic-local-fixture.pdf',mime_type:'application/pdf',file_size_bytes:bytes.length,
  storage_bucket:'customer-documents',file_path:path,file_checksum:checksum,created_by:f.actorUserId,
  uploaded_at:new Date().toISOString(),metadata:{source:'customer_intake',documentRole:'signed_agreement',channel:'synthetic_local_native_only'},
 }).select('id').single()
 expect(result.error).toBeNull();expect(result.data?.id).toBeTruthy()
 return {documentId:result.data!.id,checksum,path}
}

it('imports a local fixture PDF against the exact existing canonical price receipt without appending or changing its fees',async()=>{
 const p=await revisionPending(),before=revisionGraph(p)
 const rows=sql<unknown>(`SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.contract_price_snapshots s WHERE s.company_id=${literal(f.companyId)} AND s.contract_id=${literal(p.contractId)}`)
 const imported=await importedNativeFixturePdf(p.contractId),after=revisionGraph(p)
 expect(after.contract).toMatchObject({status:'signed',document_sha256:imported.checksum,contract_price_snapshot_id:before.ledger.id})
 expect(after.ledger).toEqual(before.ledger)
 expect(sql<unknown>(`SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.contract_price_snapshots s WHERE s.company_id=${literal(f.companyId)} AND s.contract_id=${literal(p.contractId)}`)).toEqual(rows)
 expect(after.contract.signature_snapshot).toMatchObject({signing_method:'imported_signed_document',source_authorization_document_id:imported.documentId,pricing_snapshot_sha256:before.ledger.snapshot_hash})
})

it('imports an actually edited unsigned agreement against its privately authorized current receipt and preserves historical prices',async()=>{
 const p=await revisionPending(),old=revisionGraph(p)
 const saved=await supabaseService.rpc('gridex_edit_unsigned_customer_contract_v1',editArgs(p,{invoice_fee_sek:25.5,override_reason:'SYNTHETIC local revised PDF import'}))
 expect(saved.error).toBeNull()
 const revised=revisionGraph(p);expect(revised.ledger.source).toBe('customer_contract_unsigned_edit')
 const imported=await importedNativeFixturePdf(p.contractId),after=revisionGraph(p)
 expect(after.contract).toMatchObject({status:'signed',invoice_fee_sek:25.5,document_sha256:imported.checksum,contract_price_snapshot_id:revised.ledger.id})
 expect(after.ledger).toEqual(revised.ledger)
 expect(sql<unknown>(`SELECT to_jsonb(s) FROM public.contract_price_snapshots s WHERE id=${literal(String(old.ledger.id))}`)).toEqual(old.ledger)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.contract_price_snapshots WHERE company_id=${literal(f.companyId)} AND contract_id=${literal(p.contractId)}`)).toBe(2)
})

it('creates the first canonical receipt for an unsigned manual PDF contract through the real materializer and full import profile',async()=>{
 guard();const contractId=randomUUID()
 const created=await supabaseService.from('customer_contracts').insert({id:contractId,company_id:f.companyId,customer_id:f.customerId,
  site_id:f.siteId,customer_site_id:f.siteId,metering_point_id:f.pointId,status:'draft',source_type:'manual_override',
  contract_name:'SYNTHETIC simple manual PDF intake',contract_type:'variable_monthly',energy_direction:'consumption',
  spot_markup_ore_per_kwh:1,variable_fee_ore_per_kwh:8,monthly_fee_sek:49,invoice_fee_sek:19,vat_rate:0.25,
  starts_at:null,ends_at:null,signed_at:null,price_area_used:'SE3',created_by:f.actorUserId,updated_by:f.actorUserId,
  price_snapshot:{spotMarkupOrePerKwh:1,variableFeeOrePerKwh:8,monthlyFeeSek:49,invoiceFeeSek:19,vatRate:0.25,optionalFeeLines:[]},
  metadata:{test_center:{kind:'invoice_test_customer'},test:'SYNTHETIC native manual PDF only'},
 })
 expect(created.error).toBeNull()
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.contract_price_snapshots WHERE contract_id=${literal(contractId)}`)).toBe(0)
 const imported=await importedNativeFixturePdf(contractId)
 const after=revisionGraph({contractId,requestId:'not-used',tokenHash:'not-used'})
 expect(after.contract).toMatchObject({status:'signed',signed_at:expect.any(String),invoice_fee_sek:19,document_sha256:imported.checksum})
 expect(after.ledger).toMatchObject({snapshot_quality:'canonical',source:'admin_signed_document_import',invoice_delivery_method:null})
 const components=after.ledger.price_components_snapshot as Array<Record<string,unknown>>
 expect(components.some(c=>['invoice_fee','invoice_administration_fee'].includes(String(c.component_code??c.componentCode))&&Number(c.amount)===19)).toBe(true)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.contract_price_snapshots WHERE contract_id=${literal(contractId)}`)).toBe(1)
})
