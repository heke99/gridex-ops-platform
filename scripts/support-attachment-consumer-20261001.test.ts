import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exportJWK,generateKeyPair,SignJWT } from 'jose'
import {scannerSha256,scanBinding,scannerTrustEntry,SUPPORT_SCAN_PURPOSE,type SupportScanChallenge} from '@/lib/customer-cases/scannerProof'
const f=vi.hoisted(()=>({calls:[] as Array<{name:string;args:Record<string,unknown>}>,downloads:0,claims:[] as unknown[],
  rpcHandler:null as null|((name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>),
  bytes:new Uint8Array(),onDownload:null as null|(()=>void),adminResponse:null as Response|null,permissions:[] as string[],sessions:0}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:async(name:string,args:Record<string,unknown>)=>{
  f.calls.push({name,args});return f.rpcHandler?f.rpcHandler(name,args):{error:null,data:name==='gridex_claim_support_attachment_scans_v1'?f.claims:true}
},storage:{from:()=>({download:async()=>{f.downloads++;f.onDownload?.();return {error:null,data:new Blob([f.bytes])}}})}}}))
vi.mock('@/lib/admin/apiGuards',()=>({requireAdminApiAccess:async(permissions:string[])=>{
  f.permissions=permissions;return f.adminResponse?{response:f.adminResponse}:{guard:{companyId:'fa710000-0000-4000-8000-000000000002',userId:'fa710000-0000-4000-8000-000000000005'}}
}}))
vi.mock('@/lib/customer-operations/supportSession',()=>({currentSupportSession:async()=>{
  f.sessions++;return {kind:'ops',userId:'fa710000-0000-4000-8000-000000000005',sessionId:'fa710000-0000-4000-8000-000000000006'}
}}))
const id=(n:number)=>`fa710000-0000-4000-8000-${String(n).padStart(12,'0')}`
beforeEach(()=>{f.calls=[];f.downloads=0;f.claims=[];f.rpcHandler=null;f.bytes=new TextEncoder().encode('Synthetic private bytes');f.onDownload=null;
  f.adminResponse=null;f.permissions=[];f.sessions=0;delete process.env.GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET;delete process.env.GRIDEX_SUPPORT_SCANNER_PROCESS_SECRET;
  delete process.env.GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST})
