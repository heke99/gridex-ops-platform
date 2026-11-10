import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
import {db05PredecessorSchema,prePr973Audit19Schema,prePr932UnsignedEditSchema,preLocal047Schema} from './helpers/db05PredecessorSchema'

const injected=vi.hoisted(()=>({patch:null as string|null,patch28:null as string|null,patch29:null as string|null,patchPoa:null as string|null,patchPoaNext:null as string|null,patchTenantKey:null as string|null,patchPr932:null as string|null,patchPr973:null as string|null,patchPr949:null as string|null,patchLocal047:null as string|null,reads:[] as string[]}))
vi.mock('node:fs',async original=>{
 const actual=await original<typeof import('node:fs')>()
 return {...actual,readFileSync:(path:Parameters<typeof actual.readFileSync>[0],options?:Parameters<typeof actual.readFileSync>[1])=>{
  const name=String(path)
  if(name.endsWith('db05-schema-predecessor-local047-20261107.patch.json')){
   injected.reads.push('local047')
   if(injected.patchLocal047!==null)return injected.patchLocal047
  }
  if(name.endsWith('db05-schema-predecessor-pr949-contrl-20261101.patch.json')){
   injected.reads.push('pr949Contrl')
   if(injected.patchPr949!==null)return injected.patchPr949
  }
  if(name.endsWith('db05-schema-predecessor-pr973-audit19-20261030.patch.json')){
   injected.reads.push('pr973Audit19')
   if(injected.patchPr973!==null)return injected.patchPr973
  }
  if(name.endsWith('db05-schema-predecessor-pr932-unsigned-edit-20261029.patch.json')){
   injected.reads.push('pr932UnsignedEdit')
   if(injected.patchPr932!==null)return injected.patchPr932
  }
  if(name.endsWith('db05-schema-predecessor-poa-tenant-key-20261029.patch.json')){
   injected.reads.push('poaTenantKey')
   if(injected.patchTenantKey!==null)return injected.patchTenantKey
  }
  if(name.endsWith('db05-schema-predecessor-poa-20261029.patch.json')){
   injected.reads.push('poa20261029')
   if(injected.patchPoaNext!==null)return injected.patchPoaNext
  }
  if(name.endsWith('db05-schema-predecessor-poa-20261028.patch.json')){
   injected.reads.push('poa20261028')
   if(injected.patchPoa!==null)return injected.patchPoa
  }
  if(name.endsWith('db05-schema-predecessor-audit29.patch.json')){
   injected.reads.push('audit29')
   if(injected.patch29!==null)return injected.patch29
  }
  if(name.endsWith('db05-schema-predecessor-audit28.patch.json')){
   injected.reads.push('audit28')
   if(injected.patch28!==null)return injected.patch28
  }
  if(name.endsWith('db05-schema-predecessor-audit27.patch.json')){
   injected.reads.push('audit27')
   if(injected.patch!==null)return injected.patch
  }
  if(name.endsWith('db05-schema-predecessor-audit26.patch.json'))injected.reads.push('audit26')
  return actual.readFileSync(path,options)
 }}
})
const sha=(text:string)=>createHash('sha256').update(text).digest('hex')
type CapturePatch={preSha256:string;postSha256:string;hunks:{preStart:number;preCount:number;preSha256:string;postStart:number;postCount:number;postSha256:string;preLines:string[];postLines:string[]}[]}
const rawCapture=readFileSync('supabase/schema.sql','utf8')
const historicalCapture=[ 'f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed', 'a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136' ].includes(sha(rawCapture))?preLocal047Schema(rawCapture):rawCapture
const pr973Sha='bf4370087bed7d9ed8ff754a9c3468443b60d05442f7f9b85d42dc77a0f5538b'
const pr949Sha='a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc'
const pr949PatchBytes=readFileSync('__tests__/fixtures/db05-schema-predecessor-pr949-contrl-20261101.patch.json','utf8')
const pr949Patch=JSON.parse(pr949PatchBytes) as CapturePatch
// Preserve all historical oracles on exact PR973 bytes. The fixture can also
// reconstruct the authentic PR949 bytes before that GEN is merged into main.
const pr973Capture=sha(historicalCapture)===pr949Sha?exactPatchFixture(pr949Patch,pr973Sha,pr949Sha,historicalCapture,false):historicalCapture
const pr949Capture=sha(historicalCapture)===pr949Sha?historicalCapture:exactPatchFixture(pr949Patch,pr973Sha,pr949Sha,pr973Capture,true)
const pr973Patch=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-pr973-audit19-20261030.patch.json','utf8')) as CapturePatch
function exactPatchFixture(patch:CapturePatch,preSha:string,postSha:string,schema:string,forward:boolean):string{
 expect(patch.preSha256).toBe(preSha);expect(patch.postSha256).toBe(postSha)
 expect(sha(schema)).toBe(forward?preSha:postSha)
 const lines=schema.split('\n')
 for(const h of [...patch.hunks].reverse()){
  expect(h.preLines).toHaveLength(h.preCount);expect(h.postLines).toHaveLength(h.postCount)
  expect(sha(h.preLines.join('\n'))).toBe(h.preSha256);expect(sha(h.postLines.join('\n'))).toBe(h.postSha256)
  const start=forward?h.preStart:h.postStart,count=forward?h.preCount:h.postCount
  expect(sha(lines.slice(start,start+count).join('\n'))).toBe(forward?h.preSha256:h.postSha256)
  lines.splice(start,count,...(forward?h.postLines:h.preLines))
 }
 const result=lines.join('\n');expect(sha(result)).toBe(forward?postSha:preSha);return result
}
const pr932Sha='20b8165bd30260151e79c43e3759241a99266eddd0b3f47cead2518cbd10893b'
const pr932PreSha='aa5d9975d3398081ea157d916308444b3e940f14fe5c9944815eff858cdac0a6'
const pr932Patch=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-pr932-unsigned-edit-20261029.patch.json','utf8')) as CapturePatch
const exactPr973Fixture=(schema:string,forward:boolean)=>exactPatchFixture(pr973Patch,pr932Sha,pr973Sha,schema,forward)
// The genuine PR973 checked-in capture is reversed to the exact PR932 bytes.
const pr932Capture=sha(pr973Capture)===pr973Sha?exactPr973Fixture(pr973Capture,false):pr973Capture
function exactPr932Fixture(schema:string,forward:boolean):string{
 expect(pr932Patch.preSha256).toBe(pr932PreSha);expect(pr932Patch.postSha256).toBe(pr932Sha)
 expect(sha(schema)).toBe(forward?pr932PreSha:pr932Sha)
 const lines=schema.split('\n')
 for(const h of [...pr932Patch.hunks].reverse()){
  expect(h.preLines).toHaveLength(h.preCount);expect(h.postLines).toHaveLength(h.postCount)
  expect(sha(h.preLines.join('\n'))).toBe(h.preSha256);expect(sha(h.postLines.join('\n'))).toBe(h.postSha256)
  const start=forward?h.preStart:h.postStart,count=forward?h.preCount:h.postCount
  expect(sha(lines.slice(start,start+count).join('\n'))).toBe(forward?h.preSha256:h.postSha256)
  lines.splice(start,count,...(forward?h.postLines:h.preLines))
 }
 const result=lines.join('\n');expect(sha(result)).toBe(forward?pr932Sha:pr932PreSha);return result
}
// Keep every C14 and older oracle on its exact captured bytes. The genuine
// PR932 checked-in capture is independently tested through the helper below.
const currentCapture=sha(pr932Capture)===pr932Sha?exactPr932Fixture(pr932Capture,false):pr932Capture
const successorSha='4a0a481dd5b6af7323f45dd78b5f03f37d08cc3ae244fbd9ea1074f3803d0746'
const tenantKeySha='aa5d9975d3398081ea157d916308444b3e940f14fe5c9944815eff858cdac0a6'
const tenantKeyPatch=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-poa-tenant-key-20261029.patch.json','utf8')) as CapturePatch
function exactTenantKeyFixture(schema:string,forward:boolean):string{
 expect(tenantKeyPatch.preSha256).toBe(successorSha);expect(tenantKeyPatch.postSha256).toBe(tenantKeySha)
 expect(sha(schema)).toBe(forward?successorSha:tenantKeySha)
 const lines=schema.split('\n')
 for(const h of [...tenantKeyPatch.hunks].reverse()){
  expect(h.preLines).toHaveLength(h.preCount);expect(h.postLines).toHaveLength(h.postCount)
  expect(sha(h.preLines.join('\n'))).toBe(h.preSha256);expect(sha(h.postLines.join('\n'))).toBe(h.postSha256)
  const start=forward?h.preStart:h.postStart,count=forward?h.preCount:h.postCount
  expect(sha(lines.slice(start,start+count).join('\n'))).toBe(forward?h.preSha256:h.postSha256)
  lines.splice(start,count,...(forward?h.postLines:h.preLines))
 }
 const result=lines.join('\n');expect(sha(result)).toBe(forward?tenantKeySha:successorSha);return result
}
// Keep all original C12 oracles on their exact captured bytes. The new C14
// checked-in capture is independently tested through the public helper below.
const actualCapture=sha(currentCapture)===tenantKeySha?exactTenantKeyFixture(currentCapture,false):currentCapture
const successorPatch=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-poa-20261029.patch.json','utf8')) as CapturePatch
function exactSuccessorFixture(schema:string,forward:boolean):string{
 expect(successorPatch.preSha256).toBe('313208382efbca3f87375e054352f96d4dfc33e4e48fcf1d1d21bf64698e6e9b')
 expect(successorPatch.postSha256).toBe(successorSha)
 expect(sha(schema)).toBe(forward?successorPatch.preSha256:successorSha)
 const lines=schema.split('\n')
 for(const h of [...successorPatch.hunks].reverse()){
  expect(h.preLines).toHaveLength(h.preCount);expect(h.postLines).toHaveLength(h.postCount)
  expect(sha(h.preLines.join('\n'))).toBe(h.preSha256);expect(sha(h.postLines.join('\n'))).toBe(h.postSha256)
  const start=forward?h.preStart:h.postStart,count=forward?h.preCount:h.postCount
  expect(sha(lines.slice(start,start+count).join('\n'))).toBe(forward?h.preSha256:h.postSha256)
  lines.splice(start,count,...(forward?h.postLines:h.preLines))
 }
 const result=lines.join('\n');expect(sha(result)).toBe(forward?successorSha:successorPatch.preSha256);return result
}
// Preserve every historical oracle against its original byte-exact capture.
// The new actual capture is tested separately through the public helper below.
const capture=sha(actualCapture)===successorSha?exactSuccessorFixture(actualCapture,false):actualCapture
const audit27=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-audit27.patch.json','utf8')) as {
 preSha256:string;postSha256:string;hunks:{postStart:number;postCount:number;postSha256:string;preLines:string[]}[]}
