import {randomUUID}from'node:crypto'
import {createServer}from'node:http'
import {createClient}from'@supabase/supabase-js'
import {exportJWK,generateKeyPair,SignJWT}from'jose'
import {describe,expect,it,vi}from'vitest'
import {quote,session,sql,until}from'./partner-queue-continuation-20260930-native'
vi.mock('server-only',()=>({}))
import {supabaseService}from'@/lib/supabase/service'
import {executeSupportCommand}from'@/lib/customer-operations/supportCommand'
import {intakeSupportAttachment}from'@/lib/customer-cases/attachments'
import {publicReference}from'@/lib/integrations/publicReferences'
import {prepareSupportAttachmentScan}from'@/lib/customer-cases/attachmentScan'
import {prepareProtectedSupportAttachmentRead,denyProtectedSupportAttachmentDownload}from'@/lib/customer-cases/attachmentProtectedRead'
import {processSupportAttachmentScans,receiveSupportAttachmentScannerCallback}from'@/lib/customer-cases/attachmentScanQueue'
import {handleSupportScannerCallback}from'@/lib/customer-cases/attachmentScanHttp'
import {scanBinding,scannerSha256,scannerTrustEntry,SUPPORT_SCAN_PURPOSE,verifySupportAttachmentScannerProof,type SupportScanChallenge}from'@/lib/customer-cases/scannerProof'