afterEach(()=>{vi.restoreAllMocks()})
it('default-absent provider consumes genuine claims as explicit qualification blocks and performs zero dispatch/byte reads',async()=>{
  const {processSupportAttachmentScans}=await import('@/lib/customer-cases/attachmentScanQueue')
  f.claims=[{scanIntentId:id(1),companyId:id(2),attachmentId:id(3),claimToken:id(4)}]
  expect(await processSupportAttachmentScans({limit:5,claimToken:id(4)})).toMatchObject({claimed:1,blocked:1,evidenceRecorded:0})
  expect(f.calls.at(-1)).toMatchObject({name:'gridex_finish_support_attachment_scan_claim_v1',args:{p_outcome:'blocked_scanner_qualification'}})
  expect(f.downloads).toBe(0)
})
async function signer(){
  const pair=await generateKeyPair('RS256'),kid='controlled-evidence-key',publicKey={...await exportJWK(pair.publicKey),kid,alg:'RS256',use:'sig'}
  const config=JSON.stringify({[id(2)]:{issuer:'https://synthetic-scanner.example.invalid',audience:'isolated-consumer',subject:'synthetic-scanner-principal',
    kid,purpose:SUPPORT_SCAN_PURPOSE,jwks:{keys:[publicKey]}}})
  process.env.GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST=config
  const entry=await scannerTrustEntry(id(2),config)
  if(!entry)throw new Error('controlled_key_configuration_invalid')
  const now=Math.floor(Date.now()/1000),challenge:SupportScanChallenge={companyId:id(2),customerId:id(9),caseId:id(10),attachmentId:id(3),
    scanIntentId:id(1),reservationHash:'a'.repeat(64),revision:1,bucket:'customer-support-quarantine',objectKey:`${id(2)}/${id(9)}/${id(10)}/${id(3)}`,
    sha256:scannerSha256(f.bytes),byteSize:f.bytes.length,objectId:id(11),objectVersion:'synthetic-v1',objectUpdatedAt:'2026-10-01T00:00:00Z',
    nonceId:id(12),issuedAt:now,expiresAt:now+300,...entry.trust}
  const token=()=>new SignJWT({purpose:SUPPORT_SCAN_PURPOSE,binding_sha256:scannerSha256(scanBinding(challenge)),verdict:'clean'})
    .setProtectedHeader({alg:'RS256',kid,typ:'gridex-support-attachment-scan+jwt'}).setIssuer(entry.issuer).setAudience(entry.audience)
    .setSubject(entry.subject).setJti(challenge.nonceId).setIssuedAt(now).setExpirationTime(now+300).sign(pair.privateKey)
  const callback={challenge,scanIntentId:id(1),claimToken:id(4),status:'processing'}
  f.rpcHandler=async(name)=>({error:null,data:name==='gridex_claim_support_attachment_scans_v1'?
    [{scanIntentId:id(1),companyId:id(2),attachmentId:id(3),claimToken:id(4)}]:name==='gridex_reserve_support_attachment_scan_v1'?challenge:
    name==='gridex_get_support_attachment_scan_callback_v1'?callback:name==='gridex_commit_support_attachment_scan_callback_v1'?
      {nonceId:challenge.nonceId,attachmentId:challenge.attachmentId,verdict:'clean',outcome:'blocked_scanner_qualification',releaseAllowed:false,replayed:false}:true})
  return {challenge,token}
}
it('actual controlled RS256 adapter consumes the bound intent and actual bytes; its signed callback remains non-releasing',async()=>{
  const s=await signer(),{processSupportAttachmentScans}=await import('@/lib/customer-cases/attachmentScanQueue')
  let issued=0
  expect(await processSupportAttachmentScans({limit:5,claimToken:id(4)},{evidencePurpose:SUPPORT_SCAN_PURPOSE,issue:async input=>{
    issued++;expect(input.bytes).toEqual(f.bytes);expect(input.challenge).toMatchObject({scanIntentId:id(1),attachmentId:id(3)});return {token:await s.token()}
  }})).toMatchObject({claimed:1,evidenceRecorded:1,blocked:0,errors:0})
  expect(issued).toBe(1);expect(f.calls.at(-1)?.name).toBe('gridex_commit_support_attachment_scan_callback_v1')
  expect(f.calls.at(-1)?.args.p_proof).toMatchObject({physicalSha256:s.challenge.sha256,physicalByteSize:f.bytes.length,verdict:'clean'})
})
it('actual signed callback derives its full authority from the stored nonce and rejects changed equal-size physical bytes',async()=>{
  const s=await signer(),{handleSupportScannerCallback}=await import('@/lib/customer-cases/attachmentScanHttp')
  process.env.GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET='a'.repeat(32)
  const call=()=>handleSupportScannerCallback(new Request('https://gridex.example/api/internal/customer-support/scanner/verdict',{method:'POST',
    headers:{authorization:'Bearer '+'a'.repeat(32),'content-type':'application/json'},body:JSON.stringify({nonceId:s.challenge.nonceId,token:currentToken})}))
  const currentToken=await s.token()
  expect((await call()).status).toBe(202)
  expect(f.calls[0]).toMatchObject({name:'gridex_get_support_attachment_scan_callback_v1',args:{p_nonce_id:s.challenge.nonceId}})
  f.calls=[];f.bytes.fill(120)
  expect((await call()).status).toBe(403)
  expect(f.calls.some(row=>row.name==='gridex_commit_support_attachment_scan_callback_v1')).toBe(false)
})
it('server key revocation during private callback byte inspection denies the formerly valid proof before persistence',async()=>{
  const s=await signer(),{receiveSupportAttachmentScannerCallback}=await import('@/lib/customer-cases/attachmentScanQueue')
  const token=await s.token();f.onDownload=()=>{delete process.env.GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST}
  await expect(receiveSupportAttachmentScannerCallback({nonceId:s.challenge.nonceId,token})).rejects.toThrow('support_attachment_scan_unavailable')
  expect(f.calls.some(row=>row.name==='gridex_commit_support_attachment_scan_callback_v1')).toBe(false)
})
it('an item failure remains local to its claim and the next tenant still receives its explicit qualification block',async()=>{
  const {processSupportAttachmentScans}=await import('@/lib/customer-cases/attachmentScanQueue')
  f.claims=[{scanIntentId:id(1),companyId:id(2),attachmentId:id(3),claimToken:id(4)},
    {scanIntentId:id(21),companyId:id(22),attachmentId:id(23),claimToken:id(4)}]
  f.rpcHandler=async(name,args)=>name==='gridex_claim_support_attachment_scans_v1'?{error:null,data:f.claims}:
    args.p_intent_id===id(1)?{error:{code:'42501'},data:null}:{error:null,data:true}
  expect(await processSupportAttachmentScans({limit:5,claimToken:id(4)})).toMatchObject({claimed:2,blocked:1,errors:1})
  expect(f.calls.at(-1)?.args).toMatchObject({p_intent_id:id(21),p_outcome:'blocked_scanner_qualification'})
})
it('actual exported protected HTTP route checks canonical cases.read/session and returns only a safe blocked result',async()=>{
  const s=await signer(),now=Math.floor(Date.now()/1000),read={nonceId:id(31),issuedAt:now,expiresAt:now+60,
    binding:Object.fromEntries(Object.entries(s.challenge).filter(([key])=>!['nonceId','issuedAt','expiresAt','issuerHash','subjectHash','keyHash'].includes(key))),releaseAllowed:false}
  f.rpcHandler=async(name)=>({error:null,data:name==='gridex_prepare_support_attachment_read_v1'||name==='gridex_get_support_attachment_read_nonce_v1'?read:
    {releaseAllowed:false,outcome:'blocked_scanner_qualification',physicalHashVerified:true}})
  const route=await import('@/app/api/internal/customer-support/attachments/[attachmentId]/download/route'),params=Promise.resolve({attachmentId:id(3)})
  const prepared=await route.POST(new Request('https://gridex.example/api/internal/customer-support/attachments/'+id(3)+'/download',{
    method:'POST',headers:{origin:'https://gridex.example','content-type':'application/json'},body:JSON.stringify({customerId:id(9)})}),{params})
  expect(prepared.status).toBe(201);expect(await prepared.json()).toEqual({nonceId:id(31),expiresAt:now+60,releaseAllowed:false})
  const denied=await route.GET(new Request('https://gridex.example/api/internal/customer-support/attachments/'+id(3)+'/download?customerId='+id(9),{
    headers:{'x-gridex-support-read-nonce':id(31)}}),{params})
  expect(denied.status).toBe(423);expect(await denied.json()).toEqual({releaseAllowed:false,outcome:'blocked_scanner_qualification',physicalHashVerified:true})
  expect(f.permissions).toEqual(['cases.read']);expect(f.sessions).toBe(2)
  expect(denied.headers.get('content-type')).toContain('application/json');expect(denied.headers.get('cache-control')).toContain('no-store')
  expect(f.calls.at(-1)?.args.p_context).toMatchObject({companyId:id(2),customerId:id(9),mode:'ops',actorUserId:id(5),sessionId:id(6)})
})
it('anonymous/cross-site protected requests stop before nonce/private-byte access and revoked authority after bytes is denied',async()=>{
  const {handleProtectedSupportAttachmentDownload}=await import('@/lib/customer-cases/attachmentScanHttp')
  f.adminResponse=Response.json({error:'unauthorized'},{status:401})
  expect((await handleProtectedSupportAttachmentDownload(new Request('https://gridex.example/read'),id(3))).status).toBe(401)
  f.adminResponse=null
  expect((await handleProtectedSupportAttachmentDownload(new Request('https://gridex.example/read',{method:'POST',headers:{origin:'https://attacker.example'},body:'{}'}),id(3))).status).toBe(403)
  expect(f.calls).toEqual([]);expect(f.downloads).toBe(0)
  const s=await signer(),now=Math.floor(Date.now()/1000),read={nonceId:id(31),issuedAt:now,expiresAt:now+60,
    binding:Object.fromEntries(Object.entries(s.challenge).filter(([key])=>!['nonceId','issuedAt','expiresAt','issuerHash','subjectHash','keyHash'].includes(key))),releaseAllowed:false}
  let revoked=false;f.onDownload=()=>{revoked=true}
  f.rpcHandler=async()=>revoked?{error:{code:'42501'},data:null}:{error:null,data:read}
  const denied=await handleProtectedSupportAttachmentDownload(new Request('https://gridex.example/read?customerId='+id(9),{headers:{'x-gridex-support-read-nonce':id(31)}}),id(3))
  expect(denied.status).toBe(403);expect(await denied.json()).toEqual({error:'support_actor_forbidden',releaseAllowed:false})
})
it('unconfigured or unauthorized callback transport is denied before any database/private Storage call',async()=>{
  const {handleSupportScannerCallback}=await import('@/lib/customer-cases/attachmentScanHttp')
  expect((await handleSupportScannerCallback(new Request('https://gridex.example/api/internal/customer-support/scanner/verdict',{method:'POST',body:'{}'}))).status).toBe(503)
  process.env.GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET='a'.repeat(32)
  expect((await handleSupportScannerCallback(new Request('https://gridex.example/api/internal/customer-support/scanner/verdict',{method:'POST',headers:{authorization:'Bearer wrong'},body:'{}'}))).status).toBe(401)
  expect(f.calls).toEqual([]);expect(f.downloads).toBe(0)
})
it('an authenticated callback cannot submit its own tenant/actor/challenge/verified authority',async()=>{
  const {handleSupportScannerCallback}=await import('@/lib/customer-cases/attachmentScanHttp')
  process.env.GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET='a'.repeat(32)
  const response=await handleSupportScannerCallback(new Request('https://gridex.example/api/internal/customer-support/scanner/verdict',{method:'POST',
    headers:{authorization:'Bearer '+'a'.repeat(32),'content-type':'application/json'},body:JSON.stringify({nonceId:id(1),token:'forged',verified:true,companyId:id(2)})}))
  expect(response.status).toBe(422);expect(f.calls).toEqual([])
  expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff')
})
it('an oversized authenticated callback is rejected without signature/database/private-byte work',async()=>{
  const {handleSupportScannerCallback}=await import('@/lib/customer-cases/attachmentScanHttp')
  process.env.GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET='a'.repeat(32)
  const response=await handleSupportScannerCallback(new Request('https://gridex.example/api/internal/customer-support/scanner/verdict',{method:'POST',
    headers:{authorization:'Bearer '+'a'.repeat(32),'content-type':'application/json'},body:JSON.stringify({nonceId:id(1),token:'a'.repeat(11000)})}))
  expect(response.status).toBe(413);expect(f.calls).toEqual([])
})
for(const operation of ['callback','process']as const)it(`malformed multibyte ${operation} bearer returns a bounded 401 instead of escaping transport`,async()=>{
  const http=await import('@/lib/customer-cases/attachmentScanHttp')
  process.env[operation==='callback'?'GRIDEX_SUPPORT_SCANNER_CALLBACK_SECRET':'GRIDEX_SUPPORT_SCANNER_PROCESS_SECRET']='a'.repeat(32)
  const handler=operation==='callback'?http.handleSupportScannerCallback:http.handleSupportScannerProcess
  const response=await handler(new Request('https://gridex.example/scanner/'+operation,{method:'POST',headers:{authorization:'Bearer '+'é'.repeat(32)},body:'{}'}))
  expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toContain('no-store');expect(f.calls).toEqual([])
})