const audit26=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-audit26.patch.json','utf8')) as {preSha256:string;postSha256:string}
afterEach(()=>{injected.patchLocal047=null;injected.patchPr949=null;injected.patchPr973=null;injected.patch=null;injected.patch28=null;injected.patch29=null;injected.patchPoa=null;injected.patchPoaNext=null;injected.patchTenantKey=null;injected.patchPr932=null;injected.reads=[]})
// Both immutable genuine captures are covered even when the checked-in context
// is the older one. The fixture stores only the exact changed line ranges.
type Audit28={preSha256:string;postSha256:string;hunks:{preStart:number;preCount:number;preSha256:string;postStart:number;postCount:number;postSha256:string;preLines:string[];postLines:string[]}[]}
const audit28=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-audit28.patch.json','utf8')) as Audit28
const oldSha='fc6968d3f4d4f4e8fe9a487f3af9851c1f29d7ea708dee61f57cfa65dc4ebb4a'
const currentSha='69ada64839584b3576e9b57471143f1ce23c0e87bdc724f9f2261ed15fdfa85b'
function exactAudit28Fixture(schema:string,forward:boolean):string{
 expect(audit28.preSha256).toBe(oldSha)
 expect(audit28.postSha256).toBe(currentSha)
 expect(sha(schema)).toBe(forward?oldSha:currentSha)
 const lines=schema.split('\n')
 for(const hunk of [...audit28.hunks].reverse()){
  expect(hunk.preLines).toHaveLength(hunk.preCount)
  expect(hunk.postLines).toHaveLength(hunk.postCount)
  expect(sha(hunk.preLines.join('\n'))).toBe(hunk.preSha256)
  expect(sha(hunk.postLines.join('\n'))).toBe(hunk.postSha256)
  const start=forward?hunk.preStart:hunk.postStart,count=forward?hunk.preCount:hunk.postCount
  expect(sha(lines.slice(start,start+count).join('\n'))).toBe(forward?hunk.preSha256:hunk.postSha256)
  lines.splice(start,count,...(forward?hunk.postLines:hunk.preLines))
 }
 const rebuilt=lines.join('\n')
 expect(sha(rebuilt)).toBe(forward?currentSha:oldSha)
 return rebuilt
}
const nextSha='4ab0c60bd5688e9653927491981f779b374a3a85600d8a87e050ac67f15a15ca'
const audit29=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-audit29.patch.json','utf8')) as Audit28
function exactAudit29Fixture(schema:string,forward:boolean):string{
 expect(audit29.preSha256).toBe(currentSha)
 expect(audit29.postSha256).toBe(nextSha)
 expect(sha(schema)).toBe(forward?currentSha:nextSha)
 const lines=schema.split('\n')
 for(const hunk of [...audit29.hunks].reverse()){
  expect(hunk.preLines).toHaveLength(hunk.preCount)
  expect(hunk.postLines).toHaveLength(hunk.postCount)
  expect(sha(hunk.preLines.join('\n'))).toBe(hunk.preSha256)
  expect(sha(hunk.postLines.join('\n'))).toBe(hunk.postSha256)
  const start=forward?hunk.preStart:hunk.postStart,count=forward?hunk.preCount:hunk.postCount
  expect(sha(lines.slice(start,start+count).join('\n'))).toBe(forward?hunk.preSha256:hunk.postSha256)
  lines.splice(start,count,...(forward?hunk.postLines:hunk.preLines))
 }
 const rebuilt=lines.join('\n')
 expect(sha(rebuilt)).toBe(forward?nextSha:currentSha)
 return rebuilt
}
const poaSha='313208382efbca3f87375e054352f96d4dfc33e4e48fcf1d1d21bf64698e6e9b'
const poaPatch=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-poa-20261028.patch.json','utf8')) as Audit28
function exactPoaFixture(schema:string,forward:boolean):string{
 expect(poaPatch.preSha256).toBe(nextSha)
 expect(poaPatch.postSha256).toBe(poaSha)
 expect(sha(schema)).toBe(forward?nextSha:poaSha)
 const lines=schema.split('\n')
 for(const hunk of [...poaPatch.hunks].reverse()){
  expect(hunk.preLines).toHaveLength(hunk.preCount)
  expect(hunk.postLines).toHaveLength(hunk.postCount)
  expect(sha(hunk.preLines.join('\n'))).toBe(hunk.preSha256)
  expect(sha(hunk.postLines.join('\n'))).toBe(hunk.postSha256)
  const start=forward?hunk.preStart:hunk.postStart,count=forward?hunk.preCount:hunk.postCount
  expect(sha(lines.slice(start,start+count).join('\n'))).toBe(forward?hunk.preSha256:hunk.postSha256)
  lines.splice(start,count,...(forward?hunk.postLines:hunk.preLines))
 }
 const rebuilt=lines.join('\n')
 expect(sha(rebuilt)).toBe(forward?poaSha:nextSha)
 return rebuilt
}
if(![oldSha,currentSha,nextSha,poaSha].includes(sha(capture)))throw Error('db05_schema_predecessor_unknown:'+sha(capture))
const nextInput=sha(capture)===poaSha?exactPoaFixture(capture,false):capture
const currentInput=sha(nextInput)===nextSha?exactAudit29Fixture(nextInput,false):nextInput
const source=sha(currentInput)===oldSha?currentInput:exactAudit28Fixture(currentInput,false)
const current=sha(currentInput)===currentSha?currentInput:exactAudit28Fixture(source,true)
const next=sha(nextInput)===nextSha?nextInput:exactAudit29Fixture(current,true)
const poa=sha(capture)===poaSha?capture:exactPoaFixture(next,true)

