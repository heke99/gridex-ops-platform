import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
import {db05PredecessorSchema} from './helpers/db05PredecessorSchema'

const injected=vi.hoisted(()=>({patch:null as string|null,reads:[] as string[]}))
vi.mock('node:fs',async original=>{
 const actual=await original<typeof import('node:fs')>()
 return {...actual,readFileSync:(path:Parameters<typeof actual.readFileSync>[0],options?:Parameters<typeof actual.readFileSync>[1])=>{
  const name=String(path)
  if(name.endsWith('db05-schema-predecessor-audit27.patch.json')){
   injected.reads.push('audit27')
   if(injected.patch!==null)return injected.patch
  }
  if(name.endsWith('db05-schema-predecessor-audit26.patch.json'))injected.reads.push('audit26')
  return actual.readFileSync(path,options)
 }}
})
const source=readFileSync('supabase/schema.sql','utf8')
const audit27=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-audit27.patch.json','utf8')) as {
 preSha256:string;postSha256:string;hunks:{postStart:number;postCount:number;postSha256:string;preLines:string[]}[]}
const audit26=JSON.parse(readFileSync('__tests__/fixtures/db05-schema-predecessor-audit26.patch.json','utf8')) as {preSha256:string;postSha256:string}
const sha=(text:string)=>createHash('sha256').update(text).digest('hex')
afterEach(()=>{injected.patch=null;injected.reads=[]})

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
