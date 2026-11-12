import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
import {db05PredecessorSchema,prePr973Audit19Schema,prePr932UnsignedEditSchema,preLocal047Schema} from './helpers/db05PredecessorSchema'

const injected=vi.hoisted(()=>({patch:null as string|null,patch28:null as string|null,patch29:null as string|null,patchPoa:null as string|null,patchPoaNext:null as string|null,patchTenantKey:null as string|null,patchPr932:null as string|null,patchPr973:null as string|null,patchPr949:null as string|null,patchLocal047:null as string|null,patchLocal317:null as string|null,reads:[] as string[]}))
vi.mock('node:fs',async original=>{
 const actual=await original<typeof import('node:fs')>()
 return {...actual,readFileSync:(path:Parameters<typeof actual.readFileSync>[0],options?:Parameters<typeof actual.readFileSync>[1])=>{
  const name=String(path)
  if(name.endsWith('db05-schema-predecessor-local317-20261112.patch.json')){
   injected.reads.push('local317')
   if(injected.patchLocal317!==null)return injected.patchLocal317
  }
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
const historicalCapture=[ '8b7d84b657a1ebcbe2591107524ebeb74afb6dceac2cad49bec39a6ea9d1b26a', 'f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed', 'a825c79079b1fad25bc1396d241a19f097020c7567134da40729648c74ec4136', 'f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137' ].includes(sha(rawCapture))?preLocal047Schema(rawCapture):rawCapture
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
afterEach(()=>{injected.patchLocal317=null;injected.patchLocal047=null;injected.patchPr949=null;injected.patchPr973=null;injected.patch=null;injected.patch28=null;injected.patch29=null;injected.patchPoa=null;injected.patchPoaNext=null;injected.patchTenantKey=null;injected.patchPr932=null;injected.reads=[]})
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

// Authentic capture-only run42920177040 on19c177; finite8hunk fixture data, not hand-written schema.
const genuine1049Patch:CapturePatch={"preSha256":"f8e0964d0f3a51d37ef85a0e0febb21a78b7e91cea12e42d56dcb234ff1669ed","postSha256":"f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137","hunks":[{"preStart":210,"preCount":0,"preSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","postStart":210,"postCount":6,"postSha256":"6389ab94d13bbc44c4b24169c0ed51b17ec300a29be547973afe67de0865c938","preLines":[],"postLines":["--","-- Name: gridex_ediel_test_capability; Type: SCHEMA; Schema: -; Owner: -","--","","CREATE SCHEMA gridex_ediel_test_capability;",""]},{"preStart":19021,"preCount":0,"preSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","postStart":19027,"postCount":313,"postSha256":"e859414efd5b5d35b115c142e4b98cc41690d2b7d34aed808fd8cc40a2c9e7a7","preLines":[],"postLines":["--","-- Name: current_snapshot_payload_v1(uuid, uuid, uuid); Type: FUNCTION; Schema: gridex_ediel_test_capability; Owner: -","--","","CREATE FUNCTION gridex_ediel_test_capability.current_snapshot_payload_v1(p_company_id uuid, p_actor_profile_id uuid, p_route_profile_id uuid) RETURNS jsonb","    LANGUAGE plpgsql STABLE SECURITY DEFINER","    SET search_path TO 'public', 'extensions', 'pg_temp'","    AS $$","declare","  v_company public.companies%rowtype;","  v_actor public.ediel_actor_settings%rowtype;","  v_route public.ediel_route_profiles%rowtype;","  v_communication_route public.communication_routes%rowtype;","  v_payload jsonb;","  v_actor_role text;","  v_actor_ediel_id text;","  v_route_sender text;","  v_route_receiver text;","begin","  if p_company_id is null or p_actor_profile_id is null or p_route_profile_id is null then","    raise exception 'company_actor_profile_and_route_required';","  end if;","","  select * into v_company","  from public.companies","  where id=p_company_id;","  if not found then raise exception 'tenant_not_found'; end if;","","  select * into v_actor","  from public.ediel_actor_settings","  where id=p_actor_profile_id and company_id=p_company_id;","  if not found then raise exception 'tenant_scoped_test_actor_profile_not_found'; end if;","  if lower(coalesce(v_actor.environment,'')) <> 'test' or coalesce(v_actor.is_active,false) <> true then","    raise exception 'test_actor_profile_must_be_active_test_profile';","  end if;","","  v_actor_role := case lower(coalesce(nullif(v_actor.actor_role,''),v_actor.role))","    when 'supplier' then 'supplier'","    when 'electricity_supplier' then 'supplier'","    when 'esco' then 'energy_service_company'","    when 'energy_service_company' then 'energy_service_company'","    else lower(coalesce(nullif(v_actor.actor_role,''),v_actor.role))","  end;","  v_actor_ediel_id := nullif(btrim(coalesce(v_actor.actor_ediel_id,v_actor.ediel_id)), '');","  if v_actor_role is null or v_actor_ediel_id is null then","    raise exception 'test_actor_profile_identity_incomplete';","  end if;","","  select * into v_route","  from public.ediel_route_profiles","  where id=p_route_profile_id and company_id=p_company_id;","  if not found then raise exception 'tenant_scoped_test_route_profile_not_found'; end if;","  if lower(coalesce(v_route.environment,'')) <> 'test'","     or coalesce(v_route.is_active,true) <> true","     or coalesce(v_route.is_enabled,true) <> true then","    raise exception 'test_route_profile_must_be_active_test_route';","  end if;","","  v_route_sender := nullif(btrim(coalesce(v_route.sender_ediel_id,v_route.own_ediel_id)), '');","  v_route_receiver := nullif(btrim(coalesce(v_route.receiver_ediel_id,v_route.counterparty_ediel_id)), '');","  if v_route_sender is null or upper(v_route_sender) <> upper(v_actor_ediel_id) then","    raise exception 'test_route_sender_must_match_actor_profile';","  end if;","  if v_route_receiver is null then","    raise exception 'test_route_receiver_required';","  end if;","  if v_route.actor_setting_id is not null and v_route.actor_setting_id <> v_actor.id then","    raise exception 'test_route_actor_binding_mismatch';","  end if;","","  select * into v_communication_route","  from public.communication_routes","  where id=v_route.communication_route_id and company_id=p_company_id;","  if not found or v_communication_route.is_active is distinct from true","     or v_communication_route.environment_type is null","     or v_communication_route.environment_type not in ('agt_test','tgt_test','bilateral_test') then","    raise exception 'test_route_communication_source_required';","  end if;","","  v_payload := jsonb_build_object(","    'test_context', jsonb_build_object(","      'actor_profile_id', v_actor.id,","      'route_profile_id', v_route.id,","      'actor_role', v_actor_role,","      'test_ediel_id', v_actor_ediel_id,","      'counterparty_ediel_id', v_route_receiver,","      'message_family', upper(coalesce(v_route.message_family,'')),","      'application_reference', v_route.application_reference,","      'environment_type', v_communication_route.environment_type","    ),","    'company', jsonb_build_object(","      'id', v_company.id,","      'actor_role', v_actor_role,","      'test_ediel_id', v_actor_ediel_id,","      'production_ediel_id', v_company.production_ediel_id,","      'brp_ediel_id', coalesce(v_actor.brp_ediel_id,v_company.brp_ediel_id),","      'test_application_reference', v_route.application_reference,","      'production_application_reference', v_company.production_application_reference,","      'primary_test_route_id', v_route.id,","      'primary_production_route_id', v_company.ediel_primary_production_route_profile_id","    ),","    'actor_profiles', coalesce((","      select jsonb_agg(jsonb_build_object(","        'id',a.id,'environment',a.environment,'actor_role',coalesce(a.actor_role,a.role),","        'ediel_id',coalesce(a.actor_ediel_id,a.ediel_id),","        'sender_subaddress',coalesce(a.sender_sub_address,a.sender_subaddress),","        'receiver_subaddress',coalesce(a.receiver_sub_address,a.receiver_subaddress),","        'application_reference',coalesce(a.application_reference,a.default_application_reference),","        'mailbox',a.mailbox,'brp_ediel_id',a.brp_ediel_id,'is_active',a.is_active","      ) order by a.environment,a.id)","      from public.ediel_actor_settings a","      where a.company_id=p_company_id","    ),'[]'::jsonb),","    'routes', coalesce((","      select jsonb_agg(jsonb_build_object(","        'id',r.id,'environment',r.environment,'route_type',r.route_type,","        'actor_setting_id',r.actor_setting_id,","        'sender_ediel_id',r.sender_ediel_id,","        'sender_subaddress',coalesce(r.sender_sub_address,r.sender_subaddress),","        'receiver_ediel_id',r.receiver_ediel_id,","        'receiver_subaddress',coalesce(r.receiver_sub_address,r.receiver_subaddress),","        'application_reference',r.application_reference,","        'message_family',r.message_family,","        'environment_type',cr.environment_type,","        'mailbox_id',r.mailbox_id,'transport_profile_id',r.transport_profile_id,","        'certificate_id',r.certificate_id,'receiver_certificate_id',r.receiver_certificate_id,","        'transport_security_mode',r.transport_security_mode,","        'is_active',r.is_active,'is_enabled',r.is_enabled","      ) order by r.environment,r.id)","      from public.ediel_route_profiles r","      left join public.communication_routes cr","        on cr.id=r.communication_route_id and cr.company_id=r.company_id","      where r.company_id=p_company_id","    ),'[]'::jsonb),","    'mailboxes', coalesce((","      select jsonb_agg(jsonb_build_object(","        'id',m.id,'environment',m.environment,'mailbox_name',m.mailbox_name,","        'email_address',m.email_address,'provider',m.provider,'mailbox_type',m.mailbox_type,","        'transport_mode',m.transport_mode,'tls_required',m.tls_required,","        'signing_mode',m.signing_mode,'encryption_mode',m.encryption_mode,","        'is_active',m.is_active,'is_shared_platform_mailbox',m.is_shared_platform_mailbox","      ) order by m.environment,m.id)","      from public.ediel_mailboxes m","      where m.company_id=p_company_id or m.id=v_route.mailbox_id","    ),'[]'::jsonb),","    'certificates', coalesce((","      select jsonb_agg(jsonb_build_object(","        'id',c.id,'fingerprint',coalesce(c.fingerprint_sha256,c.certificate_fingerprint),","        'owner_ediel_id',c.owner_ediel_id,'owner_subaddress',c.owner_subaddress,","        'message_family',c.message_family,'purpose',c.purpose,'usage',c.usage,","        'valid_from',coalesce(c.valid_from,c.certificate_valid_from),","        'valid_to',coalesce(c.valid_to,c.certificate_valid_to),","        'encryption_status',c.encryption_status,'status',c.status","      ) order by c.id)","      from public.ediel_certificates c","      where c.id in (v_route.certificate_id,v_route.receiver_certificate_id)","    ),'[]'::jsonb),","    'active_rule_versions', coalesce((","      select jsonb_agg(jsonb_build_object(","        'rule_key',rv.rule_key,'version_code',rv.version_code,'schema_version',rv.schema_version,","        'environment',rv.environment,'status',rv.status,'is_active',rv.is_active","      ) order by rv.rule_key,rv.version_code)","      from public.ediel_rule_versions rv","      where coalesce(rv.is_active,false)=true and coalesce(rv.status,'active')='active'","    ),'[]'::jsonb),","    'engine_version','canonical-evidence-v3-role-scoped'","  );","","  return v_payload;","exception when raise_exception then return null;","end;","$$;","","--","-- Name: invalidate_v1(); Type: FUNCTION; Schema: gridex_ediel_test_capability; Owner: -","--","","CREATE FUNCTION gridex_ediel_test_capability.invalidate_v1() RETURNS trigger","    LANGUAGE plpgsql SECURITY DEFINER","    SET search_path TO 'public', 'pg_temp'","    AS $$","declare old_company uuid; new_company uuid; row_company uuid; global_change boolean;","begin"," if TG_TABLE_NAME='ediel_mailboxes' and TG_OP='UPDATE' then","  if gridex_ediel_test_capability.mailbox_configuration_v1(to_jsonb(OLD))","     is not distinct from gridex_ediel_test_capability.mailbox_configuration_v1(to_jsonb(NEW)) then","   return NEW;","  end if;"," end if;"," if TG_OP<>'INSERT' then old_company:=nullif(to_jsonb(OLD)->>'company_id','')::uuid; end if;"," if TG_OP<>'DELETE' then new_company:=nullif(to_jsonb(NEW)->>'company_id','')::uuid; end if;"," -- Null-company shared dependencies and global rule tables invalidate all."," global_change:=(TG_OP<>'INSERT' and old_company is null) or (TG_OP<>'DELETE' and new_company is null);"," for row_company in select company_id from public.company_capabilities","  where capability_code='ediel_test' and (company_id=old_company or company_id=new_company","   or (global_change and (TG_TABLE_NAME<>'ediel_mailboxes' or exists(","     select 1 from public.ediel_active_test_configurations selected","     join public.ediel_route_profiles route on route.id=selected.route_profile_id and route.company_id=selected.company_id","     where selected.company_id=public.company_capabilities.company_id","       and selected.id::text=public.company_capabilities.configuration->>'configurationId'","       and (route.mailbox_id::text=to_jsonb(OLD)->>'id' or route.mailbox_id::text=to_jsonb(NEW)->>'id')","   ))))","  order by company_id"," loop","  update public.company_capabilities set enabled=false,readiness_status='blocked',configuration='{}'::jsonb,","   blockers=array['test_configuration_changed_requires_reconciliation']::text[],updated_at=clock_timestamp()","  where company_id=row_company and capability_code='ediel_test';"," end loop;"," if TG_OP='DELETE' then return OLD; end if; return NEW;","end;","$$;","","--","-- Name: mailbox_configuration_v1(jsonb); Type: FUNCTION; Schema: gridex_ediel_test_capability; Owner: -","--","","CREATE FUNCTION gridex_ediel_test_capability.mailbox_configuration_v1(p_row jsonb) RETURNS jsonb","    LANGUAGE sql IMMUTABLE STRICT","    SET search_path TO 'pg_catalog'","    AS $$"," SELECT p_row - ARRAY['last_polled_at','last_successful_poll_at','locked_at','locked_by','last_error','updated_at']::text[];","$$;","","--","-- Name: witness_v1(uuid, uuid); Type: FUNCTION; Schema: gridex_ediel_test_capability; Owner: -","--","","CREATE FUNCTION gridex_ediel_test_capability.witness_v1(p_company uuid, p_configuration uuid) RETURNS jsonb","    LANGUAGE plpgsql STABLE SECURITY DEFINER","    SET search_path TO 'public', 'extensions', 'pg_temp'","    AS $$","declare"," c public.ediel_active_test_configurations%rowtype;"," s public.ediel_system_test_settings%rowtype;"," a public.ediel_actor_settings%rowtype;"," r public.ediel_route_profiles%rowtype;"," cr public.communication_routes%rowtype;"," snap public.ediel_configuration_snapshots%rowtype;"," portal public.ediel_counterparties%rowtype; brp public.ediel_counterparties%rowtype;"," live_payload jsonb; fingerprint text; mailbox_json jsonb; rules_json jsonb;","begin"," select * into c from public.ediel_active_test_configurations"," where id=p_configuration and company_id=p_company and status='active'"," and environment='test' and environment_type='tgt_test';"," if not found then return null; end if;"," select * into s from public.ediel_system_test_settings where id=c.system_test_settings_id"," and company_id=p_company and is_active and environment='test' and environment_type='tgt_test'"," and route_profile_id=c.route_profile_id and sender_actor_setting_id=c.actor_profile_id"," and actor_role=(case c.actor_role when 'energy_service_company' then 'esco' when 'electricity_supplier' then 'supplier' else c.actor_role end)"," and message_family=c.message_family and setup_package=c.setup_package;"," if not found or nullif(btrim(s.setup_package),'') is null then return null; end if;"," select * into a from public.ediel_actor_settings where id=c.actor_profile_id and company_id=p_company;"," if not found then return null; end if;"," select * into r from public.ediel_route_profiles where id=c.route_profile_id and company_id=p_company;"," if not found or nullif(btrim(r.mailbox),'') is null"," or (r.valid_from is not null and r.valid_from>statement_timestamp())"," or (r.valid_to is not null and r.valid_to<=statement_timestamp())"," or r.message_family is distinct from c.message_family then return null; end if;"," select * into cr from public.communication_routes where id=r.communication_route_id and company_id=p_company;"," if not found or cr.environment_type is distinct from c.environment_type then return null; end if;"," select * into portal from public.ediel_counterparties where id=s.test_portal_counterparty_id"," and company_id=p_company and environment='test' and is_active and counterparty_role='test_portal';"," if not found or upper(coalesce(portal.counterparty_ediel_id,portal.ediel_id,''))"," <> upper(coalesce(r.receiver_ediel_id,r.counterparty_ediel_id,'')) then return null; end if;"," if s.test_brp_counterparty_id is not null then","  select * into brp from public.ediel_counterparties where id=s.test_brp_counterparty_id","   and company_id=p_company and environment='test' and is_active and counterparty_role='brp';","  if not found then return null; end if;"," end if;"," select * into snap from public.ediel_configuration_snapshots where id=c.configuration_snapshot_id and company_id=p_company;"," if not found then return null; end if;"," live_payload:=gridex_ediel_test_capability.current_snapshot_payload_v1(p_company,c.actor_profile_id,c.route_profile_id);"," -- Match the actual runtime selector's OR over both legacy/current role columns."," if (select count(*) from public.ediel_actor_settings other where other.company_id=p_company","  and other.environment='test' and other.is_active and","  (case when c.actor_role in ('supplier','electricity_supplier') then","    other.role in ('supplier','electricity_supplier') or other.actor_role in ('supplier','electricity_supplier')","   when c.actor_role in ('esco','energy_service_company') then","    other.role in ('esco','energy_service_company') or other.actor_role in ('esco','energy_service_company')","   else false end))<>1 then return null; end if;"," if (select count(*) from public.ediel_system_test_settings other where other.company_id=p_company","  and other.is_active and other.environment='test' and other.environment_type=s.environment_type","  and other.test_suite=s.test_suite and other.actor_role=s.actor_role and other.message_family=s.message_family","  and other.setup_package=s.setup_package)<>1 then return null; end if;"," if (live_payload#>>'{test_context,actor_role}') is distinct from (case c.actor_role when 'esco' then 'energy_service_company' when 'electricity_supplier' then 'supplier' else c.actor_role end) then return null; end if;"," if live_payload is null or live_payload is distinct from snap.payload"," or snap.configuration_hash is distinct from encode(digest(convert_to(snap.payload::text,'utf8'),'sha256'),'hex') then return null; end if;"," if r.mailbox_id is not null then","  select gridex_ediel_test_capability.mailbox_configuration_v1(to_jsonb(m)) into mailbox_json","  from public.ediel_mailboxes m where m.id=r.mailbox_id and m.is_active and m.environment='test'","  and (m.company_id=p_company or (m.company_id is null and m.is_shared_platform_mailbox));","  if mailbox_json is null then return null; end if;"," end if;"," -- Time validity must be checked on read even when no writer fires a trigger."," if exists(select 1 from public.ediel_certificates cert","   where cert.id in(r.certificate_id,r.receiver_certificate_id)","   and ((coalesce(cert.valid_from,cert.certificate_valid_from) is not null","         and coalesce(cert.valid_from,cert.certificate_valid_from)>statement_timestamp())","     or (coalesce(cert.valid_to,cert.certificate_valid_to) is not null","         and coalesce(cert.valid_to,cert.certificate_valid_to)<=statement_timestamp()))) then return null; end if;"," select jsonb_build_object(","  'packs',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ediel_rule_packs t where status='active'),","  'profiles',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ediel_message_profiles t where is_enabled),","  'tenantProfiles',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ediel_rule_profile_versions t where company_id=p_company and status='active')"," ) into rules_json;"," fingerprint:=encode(digest(convert_to(jsonb_build_object(","  'configuration',to_jsonb(c),'settings',to_jsonb(s),'actor',to_jsonb(a),","  'route',to_jsonb(r),'communicationRoute',to_jsonb(cr),'portal',to_jsonb(portal),","  'brp',to_jsonb(brp),'mailbox',mailbox_json,'rules',rules_json,'snapshot',snap.payload,'snapshotHash',snap.configuration_hash)::text,'utf8'),'sha256'),'hex');"," return jsonb_build_object('configurationId',c.id,'snapshotId',snap.id,'fingerprint',fingerprint,'basis','canonical_tgt_configuration_v1');","end;","$$;",""]},{"preStart":42191,"preCount":0,"preSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","postStart":42510,"postCount":29,"postSha256":"340dfbb003a539a03cce437ea8d2dac0de2d0ee378a70c286f5065e75b242a2f","preLines":[],"postLines":["--","-- Name: canonical_reconcile_ediel_test_capability_v1(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -","--","","CREATE FUNCTION public.canonical_reconcile_ediel_test_capability_v1(p_company_id uuid, p_actor_user_id uuid, p_configuration_id uuid) RETURNS jsonb","    LANGUAGE plpgsql SECURITY DEFINER","    SET search_path TO 'public', 'extensions', 'pg_temp'","    AS $$","declare witness jsonb; allowed boolean;","begin"," if public.canonical_actor_is_authorized(p_company_id,p_actor_user_id,'ediel.profile.write',false) is not true then","  raise exception 'ediel_test_capability_actor_denied' using errcode='42501';"," end if;"," -- Serialize publication with invalidators. Dependencies are read, not locked:"," -- a concurrent dependency writer publishes invalidation after this lock releases."," perform 1 from public.company_capabilities where company_id=p_company_id and capability_code='ediel_test' for update;"," if not found then raise exception 'ediel_test_capability_seed_missing'; end if;"," witness:=gridex_ediel_test_capability.witness_v1(p_company_id,p_configuration_id);"," allowed:=witness is not null;"," update public.company_capabilities set enabled=allowed,","  readiness_status=case when allowed then 'ready' else 'blocked' end,","  configuration=coalesce(witness,'{}'::jsonb),","  blockers=case when allowed then '{}'::text[] else array['current_canonical_tgt_configuration_required']::text[] end,","  last_verified_at=clock_timestamp(),last_verified_by=p_actor_user_id,updated_by=p_actor_user_id,updated_at=clock_timestamp()"," where company_id=p_company_id and capability_code='ediel_test';"," return jsonb_build_object('allowed',allowed,'companyId',p_company_id,'configurationId',p_configuration_id);","end;","$$;",""]},{"preStart":44476,"preCount":0,"preSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","postStart":44824,"postCount":9,"postSha256":"4765b4992a54f56125fd05f4fde69532dab425ad5c269317e65c475431ced4ff","preLines":[],"postLines":["  -- B4 currentness: historical/manual capability flags cannot grant test admission.","  if p_operation='ediel.test.process' and v_capability_ready then","    v_capability_ready := exists (","      select 1 from public.ediel_active_test_configurations test_configuration","      where test_configuration.company_id=p_company_id","        and v_capability_row.configuration = gridex_ediel_test_capability.witness_v1(p_company_id,test_configuration.id)","    );","  end if;",""]},{"preStart":122479,"preCount":0,"preSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","postStart":122836,"postCount":5,"postSha256":"431e9a2c804504a0b338284bd7474979274962b0db60c144ff8cce33993811dd","preLines":[],"postLines":["    smtp_host text,","    smtp_port integer,","    last_successful_poll_at timestamp with time zone,","    created_by uuid,","    updated_by uuid,"]},{"preStart":158723,"preCount":0,"preSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","postStart":159085,"postCount":78,"postSha256":"de460f35db528d69660e11162b2d93847a2b4e6a334aae080445407f76fdd299","preLines":[],"postLines":["--","-- Name: communication_routes b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.communication_routes FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_active_test_configurations b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_active_test_configurations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_actor_settings b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_actor_settings FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_certificates b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_certificates FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_configuration_snapshots b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_configuration_snapshots FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_counterparties b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_counterparties FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_mailboxes b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_mailboxes FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_message_profiles b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_message_profiles FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_route_profiles b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_route_profiles FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_rule_packs b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_rule_packs FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_rule_profile_versions b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_rule_profile_versions FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_rule_versions b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_rule_versions FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();","","--","-- Name: ediel_system_test_settings b4_test_capability_invalidate; Type: TRIGGER; Schema: public; Owner: -","--","","CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR DELETE OR UPDATE ON public.ediel_system_test_settings FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();",""]},{"preStart":202255,"preCount":0,"preSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","postStart":202695,"postCount":24,"postSha256":"32eb1ffc4bfbd2010395391fd70e8518059261dde239933387854e57d68c5731","preLines":[],"postLines":["--","-- Name: FUNCTION current_snapshot_payload_v1(p_company_id uuid, p_actor_profile_id uuid, p_route_profile_id uuid); Type: ACL; Schema: gridex_ediel_test_capability; Owner: -","--","","REVOKE ALL ON FUNCTION gridex_ediel_test_capability.current_snapshot_payload_v1(p_company_id uuid, p_actor_profile_id uuid, p_route_profile_id uuid) FROM PUBLIC;","","--","-- Name: FUNCTION invalidate_v1(); Type: ACL; Schema: gridex_ediel_test_capability; Owner: -","--","","REVOKE ALL ON FUNCTION gridex_ediel_test_capability.invalidate_v1() FROM PUBLIC;","","--","-- Name: FUNCTION mailbox_configuration_v1(p_row jsonb); Type: ACL; Schema: gridex_ediel_test_capability; Owner: -","--","","REVOKE ALL ON FUNCTION gridex_ediel_test_capability.mailbox_configuration_v1(p_row jsonb) FROM PUBLIC;","","--","-- Name: FUNCTION witness_v1(p_company uuid, p_configuration uuid); Type: ACL; Schema: gridex_ediel_test_capability; Owner: -","--","","REVOKE ALL ON FUNCTION gridex_ediel_test_capability.witness_v1(p_company uuid, p_configuration uuid) FROM PUBLIC;",""]},{"preStart":205903,"preCount":0,"preSha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","postStart":206367,"postCount":7,"postSha256":"847fe7a01452c16bc16c09a68f5048216da28784a538e143a1b559a720aabc06","preLines":[],"postLines":["--","-- Name: FUNCTION canonical_reconcile_ediel_test_capability_v1(p_company_id uuid, p_actor_user_id uuid, p_configuration_id uuid); Type: ACL; Schema: public; Owner: -","--","","REVOKE ALL ON FUNCTION public.canonical_reconcile_ediel_test_capability_v1(p_company_id uuid, p_actor_user_id uuid, p_configuration_id uuid) FROM PUBLIC;","GRANT ALL ON FUNCTION public.canonical_reconcile_ediel_test_capability_v1(p_company_id uuid, p_actor_user_id uuid, p_configuration_id uuid) TO service_role;",""]}]}
const genuine1049Capture=exactPatchFixture(genuine1049Patch,local047Sha,genuine1049Patch.postSha256,genuine079Prior,true)
it.each(genuine079Restorers)('authentic1049 returns identical historical bytes: %s',restore=>{
 expect(sha(genuine1049Capture)).toBe('f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137')
 expect(restore(genuine1049Capture)).toBe(genuine079PriorOracles.get(restore))
})
it.each(['prefix','suffix','truncated'] as const)('authentic1049 refuses unknown %s bytes before fixture reads',mutation=>{
 const changed=mutation==='prefix'?'-- unknown\n'+genuine1049Capture:mutation==='suffix'?genuine1049Capture+'\n':genuine1049Capture.slice(1)
 for(const restore of genuine079Restorers)expect(()=>restore(changed)).toThrow('db05_schema_predecessor_unknown:')
 expect(injected.reads).not.toContain('local047')
})

// Genuine committed Main0ac capture and unchanged authentic82bd predecessor.
const genuine317Current=execFileSync('git',['show','0ac52c670f0e0c58a530dd649b08dc09460ea934:supabase/schema.sql'],{encoding:'utf8',maxBuffer:30_000_000})
const genuine317Prior=execFileSync('git',['show','82bd94f406c1299ed9f9329e4332051ca20fce70:supabase/schema.sql'],{encoding:'utf8',maxBuffer:30_000_000})
const genuine317Patch=JSON.parse(readFileSync(new URL('./fixtures/db05-schema-predecessor-local317-20261112.patch.json',import.meta.url),'utf8')) as CapturePatch
it.each(genuine079Restorers)('local317 authentic successor preserves exact historical oracle: %s',restore=>{
 expect(sha(genuine317Current)).toBe('8b7d84b657a1ebcbe2591107524ebeb74afb6dceac2cad49bec39a6ea9d1b26a')
 expect(sha(genuine317Prior)).toBe('f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137')
 expect(restore(genuine317Current)).toBe(genuine079PriorOracles.get(restore))
})
it('local317 exact inverse reconstructs authentic82bd bytes and refuses moved/changed hunks',()=>{
 expect(exactPatchFixture(genuine317Patch,'f25d892e78532bb5fc02c9470c8a7a2c0b6216b65f756918636730eb94c20137','8b7d84b657a1ebcbe2591107524ebeb74afb6dceac2cad49bec39a6ea9d1b26a',genuine317Current,false)).toBe(genuine317Prior)
 const changed=structuredClone(genuine317Patch);changed.hunks[0].postSha256='0'.repeat(64);injected.patchLocal317=JSON.stringify(changed)
 expect(()=>preLocal047Schema(genuine317Current)).toThrow('db05_schema_predecessor_fixture_changed:local317')
 const moved=structuredClone(genuine317Patch);moved.hunks[0].postStart++;injected.patchLocal317=JSON.stringify(moved)
 expect(()=>preLocal047Schema(genuine317Current)).toThrow('db05_schema_predecessor_fixture_changed:local317')
})
it('local317 rejects unknown bytes before inverse read and leaves older captures independent',()=>{
 for(const restore of genuine079Restorers)expect(()=>restore('-- unknown\n'+genuine317Current)).toThrow('db05_schema_predecessor_unknown:')
 expect(injected.reads).not.toContain('local317')
 injected.patchLocal317='{}'
 expect(preLocal047Schema(genuine317Prior)).toBe(preLocal047Schema(genuine1049Capture))
 expect(injected.reads).not.toContain('local317')
})
