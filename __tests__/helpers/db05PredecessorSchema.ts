import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'

type Patch={preSha256:string;postSha256:string;hunks:{postStart:number;postCount:number;postSha256:string;preLines:string[]}[]}
const sha=(text:string)=>createHash('sha256').update(text).digest('hex')

/** Exact pre-DB-05 schema.sql capture. The checked-in capture is either that
 * predecessor or an authenticated post-DB-05 GEN; each is reversed by
 * the generated patch and the result must hash to the pinned predecessor.
 * Any other capture fails closed. */
export function db05PredecessorSchema(schema:string):string{
 let patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor.patch.json',import.meta.url),'utf8'))
 const actual=sha(schema)
 if(actual==='a15291106e26b9bea9f70dd99f3c19f6cae7e159afd8a5d4674a997d98c2eac6'){
  const mailPatch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-mail.patch.json',import.meta.url),'utf8'))
  if(mailPatch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=mailPatch
 }
 if(actual==='82df2a64df29439af19b4d0ff7b513e43d4e1a4dceb67818f65b8f8620ee2fa6'){
  const auditPatch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit21.patch.json',import.meta.url),'utf8'))
  if(auditPatch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=auditPatch
 }
 if(actual==='9eab8f0798ef736aba5bc24de56fb24876105a652ee7d701f9764c14c98b7c24'){
  const audit22Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit22.patch.json',import.meta.url),'utf8'))
  if(audit22Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit22Patch
 }
 if(actual==='1f1e8ca5458470bc7cd06ab027ffbace8af3cbc02013c83e692bc5215ad35d28'){
  const audit23Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit23.patch.json',import.meta.url),'utf8'))
  if(audit23Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit23Patch
 }
 if(actual===patch.preSha256)return schema
 if(actual!==patch.postSha256)throw Error('db05_schema_predecessor_unknown:'+actual)
 const lines=schema.split('\n')
 for(const hunk of [...patch.hunks].reverse()){
  if(sha(lines.slice(hunk.postStart,hunk.postStart+hunk.postCount).join('\n'))!==hunk.postSha256)throw Error('db05_schema_predecessor_hunk_changed:'+hunk.postStart)
  lines.splice(hunk.postStart,hunk.postCount,...hunk.preLines)
 }
 const rebuilt=lines.join('\n')
 if(sha(rebuilt)!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
 return rebuilt
}
