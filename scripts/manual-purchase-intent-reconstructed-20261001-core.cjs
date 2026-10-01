const fs=require('node:fs')
const path=require('node:path')
const {createHash}=require('node:crypto')
const {PGlite}=require('@electric-sql/pglite')
const root=path.resolve(__dirname,'..')
const schema=fs.readFileSync(path.join(root,'supabase/schema.sql'),'utf8')
const migrationPath=path.join(root,'supabase/migrations/20261001094830_manual_purchase_intent_reconstructed.sql')
const ids={company:'11111111-1111-4111-8111-111111111111',actor:'33333333-3333-4333-8333-333333333333',session:'44444444-4444-4444-8444-444444444444',item:'55555555-5555-4555-8555-555555555555',invoice:'66666666-6666-4666-8666-666666666666',run:'77777777-7777-4777-8777-777777777777',customer:'88888888-8888-4888-8888-888888888888',contract:'99999999-9999-4999-8999-999999999999',price:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',underlay:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',connection:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',role:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',permission:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}
function actualTable(name){
 const match=schema.match(new RegExp('CREATE TABLE public\\.'+name+' \\([\\s\\S]*?\\n\\);'))
 if(!match)throw Error('canonical_table_missing:'+name)
 return match[0]
}
async function createFixture(){
 const db=new PGlite()
 await db.exec(`create schema private;create schema extensions;create role service_role bypassrls;create role anon;create role authenticated;
 create function extensions.digest(bytea,text)returns bytea language sql immutable as $$select sha256($1)$$;
 create table public.companies(id uuid primary key,is_active boolean,status text,outbound_frozen boolean,outbound_frozen_channels text[]);
 create table public.customers(id uuid primary key,company_id uuid,archived_at timestamptz,status text);
 create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,status text);
 create table public.user_profiles(id uuid primary key,user_status text);
 create table public.company_memberships(id uuid primary key default gen_random_uuid(),company_id uuid,user_id uuid,is_active boolean,status text);
 create table public.roles(id uuid primary key,is_active boolean,key text);
 create table public.user_roles(id uuid primary key default gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,is_active boolean,status text);
 create table public.permissions(id uuid primary key,key text);
 create table public.role_permissions(id uuid primary key default gen_random_uuid(),role_id uuid,permission_id uuid,effect text);
 create table private.business_actor(user_id uuid,session_id uuid,valid_until timestamptz,active boolean,platform boolean);
 create function private.gridex_profile_session_active_v1(p_user uuid,p_session uuid)returns boolean language sql volatile as $$select exists(select 1 from private.business_actor where user_id=p_user and session_id=p_session and active and valid_until>clock_timestamp())$$;
 create function private.gridex_profile_authority_lock_v1(p_user uuid,p_company uuid)returns void language sql volatile as $$select pg_advisory_xact_lock(47)$$;
 create function public.canonical_actor_is_platform_admin(p_user uuid)returns boolean language sql stable as $$select exists(select 1 from private.business_actor where user_id=p_user and platform and active)$$;`)
 for(const table of ['invoice_export_items','invoice_export_runs','customer_invoices','customer_invoice_lines','customer_invoice_documents','billing_underlays','pricing_runs','billing_provider_connections','invoice_purchase_events','domain_events','platform_table_classification'])await db.exec(actualTable(table))
 await db.exec(`alter table public.invoice_export_items add primary key(id);alter table public.customer_invoices add primary key(id);
 alter table public.invoice_purchase_events add primary key(id);alter table public.domain_events add primary key(id);
 create unique index invoice_export_items_company_id_id_uidx on public.invoice_export_items(company_id,id);
 create unique index customer_invoices_company_export_item_uidx on public.customer_invoices(company_id,invoice_export_item_id);
 alter table public.platform_table_classification add primary key(table_name);
 grant usage on schema public,private,extensions to service_role;grant all on all tables in schema public,private to service_role;grant execute on all functions in schema public,private,extensions to service_role;`)
 const review={invoice_export_item_id:ids.item,billing_underlay_id:ids.underlay,pricing_run_id:ids.price,
  calculation_snapshot_sha256:'b'.repeat(64),total_kwh:1,total_inc_vat:125,price_area:'SE3'}
 const reviewHash=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(review).sort(([a],[b])=>a.localeCompare(b))))).digest('hex')
 const approval=JSON.stringify({approval:{status:'approved',review_hash:reviewHash,calculation_snapshot_sha256:'b'.repeat(64)}})
 await db.query('insert into public.companies values($1,true,\'active\',false,\'{}\')',[ids.company])
 await db.query('insert into public.customers values($1,$2,null,\'active\')',[ids.customer,ids.company])
 await db.query('insert into public.customer_contracts values($1,$2,$3,\'active\')',[ids.contract,ids.company,ids.customer])
 await db.query('insert into public.user_profiles values($1,\'active\')',[ids.actor])
 await db.query('insert into public.company_memberships(company_id,user_id,is_active,status)values($1,$2,true,\'active\')',[ids.company,ids.actor])
 await db.query('insert into public.roles values($1,true,\'operations_manager\')',[ids.role])
 await db.query('insert into public.user_roles(user_id,company_id,role_id,is_active,status)values($1,$2,$3,true,\'active\')',[ids.actor,ids.company,ids.role])
 await db.query('insert into public.permissions values($1,\'billing.write\')',[ids.permission])
 await db.query('insert into public.role_permissions(role_id,permission_id,effect)values($1,$2,\'allow\')',[ids.role,ids.permission])
 await db.query('insert into private.business_actor values($1,$2,clock_timestamp()+interval\'1 hour\',true,false)',[ids.actor,ids.session])
 await db.query(`insert into public.invoice_export_runs(id,company_id,billing_month,status,financing_mode)values($1,$2,'2026-09','sent','invoice_service')`,[ids.run,ids.company])
 await db.query(`insert into public.billing_underlays(id,company_id,customer_id,customer_contract_id,contract_id,underlay_year,underlay_month,status,readiness_status,missing_values_count,total_kwh,price_area)values($1,$2,$3,$4,$4,2026,9,'validated','ready',0,1,'SE3')`,[ids.underlay,ids.company,ids.customer,ids.contract])
 await db.query(`insert into public.pricing_runs(id,company_id,customer_id,billing_underlay_id,status,locked_at,total_ex_vat,vat_amount,total_inc_vat)values($1,$2,$3,$4,'locked',clock_timestamp(),100,25,125)`,[ids.price,ids.company,ids.customer,ids.underlay])
 await db.query(`insert into public.invoice_export_items(id,company_id,export_run_id,customer_id,customer_contract_id,billing_underlay_id,pricing_run_id,status,financing_mode,provider_invoice_guid,provider_invoice_id,provider_request_id,provider_idempotency_key,idempotency_key,request_payload,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,metadata,sent_at,provider_confirmed_at)values($1,$2,$3,$4,$5,$6,$7,'sent','invoice_service','original-guid','original-guid','original-key','original-key','original-key','{"originalFinancialPayload":true}',100,25,125,1,$8,clock_timestamp(),clock_timestamp())`,[ids.item,ids.company,ids.run,ids.customer,ids.contract,ids.underlay,ids.price,approval])
 await db.query(`insert into public.customer_invoices(id,company_id,customer_id,customer_contract_id,contract_id,invoice_export_item_id,invoice_reference,status,issued_at,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,price_area_code,calculation_snapshot_sha256,metadata,partner_invoice_reference)values($1,$2,$3,$4,$4,$5,'synthetic-invoice-reference','sent',clock_timestamp(),100,25,125,1,'SE3',$6,$7,'original-guid')`,[ids.invoice,ids.company,ids.customer,ids.contract,ids.item,'b'.repeat(64),approval])
 await db.query(`insert into public.billing_provider_connections(id,company_id,provider,status)values($1,$2,'capway_aptic','ready')`,[ids.connection,ids.company])
 await db.query(`insert into public.customer_invoice_lines(company_id,invoice_id,customer_id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat)values($1,$2,$3,'Synthetic original energy',1,100,100,25,125)`,[ids.company,ids.invoice,ids.customer])
 await db.query(`insert into public.customer_invoice_documents(company_id,invoice_id,customer_id,storage_bucket,file_path,file_name,mime_type,metadata)values($1,$2,$3,'synthetic-private','synthetic/original.pdf','original.pdf','application/pdf','{"fixture_reference_sha256":"original-reference-only"}')`,[ids.company,ids.invoice,ids.customer])
 const extra=(name,value)=>({name,value:[value]})
 const capture={externalReferenceCode:ids.price,invoiceDate:'2026-09-01T00:00:00.000Z',
  extraFields:[extra('gridex_company_id',ids.company),extra('gridex_pricing_run_id',ids.price),extra('gridex_financing_mode','invoice_service')],
  customer:{extraFields:[extra('gridex_customer_id',ids.customer)]},debts:[{invoiceDate:'2026-09-01T00:00:00.000Z',dueDate:'2026-09-21T00:00:00.000Z',
   originalPrincipal:100,originalVat:25,rounding:0,currencyCode:'SEK',extraFields:[extra('gridex_billing_underlay_id',ids.underlay)]}]}
 await db.query('update public.invoice_export_items set request_payload=$1',[JSON.stringify(capture)])
 const migration=fs.readFileSync(migrationPath,'utf8');if(migration.trim())await db.exec(migration)
 await db.exec('set role service_role')
 const item=(await db.query('select to_jsonb(i)as item from public.invoice_export_items i')).rows[0].item
 const keys=['id','company_id','export_run_id','customer_id','customer_contract_id','billing_underlay_id','pricing_run_id','provider','environment','financing_mode','provider_invoice_guid','provider_invoice_id','provider_request_id','provider_idempotency_key','idempotency_key','request_payload','amount_ex_vat','vat_amount','amount_inc_vat','rounding_amount','total_kwh','currency','period_start','period_end','sent_at','provider_confirmed_at']
 const connection={id:ids.connection,company_id:ids.company,provider:'capway_aptic',environment:'test',status:'ready',settings:{},secret_reference:{}}
 const command={companyId:ids.company,itemId:ids.item,actorUserId:ids.actor,sessionId:ids.session,financingMode:'factoring_without_recourse',payload:{approved:true,purchaseFeePercentage:null,purchaseFeeAmount:null,purchaseFeeCurrency:null,recourseDays:null,depositAmount:null,note:'original note'},itemBinding:Object.fromEntries(keys.map(k=>[k,item[k]??null])),connectionJson:JSON.stringify(connection)}
 const claim=async(changes={})=>(await db.query('select public.gridex_claim_manual_invoice_purchase_v1($1::jsonb)as result',[JSON.stringify({...command,...changes})])).rows[0].result
 const finish=async(receipt,changes={})=>(await db.query('select public.gridex_complete_manual_invoice_purchase_v1($1::jsonb)as result',[JSON.stringify({...command,intentId:receipt.intentId,requestHash:receipt.requestHash,snapshotHash:receipt.snapshotHash,outcome:'response_observed',observation:{accepted:true},...changes})])).rows[0].result
 const rows=async(table)=>(await db.query('select to_jsonb(t)as row from '+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.row)
 const snapshot=async()=>Object.fromEntries(await Promise.all(['invoice_export_items','customer_invoices','customer_invoice_lines','customer_invoice_documents','invoice_purchase_events','domain_events','companies','customers','customer_contracts','pricing_runs','billing_underlays'].map(async t=>[t,await rows('public.'+t)])))
 return{db,ids,command,claim,finish,rows,snapshot}
}
module.exports={createFixture,migrationPath,actualTable}
