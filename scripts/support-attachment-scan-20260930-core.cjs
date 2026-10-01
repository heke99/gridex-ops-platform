const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {createHash}=require('node:crypto')
const {createSensitiveContactFixture}=require('./support-sensitive-contact-20260930-core.cjs')
const migration='20260930234348_support_attachment_authenticated_scan_receipts.sql'
const sha=value=>createHash('sha256').update(value).digest('hex')
async function createScannerCore(){
  const f=await createSensitiveContactFixture(),{db,id}=f
  await db.exec(`reset role;create schema storage;
    create table storage.objects(id uuid primary key,bucket_id text,name text,version text,updated_at timestamptz,metadata jsonb);
    create table public.customer_support_threads(id uuid primary key,company_id uuid,customer_id uuid,public_reference text,customer_title text);
    create table public.customer_case_publications(id uuid primary key,company_id uuid,customer_id uuid,customer_case_id uuid,revoked_at timestamptz);
    insert into public.permissions values('${id(21)}','cases.read','Read Support');
    insert into public.user_permissions values('${id(22)}','${id(3)}','${id(1)}','${id(21)}','active',true,'allow');`)
  const base=readFileSync(resolve(__dirname,'../supabase/migrations/20260930170000_support_channel_safeguards.sql'),'utf8')
  const table=base.match(/create table public\.customer_support_attachments \([\s\S]*?\n\);/i)?.[0]
  if(!table)throw new Error('scanner_core_actual_attachment_table_missing')
  await db.exec(table)
  for(const [file,name,tag] of [
    ['20260930160000_support_case_atomic_commands.sql','gridex_support_clock_active_v1','function'],
    ['20260930170000_support_channel_safeguards.sql','gridex_support_attachment_case_v1','f'],
  ]){
    const source=readFileSync(resolve(__dirname,'../supabase/migrations',file),'utf8')
    const start=source.indexOf('create function private.'+name+'(')
    if(start<0)throw new Error('scanner_core_authority_helper_missing:'+name)
    await db.exec(source.slice(start,source.indexOf('$'+tag+'$;',start)+tag.length+4))
  }
  await db.exec(`insert into public.customer_support_threads values('${id(11)}','${id(1)}','${id(9)}','case_${'a'.repeat(32)}','Synthetic support');
    insert into storage.objects values('${id(31)}','customer-support-quarantine','${id(1)}/${id(9)}/${id(11)}/${id(30)}',
      'synthetic-object-v1',clock_timestamp(),'{"size":23}');
    insert into canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
      values('${id(1)}','customer.support.attachment.v1','${'a'.repeat(64)}',
      '${JSON.stringify({customerId:id(9),caseId:id(11),mode:'ops',actorUserId:id(3),clientId:null,visibility:'internal',fileName:'synthetic.txt',mediaType:'text/plain',byteSize:23,sha256:sha('Synthetic private bytes')})}',
      '${JSON.stringify({companyId:id(1),customerId:id(9),caseId:id(11),attachmentId:id(30),objectKey:id(1)+'/'+id(9)+'/'+id(11)+'/'+id(30),phase:'stored',revision:1,scanStatus:'quarantined',replayed:false})}','${id(3)}');
    insert into public.customer_support_attachments(id,company_id,customer_id,customer_case_id,intake_key,request_hash,visibility,actor_user_id,channel,
      file_name,media_type,byte_size,content_sha256,object_key,uploaded_at,revision)
      select '${id(30)}','${id(1)}','${id(9)}','${id(11)}','${'a'.repeat(64)}',request_hash,'internal','${id(3)}','ops',
        'synthetic.txt','text/plain',23,'${sha('Synthetic private bytes')}','${id(1)}/${id(9)}/${id(11)}/${id(30)}',clock_timestamp(),1
      from public.canonical_command_results where company_id='${id(1)}' and command_type='customer.support.attachment.v1';
    insert into public.canonical_domain_events(id,company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
      values('${id(32)}','${id(1)}','CUSTOMER_SUPPORT_ATTACHMENT_QUARANTINED','customer_case','${id(11)}',1,'${'a'.repeat(64)}',
        '${JSON.stringify({customerId:id(9),caseId:id(11),attachmentId:id(30)})}','${id(3)}');
    insert into public.canonical_event_outbox(id,company_id,domain_event_id,topic,idempotency_key,payload)
      values('${id(33)}','${id(1)}','${id(32)}','customer.support.attachment.scan_requested','${'a'.repeat(64)}',
        '${JSON.stringify({customerId:id(9),caseId:id(11),attachmentId:id(30),bucket:'customer-support-quarantine',objectKey:id(1)+'/'+id(9)+'/'+id(11)+'/'+id(30),sha256:sha('Synthetic private bytes'),visibility:'internal'})}');
    grant usage on schema storage to service_role;grant select,update on storage.objects to service_role;
    grant select,insert,update on public.customer_support_attachments to service_role;
    grant select on public.customer_support_threads,public.customer_case_publications to service_role;
    grant execute on function private.gridex_support_clock_active_v1(jsonb),private.gridex_support_attachment_case_v1(jsonb,jsonb,boolean) to service_role;`)
  const forward=readFileSync(resolve(__dirname,'../supabase/migrations',migration),'utf8')
  if(forward.trim())await db.exec(forward)
  const trust={issuerHash:sha('https://synthetic-scanner.example.invalid'),subjectHash:sha('synthetic-scanner-principal'),keyHash:sha('synthetic-public-key')}
  if((await db.query("select to_regclass('private.support_attachment_scanner_roots') as name")).rows[0].name)
    await db.query(`insert into private.support_attachment_scanner_roots(company_id,issuer_hash,subject_hash,key_hash)values($1::uuid,$2,$3,$4)`,[id(1),trust.issuerHash,trust.subjectHash,trust.keyHash])
  await db.exec('set role service_role')
  const context={companyId:id(1),customerId:id(9),mode:'ops',actorUserId:id(3),sessionId:id(4)}
  const reserve=()=>db.query('select public.gridex_reserve_support_attachment_scan_v1($1::uuid,$2::uuid,$3::jsonb) as result',
    [id(1),id(30),JSON.stringify(trust)]).then(r=>r.rows[0].result)
  const proof=(challenge,patch={})=>({issuerHash:trust.issuerHash,subjectHash:trust.subjectHash,keyHash:trust.keyHash,
    nonceHash:sha(challenge.nonceId),issuedAt:challenge.issuedAt,expiresAt:challenge.expiresAt,
    bindingJson:JSON.stringify(challenge),requestHash:sha(JSON.stringify(challenge)),verdict:'clean',
    physicalSha256:challenge.sha256,physicalByteSize:challenge.byteSize,...patch})
  const record=(challenge,p=proof(challenge))=>db.query('select public.gridex_record_support_attachment_scan_v1($1::uuid,$2::jsonb) as result',
    [challenge.nonceId,JSON.stringify(p)]).then(r=>r.rows[0].result)
  const assess=(witness=null,ctx=context)=>db.query('select public.gridex_assess_support_attachment_scan_v1($1::jsonb,$2::uuid,$3::jsonb,$4::jsonb) as result',
    [JSON.stringify(ctx),id(30),JSON.stringify(trust),witness&&JSON.stringify(witness)]).then(r=>r.rows[0].result)
  const snapshot=async()=>{
    const tables=['public.customer_support_attachments','private.support_attachment_scan_challenges','private.support_attachment_scan_receipts']
    return Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query('select to_jsonb(t) as value from '+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.value)])))
  }
  return {db,id,trust,context,reserve,proof,record,assess,snapshot}
}
module.exports={createScannerCore,migration,sha}