async function fixture(){
  const company=randomUUID(),customer=randomUUID(),sibling=randomUUID(),user=randomUUID(),authSession=randomUUID()
  sql(`insert into companies(id,name,status)values(${quote(company)},'Synthetic attachment consumer','active');
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      values(${quote(user)},'authenticated','authenticated',${quote(user+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);
    insert into user_profiles(id,email,full_name,user_status)values(${quote(user)},${quote(user+'@example.invalid')},'Synthetic consumer owner','active');
    insert into auth.sessions(id,user_id,created_at,updated_at,not_after)values(${quote(authSession)},${quote(user)},now(),now(),clock_timestamp()+interval '1 hour');
    insert into customers(id,company_id,customer_number,name,customer_type)values
      (${quote(customer)},${quote(company)},${quote(customer)},'Synthetic consumer customer','private'),
      (${quote(sibling)},${quote(company)},${quote(sibling)},'Synthetic consumer sibling','private');
    insert into customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
      values(${quote(company)},${quote(customer)},${quote(user)},${quote(user)},'active',true,'owner',${quote(user+'@example.invalid')});select to_jsonb(true);`)
  const context={companyId:company,customerId:customer,actor:{kind:'portal'as const,userId:user,sessionId:authSession}}
  const created=await executeSupportCommand({...context,operation:'create',expectedRevision:0,idempotencyKey:'consumer-case-'+randomUUID(),
    payload:{title:'Synthetic consumer case',body:'Inert bytes; no approved external scanner'}})
  const bytes='Synthetic inert private consumer bytes\n'
  await intakeSupportAttachment({context,caseReference:publicReference('case',company,created.caseId)!,expectedRevision:1,
    idempotencyKey:'consumer-upload-'+randomUUID(),file:new File([bytes],'synthetic.txt',{type:'text/plain'})})
  const attachment=sql<{id:string;object_key:string}>(`select jsonb_build_object('id',id,'object_key',object_key)from customer_support_attachments where company_id=${quote(company)};`)
  const pair=await generateKeyPair('RS256'),kid='controlled-'+randomUUID(),jwk={...await exportJWK(pair.publicKey),kid,alg:'RS256',use:'sig'}
  const configuration=JSON.stringify({[company]:{issuer:'https://synthetic-scanner.example.invalid',audience:'isolated-native-consumer',subject:'synthetic-scanner-principal',kid,
    purpose:SUPPORT_SCAN_PURPOSE,jwks:{keys:[jwk]}}})
  vi.stubEnv('GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST',configuration)
  const entry=await scannerTrustEntry(company,configuration)
  if(!entry)throw new Error('synthetic_scanner_key_configuration_invalid')
  sql(`insert into private.support_attachment_scanner_roots(company_id,issuer_hash,subject_hash,key_hash)
    values(${quote(company)},${quote(entry.trust.issuerHash)},${quote(entry.trust.subjectHash)},${quote(entry.trust.keyHash)});select to_jsonb(true);`)
  const token=(challenge:SupportScanChallenge)=>new SignJWT({purpose:SUPPORT_SCAN_PURPOSE,binding_sha256:scannerSha256(scanBinding(challenge)),verdict:'clean'})
    .setProtectedHeader({alg:'RS256',kid,typ:'gridex-support-attachment-scan+jwt'}).setIssuer(entry.issuer).setSubject(entry.subject)
    .setAudience(entry.audience).setIssuedAt(challenge.issuedAt).setExpirationTime(challenge.expiresAt).setJti(challenge.nonceId).sign(pair.privateKey)
  const snapshot=()=>sql<Record<string,unknown>>(`select jsonb_build_object(
    'attachments',(select jsonb_agg(to_jsonb(t)order by id)from customer_support_attachments t where company_id=${quote(company)}),
    'jobs',(select jsonb_agg(to_jsonb(t)order by scan_intent_id)from private.support_attachment_scan_jobs t where company_id=${quote(company)}),
    'nonces',(select jsonb_agg(to_jsonb(t)order by nonce_id)from private.support_attachment_scan_challenges t where company_id=${quote(company)}),
    'receipts',(select jsonb_agg(to_jsonb(t)order by nonce_id)from private.support_attachment_scan_receipts t where company_id=${quote(company)}),
    'readNonces',(select jsonb_agg(to_jsonb(t)order by nonce_id)from private.support_attachment_read_nonces t where company_id=${quote(company)}));`)
  const prepare=async()=>{
    const claimToken=randomUUID()
    const claims=await supabaseService.rpc('gridex_claim_support_attachment_scans_v1',{p_company_id:company,p_limit:1,p_claim_token:claimToken})
    expect(claims.error).toBeNull();expect(claims.data).toHaveLength(1)
    const challenge=await prepareSupportAttachmentScan({companyId:company,attachmentId:attachment.id})
    const bound=await supabaseService.rpc('gridex_bind_support_attachment_scan_claim_v1',{
      p_intent_id:challenge.scanIntentId,p_claim_token:claimToken,p_nonce_id:challenge.nonceId})
    expect(bound.error).toBeNull();expect(bound.data).toBe(true)
    return {challenge,claimToken,signed:await token(challenge)}
  }
  return {company,customer,sibling,user,authSession,context,bytes,attachment,entry,configuration,token,snapshot,prepare}
}
async function callbackHttp(){
  const secret=randomUUID()+randomUUID();vi.stubEnv('GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET',secret)
  const server=createServer((request,response)=>{
    const chunks:Buffer[]=[];let total=0
    request.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>12*1024){response.writeHead(413);response.end();request.destroy()}else chunks.push(chunk)})
    request.on('end',()=>{void(async()=>{
      try{
        const handled=await handleSupportScannerCallback(new Request('http://127.0.0.1/verdict',{method:request.method,headers:request.headers as Record<string,string>,body:Buffer.concat(chunks)}))
        response.writeHead(handled.status,Object.fromEntries(handled.headers));response.end(Buffer.from(await handled.arrayBuffer()))
      }catch{response.writeHead(500);response.end()}
    })()})
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address();if(!address||typeof address==='string')throw new Error('controlled_callback_loopback_unavailable')
  return {secret,url:`http://127.0.0.1:${address.port}/verdict`,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}