it('reverses the genuine POA capture exactly through every preserved historical link without granting POA runtime proof',()=>{
 injected.reads=[]
 expect(exactPoaFixture(poa,false)).toBe(next)
 expect(exactPoaFixture(next,true)).toBe(poa)
 expect(sha(db05PredecessorSchema(poa))).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(injected.reads).toEqual(['poa20261028','audit29','audit28','audit27','audit26'])
})
it.each(['preSha256','postSha256'] as const)('refuses a changed genuine POA capture link %s',field=>{
 const changed=structuredClone(poaPatch);changed[field]='f'.repeat(64);injected.patchPoa=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(poa)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('refuses a changed POA successor hunk',()=>{
 const changed=structuredClone(poaPatch);changed.hunks[0].postSha256='f'.repeat(64);injected.patchPoa=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(poa)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('refuses a POA inverse that cannot rebuild the exact old capture',()=>{
 const changed=structuredClone(poaPatch);changed.hunks[0].preLines.push('-- unqualified');injected.patchPoa=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(poa)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('refuses an unrecognized modification to the new POA capture',()=>{
 expect(()=>db05PredecessorSchema(poa+'\n')).toThrow('db05_schema_predecessor_unknown:')
})


it('chains the exact genuine S01 capture through the authenticated audit26 schema to the pinned pre-DB05 capture',()=>{
 injected.reads=[]
 expect(sha(source)).toBe('fc6968d3f4d4f4e8fe9a487f3af9851c1f29d7ea708dee61f57cfa65dc4ebb4a')
 expect(audit27.postSha256).toBe(sha(source))
 expect(audit27.preSha256).toBe('47726959555e64a527ab2353f9532958fe6cc06bd75235375f33a04d4f231022')
 expect(audit27.preSha256).toBe(audit26.postSha256)
 const rebuilt=db05PredecessorSchema(source)
 expect(sha(rebuilt)).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(sha(rebuilt)).toBe(audit26.preSha256)
 expect(injected.reads).toEqual(['audit27','audit26'])
 expect(db05PredecessorSchema(rebuilt)).toBe(rebuilt)
})
it('refuses an unknown capture rather than reversing a similar-looking schema',()=>{
 expect(()=>db05PredecessorSchema(source+'\n')).toThrow('db05_schema_predecessor_unknown:')
})
it.each(['preSha256','postSha256'] as const)('refuses a changed authenticated audit27 link %s',field=>{
 const changed=structuredClone(audit27);changed[field]='f'.repeat(64);injected.patch=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(source)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('refuses a changed exact successor hunk',()=>{
 const changed=structuredClone(audit27);changed.hunks[0].postSha256='f'.repeat(64);injected.patch=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(source)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('refuses a hunk that would rebuild an unqualified intermediate capture',()=>{
 const changed=structuredClone(audit27);changed.hunks[0].preLines.push('-- unqualified intermediate');injected.patch=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(source)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})

it('chains the exact genuine MAIN capture through audit28, S01 and audit26 to the same pinned predecessor',()=>{
 injected.reads=[]
 expect(sha(current)).toBe(currentSha)
 expect(exactAudit28Fixture(current,false)).toBe(source)
 expect(exactAudit28Fixture(source,true)).toBe(current)
 const rebuilt=db05PredecessorSchema(current)
 expect(sha(rebuilt)).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(rebuilt).toBe(db05PredecessorSchema(source))
 expect(injected.reads).toEqual(['audit28','audit27','audit26','audit27','audit26'])
 expect(db05PredecessorSchema(rebuilt)).toBe(rebuilt)
})
it.each(['prefix','suffix','truncated'] as const)('refuses an altered new capture %s',mutation=>{
 const changed=mutation==='prefix'?'-- unqualified\n'+current:mutation==='suffix'?current+'\n':current.slice(1)
 expect(()=>db05PredecessorSchema(changed)).toThrow('db05_schema_predecessor_unknown:')
})
it.each(['preSha256','postSha256'] as const)('refuses a changed authenticated audit28 link %s',field=>{
 const changed=structuredClone(audit28);changed[field]='f'.repeat(64);injected.patch28=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(current)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('refuses a changed audit28 exact successor hunk',()=>{
 const changed=structuredClone(audit28);changed.hunks[0].postSha256='f'.repeat(64);injected.patch28=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(current)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('refuses an audit28 hunk that would rebuild an unqualified S01 intermediate',()=>{
 const changed=structuredClone(audit28);changed.hunks[0].preLines.push('-- unqualified intermediate');injected.patch28=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(current)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('refuses a moved audit28 exact successor hunk',()=>{
 const changed=structuredClone(audit28);changed.hunks[0].postStart+=1;injected.patch28=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(current)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('retains the authenticated audit27 link refusal after the new capture is reversed',()=>{
 const changed=structuredClone(audit27);changed.preSha256='f'.repeat(64);injected.patch=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(current)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})


it('chains genuine G3 capture through unchanged MAIN3d08 and historical links to the same predecessor',()=>{
 injected.reads=[]
 expect(exactAudit29Fixture(next,false)).toBe(current)
 expect(exactAudit29Fixture(current,true)).toBe(next)
 expect(db05PredecessorSchema(next)).toBe(db05PredecessorSchema(current))
 expect(sha(db05PredecessorSchema(next))).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(injected.reads).toEqual(['audit29','audit28','audit27','audit26','audit28','audit27','audit26','audit29','audit28','audit27','audit26'])
})
it.each(['prefix','suffix','truncated'] as const)('refuses an altered genuine G3 capture %s',mutation=>{
 const changed=mutation==='prefix'?'-- unqualified\n'+next:mutation==='suffix'?next+'\n':next.slice(1)
 expect(()=>db05PredecessorSchema(changed)).toThrow('db05_schema_predecessor_unknown:')
})
it.each(['preSha256','postSha256'] as const)('refuses a changed authenticated audit29 link %s',field=>{
 const changed=structuredClone(audit29);changed[field]='f'.repeat(64);injected.patch29=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(next)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('refuses a changed audit29 exact successor hunk',()=>{
 const changed=structuredClone(audit29);changed.hunks[0].postSha256='f'.repeat(64);injected.patch29=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(next)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('refuses an audit29 hunk that rebuilds an unqualified MAIN3d08 intermediate',()=>{
 const changed=structuredClone(audit29);changed.hunks[0].preLines.push('-- unqualified intermediate');injected.patch29=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(next)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('refuses a moved audit29 exact successor hunk',()=>{
 const changed=structuredClone(audit29);changed.hunks[0].postStart+=1;injected.patch29=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(next)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('retains the audit28 link refusal after the genuine G3 capture is reversed',()=>{
 const changed=structuredClone(audit28);changed.preSha256='f'.repeat(64);injected.patch28=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(next)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})

it('reverses the genuine confirmation/format capture through every unchanged historical oracle',()=>{
 const successor=exactSuccessorFixture(poa,true);injected.reads=[]
 expect(exactSuccessorFixture(successor,false)).toBe(poa)
 expect(sha(db05PredecessorSchema(successor))).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(injected.reads).toEqual(['poa20261029','poa20261028','audit29','audit28','audit27','audit26'])
 expect(successor).toBe(actualCapture)
})
it.each(['preSha256','postSha256'] as const)('rejects a changed genuine confirmation/format link %s',field=>{
 const changed=structuredClone(successorPatch);changed[field]='f'.repeat(64);injected.patchPoaNext=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(actualCapture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('rejects a changed confirmation/format successor hunk',()=>{
 const changed=structuredClone(successorPatch);changed.hunks[0].postSha256='f'.repeat(64);injected.patchPoaNext=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(actualCapture)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('rejects a moved confirmation/format successor hunk',()=>{
 const changed=structuredClone(successorPatch);changed.hunks[0].postStart+=1;injected.patchPoaNext=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(actualCapture)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('rejects a confirmation/format inverse that rebuilds unqualified old bytes',()=>{
 const changed=structuredClone(successorPatch);changed.hunks[0].preLines.push('-- unqualified');injected.patchPoaNext=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(actualCapture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it.each(['prefix','suffix','truncated'] as const)('rejects an altered confirmation/format capture %s',mutation=>{
 const changed=mutation==='prefix'?'-- unqualified\n'+actualCapture:mutation==='suffix'?actualCapture+'\n':actualCapture.slice(1)
 expect(()=>db05PredecessorSchema(changed)).toThrow('db05_schema_predecessor_unknown:')
})
it('retains the prior POA inverse refusal after reversing the genuine confirmation/format capture',()=>{
 const changed=structuredClone(poaPatch);changed.preSha256='f'.repeat(64);injected.patchPoa=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(actualCapture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})

it('reverses the genuine tenant-key capture through every unchanged original capture',()=>{
 expect(sha(currentCapture)).toBe(tenantKeySha)
 expect(exactTenantKeyFixture(currentCapture,false)).toBe(actualCapture)
 expect(exactTenantKeyFixture(actualCapture,true)).toBe(currentCapture);injected.reads=[]
 expect(sha(db05PredecessorSchema(currentCapture))).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(injected.reads).toEqual(['poaTenantKey','poa20261029','poa20261028','audit29','audit28','audit27','audit26'])
})
it.each(['preSha256','postSha256'] as const)('rejects a changed genuine tenant-key link %s',field=>{
 const changed=structuredClone(tenantKeyPatch);changed[field]='f'.repeat(64);injected.patchTenantKey=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(currentCapture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('rejects a changed tenant-key successor hunk',()=>{
 const changed=structuredClone(tenantKeyPatch);changed.hunks[0].postSha256='f'.repeat(64);injected.patchTenantKey=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(currentCapture)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('rejects a moved tenant-key successor hunk',()=>{
 const changed=structuredClone(tenantKeyPatch);changed.hunks[0].postStart+=1;injected.patchTenantKey=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(currentCapture)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('rejects a tenant-key inverse that rebuilds unqualified older bytes',()=>{
 const changed=structuredClone(tenantKeyPatch);changed.hunks[0].preLines.push('-- unqualified');injected.patchTenantKey=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(currentCapture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it.each(['prefix','suffix','truncated'] as const)('rejects an altered tenant-key capture %s',mutation=>{
 const changed=mutation==='prefix'?'-- unqualified\n'+currentCapture:mutation==='suffix'?currentCapture+'\n':currentCapture.slice(1)
 expect(()=>db05PredecessorSchema(changed)).toThrow('db05_schema_predecessor_unknown:')
})
it('retains the original confirmation inverse refusal after reversing the genuine tenant-key capture',()=>{
 const changed=structuredClone(successorPatch);changed.preSha256='f'.repeat(64);injected.patchPoaNext=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(currentCapture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})

it('reverses the genuine PR932 capture through every unchanged original capture',()=>{
 expect(sha(pr932Capture)).toBe(pr932Sha)
 expect(exactPr932Fixture(pr932Capture,false)).toBe(currentCapture)
 expect(exactPr932Fixture(currentCapture,true)).toBe(pr932Capture);injected.reads=[]
 expect(sha(db05PredecessorSchema(pr932Capture))).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(injected.reads).toEqual(['pr932UnsignedEdit','poaTenantKey','poa20261029','poa20261028','audit29','audit28','audit27','audit26'])
})
it.each(['preSha256','postSha256'] as const)('rejects a changed genuine PR932 link %s',field=>{
 const changed=structuredClone(pr932Patch);changed[field]='f'.repeat(64);injected.patchPr932=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr932Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('rejects a changed PR932 successor hunk',()=>{
 const changed=structuredClone(pr932Patch);changed.hunks[0].postSha256='f'.repeat(64);injected.patchPr932=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr932Capture)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('rejects a moved PR932 successor hunk',()=>{
 const changed=structuredClone(pr932Patch);changed.hunks[0].postStart+=1;injected.patchPr932=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr932Capture)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('rejects a PR932 inverse that rebuilds unqualified older bytes',()=>{
 const changed=structuredClone(pr932Patch);changed.hunks[0].preLines.push('-- unqualified');injected.patchPr932=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr932Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it.each(['prefix','suffix','truncated'] as const)('rejects an altered PR932 capture %s',mutation=>{
 const changed=mutation==='prefix'?'-- unqualified\n'+pr932Capture:mutation==='suffix'?pr932Capture+'\n':pr932Capture.slice(1)
 expect(()=>db05PredecessorSchema(changed)).toThrow('db05_schema_predecessor_unknown:')
})
it('retains the tenant-key inverse refusal after reversing the genuine PR932 capture',()=>{
 const changed=structuredClone(tenantKeyPatch);changed.preSha256='f'.repeat(64);injected.patchTenantKey=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr932Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})

it('reverses the genuine PR973 capture through every unchanged original capture',()=>{
 expect(sha(pr973Capture)).toBe(pr973Sha)
 expect(exactPr973Fixture(pr973Capture,false)).toBe(pr932Capture)
 expect(exactPr973Fixture(pr932Capture,true)).toBe(pr973Capture);injected.reads=[]
 expect(sha(db05PredecessorSchema(pr973Capture))).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(injected.reads).toEqual(['pr973Audit19','pr932UnsignedEdit','poaTenantKey','poa20261029','poa20261028','audit29','audit28','audit27','audit26'])
})
it.each(['preSha256','postSha256'] as const)('rejects a changed genuine PR973 link %s',field=>{
 const changed=structuredClone(pr973Patch);changed[field]='f'.repeat(64);injected.patchPr973=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr973Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('rejects a changed or moved PR973 successor hunk',()=>{
 const changed=structuredClone(pr973Patch);changed.hunks[0].postSha256='f'.repeat(64);injected.patchPr973=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr973Capture)).toThrow('db05_schema_predecessor_hunk_changed:')
 const moved=structuredClone(pr973Patch);moved.hunks[0].postStart+=1;injected.patchPr973=JSON.stringify(moved)
 expect(()=>db05PredecessorSchema(pr973Capture)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('rejects a PR973 inverse that rebuilds unqualified older bytes',()=>{
 const changed=structuredClone(pr973Patch);changed.hunks[0].preLines.push('-- unqualified');injected.patchPr973=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr973Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it.each(['prefix','suffix','truncated'] as const)('rejects an altered PR973 capture %s',mutation=>{
 const changed=mutation==='prefix'?'-- unqualified\n'+pr973Capture:mutation==='suffix'?pr973Capture+'\n':pr973Capture.slice(1)
 expect(()=>db05PredecessorSchema(changed)).toThrow('db05_schema_predecessor_unknown:')
})
it('retains the PR932 inverse refusal after reversing the genuine PR973 capture',()=>{
 const changed=structuredClone(pr932Patch);changed.preSha256='f'.repeat(64);injected.patchPr932=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr973Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})

it('binds the PR949 inverse to the exact primary artifact and unchanged historical capture',()=>{
 expect(sha(pr949PatchBytes)).toBe('bcd03c06cd68729e57708b1639dc308a47f6800a1f4ed5d9b9e701bde2e27ff8')
 expect(sha(pr949Capture)).toBe(pr949Sha)
 expect(exactPatchFixture(pr949Patch,pr973Sha,pr949Sha,pr949Capture,false)).toBe(pr973Capture)
 expect(exactPatchFixture(pr949Patch,pr973Sha,pr949Sha,pr973Capture,true)).toBe(pr949Capture)
})
it('reverses the genuine PR949 capture through every unchanged historical inverse',()=>{
 expect(sha(db05PredecessorSchema(pr949Capture))).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(injected.reads).toEqual(['pr949Contrl','pr973Audit19','pr932UnsignedEdit','poaTenantKey','poa20261029','poa20261028','audit29','audit28','audit27','audit26'])
})
it.each([
 ['pre-PR973',prePr973Audit19Schema,'20b8165bd30260151e79c43e3759241a99266eddd0b3f47cead2518cbd10893b'],
 ['pre-PR932',prePr932UnsignedEditSchema,'aa5d9975d3398081ea157d916308444b3e940f14fe5c9944815eff858cdac0a6'],
] as const)('accepts genuine PR949 through the %s entrypoint',(_name,convert,expected)=>{
 expect(sha(convert(pr949Capture))).toBe(expected)
 expect(convert(pr949Capture)).toBe(convert(pr973Capture))
})
it.each(['preSha256','postSha256'] as const)('rejects PR949 fixture %s drift',field=>{
 const changed=structuredClone(pr949Patch);changed[field]='f'.repeat(64);injected.patchPr949=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr949Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
 expect(()=>prePr973Audit19Schema(pr949Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
 expect(()=>prePr932UnsignedEditSchema(pr949Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it.each(['hash','start','count'] as const)('rejects PR949 postimage hunk %s drift',field=>{
 const changed=structuredClone(pr949Patch)
 if(field==='hash')changed.hunks[0].postSha256='f'.repeat(64)
 if(field==='start')changed.hunks[0].postStart+=1
 if(field==='count')changed.hunks[0].postCount+=1
 injected.patchPr949=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr949Capture)).toThrow('db05_schema_predecessor_hunk_changed:')
})
it('rejects PR949 inverse lines that rebuild unqualified older bytes',()=>{
 const changed=structuredClone(pr949Patch);changed.hunks[0].preLines.push('-- unqualified');injected.patchPr949=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr949Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it.each(['prefix','suffix','truncated'] as const)('rejects an altered PR949 capture %s at all three entrypoints',mutation=>{
 const changed=mutation==='prefix'?'-- unqualified\n'+pr949Capture:mutation==='suffix'?pr949Capture+'\n':pr949Capture.slice(1)
 for(const convert of [db05PredecessorSchema,prePr973Audit19Schema,prePr932UnsignedEditSchema]){
  expect(()=>convert(changed)).toThrow('db05_schema_predecessor_unknown:')
 }
 expect(injected.reads).not.toContain('pr949Contrl')
})
it.each(['pr973','pr932'] as const)('retains the unchanged %s inverse refusal after PR949',stage=>{
 const changed=structuredClone(stage==='pr973'?pr973Patch:pr932Patch);changed.preSha256='f'.repeat(64)
 if(stage==='pr973')injected.patchPr973=JSON.stringify(changed)
 else injected.patchPr932=JSON.stringify(changed)
 expect(()=>db05PredecessorSchema(pr949Capture)).toThrow('db05_schema_predecessor_rebuild_mismatch')
})
it('keeps older PR973 entrypoints independent of the new PR949 fixture',()=>{
 injected.patchPr949='{}'
 expect(sha(db05PredecessorSchema(pr973Capture))).toBe('c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823')
 expect(sha(prePr973Audit19Schema(pr973Capture))).toBe(pr932Sha)
 expect(sha(prePr932UnsignedEditSchema(pr973Capture))).toBe(pr932PreSha)
 expect(injected.reads).not.toContain('pr949Contrl')
})

// Authentic local047 RAW3 successor: finite19hunk inverse, no generated output writes.
const local047Sha='f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed'
const local047Patch=JSON.parse(readFileSync(new URL('./fixtures/db05-schema-predecessor-local047-20261107.patch.json',import.meta.url),'utf8')) as CapturePatch
const local047Capture=exactPatchFixture(local047Patch,pr949Sha,local047Sha,pr949Capture,true)
it.each([
 ['DB05/local047',db05PredecessorSchema,local047Capture],['DB05/PR949',db05PredecessorSchema,pr949Capture],
 ['pre-PR973/local047',prePr973Audit19Schema,local047Capture],['pre-PR973/PR949',prePr973Audit19Schema,pr949Capture],
 ['pre-PR932/local047',prePr932UnsignedEditSchema,local047Capture],['pre-PR932/PR949',prePr932UnsignedEditSchema,pr949Capture],
] as const)('authentic local047 retains exact historical predecessor: %s',(_name,convert,input)=>{
 expect(local047Patch.hunks).toHaveLength(19)
 expect(convert(input)).toBe(genuine079PriorOracles.get(convert))
})
it('authentic local047 unknown bytes stay closed before inverse reads',()=>{
 for(const convert of [db05PredecessorSchema,prePr973Audit19Schema,prePr932UnsignedEditSchema])expect(()=>convert(local047Capture+'\n-- drift')).toThrow('db05_schema_predecessor_unknown:')
 expect(injected.reads).not.toContain('local047')
})
it.each(['preHash','postHash','hunkHash','hunkBytes'] as const)('authentic local047 refuses tampered %s inverse',kind=>{
 const patch=structuredClone(local047Patch)
 if(kind==='preHash')patch.preSha256='0'.repeat(64)
 if(kind==='postHash')patch.postSha256='0'.repeat(64)
 if(kind==='hunkHash')patch.hunks[0].postSha256='0'.repeat(64)
 if(kind==='hunkBytes')patch.hunks[0].preLines.push('-- tamper')
 injected.patchLocal047=JSON.stringify(patch)
 for(const convert of [db05PredecessorSchema,prePr973Audit19Schema,prePr932UnsignedEditSchema])expect(()=>convert(local047Capture)).toThrow(/db05_schema_predecessor_(rebuild_mismatch|hunk_changed)/)
})
// Both old inputs independently retain the corrupt-fixture/nonconsultation property.
// Reuse the qualified immutable oracle below rather than run two full chains in one deadline.
it.each([['PR949',pr949Capture],['PR973',pr973Capture]])('older genuine %s never consults new local047 fixture',(_name,input)=>{
 injected.reads=[] // Measure only this conversion, not earlier shared-oracle setup reads.
 injected.patchLocal047='{}'
 expect(db05PredecessorSchema(input)).toBe(genuine079PriorOracles.get(db05PredecessorSchema))
 expect(injected.reads).not.toContain('local047')
})

// Genuine ordinary captures: load and qualify once, without DB or generated fixtures.
// Keep prior conversions out of each five-second case; each case still compares
// the complete restored bytes and checks unknown-input rejection.
const genuine079Prior=execFileSync('git',['show','a9cf57b5644626f6dcb0bafc60299ff21839db61:supabase/schema.sql'],{encoding:'utf8',timeout:10000,maxBuffer:32*1024*1024})
const genuine079Current=execFileSync('git',['show','9e0ae5e2d257cd657d5394b551ed0497ef53382e:supabase/schema.sql'],{encoding:'utf8',timeout:10000,maxBuffer:32*1024*1024})
const genuine079PriorSha=sha(genuine079Prior),genuine079CurrentSha=sha(genuine079Current)
if(genuine079PriorSha!=='f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed'||genuine079CurrentSha!=='a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136')throw Error('genuine079_capture_unqualified')
const genuine079Restorers=[preLocal047Schema,prePr973Audit19Schema,prePr932UnsignedEditSchema,db05PredecessorSchema]
const genuine079PriorOracles=new Map(genuine079Restorers.map(restore=>[restore,restore(genuine079Prior)]))
it('qualifies shared genuine079 prior oracles against exact capture and historical target hashes',()=>{
 expect(genuine079PriorSha).toBe('f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed')
 expect(genuine079CurrentSha).toBe('a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136')
 expect(genuine079Restorers.map(restore=>sha(genuine079PriorOracles.get(restore)!))).toEqual([
  'a0f788f2517b919c91dc4c655565da04a456548a25692f0de7fb25bcd4046afc',
  '20b8165bd30260151e79c43e3759241a99266eddd0b3f47cead2518cbd10893b',
  'aa5d9975d3398081ea157d916308444b3e940f14fe5c9944815eff858cdac0a6',
  'c4e86b3bda8dc8579df1b3bfa9bdc8994b9ca0085c07710c36a15e1259069823',
 ])
})
it.each(genuine079Restorers)('reverses genuine079 capture to unchanged historical predecessor target: %s',restore=>{
 expect(restore(genuine079Current)).toBe(genuine079PriorOracles.get(restore))
 expect(()=>restore(genuine079Current+'\n-- unknown capture\n')).toThrow(/db05_schema_predecessor_unknown/)
})
