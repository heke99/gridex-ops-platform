import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Executes actual forward SQL in PostgreSQL WASM. Table columns come from the
// repository schema; external signing/event/job ports below are bounded fixtures.
// Not hosted RLS, native pgcrypto, worker, browser or production qualification.
let db: PGlite
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const token = 'a'.repeat(64)
const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
const tables = ['customer_contracts','customer_contract_signature_requests','customers','companies',
  'contract_price_snapshots','contract_publication_versions','contract_publications','tenant_contract_assignments',
  'contract_product_versions','price_plan_versions','legal_bundle_versions','legal_bundle_version_documents',
  'customer_legal_acceptances','customer_contract_acceptances','customer_contract_evidence','powers_of_attorney',
  'power_of_attorney_scopes','authorization_scopes','customer_authorization_documents','customer_operation_jobs','customer_sites',
  'customer_contract_confirmation_deliveries']

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema auth; create schema extensions; create schema storage;
    create table storage.buckets(id text,public boolean); create table storage.objects(bucket_id text,name text);
    create role anon; create role authenticated; create role service_role;
    create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create function public.gridex_new_public_resource_reference(text) returns text language sql as $$select $1||gen_random_uuid()::text$$;`)
  for (const name of tables) {
    const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))![0]
    const columns = ddl.split('\n').slice(1,-1).filter(line => /^    [a-z_][a-z0-9_]* /.test(line)).map(line => {
      let column = line.trim().replace(/,$/,'').replace(/ NOT NULL/g,'')
      if (column.includes(' GENERATED ALWAYS AS')) column = column.slice(0,column.indexOf(' GENERATED ALWAYS AS'))
      if (/DEFAULT public\./.test(column)) column = column.slice(0,column.indexOf(' DEFAULT'))
      if (column.startsWith('id uuid')) column = 'id uuid default gen_random_uuid()'
      return column
    })
    await db.exec(`create table public.${name} (${columns.join(',')})`)
  }
  await db.exec(`create unique index acceptance_dedupe on customer_contract_acceptances(customer_contract_id,acceptance_sha256);
    create unique index confirmation_request_dedupe on customer_contract_confirmation_deliveries(signature_request_id);
    create unique index evidence_dedupe on customer_contract_evidence(customer_contract_id,evidence_type,evidence_sha256);
    create unique index poa_scopes_dedupe on power_of_attorney_scopes(company_id,power_of_attorney_id,scope_type);
    create function public.ediel_require_contract_records_available_v1(uuid,uuid) returns void language plpgsql as $$begin return; end$$;
    create function public.gridex_legacy_legal_type_for_module(text) returns text language sql as $$select $1$$;
    create function public.gridex_get_customer_contract_signature_receipt_v1(text) returns jsonb language sql as $$
      select jsonb_build_object('request_id',r.id,'company_id',c.company_id,'customer_id',c.customer_id,
        'contract_id',c.id,'signed_at',c.signed_at,'signature_snapshot_sha256',c.signature_snapshot_sha256)
      from public.customer_contract_signature_requests r join public.customer_contracts c on c.id=r.customer_contract_id where r.token_hash=$1$$;
    create function public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,uuid,text)
      returns jsonb language sql as $$select '{}'::jsonb$$;
    create function test_signed_job() returns trigger language plpgsql as $$begin
      if new.status='signed' and old.status is distinct from 'signed' then
        insert into public.customer_operation_jobs(company_id,customer_id,customer_site_id,job_type,status,idempotency_key,payload)
        values(new.company_id,new.customer_id,coalesce(new.customer_site_id,new.site_id),'start_supplier_switch','queued',
          'contract-signed:'||new.id,jsonb_build_object('contract_id',new.id));
      end if; return new; end$$;
    create trigger signed_job after update on customer_contracts for each row execute function test_signed_job();`)
  const expiry = schema.match(/CREATE FUNCTION public\.gridex_sync_poa_expires_at\(\)[\s\S]*?\n\$\$;/)![0]
  await db.exec(expiry)
  await db.exec(`create trigger poa_expiry before insert or update of valid_to,valid_until on powers_of_attorney
    for each row execute function gridex_sync_poa_expires_at()`)
  const binder = schema.match(/CREATE FUNCTION public\.gridex_bind_poa_authorization_document\(\)[\s\S]*?\n\$\$;/)![0]
  await db.exec(binder)
  await db.exec(`create trigger bind_document after insert on customer_authorization_documents
    for each row execute function gridex_bind_poa_authorization_document()`)
  const forward = fs.readFileSync('supabase/migrations/20261028091248_allow_contract_signature_before_supply_start.sql','utf8')
  await db.exec(forward)
})
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec(`truncate ${tables.join(',')},storage.objects,storage.buckets; set test.role='service_role';
    insert into companies(id,is_active,lifecycle_status) values('${id(1)}',true,'active');
    insert into customers(id,company_id,customer_type,full_name,personal_number,customer_number)
      values('${id(2)}','${id(1)}','private','Synthetic Signer','199001019999','TEST-1');
    insert into customer_sites(id,company_id,customer_id) values('${id(3)}','${id(1)}','${id(2)}');
    insert into tenant_contract_assignments(id,company_id) values('${id(4)}','${id(1)}');
    insert into contract_publications(id,assignment_id) values('${id(5)}','${id(4)}');
    insert into contract_product_versions(id,status,locked_at,power_of_attorney_required) values('${id(6)}','approved',now(),true);
    insert into price_plan_versions(id,status,locked_at) values('${id(7)}','published',now());
    insert into legal_bundle_versions(id,company_id,status,locked_at,unresolved_variables) values('${id(8)}','${id(1)}','published',now(),'{}');
    insert into legal_bundle_version_documents(id,legal_bundle_version_id,module_key,title,rendered_body,content_sha256,template_version,unresolved_variables)
      values('${id(9)}','${id(8)}','power_of_attorney','Synthetic POA','Exact accepted synthetic text',
        encode(sha256(convert_to('Exact accepted synthetic text','UTF8')),'hex'),'test-v1','{}');
    insert into contract_publication_versions(id,contract_publication_id,contract_product_version_id,price_plan_version_id,legal_bundle_version_id,status,locked_at)
      values('${id(10)}','${id(5)}','${id(6)}','${id(7)}','${id(8)}','published',now());
    insert into contract_price_snapshots(id,company_id,contract_id,snapshot_hash) values('${id(11)}','${id(1)}','${id(12)}','price-sha');
    insert into customer_contracts(id,company_id,customer_id,customer_site_id,status,contract_price_snapshot_id,
      contract_publication_version_id,contract_product_version_id,price_plan_version_id,legal_bundle_version_id)
      values('${id(12)}','${id(1)}','${id(2)}','${id(3)}','pending_signature','${id(11)}','${id(10)}','${id(6)}','${id(7)}','${id(8)}');
    insert into customer_contract_signature_requests(id,company_id,customer_id,customer_contract_id,token_hash,expires_at,channel,recipient_email)
      values('${id(13)}','${id(1)}','${id(2)}','${id(12)}','${token}',now()+interval '1 day','internal','synthetic@example.invalid');`)
})
const sign = (accepted = true, scopes = ['supplier_switch','facility_information_lookup'], ip: string | null = '192.0.2.8') =>
  db.query<{ result: Record<string, unknown> }>(`select public.gridex_finalize_customer_contract_signature_v2($1,$2,$3,$4,$5,$6,$7) as result`,
    [token,'hmac-original','Synthetic UA',ip,accepted,scopes,'ops_online_poa_v1'])

describe('same-transaction online contract + explicitly accepted POA', () => {
  it('binds exact customer/tenant/site/legal version, actual IP and consent time; holds dispatch until archive', async () => {
    await sign()
    const { rows } = await db.query<Record<string, unknown>>(`select p.*,c.signature_snapshot_sha256,c.signed_at as contract_signed_at
      from powers_of_attorney p join customer_contracts c on c.id=p.customer_contract_id`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ company_id:id(1),customer_id:id(2),customer_site_id:id(3),customer_contract_id:id(12),
      source:'ops_online_signature',accepted_ip:'192.0.2.8',signer_name:'Synthetic Signer',signer_identity_number:'199001019999',
      signed_scope_snapshot:['supplier_switch','facility_information_lookup'],legal_bundle_version_document_id:id(9) })
    expect(rows[0].accepted_at).toEqual(rows[0].contract_signed_at)
    expect(rows[0].evidence_payload).toMatchObject({ ip_address:'192.0.2.8',capture_source:'actual_signing_request',
      signature_request_id:id(13),signature_snapshot_sha256:rows[0].signature_snapshot_sha256 })
    expect((rows[0].evidence_payload as Record<string, unknown>).verification_reference).toBeTruthy()
    expect((await db.query('select status,review_reason_code from customer_operation_jobs')).rows)
      .toEqual([{status:'blocked',review_reason_code:'poa_archive_pending'}])
    expect((await db.query('select scope_type from power_of_attorney_scopes order by scope_type')).rows)
      .toEqual([{scope_type:'facility_information_lookup'},{scope_type:'supplier_switch'}])
    expect((await db.query('select count(*)::int as n from customer_authorization_documents')).rows).toEqual([{n:0}])
  })
  it.each([
    ['missing explicit consent',false,[], '192.0.2.8'],
    ['missing original IP',true,['supplier_switch'],null],
    ['expanded scope',true,['supplier_switch','terminate_any_contract'],'192.0.2.8'],
  ])('rolls back signature and all downstream intents for %s', async (_name,accepted,scopes,ip) => {
    await expect(sign(accepted as boolean,scopes as string[],ip as string|null)).rejects.toThrow(/poa_/)
    expect((await db.query('select status,signed_at from customer_contracts')).rows).toEqual([{status:'pending_signature',signed_at:null}])
    expect((await db.query('select used_at from customer_contract_signature_requests')).rows).toEqual([{used_at:null}])
    for (const table of ['powers_of_attorney','customer_legal_acceptances','customer_contract_evidence','customer_operation_jobs']) {
      expect((await db.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{n:0}])
    }
  })
  it('does not claim POA consent on an optional contract-only signature', async () => {
    await db.exec('update contract_product_versions set power_of_attorney_required=false')
    await sign(false,[],null)
    expect((await db.query('select status from customer_contracts')).rows).toEqual([{status:'signed'}])
    expect((await db.query('select count(*)::int as n from powers_of_attorney')).rows).toEqual([{n:0}])
    expect((await db.query("select count(*)::int as n from customer_legal_acceptances where acceptance_type='power_of_attorney'")).rows).toEqual([{n:0}])
    expect((await db.query('select status,review_reason_code from customer_operation_jobs')).rows)
      .toEqual([{status:'needs_review',review_reason_code:'poa_not_granted'}])
  })
  it('replay preserves original IP/scopes/time/verifier and never creates another consent', async () => {
    await sign()
    const before = (await db.query('select * from powers_of_attorney')).rows
    await sign(true,['supplier_switch'],'192.0.2.99')
    expect((await db.query('select * from powers_of_attorney')).rows).toEqual(before)
    expect((await db.query('select count(*)::int as n from customer_operation_jobs')).rows).toEqual([{n:1}])
  })
  it('uses a known legacy site alias in the same exact customer scope without guessing',async()=>{
    await db.exec(`update customer_contracts set site_id='${id(3)}',customer_site_id=null`)
    await sign()
    expect((await db.query('select site_id,customer_site_id from powers_of_attorney')).rows).toEqual([{site_id:id(3),customer_site_id:id(3)}])
  })
  it('rejects conflicting nonempty site aliases instead of choosing one',async()=>{
    await db.exec(`update customer_contracts set site_id='${id(99)}'`)
    await expect(sign()).rejects.toThrow(/poa_site_scope/)
    expect((await db.query('select count(*)::int as n from customer_contract_evidence')).rows).toEqual([{n:0}])
  })
  it('rejects a foreign site before any acceptance is committed', async () => {
    await db.exec(`update customer_sites set customer_id='${id(99)}'`)
    await expect(sign()).rejects.toThrow(/poa_site_scope/)
    expect((await db.query('select count(*)::int as n from customer_contract_evidence')).rows).toEqual([{n:0}])
  })
  it('never commits acceptance or downstream intents when the link has expired',async()=>{
    await db.exec("update customer_contract_signature_requests set expires_at=clock_timestamp()-interval '1 second'")
    await expect(sign()).rejects.toThrow(/signature_link_expired/)
    expect((await db.query('select status,signed_at from customer_contracts')).rows).toEqual([{status:'pending_signature',signed_at:null}])
    expect((await db.query('select used_at from customer_contract_signature_requests')).rows).toEqual([{used_at:null}])
    for(const table of ['powers_of_attorney','customer_contract_evidence','customer_operation_jobs']){
      expect((await db.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{n:0}])
    }
  })
  it('rejects authenticated caller even with a valid bearer hash', async () => {
    await db.exec("set test.role='authenticated'")
    await expect(sign()).rejects.toThrow(/service_role_required/)
  })
})

// Storage rows below are a bounded external-object fixture, never a claim that
// synthetic SQL metadata proves uploaded PDF bytes. The TS archive test and
// existing PDF/hash verifier own that boundary; hosted/native proof remains due.
const pdfSha='c'.repeat(64), evidenceSha='b'.repeat(64)
async function prepareArchive(scopes=['supplier_switch','facility_information_lookup']) {
  await sign(true,scopes)
  const p=(await db.query<{id:string}>('select id from powers_of_attorney')).rows[0]
  const path=`companies/${id(1)}/customers/${id(2)}/powers-of-attorney/${p.id}/fullmakt-${pdfSha}.pdf`
  await db.query(`update powers_of_attorney set document_path=$1,metadata=metadata||jsonb_build_object('document_archive',
    jsonb_build_object('path',$1::text,'storage_bucket','customer-documents','sha256',$2::text,'evidence_sha256',$3::text))`,[path,pdfSha,evidenceSha])
  await db.exec(`insert into storage.buckets values('customer-documents',false)`); await db.query(`insert into storage.objects values('customer-documents',$1)`,[path])
  return {poaId:p.id,path}
}
async function complete(a:{poaId:string;path:string}, company=id(1)) {
  return db.query(`select gridex_complete_online_signature_poa_archive_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [company,id(2),id(12),id(13),a.poaId,a.path,pdfSha,evidenceSha,128])
}
describe('atomic private archive completion gate',()=>{
  it('creates one exact document and releases only its own archive hold',async()=>{
    const a=await prepareArchive();await complete(a);await complete(a)
    expect((await db.query('select company_id,customer_id,customer_contract_id,power_of_attorney_id,file_checksum,status from customer_authorization_documents')).rows)
      .toEqual([{company_id:id(1),customer_id:id(2),customer_contract_id:id(12),power_of_attorney_id:a.poaId,file_checksum:pdfSha,status:'active'}])
    expect((await db.query('select status,review_reason_code from customer_operation_jobs')).rows).toEqual([{status:'queued',review_reason_code:null}])
    expect((await db.query(`select company_id,customer_id,authorization_document_id,covers_grid_owner_data,covers_current_supplier_contract,covers_metering_data,signed_scope_snapshot from authorization_scopes`)).rows)
      .toEqual([{company_id:id(1),customer_id:id(2),authorization_document_id:(await db.query<{id:string}>('select id from customer_authorization_documents')).rows[0].id,
        covers_grid_owner_data:true,covers_current_supplier_contract:true,covers_metering_data:true,signed_scope_snapshot:['supplier_switch','facility_information_lookup']}])
    expect((await db.query("select metadata->>'online_signature_archive_pending' as pending from powers_of_attorney")).rows).toEqual([{pending:'false'}])
  })
  it('does not add metering coverage to a supplier-switch-only consent',async()=>{
    const a=await prepareArchive(['supplier_switch']);await complete(a)
    expect((await db.query('select covers_grid_owner_data,covers_current_supplier_contract,covers_metering_data,signed_scope_snapshot from authorization_scopes')).rows)
      .toEqual([{covers_grid_owner_data:true,covers_current_supplier_contract:true,covers_metering_data:false,signed_scope_snapshot:['supplier_switch']}])
  })
  it('does not widen or revive a previously revoked exact document authorization',async()=>{
    const a=await prepareArchive();await complete(a)
    await db.exec("update authorization_scopes set status='revoked',revoked_at=now()")
    await expect(complete(a)).rejects.toThrow(/poa_archive_authorization_binding_invalid/)
    expect((await db.query('select status from authorization_scopes')).rows).toEqual([{status:'revoked'}])
    expect((await db.query('select count(*)::int as n from authorization_scopes')).rows).toEqual([{n:1}])
  })

  it.each(['foreign tenant','public bucket','missing object','wrong checksum','revoked consent'])('refuses %s without activating document/dispatch',async reason=>{
    const a=await prepareArchive()
    if(reason==='public bucket')await db.exec('update storage.buckets set public=true')
    if(reason==='missing object')await db.exec('delete from storage.objects')
    if(reason==='wrong checksum')await db.exec(`update powers_of_attorney set metadata=jsonb_set(metadata,'{document_archive,sha256}','"wrong"')`)
    if(reason==='revoked consent')await db.exec("update powers_of_attorney set status='revoked',revoked_at=now()")
    await expect(complete(a,reason==='foreign tenant'?id(99):id(1))).rejects.toThrow(/poa_archive_/)
    expect((await db.query('select count(*)::int as n from customer_authorization_documents')).rows).toEqual([{n:0}])
    expect((await db.query('select status from customer_operation_jobs')).rows).toEqual([{status:'blocked'}])
  })
  it.each(['needs_review','cancelled','blocked'])('preserves an unrelated %s decision after the PDF is saved',async status=>{
    const a=await prepareArchive();await db.query("update customer_operation_jobs set status=$1,review_reason_code='different_review'",[status])
    await complete(a)
    expect((await db.query('select status,review_reason_code from customer_operation_jobs')).rows).toEqual([{status,review_reason_code:'different_review'}])
  })
  it('preserves the entire inclusive Stockholm last validity day despite the original expiry trigger',async()=>{
    await sign()
    const result=await db.query<{valid_from:string;valid_to:string;expires_at:string}>(`select valid_from::text,valid_to::text,
      (expires_at at time zone 'Europe/Stockholm')::text as expires_at from powers_of_attorney`)
    const r=result.rows[0]
    expect(r.expires_at).toMatch(/00:00:00$/)
    expect((await db.query(`select expires_at=((valid_to+1)::timestamp at time zone 'Europe/Stockholm') as exact from powers_of_attorney`)).rows).toEqual([{exact:true}])
    expect((await db.query(`select valid_to=(valid_from+interval '12 months')::date-1 as exact from powers_of_attorney`)).rows).toEqual([{exact:true}])
  })
})

