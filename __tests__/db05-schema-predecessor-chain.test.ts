import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
import {db05PredecessorSchema} from './helpers/db05PredecessorSchema'

const injected=vi.hoisted(()=>({patch:null as string|null,patch28:null as string|null,patch29:null as string|null,patchPoa:null as string|null,patchPoaNext:null as string|null,patchTenantKey:null as string|null,reads:[] as string[]}))
vi.mock('node:fs',async original=>{
 const actual=await original<typeof import('node:fs')>()
 return {...actual,readFileSync:(path:Parameters<typeof actual.readFileSync>[0],options?:Parameters<typeof actual.readFileSync>[1])=>{
  const name=String(path)
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
const currentCapture=readFileSync('supabase/schema.sql','utf8')
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
afterEach(()=>{injected.patch=null;injected.patch28=null;injected.patch29=null;injected.patchPoa=null;injected.patchPoaNext=null;injected.patchTenantKey=null;injected.reads=[]})
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
