const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {createScannerCore}=require('./support-attachment-scan-20260930-core.cjs')
const migration='20261001002726_support_attachment_consumer_protected_read.sql'
async function createConsumerCore(){
  const f=await createScannerCore()
  await f.db.exec(`reset role;alter table canonical_event_outbox add column created_at timestamptz not null default clock_timestamp();
    alter table canonical_event_outbox add column available_at timestamptz not null default clock_timestamp();
    alter table canonical_event_outbox add column status text not null default 'processed';`)
  const sql=readFileSync(resolve(__dirname,'../supabase/migrations',migration),'utf8')
  if(sql.trim())await f.db.exec(sql)
  await f.db.exec('set role service_role')
  const claim=(limit=20,company=null,token=f.id(90))=>f.db.query('select public.gridex_claim_support_attachment_scans_v1($1::uuid,$2::int,$3::uuid) as result',
    [company,limit,token]).then(r=>r.rows.map(row=>row.result))
  const prepare=(context=f.context)=>f.db.query('select public.gridex_prepare_support_attachment_read_v1($1::jsonb,$2::uuid) as result',
    [JSON.stringify(context),f.id(30)]).then(r=>r.rows[0].result)
  const finish=(nonce,witness=null,context=f.context)=>f.db.query('select public.gridex_finish_support_attachment_read_v1($1::jsonb,$2::uuid,$3::jsonb) as result',
    [JSON.stringify(context),nonce,witness&&JSON.stringify(witness)]).then(r=>r.rows[0].result)
  const consumerSnapshot=async()=>{
    const names=['private.support_attachment_scan_jobs','private.support_attachment_scan_turns','private.support_attachment_read_nonces',
      'public.canonical_event_outbox','public.canonical_domain_events']
    return {...await f.snapshot(),...Object.fromEntries(await Promise.all(names.map(async name=>[name,
      (await f.db.query('select to_jsonb(t)as value from '+name+' t order by to_jsonb(t)::text')).rows.map(row=>row.value)])))}
  }
  async function seedIntents(company,customer,caseId,count){
    await f.db.exec(`reset role;
      insert into customers(id,company_id)values('${customer}','${company}')on conflict(id)do nothing;
      insert into customer_cases(id,company_id,customer_id)values('${caseId}','${company}','${customer}')on conflict(id)do nothing;
      with seed as(select gen_random_uuid() as id,encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex')as key from generate_series(1,${count})),
      commands as(insert into canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
        select '${company}','customer.support.attachment.v1',key,
          jsonb_build_object('customerId','${customer}','caseId','${caseId}','mode','ops','actorUserId','${f.id(3)}','clientId',null,
            'visibility','internal','fileName','synthetic.txt','mediaType','text/plain','byteSize',23,'sha256','${require('./support-attachment-scan-20260930-core.cjs').sha('Synthetic private bytes')}'),
          jsonb_build_object('companyId','${company}','customerId','${customer}','caseId','${caseId}','attachmentId',id,
            'objectKey','${company}/${customer}/${caseId}/'||id,'phase','stored','revision',1,'scanStatus','quarantined','replayed',false),'${f.id(3)}'
          from seed returning *)
      insert into customer_support_attachments(id,company_id,customer_id,customer_case_id,intake_key,request_hash,visibility,actor_user_id,channel,
        file_name,media_type,byte_size,content_sha256,object_key,uploaded_at,revision)
      select (result_payload->>'attachmentId')::uuid,company_id,'${customer}','${caseId}',idempotency_key,request_hash,'internal','${f.id(3)}','ops',
        'synthetic.txt','text/plain',23,request_payload->>'sha256',result_payload->>'objectKey',clock_timestamp(),1 from commands;
      insert into storage.objects(id,bucket_id,name,version,updated_at,metadata)
        select gen_random_uuid(),storage_bucket,object_key,'synthetic-object-v1',clock_timestamp(),'{"size":23}'
        from customer_support_attachments where company_id='${company}' and customer_id='${customer}' and not exists(select 1 from storage.objects where name=object_key);
      with events as(insert into canonical_domain_events(company_id,event_type,aggregate_type,aggregate_id,aggregate_version,idempotency_key,payload,created_by)
        select company_id,'CUSTOMER_SUPPORT_ATTACHMENT_QUARANTINED','customer_case',customer_case_id,revision,intake_key,
          jsonb_build_object('customerId',customer_id,'caseId',customer_case_id,'attachmentId',id),actor_user_id
          from customer_support_attachments a where company_id='${company}' and customer_id='${customer}'
            and not exists(select 1 from canonical_event_outbox o where o.company_id=a.company_id and o.idempotency_key=a.intake_key) returning *)
      insert into canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
        select e.company_id,e.id,'customer.support.attachment.scan_requested',e.idempotency_key,
          jsonb_build_object('customerId',a.customer_id,'caseId',a.customer_case_id,'attachmentId',a.id,'bucket',a.storage_bucket,
            'objectKey',a.object_key,'sha256',a.content_sha256,'visibility',a.visibility)
        from events e join customer_support_attachments a on a.company_id=e.company_id and a.intake_key=e.idempotency_key;
      set role service_role;`)
  }
  return {...f,claim,prepare,finish,consumerSnapshot,seedIntents}
}
module.exports={createConsumerCore,migration}
