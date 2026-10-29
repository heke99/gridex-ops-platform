import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'

type Patch={preSha256:string;postSha256:string;hunks:{postStart:number;postCount:number;postSha256:string;preLines:string[]}[]}
const sha=(text:string)=>createHash('sha256').update(text).digest('hex')

function reversePatch(schema:string,patch:Patch):string{
 if(sha(schema)!==patch.postSha256)throw Error('db05_schema_predecessor_unknown:'+sha(schema))
 const lines=schema.split('\n')
 for(const hunk of [...patch.hunks].reverse()){
  if(sha(lines.slice(hunk.postStart,hunk.postStart+hunk.postCount).join('\n'))!==hunk.postSha256)throw Error('db05_schema_predecessor_hunk_changed:'+hunk.postStart)
  lines.splice(hunk.postStart,hunk.postCount,...hunk.preLines)
 }
 const rebuilt=lines.join('\n')
 if(sha(rebuilt)!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
 return rebuilt
}

/** Exact pre-DB-05 schema.sql capture. The checked-in capture is either that
 * predecessor or an authenticated post-DB-05 GEN; each is reversed by
 * the generated patch and the result must hash to the pinned predecessor.
 * Any other capture fails closed. */
export function db05PredecessorSchema(schema:string):string{
 let patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor.patch.json',import.meta.url),'utf8'))
 const actual=sha(schema)
 if(actual==='4a0a481dd5b6af7323f45dd78b5f03f37d08cc3ae244fbd9ea1074f3803d0746'){
  // Genuine ordinary C12 capture011c1c44/artifact12862355503. Restore the
  // unchanged3132 POA capture before every historical DB05 inverse/oracle.
  // This finite inverse grants no confirmation/POA native or business proof.
  const successor:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-poa-20261029.patch.json',import.meta.url),'utf8'))
  if(successor.preSha256!=='313208382efbca3f87375e054352f96d4dfc33e4e48fcf1d1d21bf64698e6e9b'||successor.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,successor))
 }
 if(actual==='313208382efbca3f87375e054352f96d4dfc33e4e48fcf1d1d21bf64698e6e9b'){
  // Genuine ordinary POA capture23491/artifact12845430969. This inverse only
  // preserves historical DB05 fixtures; it grants no proof for the new POA SQL.
  const poaPatch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-poa-20261028.patch.json',import.meta.url),'utf8'))
  if(poaPatch.preSha256!=='4ab0c60bd5688e9653927491981f779b374a3a85600d8a87e050ac67f15a15ca'||poaPatch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,poaPatch))
 }
 if(actual==='4ab0c60bd5688e9653927491981f779b374a3a85600d8a87e050ac67f15a15ca'){
  // Genuine ordinary G3 capture012cc8bf/artifact12561956311. Rebuild exact
  // MAIN3d08 capture before its unchanged audit28 -> audit27 -> audit26 chain.
  const audit29Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit29.patch.json',import.meta.url),'utf8'))
  if(audit29Patch.preSha256!=='69ada64839584b3576e9b57471143f1ce23c0e87bdc724f9f2261ed15fdfa85b'||audit29Patch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,audit29Patch))
 }
 if(actual==='69ada64839584b3576e9b57471143f1ce23c0e87bdc724f9f2261ed15fdfa85b'){
  // Genuine ordinary MAIN capture from 3d08. Rebuild exact S01 capture before
  // its unchanged audit27 -> audit26 -> pinned predecessor chain.
  const audit28Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit28.patch.json',import.meta.url),'utf8'))
  if(audit28Patch.preSha256!=='fc6968d3f4d4f4e8fe9a487f3af9851c1f29d7ea708dee61f57cfa65dc4ebb4a'||audit28Patch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,audit28Patch))
 }
 if(actual==='fc6968d3f4d4f4e8fe9a487f3af9851c1f29d7ea708dee61f57cfa65dc4ebb4a'){
  // Genuine ordinary capture0ede/artifact12534357628 adds only the bounded S01
  // generated successor. Rebuild exact audit26 input before its existing proof.
  const audit27Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit27.patch.json',import.meta.url),'utf8'))
  if(audit27Patch.preSha256!=='47726959555e64a527ab2353f9532958fe6cc06bd75235375f33a04d4f231022'||audit27Patch.postSha256!==actual)throw Error('db05_schema_predecessor_rebuild_mismatch')
  return db05PredecessorSchema(reversePatch(schema,audit27Patch))
 }
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
 if(actual==='a4e65c958a235616961ad8b634f49da444f6da94025064e8d37b0f549708c1e9'){
  const audit24Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit24.patch.json',import.meta.url),'utf8'))
  if(audit24Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit24Patch
 }
 if(actual==='4383694c97944f44900e66929358d5e0acae3b57332e9f30730d6678531d07ad'){
  const audit25Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit25.patch.json',import.meta.url),'utf8'))
  if(audit25Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit25Patch
 }
 if(actual==='47726959555e64a527ab2353f9532958fe6cc06bd75235375f33a04d4f231022'){
  const audit26Patch:Patch=JSON.parse(readFileSync(new URL('../fixtures/db05-schema-predecessor-audit26.patch.json',import.meta.url),'utf8'))
  if(audit26Patch.preSha256!==patch.preSha256)throw Error('db05_schema_predecessor_rebuild_mismatch')
  patch=audit26Patch
 }
 if(actual===patch.preSha256)return schema
 if(actual!==patch.postSha256)throw Error('db05_schema_predecessor_unknown:'+actual)
 return reversePatch(schema,patch)
}
