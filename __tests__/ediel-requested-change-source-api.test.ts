import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest,NextResponse} from 'next/server'
const io=vi.hoisted(()=>({access:vi.fn(),archive:vi.fn(),read:vi.fn(),bytes:vi.fn(),review:vi.fn()}))
vi.mock('@/lib/admin/apiGuards',()=>({requireAdminApiAccess:io.access}))
vi.mock('@/lib/ediel/production/requestedChangeIntake',()=>({REQUESTED_CHANGE_SOURCE_MAX_BYTES:8*1024*1024,archiveRequestedChangeSource:io.archive,readRequestedChangeArtifact:io.read,readRequestedChangeArtifactBytes:io.bytes,reviewRequestedChangeArtifact:io.review}))
import {POST as archive} from '@/app/api/ediel/requested-change-sources/route'
import {GET as metadata} from '@/app/api/ediel/requested-change-sources/[artifactId]/route'
import {GET as source} from '@/app/api/ediel/requested-change-sources/[artifactId]/source/route'
import {POST as review} from '@/app/api/ediel/requested-change-sources/[artifactId]/review/route'
const id='11111111-1111-4111-8111-111111111111',hash='a'.repeat(64),params={params:Promise.resolve({artifactId:id})}
const request=(body?:unknown)=>new NextRequest('http://localhost/api/ediel/requested-change-sources',{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)})})
const identity={id:'199001019999',qualifier:'SE1',agency:'260'},address={lines:['TEST','',''],city:'TEST',postalCode:'12345',country:'SE',representation:{convention:'original',reference:'SYNTHETIC',mode:1}}
const submission=()=>({supplyPeriodId:id,contractId:id,kind:'death',effectiveAt:'2026-10-01T12:00:00Z',source:{bytesBase64:'VEVTVA==',mimeType:'text/plain',reference:'SYNTHETIC',version:'1'},customerIdentity:{...identity,name:'SYNTHETIC',addressLines:['TEST'],city:'TEST',postalCode:'12345',country:'SE'},invoiceeProfile:{meteringPointId:'735999123456789012',identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:['SYNTHETIC'],address,availability:'available'},event:{state:'none',reference:'SYNTHETIC'}}})
beforeEach(()=>{vi.clearAllMocks();io.access.mockResolvedValue({guard:{companyId:'current-company',userId:'current-user'}});io.archive.mockResolvedValue({status:'archived',artifactId:id,sourceHash:hash,claimsHash:hash,missing:['separate_source_review_required']});io.read.mockResolvedValue({status:'held',artifactId:id,sourceHash:hash,claimsHash:hash,missing:['authentic_current_issuer_and_representation_receipt']});io.bytes.mockResolvedValue({mimeType:'text/plain',sourceHash:hash,bytes:Uint8Array.from([84,69,83,84])});io.review.mockResolvedValue({status:'held',artifactId:id,missing:['authentic_current_issuer_and_representation_receipt']})})
describe('immutable source custody HTTP scope and actual approval separation',()=>{
 it('archives unapproved original bytes and injects current identity/tenant only on the server',async()=>{
  const input=submission(),response=await archive(request(input));expect(response.status).toBe(201);expect(await response.json()).not.toHaveProperty('eventId')
  expect(io.archive).toHaveBeenCalledExactlyOnceWith({...input,companyId:'current-company',actorUserId:'current-user',invoiceeProfile:{...input.invoiceeProfile,source:{kind:'caller_selection',companyId:'current-company',reference:'SYNTHETIC'}}});expect(io.access).toHaveBeenCalledWith({allOf:['communication.write','customers.write']})
 })
 it.each(['companyId','actorUserId','environment','verified','approved','eventId'])('refuses client authority %s before archive effects',async key=>{expect((await archive(request({...submission(),[key]:'forged'}))).status).toBe(400);expect(io.archive).not.toHaveBeenCalled()})
 it('refuses nested profile source/company authority, unknown receipt flags and invalid selector',async()=>{
  for(const body of [{...submission(),invoiceeProfile:{...submission().invoiceeProfile,source:{kind:'caller_selection',companyId:'foreign'}}},{...submission(),issuerReceipt:{verified:true}},{...submission(),contractId:'foreign-not-a-uuid'}])expect((await archive(request(body))).status).toBe(400);expect(io.archive).not.toHaveBeenCalled()
 })
 it('requires separate native reviewer authority, preserves a missing actual issuer hold and never fabricates eventId',async()=>{
  const command={sourceHash:hash,claimsHash:hash,decision:'approve',reason:'Original reviewed'};const response=await review(request(command),params);expect(response.status).toBe(409);expect(await response.json()).toEqual({status:'held',artifactId:id,missing:['authentic_current_issuer_and_representation_receipt']});expect(io.review).toHaveBeenCalledExactlyOnceWith({...command,artifactId:id,companyId:'current-company',actorUserId:'current-user'});expect(io.access).toHaveBeenCalledWith({allOf:['communication.write','customers.write','ediel.source.review']})
 })
 it('returns only a native authorized result when a qualified current source actually exists',async()=>{io.review.mockResolvedValue({status:'authorized',artifactId:id,eventId:id});const response=await review(request({sourceHash:hash,claimsHash:hash,decision:'approve',reason:'Qualified source'}),params);expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'authorized',artifactId:id,eventId:id})})
 it.each([{sourceHash:hash,claimsHash:hash,decision:'approve',reason:'review',verified:true},{sourceHash:hash,claimsHash:'forged',decision:'approve',reason:'review'}])('refuses a forged review projection %j',async body=>{expect((await review(request(body),params)).status).toBe(400);expect(io.review).not.toHaveBeenCalled()})
 it('metadata/source reads use current scope and binary download is private attachment without active content or provider errors',async()=>{
  const response=await metadata(request(),params);expect(response.status).toBe(200);expect(io.read).toHaveBeenCalledExactlyOnceWith({companyId:'current-company',actorUserId:'current-user',artifactId:id});const download=await source(request(),params);expect(await download.text()).toBe('TEST');expect(download.headers.get('content-disposition')).toBe(`attachment; filename="underlag-${id}.txt"`);expect(download.headers.get('content-type')).toBe('text/plain');expect(download.headers.get('cache-control')).toBe('private, no-store');expect(download.headers.get('x-content-type-options')).toBe('nosniff');expect(io.bytes).toHaveBeenCalledExactlyOnceWith({companyId:'current-company',actorUserId:'current-user',artifactId:id})
 })
 it('denied and unselected-company reads perform no source calls and retain private cache policy',async()=>{
  io.access.mockResolvedValue({response:NextResponse.json({error:'Denied'},{status:403})});const denied=await source(request(),params);expect(denied.status).toBe(403);expect(denied.headers.get('cache-control')).toBe('private, no-store');io.access.mockResolvedValue({guard:{companyId:null,userId:'current-user'}});expect((await metadata(request(),params)).status).toBe(403);expect(io.read).not.toHaveBeenCalled();expect(io.bytes).not.toHaveBeenCalled()
 })
 it('invalid source selector and execution-time reviewer revocation have no trusted output and no raw errors',async()=>{
  expect((await metadata(request(),{params:Promise.resolve({artifactId:'bad'})})).status).toBe(400);expect(io.read).not.toHaveBeenCalled();io.review.mockRejectedValue(Error('PRIVATE SQL CUSTOMER SECRET'));const response=await review(request({sourceHash:hash,claimsHash:hash,decision:'approve',reason:'review'}),params);expect(response.status).toBe(403);expect(await response.text()).not.toContain('PRIVATE')
 })
 it('bounds streamed and declared body sizes before source/reviewer effects',async()=>{
  const oversized=new NextRequest('http://localhost/api/ediel/requested-change-sources',{method:'POST',headers:{'content-length':'99999999'},body:'{}'});expect((await archive(oversized)).status).toBe(413);expect(io.archive).not.toHaveBeenCalled();const largeReview=request({sourceHash:hash,claimsHash:hash,decision:'approve',reason:'x'.repeat(140000)});expect((await review(largeReview,params)).status).toBe(413);expect(io.review).not.toHaveBeenCalled()
 })
 it('authorization read failures remain unavailable and have zero source effects',async()=>{io.access.mockRejectedValue(Error('PRIVATE auth failure'));expect((await archive(request(submission()))).status).toBe(503);expect(io.archive).not.toHaveBeenCalled()})
})