describe('original online POA evidence cannot drift after signing',()=>{
  const sources=['ops_online_signature','OPS_ONLINE_SIGNATURE',' ops_online_signature ','\tops_online_signature\n','\u00a0OPS_ONLINE_SIGNATURE\ufeff']
  it.each(sources.flatMap(source=>['authenticated','anon',''].map(role=>({role,source}))))('rejects a new online-capture row from a non-service role $role with source $source',async({role,source})=>{
    await sign()
    await db.query("select set_config('test.role',$1,false)",[role])
    await expect(db.query(`insert into powers_of_attorney
      select (jsonb_populate_record(null::public.powers_of_attorney,
        to_jsonb(p)||jsonb_build_object('id','${id(99)}','source',$1::text))).*
      from powers_of_attorney p`,[source])).rejects.toThrow(/poa_online_capture_service_role_required/)
    expect((await db.query('select count(*)::int as count from powers_of_attorney')).rows).toEqual([{count:1}])
  })
  it.each(sources.slice(1))('rejects a noncanonical system source even from service: %s',async source=>{
    await expect(db.query(`insert into powers_of_attorney(id,company_id,customer_id,source)
      values('${id(99)}','${id(1)}','${id(2)}',$1)`,[source])).rejects.toThrow(/poa_online_source_noncanonical/)
  })
  it.each(sources)('rejects relabelling a manual row to reserved source %s',async source=>{
    await db.exec(`insert into powers_of_attorney(id,company_id,customer_id,source)
      values('${id(99)}','${id(1)}','${id(2)}','admin_manual'); set test.role='authenticated'`)
    await expect(db.query(`update powers_of_attorney set source=$1 where id='${id(99)}'`,[source]))
      .rejects.toThrow(/poa_online_source_cannot_be_relabelled/)
  })
  it('keeps the existing manual POA insertion path available to its authorized caller',async()=>{
    await db.exec("set test.role='authenticated'")
    await db.exec(`insert into powers_of_attorney(id,company_id,customer_id,source)
      values('${id(99)}','${id(1)}','${id(2)}','admin_manual')`)
    expect((await db.query('select source from powers_of_attorney')).rows).toEqual([{source:'admin_manual'}])
  })
  it('reserves a blank-source row claiming online capture through its evidence source',async()=>{
    await sign();await db.exec("set test.role='authenticated'")
    await expect(db.exec(`insert into powers_of_attorney
      select (jsonb_populate_record(null::public.powers_of_attorney,to_jsonb(p)||jsonb_build_object(
        'id','${id(99)}','source',null,'evidence_payload',p.evidence_payload||jsonb_build_object('source','OPS_ONLINE_SIGNATURE')))).*
      from powers_of_attorney p`)).rejects.toThrow(/poa_online_capture_service_role_required/)
  })
  it.each(["accepted_ip='192.0.2.99'","signer_name='Someone else'","source='admin_manual'",
    "fullmakt_snapshot='{}'::jsonb","evidence_payload='{}'::jsonb","customer_id='10000000-0000-4000-8000-000000000099'"])(
    'rejects a later replacement of %s',async change=>{
      await sign();const before=(await db.query('select * from powers_of_attorney')).rows
      await expect(db.exec(`update powers_of_attorney set ${change}`)).rejects.toThrow(/poa_online_original_capture_immutable/)
      expect((await db.query('select * from powers_of_attorney')).rows).toEqual(before)
    })
  it('does not allow an authenticated actor to forge archive completion metadata',async()=>{
    await sign();await db.exec("set test.role='authenticated'")
    await expect(db.exec(`update powers_of_attorney set metadata=jsonb_set(metadata,'{online_signature_archive_pending}','false')`))
      .rejects.toThrow(/poa_online_archive_service_role_required/)
  })
  it('keeps optional contract-only signing inside the same customer/company boundary',async()=>{
    await db.exec(`update contract_product_versions set power_of_attorney_required=false;update customers set company_id='${id(99)}'`)
    await expect(sign(false,[],null)).rejects.toThrow(/signature_customer_scope_invalid/)
    expect((await db.query('select status from customer_contracts')).rows).toEqual([{status:'pending_signature'}])
  })
})