describe.sequential('genuine scan consumer and private read; controlled evidence never qualifies release',()=>{
  it('default-absent production adapter consumes actual bridged intent as a durable qualification block and never releases',async()=>{
    const f=await fixture(),route=await import('@/app/api/internal/customer-support/scanner/process/route')
    vi.stubEnv('GRIDEX_SUPPORT_SCANNER_PROCESS_SECRET',randomUUID()+randomUUID())
    const response=await route.POST(new Request('http://127.0.0.1/process',{method:'POST',headers:{authorization:'Bearer '+process.env.GRIDEX_SUPPORT_SCANNER_PROCESS_SECRET,'content-type':'application/json'},
      body:JSON.stringify({companyId:f.company,limit:1})}))
    expect(response.status).toBe(202);expect(await response.json()).toMatchObject({result:{claimed:1,blocked:1,evidenceRecorded:0},releaseAllowed:false})
    expect(sql<string>(`select to_jsonb(status)from private.support_attachment_scan_jobs where company_id=${quote(f.company)};`)).toBe('blocked_scanner_qualification')
    expect(sql<string>(`select to_jsonb(status)from canonical_event_outbox where company_id=${quote(f.company)}and topic='customer.support.attachment.scan_requested';`)).toBe('processed')
    expect(sql<number>(`select count(*)::int from private.support_attachment_scan_receipts where company_id=${quote(f.company)};`)).toBe(0)
    const anonymous=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
    expect((await anonymous.storage.from('customer-support-quarantine').download(f.attachment.object_key)).error).not.toBeNull()
  })
  it('controlled signed adapter uses actual private bytes; actual loopback callback replay remains one private effect',async()=>{
    const f=await fixture();let nonce='',signed='',issued=0
    const result=await processSupportAttachmentScans({companyId:f.company,limit:1},{evidencePurpose:SUPPORT_SCAN_PURPOSE,issue:async input=>{
      issued++;expect(Buffer.from(input.bytes).toString()).toBe(f.bytes);nonce=input.challenge.nonceId;signed=await f.token(input.challenge);return {token:signed}
    }})
    expect(result).toMatchObject({claimed:1,evidenceRecorded:1,errors:0});expect(issued).toBe(1)
    const before=f.snapshot(),http=await callbackHttp()
    try{
      const response=await fetch(http.url,{method:'POST',headers:{authorization:'Bearer '+http.secret,'content-type':'application/json'},body:JSON.stringify({nonceId:nonce,token:signed})})
      expect(response.status).toBe(202);expect(await response.json()).toEqual({accepted:true,replayed:true,outcome:'blocked_scanner_qualification',releaseAllowed:false})
      expect(response.headers.get('cache-control')).toContain('no-store');expect(f.snapshot()).toEqual(before)
    }finally{await http.close()}
  })
  it('two actual transactions serialize callback receipt and current-token completion together',async()=>{
    const f=await fixture(),p=await f.prepare(),proof=await verifySupportAttachmentScannerProof({challenge:p.challenge,token:p.signed,configuration:f.configuration})
    const payload={...proof,physicalSha256:p.challenge.sha256,physicalByteSize:p.challenge.byteSize}
    const command=`select public.gridex_commit_support_attachment_scan_callback_v1(${quote(p.challenge.nonceId)},${quote(p.claimToken)},${quote(JSON.stringify(payload))}::jsonb);`
    const first=session('consumer_first_'+randomUUID()),name='consumer_second_'+randomUUID(),second=session(name)
    try{
      first.child.stdin.write(`begin;set local role service_role;${command}\n\\echo CONSUMER_FIRST_HELD\n`)
      await until(()=>first.output().stdout.includes('CONSUMER_FIRST_HELD'),'consumer_first_not_held')
      second.child.stdin.end(`set role service_role;${command}`)
      await until(()=>sql<boolean>(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name=${quote(name)}and wait_event_type='Lock'));`),'consumer_second_not_waiting')
      first.child.stdin.end('commit;\n')
      expect(await first.exited,first.output().stderr).toBe(0);expect(await second.exited,second.output().stderr).toBe(0)
      expect(JSON.parse(second.output().stdout.trim())).toMatchObject({replayed:true,releaseAllowed:false})
      expect(sql<number>(`select count(*)::int from private.support_attachment_scan_receipts where company_id=${quote(f.company)};`)).toBe(1)
      expect(sql<string>(`select to_jsonb(status)from private.support_attachment_scan_jobs where company_id=${quote(f.company)};`)).toBe('evidence_recorded')
    }finally{for(const c of[first,second])if(c.child.exitCode===null)c.child.kill('SIGTERM');await Promise.allSettled([first.exited,second.exited])}
  })
  it('a late final job fault rolls receipt/nonce/job back; current root revocation denies exact callback replay',async()=>{
    const f=await fixture(),p=await f.prepare(),fault='consumer_fault_'+randomUUID().replaceAll('-',''),before=f.snapshot()
    try{
      sql(`create function private.${fault}()returns trigger language plpgsql as $fault$begin
        if new.company_id=${quote(f.company)}and new.status='evidence_recorded'then raise exception 'synthetic_consumer_final_fault';end if;return new;end;$fault$;
        create trigger ${fault} before update on private.support_attachment_scan_jobs for each row execute function private.${fault}();select to_jsonb(true);`)
      await expect(receiveSupportAttachmentScannerCallback({nonceId:p.challenge.nonceId,token:p.signed})).rejects.toThrow('support_attachment_scan_unavailable')
      expect(f.snapshot()).toEqual(before)
    }finally{sql(`drop trigger if exists ${fault} on private.support_attachment_scan_jobs;drop function if exists private.${fault}();select to_jsonb(true);`)}
    expect(await receiveSupportAttachmentScannerCallback({nonceId:p.challenge.nonceId,token:p.signed})).toMatchObject({releaseAllowed:false,replayed:false})
    const committed=f.snapshot();sql(`update private.support_attachment_scanner_roots set status='revoked'where company_id=${quote(f.company)};select to_jsonb(true);`)
    await expect(receiveSupportAttachmentScannerCallback({nonceId:p.challenge.nonceId,token:p.signed})).rejects.toThrow('support_attachment_scan_unavailable');expect(f.snapshot()).toEqual(committed)
  })
  it('the real current portal owner receives only a nonce-bound denial; sibling, replay and expired session are denied',async()=>{
    const f=await fixture(),prepared=await prepareProtectedSupportAttachmentRead(f.context,f.attachment.id)
    await expect(prepareProtectedSupportAttachmentRead({...f.context,customerId:f.sibling},f.attachment.id)).rejects.toThrow()
    expect(await denyProtectedSupportAttachmentDownload(f.context,f.attachment.id,prepared.nonceId)).toEqual({releaseAllowed:false,outcome:'blocked_scanner_qualification',physicalHashVerified:true})
    await expect(denyProtectedSupportAttachmentDownload(f.context,f.attachment.id,prepared.nonceId)).rejects.toThrow()
    const next=await prepareProtectedSupportAttachmentRead(f.context,f.attachment.id),before=f.snapshot()
    sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id=${quote(f.authSession)};select to_jsonb(true);`)
    await expect(denyProtectedSupportAttachmentDownload(f.context,f.attachment.id,next.nonceId)).rejects.toThrow();expect(f.snapshot()).toEqual(before)
    for(const role of['anon','authenticated'])expect(()=>sql(`set role ${role};select public.gridex_prepare_support_attachment_read_v1('{}',${quote(f.attachment.id)});`)).toThrow(/permission denied/)
  })
  it('root expiry in the final actual job write rolls all callback effects back',async()=>{
    const f=await fixture(),p=await f.prepare(),fault='consumer_expiry_'+randomUUID().replaceAll('-',''),before=f.snapshot(),witness=fault+'_reached'
    const proof=await verifySupportAttachmentScannerProof({challenge:p.challenge,token:p.signed,configuration:f.configuration})
    try{
      sql(`create sequence private.${witness};revoke all on sequence private.${witness} from public;grant usage on sequence private.${witness} to service_role;
        create function private.${fault}()returns trigger language plpgsql as $fault$begin
        if new.company_id=${quote(f.company)}and new.status='evidence_recorded'then perform nextval('private.${witness}'::regclass);perform pg_sleep(0.6);end if;return new;end;$fault$;
        create trigger ${fault} before update on private.support_attachment_scan_jobs for each row execute function private.${fault}();select to_jsonb(true);`)
      expect(()=>sql(`update private.support_attachment_scanner_roots set valid_until=clock_timestamp()+interval '0.4 seconds'where company_id=${quote(f.company)};
        set role service_role;select public.gridex_commit_support_attachment_scan_callback_v1(${quote(p.challenge.nonceId)},${quote(p.claimToken)},
          ${quote(JSON.stringify({...proof,physicalSha256:p.challenge.sha256,physicalByteSize:p.challenge.byteSize}))}::jsonb);`)).toThrow(/support_scanner_unavailable|support_scan_proof_expired/)
      // nextval survives the callback rollback; an early root denial cannot satisfy this witness.
      expect(sql<{called:boolean;calls:number}>(`select jsonb_build_object('called',is_called,'calls',last_value)from private.${witness};`)).toEqual({called:true,calls:1})
      expect(f.snapshot()).toEqual(before)
    }finally{sql(`drop trigger if exists ${fault} on private.support_attachment_scan_jobs;drop function if exists private.${fault}();drop sequence if exists private.${witness};select to_jsonb(true);`)}
  })
  // Retain immutable intake/scan/job/read evidence and own company/object until
  // stack disposal. Cleanup only own temporary fault hooks; never disable guards.
})
